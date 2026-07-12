/* ── game logic ─────────────────────────────────────────────── */
let gameOver=false;
let selectedSet=new Set();
let dragFrom=null, dragStart=null, dragMoved=false, boxStart=null, hoverCity=null;
// selection box (DOM)
const boxEl=document.createElement('div');
boxEl.style.cssText='position:fixed;border:1.5px solid #7ad0ff;background:rgba(120,200,255,.12);display:none;pointer-events:none;z-index:5;';
document.body.appendChild(boxEl);
// drag line (3D) — буфер под длинный маршрут по графу
/* ── стрелка отправки в стиле Mushroom Wars: плоская, голубая, расширяется к наконечнику ── */
const _alerp=(a,b,t)=>a+(b-a)*t;
const arrowPos=new Float32Array(6000*3);   // общий буфер на несколько стрелок (мультивыбор городов)
const dragArrowGeo=new T3.BufferGeometry();
dragArrowGeo.setAttribute('position',new T3.BufferAttribute(arrowPos,3));
dragArrowGeo.setDrawRange(0,0);
// двухслойный: мягкое свечение + яркое ядро (один общий буфер, два меша)
const dragGlowMat=new T3.MeshBasicMaterial({color:0x9fd4ff,transparent:true,opacity:0.28,depthWrite:false,depthTest:false,side:T3.DoubleSide});
const dragCoreMat=new T3.MeshBasicMaterial({color:0x6fc0ff,transparent:true,opacity:0.82,depthWrite:false,depthTest:false,side:T3.DoubleSide});
const dragArrow=new T3.Mesh(dragArrowGeo,dragCoreMat); dragArrow.renderOrder=30; dragArrow.visible=false; scene.add(dragArrow);
const dragArrowGlow=new T3.Mesh(dragArrowGeo,dragGlowMat); dragArrowGlow.renderOrder=29; dragArrowGlow.scale.setScalar(1); dragArrowGlow.visible=false; scene.add(dragArrowGlow);
let _av=0;
function _pV(p){if(_av+3>arrowPos.length)return;arrowPos[_av++]=p.x;arrowPos[_av++]=p.y;arrowPos[_av++]=p.z;}
function _pTri(a,b,c){_pV(a);_pV(b);_pV(c);}
function _resample(pts,n){
  const cum=[0]; let total=0;
  for(let i=1;i<pts.length;i++){total+=Math.hypot(pts[i].x-pts[i-1].x,pts[i].z-pts[i-1].z);cum.push(total);}
  if(total<1e-3)return null;
  const out=[];
  for(let k=0;k<n;k++){ const a=total*k/(n-1); let i=1; while(i<cum.length&&cum[i]<a)i++; i=Math.min(i,pts.length-1);
    const t=(a-cum[i-1])/((cum[i]-cum[i-1])||1);
    out.push({x:_alerp(pts[i-1].x,pts[i].x,t),y:_alerp(pts[i-1].y,pts[i].y,t),z:_alerp(pts[i-1].z,pts[i].z,t),arc:a}); }
  return {points:out,total};
}
function _atArc(points,arc){ for(let i=1;i<points.length;i++)if(points[i].arc>=arc){const t=(arc-points[i-1].arc)/((points[i].arc-points[i-1].arc)||1);return {x:_alerp(points[i-1].x,points[i].x,t),y:_alerp(points[i-1].y,points[i].y,t),z:_alerp(points[i-1].z,points[i].z,t)};} return points[points.length-1]; }
function _tanAt(points,arc){ for(let i=1;i<points.length;i++)if(points[i].arc>=arc){let dx=points[i].x-points[i-1].x,dz=points[i].z-points[i-1].z;const l=Math.hypot(dx,dz)||1;return {x:dx/l,z:dz/l};} const a=points[points.length-2]||points[0],b=points[points.length-1];let dx=b.x-a.x,dz=b.z-a.z;const l=Math.hypot(dx,dz)||1;return {x:dx/l,z:dz/l}; }
// добавляет треугольники ОДНОЙ стрелки в общий буфер (без сброса _av и без видимости); true если нарисовал
function _appendArrow(pts){
  const rs=pts&&pts.length>=2?_resample(pts,28):null;
  if(!rs||rs.total<1.2)return false;
  const {points,total}=rs;
  const headLen=Math.max(1.8,Math.min(total*0.34,5.5));
  const bodyLen=Math.max(0.01,total-headLen);
  const wTail=0.45,wBody=1.05,wHead=2.2,yOff=0.5;
  const cs=(p,hw,t)=>{const px=-t.z,pz=t.x;return [{x:p.x+px*hw,y:p.y+yOff,z:p.z+pz*hw},{x:p.x-px*hw,y:p.y+yOff,z:p.z-pz*hw}];};
  const tang=i=>{const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)];let dx=b.x-a.x,dz=b.z-a.z;const l=Math.hypot(dx,dz)||1;return {x:dx/l,z:dz/l};};
  let pL=null,pR=null;
  for(let i=0;i<points.length;i++){ const p=points[i]; if(p.arc>bodyLen)break;
    const hw=wTail+(wBody-wTail)*(p.arc/bodyLen); const [L,R]=cs(p,hw,tang(i));
    if(pL){_pTri(pL,pR,R);_pTri(pL,R,L);} pL=L;pR=R; }
  const be=_atArc(points,bodyLen), tEnd=_tanAt(points,bodyLen);
  const [beL,beR]=cs(be,wBody,tEnd); if(pL){_pTri(pL,pR,beR);_pTri(pL,beR,beL);}
  const [hbL,hbR]=cs(be,wHead,tEnd); const tip=points[points.length-1];
  _pTri(hbL,hbR,{x:tip.x,y:tip.y+yOff,z:tip.z});
  return true;
}
// рисует НЕСКОЛЬКО стрелок (по одной на каждый источник) в общий буфер
function updateDragArrows(list,colHex){
  _av=0; let any=false;
  for(const pts of list){ if(_av+600>arrowPos.length)break; if(_appendArrow(pts))any=true; }
  if(!any){dragArrow.visible=dragArrowGlow.visible=false;return;}
  dragArrowGeo.setDrawRange(0,_av/3); dragArrowGeo.attributes.position.needsUpdate=true; dragArrowGeo.computeBoundingSphere();
  dragCoreMat.color.setHex(colHex||0x6fc0ff); dragGlowMat.color.setHex(colHex===0xffae4a?0xffd08a:0x9fd4ff);
  dragArrow.visible=dragArrowGlow.visible=true;
}
function updateDragArrow(pts,colHex){ updateDragArrows([pts],colHex); }
function hideDragArrow(){dragArrow.visible=dragArrowGlow.visible=false;}

function newGame(){
  // remove old city/squad objects
  for(const c of cities){scene.remove(c.buildGroup);scene.remove(c.hit);scene.remove(c.ring);scene.remove(c.rangeRing);scene.remove(c.pring);scene.remove(c.bring);c.lab.remove();
    if(c.siegeOrbs)for(const o in c.siegeOrbs){scene.remove(c.siegeOrbs[o].mesh);c.siegeOrbs[o].lab.remove();}
    if(c._siegeLab){c._siegeLab.remove();c._siegeLab=null;}}
  for(const s of squads)s.destroy();
  for(const s of ships)s.destroy();
  for(const s of planes)s.destroy();
  for(const m of missiles)scene.remove(m.mesh); for(const e of fx)scene.remove(e.mesh);
  // ⚓✈ убрать динамически построенные верфи/аэродромы прошлой партии (рёбра, дороги, имена)
  for(const rm of dynamicRoadMeshes)scene.remove(rm);
  for(const de of dynamicEdges){ EDGE_BY_KEY.delete(de.key); const ei=EDGES.indexOf(de.e); if(ei>=0)EDGES.splice(ei,1);
    const al=ADJ.get(de.a); if(al)ADJ.set(de.a,al.filter(n=>n.e!==de.e)); const bl=ADJ.get(de.b); if(bl)ADJ.set(de.b,bl.filter(n=>n.e!==de.e)); }
  dynamicEdges=[]; dynamicRoadMeshes=[];
  CITY_NAMES.length=CITY_LIST.length;                       // вернуть исходные имена
  SHIPYARD_NAMES.clear(); ORIG_SHIPYARDS.forEach(n=>SHIPYARD_NAMES.add(n));
  AIRPORT_NAMES.clear(); ORIG_AIRPORTS.forEach(n=>AIRPORT_NAMES.add(n));
  cities=[];squads=[];ships=[];planes=[];missiles=[];fx=[];selectedUnits.clear();unitDrag=null;dragLead=null;selectedSet.clear();dragFrom=null;boxStart=null;hoverCity=null;hideDragArrow();boxEl.style.display='none';
  if(typeof window.resetMapBuildings==='function')window.resetMapBuildings();
  gameOver=false;panelTab='upg';
  gold=FACTIONS.map(()=>60); politPts=FACTIONS.map(()=>POLIT_START); manpower=FACTIONS.map(()=>0); airOrder=FACTIONS.map(()=>null); initTech(); factionTimer=FACTIONS.map(()=>rand(0,4.5));
  relations={}; warSince={}; truceUntil={}; peaceCD={}; playerStartedWarUntil={}; reparations=[]; gameTime=0; // все нейтральны; атаковать нельзя без объявления войны
  heroSlots=FACTIONS.map(()=>[]); heroBuffs=[]; closeHeroPick(); // 🎖 герои сбрасываются на старте партии
  warNotifQueue=[]; warNotifFrom=null; document.getElementById('warNotif').style.display='none';
  peaceOfferQueue=[]; peaceOfferFrom=null; document.getElementById('peaceOffer').style.display='none';
  if(techWinOpen)closeTech(); closeDiplo(); if(polWinOpen)closePol(); closePeace();
  CITY_DATA.forEach((d,i)=>cities.push(new City(d[0],d[1],d[2],d[3],d[4],i)));
  // capital = first city of each country
  for(const f of FACTIONS){const city=cities.find(ci=>ci.country===f.country);if(city)city.capital=true;}
  manpower=FACTIONS.map((f,i)=>manpowerCap(i)); // старт с полным пулом (города уже созданы)
  assignRegions();
  scene.updateMatrixWorld(true); // хитбоксы кликабельны сразу, до первого кадра
  document.getElementById('overlay').style.display='none';
  updatePanel(); buildHeroBar();
}

const _regCol=new T3.Color(), _polCol=new T3.Color();
let regionsDirty=false;
function markRegions(){regionsDirty=true;} // отложенная перекраска (тяжёлая на большой карте)
function politicalColor(c){
  // цвет фракции-владельца (страна → захватчик)
  return _polCol.setHex(OWNER_COL[c.owner]??0x9aa6b2);
}
function assignRegions(){
  // nearest-city voronoi over land tiles → политическая раскраска по стране/владельцу
  for(let x=0;x<GRID;x++)for(let z=0;z<GRID;z++){
    const t=tiles[x][z]; if(!t||t.isWater)continue;
    let best=null,bd=1e9;
    for(const c of cities){const dd=(x-c.gx)**2+(z-c.gz)**2;if(dd<bd){bd=dd;best=c;}}
    t.region=best;
    // сильный политический цвет + лёгкая текстура рельефа
    _regCol.copy(politicalColor(best)).lerp(t.baseCol,0.24);
    if(t.height>2.0)_regCol.lerp(TERR_WHITE,0.5); // снежные пики читаются
    landTopIM.setColorAt(t.instId,_regCol);
  }
  if(landTopIM.instanceColor)landTopIM.instanceColor.needsUpdate=true;
  // country control bonus
  const checkedCountries=new Set();
  for(const country of COUNTRIES){
    const cname=typeof canonicalCountry==='function'?canonicalCountry(country.name):country.name;
    if(checkedCountries.has(cname))continue;
    checkedCountries.add(cname);
    const cs=cities.filter(c=>c.country===cname);
    if(cs.length===0)continue;
    const o=cs[0]?.owner;
    const ctrl=cs.every(c=>c.owner===o); // вся страна у одной фракции → бонус
    for(const c of cs)c.boosted=ctrl;
  }
}
function countryCtrl(countryName){
  const cname=typeof canonicalCountry==='function'?canonicalCountry(countryName):countryName;
  const cs=cities.filter(c=>c.country===cname);
  if(cs.length===0)return null;
  const o=cs[0]?.owner;
  return cs.every(c=>c.owner===o)?o:null;
}

function sendUnits(from,to,pctOverride){
  if(from===to)return;
  // соло/MP → серверный Sim (cmdSend валидирует путь/войну/мобилизацию). Старый клиентский путь (new Squad) удалён.
  MP.cmd({cmd:'army',a:from.idx,b:to.idx,pct:Math.round(sendPct*100)});
}
/* resolveArrival / fieldBattles — в серверном Sim (мёртвый клиентский сим удалён) */
function upgradeCity(c,track){
  if(MP.guest){ MP.cmd({cmd:'upg',c:c.idx,track}); return; }
  if(c.occ){if(c.owner===OWNER.PLAYER)toast(t('toast.occNoUpgrade'));return;}
  const tier=c.branchTier(track);
  if(c.owner!==OWNER.PLAYER||tier>=MAX_TIER)return;
  const cost=upgradeCost(tier);
  if(gold[c.owner]<cost){toast(t('toast.noGoldUpgrade'));return;}
  gold[c.owner]-=cost;c[track+'Tier']=tier+1;c.syncLegacyTier(track);c.buildMeshes();markRegions();
}
function buyAmount(c,spec){
  const space=Math.floor(c.capacity-c.units-c.queued); if(space<=0)return 0;
  const cap=Math.min(space,Math.floor(gold[c.owner]/SOLDIER_PRICE),Math.floor((manpower[c.owner]||0)/SOLDIER_MP)); // лимит: место/голда/манпауэр
  if(spec==='max')return Math.max(0,cap);
  return Math.min(parseInt(spec,10),cap);
}
function buySoldiers(c,spec,unit){
  const type=(unit==='arc'||unit==='cav')?unit:'inf';   // 👥 тип найма из панели
  if(MP.guest){ MP.cmd({cmd:'buy',c:c.idx,spec:String(spec),unit:type}); return; }
  if(c.occ){if(c.owner===OWNER.PLAYER)toast(t('toast.occNoRecruit'));return;}
  const amt=buyAmount(c,spec); if(amt<=0)return;
  gold[c.owner]-=amt*SOLDIER_PRICE; manpower[c.owner]-=amt*SOLDIER_MP; c.batches.push({count:amt,time:amt*c.trainPer,elapsed:0,type});
}

/* ── исследования: граф-дерево, слоты, время ─────────────────── */
const TEFF_LBL={tr:t('tech.effTr'),td:t('tech.effTd'),sh:t('tech.effSh'),ph:t('tech.effPh'),sr:t('tech.effSr'),bd:t('tech.effBd'),cc:t('tech.effCc'),farmIncome:t('tech.effFarmIncome')};
const TUNLOCK_LBL={ships:t('tech.unlockShips'),shipMissile:t('tech.unlockShipMissile'),planes:t('tech.unlockPlanes'),planeBomb:t('tech.unlockPlaneBomb'),towers:t('tech.unlockTowers'),towerBuild:t('tech.unlockTowerBuild'),archers:t('tech.unlockArchers'),cavalry:t('tech.unlockCavalry'),farm:t('tech.unlockFarm'),village:t('tech.unlockVillage'),church:t('tech.unlockChurch')};
function techEff(n){
  const p=[];
  if(n.a)p.push(t('tech.statAtk',{v:Math.round(n.a*100)}));
  if(n.d)p.push(t('tech.statDef',{v:Math.round(n.d*100)}));
  if(n.e)p.push(t('tech.statEco',{v:Math.round(n.e*100)}));
  if(n.s)p.push(t('tech.statSpd',{v:Math.round(n.s*100)}));
  if(n.p)p.push(t('tech.statRecruit',{v:Math.round(n.p*100)}));
  if(n.v)for(const k in n.v)p.push(`${TEFF_LBL[k]||k} +${Math.round(n.v[k]*100)}%`);
  if(n.u)p.push('🔓 '+TUNLOCK_LBL[n.u]);
  if(n.slot)p.push(t('tech.statSlot'));
  return p.join(', ');
}
function nodeState(n){
  if(techHas(PLAYER,n.id))return 'done';
  if(techRes[PLAYER].some(r=>r.id===n.id))return 'inprog';
  return nodeReady(PLAYER,n)?'avail':'lock';
}
function researchNode(id){
  const n=NODE[id]; if(!n)return;
  if(techHas(PLAYER,id)||techRes[PLAYER].some(r=>r.id===id))return;
  if(!nodeReady(PLAYER,n)){toast(t('tech.needReq',{list:n.req.filter(r=>!techHas(PLAYER,r)).map(r=>tName('tech',NODE[r].name)).join(', ')}));return;}
  if(techRes[PLAYER].length>=slotCount(PLAYER)){toast(t('tech.noSlots'));return;}
  if(gold[PLAYER]<n.g){toast(t('tech.noGold'));return;}
  if(MP.guest){ MP.cmd({cmd:'research',node:id}); return; }
  gold[PLAYER]-=n.g; techRes[PLAYER].push({id,t:0}); buildTechWindow();
}
function techSlotsInner(){
  const sc=slotCount(PLAYER); let h='<div class="techSlotRail">';
  for(let i=0;i<3;i++){
    if(i>=sc){h+=`<div class="tslot lk"><span class="lock">▣</span><span>`+t('tech.slotNeedLab',{n:i+1})+`</span></div>`;continue;}
    const r=techRes[PLAYER][i];
    if(r){const n=NODE[r.id],pct=Math.min(100,r.t/n.t*100);
      h+=`<div class="tslot ac"><div class="tsf" style="width:${pct}%"></div><span class="slotIcon">${n.ic}</span><span>${tName('tech',n.name)} · `+t('tech.seconds',{s:Math.ceil(n.t-r.t)})+`</span></div>`;}
    else h+=`<div class="tslot fr"><span>`+t('tech.slotPick',{n:i+1})+`</span></div>`;
  }
  return h+'</div>';
}
function techSVG(){
  const tx=x=>110+(x-80)*1.57, ty=y=>114+(y-100)*1.18;
  const branchOrder=['war','eco','sci','ind'];
  const tierY=[142,254,366,478,590,702];
  const branchRows={
    war:[['m1'],['m2','m3'],['m4','m5','m6'],['m7','m8','m9'],['m10','m12','m14'],['m11','m13','m15']],
    eco:[['p1'],['p2','p3'],['p4','p5','p6'],['p7','p8','p9'],['p10','p11','p13'],['p12','p14','p15']],
    sci:[['k1'],['k2','k3'],['k4','k5','k6'],['k7','k8','k9'],['k10','k11','k12'],['k13','k14','k15']],
    ind:[['i1'],['i2','i3','i4'],['i5','i6','i7'],['i8','i9','i10'],['i11','i12'],['i13']],
  };
  const layout=new Map();
  for(const k of branchOrder){
    const rows=branchRows[k]||[];
    for(let t=0;t<rows.length;t++){
      const row=rows[t].map(id=>NODE[id]).filter(Boolean);
      const cx=tx(TCOLS[k].x+75);
      const step=row.length>2?66:74;
      row.forEach((n,i)=>layout.set(n.id,{x:cx+(i-(row.length-1)/2)*step,y:tierY[t]}));
    }
  }
  const pos=n=>layout.get(n.id)||{x:tx(n.x),y:ty(n.y)};
  let s='<svg viewBox="0 42 1040 714" class="techSvg" preserveAspectRatio="xMidYMin meet" xmlns="http://www.w3.org/2000/svg">';
  s+='<defs>';
  s+='<filter id="techGlow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>';
  s+='<filter id="techSoft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.2"/></filter>';
  s+='<linearGradient id="techLine" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#6a6252"/><stop offset=".5" stop-color="#d0b481"/><stop offset="1" stop-color="#6a6252"/></linearGradient>';
  s+='<radialGradient id="nodeCore" cx="45%" cy="35%" r="70%"><stop offset="0" stop-color="#28302c"/><stop offset=".68" stop-color="#151917"/><stop offset="1" stop-color="#090b0a"/></radialGradient>';
  s+='</defs>';
  for(const k of branchOrder){const C=TCOLS[k], x=tx(C.x+75);
    const headY=66, fs=k==='ind'?13:(k==='eco'?14:15);
    const labelWidth={war:55,eco:124,sci:76,ind:158}[k]||90;
    const gap=16, iconR=18, groupW=iconR*2+gap+labelWidth;
    const iconX=x-groupW/2+iconR, labelX=iconX+iconR+gap;
    s+=`<g class="techBranchHead"><circle cx="${iconX}" cy="${headY}" r="${iconR}" fill="#101614" stroke="${C.cb}" stroke-width="1.7"/><text x="${iconX}" y="${headY+6}" text-anchor="middle" font-size="17" opacity=".95">${C.ic||''}</text><text x="${labelX}" y="${headY+6}" text-anchor="start" fill="${C.cb}" font-size="${fs}" font-family="Georgia,serif" font-weight="700" letter-spacing=".4">${tName('tech',C.name)}</text></g>`;
  }
  s+='<g stroke-linecap="round">';
  for(const n of NODES)for(const r of n.req){const pa=NODE[r];if(pa){
    const st=nodeState(n), pst=nodeState(pa), active=(st==='done'||st==='inprog')&&(pst==='done'||pst==='inprog');
    const a=pos(pa), b=pos(n);
    s+=`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${active?'url(#techLine)':'#776c5c'}" stroke-width="${active?2.2:1.15}" opacity="${active ? .82 : .42}"/>`;
  }}
  s+='</g>';
  for(const n of NODES){
    const C=TCOLS[n.col], st=nodeState(n);
    const {x,y}=pos(n);
    let fill='url(#nodeCore)',stroke='#6c604f',sw=1.4,op=0.45,cls=st,halo=.18,doneBadge='';
    let bottom=`<text x="${x}" y="${y+30}" text-anchor="middle" font-size="10" font-weight="900" fill="#caa45d">${n.g}</text>`;
    if(st==='done'){stroke=C.cb;sw=2.2;op=1;halo=.42;bottom='';doneBadge=`<g class="doneBadge"><circle cx="${x+18}" cy="${y+18}" r="7.2" fill="#173421" stroke="#a8eaa4" stroke-width="1.6"/><path d="M ${x+14.7} ${y+17.7} L ${x+17.1} ${y+20.1} L ${x+21.8} ${y+14.9}" fill="none" stroke="#dff7d7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></g>`;}
    else if(st==='avail'){stroke=C.cb;sw=2.2;op=1;halo=.34;bottom=`<text x="${x}" y="${y+30}" text-anchor="middle" font-size="10" font-weight="900" fill="#f0c46a">${n.g}</text>`;}
    else if(st==='inprog'){stroke='#d5a060';sw=2.6;op=1;halo=.5;bottom=`<text x="${x}" y="${y+30}" text-anchor="middle" font-size="10" fill="#e6b36d">${n.g}</text>`;}
    const tag=n.u?'#e8714a':n.slot?'#9a7bff':null;
    s+=`<g class="tnode ${cls}" data-id="${n.id}" style="cursor:${st==='avail'?'pointer':'default'}">`;
    s+=`<circle cx="${x}" cy="${y}" r="27" fill="${stroke}" opacity="${halo}" filter="url(#techGlow)"/>`;
    s+=`<circle class="nodeOuter" cx="${x}" cy="${y}" r="24" fill="#151914" stroke="${stroke}" stroke-width="${sw}" opacity="${st==='lock' ? .72 : 1}"/>`;
    s+=`<circle class="nodeRing" cx="${x}" cy="${y}" r="18.5" fill="none" stroke="#cdb893" stroke-width="1.2" opacity="${st==='lock' ? .34 : .88}"/>`;
    s+=`<circle class="nodeCore" cx="${x}" cy="${y}" r="15" fill="${fill}" stroke="#080a09" stroke-width="1.1"/>`;
    s+=`<text x="${x}" y="${y+5}" text-anchor="middle" font-size="16" opacity="${op}">${n.ic}</text>`;
    s+=bottom;
    if(tag)s+=`<circle cx="${x+18}" cy="${y-17}" r="5" fill="${tag}" stroke="#0b0b0b" stroke-width="1"/>`;
    s+=doneBadge;
    s+='</g>';
  }
  return s+'</svg>';
}
let techWinOpen=false;
function updateTechGold(){
  const g=document.getElementById('techGold'); if(g)g.textContent=gold[PLAYER]|0;
}
function buildTechWindow(){ // полная перестройка (только по событиям, не по таймеру — иначе теряются клики)
  updateTechGold();
  document.getElementById('techGrid').innerHTML=`<div class="techSlots" id="techSlots">${techSlotsInner()}</div><div id="techGraph">${techSVG()}</div>`;
}
function refreshTechAfford(){ // частый тик: обновляем ТОЛЬКО слоты (прогресс), граф не трогаем
  if(!techWinOpen)return; updateTechGold(); const s=document.getElementById('techSlots'); if(s)s.innerHTML=techSlotsInner();
}
function unlockAllTechCheat(){
  if(typeof MP!=='undefined'&&MP.guest&&!MP.localSim){ toast(t('tech.cheatLocalOnly')); return; }
  const ids=NODES.map(n=>n.id);
  techDone[PLAYER]=new Set(ids);
  techRes[PLAYER]=[];
  recomputeTech(PLAYER);
  if(typeof LOCALSIM!=='undefined'&&LOCALSIM&&LOCALSIM.techDone&&LOCALSIM.techCache){
    LOCALSIM.techDone[PLAYER]=new Set(ids);
    LOCALSIM.techRes[PLAYER]=[];
    LOCALSIM.techCache[PLAYER]={
      add:Object.assign({},techCache[PLAYER].add),
      flags:new Set(techCache[PLAYER].flags),
      slots:techCache[PLAYER].slots
    };
  }
  if(techWinOpen)buildTechWindow();
  if(typeof updatePanel==='function')updatePanel();
  toast(t('tech.allUnlocked'));
}
function techTip(e){
  const g=e.target.closest&&e.target.closest('[data-id]');
  const tip=document.getElementById('techTip'); if(!tip)return;
  if(!g){tip.style.display='none';return;}
  const n=NODE[g.dataset.id]; if(!n){tip.style.display='none';return;}
  const st=nodeState(n);
  const lbl=st==='done'?'<span style="color:#3fd089">'+t('tech.tipDone')+'</span>'
    :st==='inprog'?'<span style="color:#ffb877">'+t('tech.tipInProg')+'</span>'
    :st==='avail'?'<span style="color:#9fe1cb">'+t('tech.tipAvail')+'</span>'
    :'<span style="color:#ff8a6a">'+t('tech.tipNeed',{list:n.req.filter(r=>!techHas(PLAYER,r)).map(r=>tName('tech',NODE[r].name)).join(', ')})+'</span>';
  tip.innerHTML=`<b>${n.ic} ${tName('tech',n.name)}</b><div class="te">${techEff(n)||'—'}</div><div class="tc">💰 ${n.g} · ⏱ `+t('tech.seconds',{s:n.t})+`</div><div class="ts2">${lbl}</div>`;
  tip.style.display='block';
  let x=e.clientX+16,y=e.clientY+16; const w=tip.offsetWidth,hh=tip.offsetHeight;
  if(x+w>innerWidth-8)x=e.clientX-w-16; if(y+hh>innerHeight-8)y=e.clientY-hh-16;
  tip.style.left=Math.max(4,x)+'px'; tip.style.top=Math.max(4,y)+'px';
}
function openTech(){techWinOpen=true;buildTechWindow();document.getElementById('techWin').style.display='flex';}
function closeTech(){techWinOpen=false;document.getElementById('techWin').style.display='none';const t=document.getElementById('techTip');if(t)t.style.display='none';}
document.getElementById('sbTech').onclick=()=>{techWinOpen?closeTech():openTech();};
document.getElementById('techClose').onclick=closeTech;
document.getElementById('techCheatAll').onclick=unlockAllTechCheat;
document.getElementById('techWin').addEventListener('click',e=>{if(e.target.id==='techWin')closeTech();});
document.getElementById('techGrid').addEventListener('click',e=>{const g=e.target.closest('[data-id]');if(g)researchNode(g.dataset.id);});
document.getElementById('techGrid').addEventListener('mousemove',techTip);
document.getElementById('techGrid').addEventListener('mouseleave',()=>{const t=document.getElementById('techTip');if(t)t.style.display='none';});

/* ── дипломатия: действия игрока + ИИ ───────────────────────── */
function factionStrength(fid){
  let s=0; for(const c of cities)if(c.owner===fid)s+=c.units+FACTION_STR_CITY_BASE;
  for(const q of squads)if(q.owner===fid)s+=q.fcount; return s;
}
// ⚡ Power: суммарная мощь фракции (армия + флот/авиация + города + прокачка городов + технологии)
function factionPower(fid){
  let p=0;
  for(const c of cities){ if(c.owner!==fid)continue;
    p += 25 + c.size*6 + c.totalTier*18 + c.units;   // город + размер + сумма прокачек + гарнизон
    if(c.capital)p+=40; }
  for(const q of squads)if(q.owner===fid)p+=q.fcount;        // армии в походе
  for(const s of ships)if(s.owner===fid)p+=14;               // флот
  for(const pl of planes)if(pl.owner===fid)p+=18;            // авиация
  p += (techDone[fid]?techDone[fid].size:0)*12;              // изученные технологии
  return Math.round(p);
}
// приток политочков фракции = база + города×k + сумма_тиров×k2 (с потолком)
function politRate(fid){
  let n=0,t=0; for(const c of cities)if(c.owner===fid){n++;t+=c.totalTier;}
  return Math.min(POLIT_RATE_MAX, POLIT_RATE_BASE + n*POLIT_PER_CITY + t*POLIT_PER_TIER);
}
// 👥 манпауэр: потолок и регенерация фракции от её городов
function manpowerCap(fid){ let m=0; for(const c of cities)if(c.owner===fid)m+=(MP_BASE+c.size*MP_PER_SIZE+c.totalTier*MP_PER_TIER)*(c.capital?MP_CAPITAL:1); return m*techMul(fid,'prod'); }
function manpowerRate(fid){ let r=0; for(const c of cities)if(c.owner===fid)r+=(MP_RATE_BASE+c.size*MP_RATE_PER_SIZE+c.totalTier*MP_RATE_PER_TIER)*(c.capital?MP_CAPITAL:1); return r*techMul(fid,'prod'); }
function commonEnemy(a,b){return FACTIONS.some(f=>f.id!==a&&f.id!==b&&atWar(a,f.id)&&atWar(b,f.id));}
function acceptAlliance(fid,vs){return commonEnemy(fid,vs)||Math.random()<POLITICS.allyAcceptProb;}
// вероятность что фракция ai примет мир от vs при дани tribute (vs платит ai)
// ── оккупация → аннексия ─────────────────────────────────────
function occCount(by,from){ let n=0; for(const c of cities)if(c.occ&&c.owner===by&&c.occFrom===from)n++; return n; }
// разрешение оккупации между a и b при мире:
// 'claimA' = a оставляет захваченное у b, но свои оккупированные города возвращает;
// 'claimB' = b оставляет захваченное у a, но свои оккупированные города возвращает;
// 'keep' = статус-кво для обеих сторон; 'white' = вернуть всё.
function resolveOccupation(a,b,terms){
  for(const c of cities){
    if(!c.occ)continue;
    if(!((c.owner===a&&c.occFrom===b)||(c.owner===b&&c.occFrom===a)))continue;
    if(terms==='keep'||(terms==='claimA'&&c.owner===a&&c.occFrom===b)||(terms==='claimB'&&c.owner===b&&c.occFrom===a)){ c.occ=false; c.occFrom=null; } // аннексия
    else { c.owner=c.occFrom; c.occ=false; c.occFrom=null; c.units=Math.max(1,c.units); c.goldTimer=0; c.batches=[]; c.recolor(); } // вернуть
  }
  markRegions();
}
// фракция полностью завоёвана (0 городов) → её занятые города становятся постоянными для текущих владельцев
function permanentAnnex(deadFid, byFid){
  for(const c of cities)if(c.occFrom===deadFid){ c.occ=false; c.occFrom=null; } // занятые dead-фракцией земли — постоянно
  // 💰 захват ВСЕХ ресурсов уничтоженной фракции победителем
  if(byFid!=null && byFid!==deadFid){
    const g=Math.floor((gold[deadFid]||0)*ANNEX_LOOT), pp=Math.floor((politPts[deadFid]||0)*ANNEX_LOOT), mp=Math.floor((manpower[deadFid]||0)*ANNEX_LOOT);
    gold[byFid]=(gold[byFid]||0)+g;
    politPts[byFid]=Math.min(POLIT_MAX,(politPts[byFid]||0)+pp);
    manpower[byFid]=Math.min(manpowerCap(byFid),(manpower[byFid]||0)+mp);
    gold[deadFid]=0; politPts[deadFid]=0; manpower[deadFid]=0;
    if(byFid===PLAYER) toast(t('toast.annexFell',{name:countryDisp(FACTIONS[deadFid].country),g})+(pp?` · ${pp}🏛`:'')+(mp?` · ${mp}👥`:''));
  }
}
// шанс что ai примет мир от vs на условиях terms{land,money,repar}
const DEBUG_BOTS_ALWAYS_ACCEPT_PEACE = true;
function peaceAcceptChance(ai,vs,terms){
  if(DEBUG_BOTS_ALWAYS_ACCEPT_PEACE && ai!==PLAYER)return 1;
  const P=POLITICS.peace, strAi=factionStrength(ai), strVs=factionStrength(vs);   // коэффициенты — из _balance.gen.js (канон balance.js)
  let s=P.base + (strVs/(strAi+1)-1)*P.strengthWeight;     // ты сильнее → охотнее соглашаются
  s += occCount(vs,ai)*P.occBonus;            // держишь их города → они хотят мира
  if(terms.land) s -= occCount(vs,ai)*P.landPenalty;   // но «оставить занятое» = отъём, сложнее
  s -= ((terms.money||0)/100)*P.moneyWeight;  // контрибуция (||0 как на сервере — без NaN при неполных terms)
  s -= ((terms.repar||0)/100)*P.reparWeight;  // репарации — самое тяжёлое
  return Math.max(P.min,Math.min(P.max,s));
}

function politEnough(cost){ if(politPts[PLAYER]>=cost)return true; toast(t('polit.notEnoughPts',{cost,have:Math.floor(politPts[PLAYER])})); return false; }
// союзники атакованной стороны автоматически втягиваются в войну против агрессора
function dragAlliesIntoWar(aggressor,target){
  const allies=FACTIONS.filter(f=>f.id!==target&&f.id!==aggressor&&allied(target,f.id)&&!atWar(aggressor,f.id));
  for(const a of allies)setWar(aggressor,a.id);
  return allies;
}
function declareWar(t){
  // после объявления войны диалог страны ЗАКРЫВАЕМ — иначе он тут же перерисуется
  // с единственной кнопкой «Заключить мир», что читается как встречный попап
  if(MP.guest){ markPlayerStartedWar(t); MP.cmd({cmd:'war',tg:t}); if(diploTarget===t)closeDiplo(); return; }
  const tl=truceLeft(PLAYER,t);
  if(tl>0){toast(t('polit.truceLeft',{name:countryDisp(FACTIONS[t].country),s:Math.ceil(tl)}));return;}
  if(!politEnough(POLIT_WAR))return;
  markPlayerStartedWar(t);
  politPts[PLAYER]-=POLIT_WAR; setWar(PLAYER,t);
  const dragged=dragAlliesIntoWar(PLAYER,t);
  toast(t('polit.warDeclared',{name:countryDisp(FACTIONS[t].country),prep:WAR_PREP,cost:POLIT_WAR}));
  if(dragged.length){ dragged.forEach(f=>{ if(f.id===PLAYER)return; if(diploTarget===f.id)refreshDiplo(); });
    toast(t('polit.alliesDragged',{list:dragged.map(f=>countryDisp(f.country)).join(', ')})); }
  if(diploTarget===t)closeDiplo(); else refreshDiplo();
  if(polWinOpen)buildPolWindow();
}
function formAlliance(t){
  if(MP.guest){ MP.cmd({cmd:'ally',tg:t}); return; }
  if(atWar(PLAYER,t)){toast(t('polit.makePeaceFirst'));return;}
  if(!politEnough(POLIT_ALLY))return;
  if(acceptAlliance(t,PLAYER)){politPts[PLAYER]-=POLIT_ALLY;setRelation(PLAYER,t,'ally');toast(t('polit.allianceFormed',{name:countryDisp(FACTIONS[t].country),cost:POLIT_ALLY}));}
  else toast(t('polit.allianceRejected',{name:countryDisp(FACTIONS[t].country)}));
  refreshDiplo();
}
function breakAlliance(t){
  if(MP.guest){ MP.cmd({cmd:'break',tg:t}); return; }
  if(!politEnough(POLIT_BREAK))return;
  politPts[PLAYER]-=POLIT_BREAK; setRelation(PLAYER,t,'neutral'); toast(t('polit.allianceBroken',{name:countryDisp(FACTIONS[t].country),cost:POLIT_BREAK})); refreshDiplo();
}
function sendSupport(t){
  if(MP.guest){ MP.cmd({cmd:'sup',tg:t}); return; }   // сервер спишет/переведёт → ack 'supDone' (точная сумма) или 'denied' (мало голды)
  const amt=Math.min(POLITICS.supportMax,gold[PLAYER]|0);
  if(amt<POLITICS.supportMin){toast(t('polit.noGoldSupport'));return;}
  gold[PLAYER]-=amt; gold[t]+=amt;
  toast(t('polit.supportSent',{amt,name:countryDisp(FACTIONS[t].country)})); refreshDiplo();
}

/* ── переговоры о мире: игрок предлагает (с данью), ИИ решает ── */
let peaceTarget=null, peaceLand=false, peaceMoney=0, peaceRepar=0;
function openPeaceDialog(t){
  if(!atWar(PLAYER,t))return;
  peaceTarget=t; peaceLand=false; peaceMoney=0; peaceRepar=0; // безопасный дефолт: белый мир, земли только явным кликом
  document.getElementById('peaceWin').style.display='flex'; refreshPeaceDialog();
}
function closePeace(){peaceTarget=null;document.getElementById('peaceWin').style.display='none';}
function peaceTermsObj(){ const occ=occCount(PLAYER,peaceTarget); return {land:peaceLand&&occ>0, money:peaceMoney, repar:peaceRepar, occ}; }
function refreshPeaceDialog(){
  if(peaceTarget==null)return;
  const f=FACTIONS[peaceTarget], T=peaceTermsObj();
  if(!T.occ&&peaceLand){peaceLand=false; T.land=false;}
  const nm=document.getElementById('peaceName');
  const country=countryDisp(f.country);
  nm.innerHTML=`<span class="peaceCountry">${country}</span><span class="peaceAction">${String(t('html.peace.title')||'Peace').replace(/[🕊:]/g,'').trim()}</span>`;
  document.getElementById('peaceInfo').innerHTML=
    t('polit.peaceInfo',{their:Math.round(factionStrength(peaceTarget)),your:Math.round(factionStrength(PLAYER)),gold:gold[peaceTarget]|0});
  document.getElementById('ptLandV').textContent = T.occ?t('polit.ptLandCities',{n:T.occ}) : t('polit.ptLandNone');
  const landBtn=document.getElementById('ptLandBtn');
  landBtn.classList.toggle('on', peaceLand);
  landBtn.disabled=!T.occ;
  landBtn.textContent=peaceLand?'✓':'';
  landBtn.setAttribute('aria-pressed',peaceLand?'true':'false');
  landBtn.title=T.occ?(peaceLand?t('polit.ptLandTitleOn'):t('polit.ptLandTitleOff')):t('polit.ptLandTitleNone');
  document.getElementById('ptMoneyV').textContent=peaceMoney+'%';
  document.getElementById('ptReparV').textContent=peaceRepar+'%';
  const ch=Math.round(peaceAcceptChance(peaceTarget,PLAYER,T)*100);
  const grab=Math.floor((gold[peaceTarget]|0)*peaceMoney/100);
  const havePol=Math.floor(politPts[PLAYER]||0), okPol=havePol>=POLIT_PEACE;
  const cd=peaceCDLeft(PLAYER,peaceTarget);
  document.getElementById('peaceChance').innerHTML=
    t('polit.peaceChance',{ch,col:ch>=60?'#5fd06a':ch>=30?'#ffce6a':'#ff7a6a'})+
    (grab?t('polit.peaceGrab',{grab}):'')+
    t('polit.peaceCost',{cost:POLIT_PEACE,col:okPol?'#cfe0f0':'#ff7a6a'})+
    (cd>0?t('polit.peaceRetry',{s:Math.ceil(cd)}):'');
  const pb=document.getElementById('peacePropose'); pb.classList.toggle('cd',cd>0); pb.style.opacity=cd>0?'0.5':''; // кнопка приглушена на кулдауне
}
function closePeaceResult(){document.getElementById('peaceResult').style.display='none';}
function peaceResultHtml(T, grab){
  const rows=[];
  if(T.land)rows.push(t('polit.resAnnex',{n:T.occ}));
  else rows.push(T.occ?t('polit.resLandBack',{n:T.occ}):t('polit.resNoTerms'));
  if(grab>0)rows.push(t('polit.resTribute',{grab}));
  if(T.repar>0)rows.push(t('polit.resRepar',{pct:T.repar}));
  return `<div class="offerTerms">${rows.map(r=>`<div>${r}</div>`).join('')}</div>`;
}
function showPeaceResult(accepted, fid, T, grab){
  const title=document.getElementById('peaceResultTitle');
  const body=document.getElementById('peaceResultBody');
  const country=FACTIONS[fid]?countryDisp(FACTIONS[fid].country):t('polit.opponentWord');
  title.textContent=accepted?t('polit.peaceAcceptedTitle'):t('polit.peaceRejectedTitle');
  title.style.color=accepted?'#9fe0ff':'#ff9a7a';
  body.innerHTML=accepted
    ? t('polit.peaceAcceptBody',{country})+peaceResultHtml(T,grab||0)
    : t('polit.peaceRejectBody',{country})+`<div class="offerTerms"><div>`+t('polit.peaceRejectHint')+`</div><div>`+t('polit.peaceRejectPause',{cd:PEACE_CD})+`</div></div>`;
  document.getElementById('peaceResult').style.display='flex';
}
function proposePeace(){
  const t=peaceTarget;
  const cd=peaceCDLeft(PLAYER,t);
  if(cd>0){ toast(t('polit.negotiationPaused',{s:Math.ceil(cd)})); return; } // анти-спам: нельзя сразу перепредложить
  if(!politEnough(POLIT_PEACE))return;          // мир стоит политочки
  const T=peaceTermsObj();
  if(MP.guest){ if(MP.cmd({cmd:'peace',tg:t,land:T.land,money:T.money,repar:T.repar})===false)return; closePeace(); return; }
  setPeaceCD(PLAYER,t);                          // одно предложение раз в PEACE_CD секунд (успех или отказ)
  if(Math.random()<peaceAcceptChance(t,PLAYER,T)){
    politPts[PLAYER]-=POLIT_PEACE;
    resolveOccupation(PLAYER,t,T.land?'claimA':'white');
    let grab=0; if(T.money>0){ grab=Math.floor((gold[t]|0)*T.money/100); gold[t]-=grab; gold[PLAYER]+=grab; }
    if(T.repar>0) reparations.push({from:t,to:PLAYER,pct:T.repar/100,until:gameTime+REPARATION_TIME});
    setRelation(PLAYER,t,'neutral'); setTruce(PLAYER,t);
    const parts=[]; if(T.land)parts.push(t('polit.partLands',{n:T.occ})); if(grab)parts.push(`+${grab}💰`); if(T.repar)parts.push(t('polit.partRepar',{pct:T.repar}));
    toast(t('polit.peaceMade',{name:countryDisp(FACTIONS[t].country),terms:parts.length?' · '+parts.join(' · '):t('polit.whitePeaceSuffix'),truce:TRUCE_TIME}));
    showPeaceResult(true,t,T,grab);
    closePeace(); refreshDiplo(); if(polWinOpen)buildPolWindow();
  } else {
    toast(t('polit.peaceRejected',{name:countryDisp(FACTIONS[t].country),cd:PEACE_CD}));
    showPeaceResult(false,t,T,0);
    refreshPeaceDialog();
  }
}

/* ── ИИ предлагает мир игроку (когда проигрывает) ────────────── */
let peaceOfferQueue=[], peaceOfferFrom=null, peaceOfferTerms=null;
function peaceOfferMode(T){
  if(!T)return 'white';
  if(T.keepPlayerLand&&T.keepEnemyLand)return 'keep';
  if(T.keepPlayerLand)return 'claimA';
  if(T.keepEnemyLand)return 'claimB';
  return 'white';
}
function makePeaceOfferTerms(fid){
  const playerOcc=occCount(PLAYER,fid), enemyOcc=occCount(fid,PLAYER);
  return {
    keepPlayerLand:false,          // ИИ предлагает белый мир: игрок возвращает занятое у ИИ
    keepEnemyLand:false,           // ИИ тоже возвращает занятое у игрока
    tribute:Math.min(gold[fid]|0,40+Math.floor(Math.random()*90)),
    playerOcc,
    enemyOcc
  };
}
function proposePeaceToPlayer(fid){
  if(playerStartedWarRecently(fid))return; // игрок сам только что начал войну — не спамим встречным миром
  if(peaceOfferFrom===fid||peaceOfferQueue.some(o=>o.fid===fid))return;
  peaceOfferQueue.push({fid,terms:makePeaceOfferTerms(fid)});
  if(document.getElementById('peaceOffer').style.display!=='flex')showNextPeaceOffer();
}
function peaceOfferTermsHtml(T){
  const rows=[];
  if(T.playerOcc>0)rows.push(T.keepPlayerLand
    ? t('polit.resAnnex',{n:T.playerOcc})
    : t('polit.offerReturnLand',{n:T.playerOcc}));
  if(T.enemyOcc>0)rows.push(T.keepEnemyLand
    ? t('polit.offerEnemyKeeps',{name:countryDisp(FACTIONS[peaceOfferFrom].country),n:T.enemyOcc})
    : t('polit.offerLandBack',{n:T.enemyOcc}));
  if(!rows.length)rows.push(t('polit.offerWhitePeace'));
  if(T.tribute>0)rows.push(t('polit.offerTribute',{tribute:T.tribute}));
  return `<div class="offerTerms">${rows.map(r=>`<div>${r}</div>`).join('')}</div>`;
}
function showNextPeaceOffer(){
  // пропустить уже неактуальные (мир уже не нужен / не воюем)
  while(peaceOfferQueue.length){
    const o=peaceOfferQueue[0];
    if(!atWar(PLAYER,o.fid)){peaceOfferQueue.shift();continue;}
    peaceOfferFrom=o.fid; peaceOfferTerms=o.terms||makePeaceOfferTerms(o.fid); peaceOfferQueue.shift();
    const f=FACTIONS[o.fid];
    document.getElementById('peaceOfferBody').innerHTML=
      t('polit.offerProposes',{col:hex6(f.color),name:countryDisp(f.country)})+
      peaceOfferTermsHtml(peaceOfferTerms);
    document.getElementById('peaceOffer').style.display='flex';
    return;
  }
  peaceOfferFrom=null; peaceOfferTerms=null; document.getElementById('peaceOffer').style.display='none';
}
function acceptPlayerPeace(){
  const fid=peaceOfferFrom, T=peaceOfferTerms||makePeaceOfferTerms(peaceOfferFrom);
  if(fid!=null&&atWar(PLAYER,fid)){
    resolveOccupation(PLAYER,fid,peaceOfferMode(T));
    setRelation(PLAYER,fid,'neutral'); setTruce(PLAYER,fid);
    const pay=Math.min(T.tribute||0,gold[fid]|0); gold[fid]-=pay; gold[PLAYER]+=pay;
    const mode=peaceOfferMode(T), landTxt=mode==='white'?t('polit.landWhite'):(mode==='claimA'?t('polit.landYouAnnex'):(mode==='claimB'?t('polit.landEnemyAnnex'):t('polit.landStatusQuo')));
    toast(t('polit.peaceWith',{name:countryDisp(FACTIONS[fid].country),pay:pay?` · `+t('polit.received',{pay}):'',land:landTxt,truce:TRUCE_TIME}));
    refreshDiplo(); if(polWinOpen)buildPolWindow();
  }
  showNextPeaceOffer();
}
function declinePlayerPeace(){
  if(peaceOfferFrom!=null)toast(t('polit.youDeclinedPeace',{name:countryDisp(FACTIONS[peaceOfferFrom].country)}));
  showNextPeaceOffer();
}

let diploTarget=null, diploBtnSig='';
function openDiplo(fid){
  if(fid===PLAYER||fid==null)return; // своя страна — без дипломатии
  if(diploTarget!==fid)diploBtnSig='';
  diploTarget=fid; document.getElementById('diploWin').style.display='flex'; refreshDiplo();
}
function closeDiplo(){diploTarget=null;diploBtnSig='';document.getElementById('diploWin').style.display='none';}
// плавающий список войн в стадии мобилизации (виден без открытия попапа)
function updateWarPreps(){
  let html='';
  for(const f of FACTIONS){
    if(f.id===PLAYER||!atWar(PLAYER,f.id))continue;
    const cd=warCountdown(PLAYER,f.id);
    if(cd>0)html+=`<div style="background:rgba(48,20,10,.86);color:#ffce6a;font-weight:800;font-size:12px;padding:6px 11px;border-radius:8px;">`+t('polit.warPrep',{name:countryDisp(f.country),s:Math.ceil(cd)})+`</div>`;
  }
  document.getElementById('warPreps').innerHTML=html;
}
const REL_RU={neutral:t('polit.relNeutral'),war:t('polit.relWar'),ally:t('polit.relAlly')};
function refreshDiplo(){
  if(diploTarget==null)return;
  const target=diploTarget, f=FACTIONS[target];
  const nm=document.getElementById('diploName');
  const rel=relation(PLAYER,target), country=countryDisp(f.country);
  const card=document.getElementById('diploCard');
  if(card)card.className='panelbox gpanel '+rel;
  const relLabel=String(REL_RU[rel]||rel).replace(/[⚔🤝]/g,'').trim();
  nm.className='diploTitle '+rel;
  nm.innerHTML=`<span class="diploCountry">${country}</span><span class="diploState">${relLabel}</span>`;
  const nc=cities.filter(c=>c.owner===target).length;
  const army=Math.round(cities.filter(c=>c.owner===target).reduce((s,c)=>s+c.units,0));
  document.getElementById('diploInfo').innerHTML=
    `<div class="wStats"><span>`+t('polit.wCities',{n:nc})+`</span><span class="sep"></span><span>`+t('polit.wArmy',{n:army})+`</span></div>`;
  const wl=warList(target), al=allyList(target);
  // полоса мобилизации при войне с игроком
  let prep='';
  if(rel==='war'){
    const cd=warCountdown(PLAYER,target);
    prep=cd>0
      ? `<div style="color:#ffb24a;font-weight:800">`+t('polit.mobilizing',{s:Math.ceil(cd)})+`</div>`
      : `<div style="color:#5fd06a;font-weight:800">`+t('polit.readyToAttack')+`</div>`;
  }
  document.getElementById('diploRel').innerHTML=
    prep+
    `<div class="relLine">`+t('polit.atWarWith',{list:wl.length?wl.join(', '):'—'})+`</div>`+
    `<div class="relLine">`+t('polit.alliancesList',{list:al.length?al.join(', '):'—'})+`</div>`;
  const box=document.getElementById('diploBtns');
  const btnSig=`${target}|${rel}`;
  if(btnSig===diploBtnSig)return;
  diploBtnSig=btnSig;
  box.innerHTML='';
  const mk=(label,cls,fn)=>{
    const b=document.createElement('button');
    b.type='button';
    b.className='dbtn '+cls;
    b.textContent=label;
    bindModalAction(b,fn);
    box.appendChild(b);
  };
  if(rel==='neutral'){
    mk(t('polit.btnDeclareWar',{cost:POLIT_WAR}),'war',()=>declareWar(target));
    mk(t('polit.btnFormAlliance',{cost:POLIT_ALLY}),'ally',()=>formAlliance(target));
    mk(t('polit.btnSendSupport'),'sup',()=>sendSupport(target));
  } else if(rel==='war'){
    mk(t('polit.btnMakePeace',{cost:POLIT_PEACE}),'peace',()=>openPeaceDialog(target));
  } else if(rel==='ally'){
    mk(t('polit.btnWarBreakAlliance',{cost:POLIT_WAR}),'war',()=>{if(!politEnough(POLIT_WAR))return;setRelation(PLAYER,target,'neutral');declareWar(target);});
    mk(t('polit.btnBreakAlliance',{cost:POLIT_BREAK}),'neutral',()=>breakAlliance(target));
    mk(t('polit.btnSendSupport'),'sup',()=>sendSupport(target));
  }
}
document.getElementById('diploClose').onclick=closeDiplo;
document.getElementById('diploWin').addEventListener('click',e=>{if(e.target.id==='diploWin')closeDiplo();});

/* ── уведомление: ИИ объявил войну игроку ───────────────────── */
let warNotifQueue=[], warNotifFrom=null, warNotifReason={};
function notifyWarDeclared(byFid,viaAlly){
  if(viaAlly&&!warNotifReason[byFid])warNotifReason[byFid]=viaAlly; // причина: втянуло за союзника
  if(warNotifFrom===byFid||warNotifQueue.includes(byFid))return;
  warNotifQueue.push(byFid);
  if(document.getElementById('warNotif').style.display!=='flex')showNextWarNotif();
}
function showNextWarNotif(){
  if(!warNotifQueue.length){warNotifFrom=null;document.getElementById('warNotif').style.display='none';return;}
  warNotifFrom=warNotifQueue.shift();
  const f=FACTIONS[warNotifFrom];
  const via=warNotifReason[warNotifFrom]; delete warNotifReason[warNotifFrom];
  const nc=cities.filter(c=>c.owner===warNotifFrom).length;
  const army=Math.round(cities.filter(c=>c.owner===warNotifFrom).reduce((s,c)=>s+c.units,0));
  const country=countryDisp(f.country);
  const ally=via?countryDisp(via):'';
  const title=document.getElementById('warNotifTitle');
  if(title){
    title.innerHTML=`<span class="dangerName">${country}</span><span class="dangerAction">${t('polit.warNotifTitlePost')}</span>`;
  }
  document.getElementById('warNotifBody').innerHTML=
    (via?`<div class="wHead">`+t('polit.warNotifAllyNote',{ally})+`</div>`:'')+
    `<div class="wStats"><span>`+t('polit.wCities',{n:nc})+`</span><span class="sep"></span><span>`+t('polit.wArmy',{n:army})+`</span></div>`+
    `<div class="wMob">`+t('polit.wMob',{prep:WAR_PREP})+`</div>`;
  document.getElementById('warNotif').style.display='flex';
}
function dismissWarNotif(){showNextWarNotif();}
bindModalAction(document.getElementById('warNotifOk'),dismissWarNotif);
bindModalAction(document.getElementById('warNotifDiplo'),()=>{const t=warNotifFrom;dismissWarNotif();openDiplo(t);});

function installPeaceUiTestHook(){
  try{
    if(typeof window==='undefined'||!/[?&]peaceTest=1(?:&|$)/.test(window.location.search))return;
    const modalState=id=>{
      const el=document.getElementById(id);
      return el?getComputedStyle(el).display:'missing';
    };
    const findCityByIdx=idx=>cities.find(c=>c.idx===idx);
    const firstEnemy=()=>FACTIONS.find(f=>f.id!==PLAYER)?.id??1;
    const closeAllPeaceTestModals=()=>{
      ['peaceWin','peaceOffer','peaceResult','warNotif'].forEach(id=>{
        const el=document.getElementById(id);
        if(el)el.style.display='none';
      });
      peaceTarget=null; peaceOfferFrom=null; peaceOfferTerms=null; peaceOfferQueue.length=0; warNotifFrom=null; warNotifQueue.length=0;
    };
    window.__peaceUiTest={
      lastSeed:null,
      foe:firstEnemy,
      setupWar(fid=firstEnemy()){
        closeAllPeaceTestModals();
        setWar(PLAYER,fid);
        politPts[PLAYER]=Math.max(politPts[PLAYER]||0,POLIT_PEACE+100);
        peaceCD[relKey(PLAYER,fid)]=0;
        return this.state(fid);
      },
      seedOccupation(fid=firstEnemy()){
        let playerHeld=cities.find(c=>!c.isShipyard&&!c.isAirport&&c.owner===PLAYER&&c.idx!=null);
        let enemyHeld=cities.find(c=>!c.isShipyard&&!c.isAirport&&c.owner===fid&&c.idx!=null);
        if(!playerHeld||!enemyHeld||playerHeld===enemyHeld){
          const normal=cities.filter(c=>!c.isShipyard&&!c.isAirport&&c.idx!=null);
          playerHeld=normal[0];
          enemyHeld=normal.find(c=>c!==playerHeld);
        }
        if(!playerHeld||!enemyHeld)throw new Error('peace test needs at least two normal cities');
        playerHeld.owner=PLAYER; playerHeld.occ=true; playerHeld.occFrom=fid; playerHeld.units=Math.max(1,playerHeld.units||1); playerHeld.recolor&&playerHeld.recolor();
        enemyHeld.owner=fid; enemyHeld.occ=true; enemyHeld.occFrom=PLAYER; enemyHeld.units=Math.max(1,enemyHeld.units||1); enemyHeld.recolor&&enemyHeld.recolor();
        this.lastSeed={playerCity:playerHeld.idx,enemyCity:enemyHeld.idx,player:FACTIONS?.[PLAYER]?.country||PLAYER,enemy:fid};
        if(typeof markRegions==='function')markRegions();
        return this.lastSeed;
      },
      openPlayerPeace(fid=firstEnemy(),withAnnex=false){
        this.setupWar(fid);
        if(withAnnex)this.seedOccupation(fid);
        openPeaceDialog(fid);
        peaceLand=!!withAnnex;
        refreshPeaceDialog();
        return this.state(fid);
      },
      toggleAnnex(){
        document.getElementById('ptLandBtn')?.click();
        return this.state(peaceTarget??firstEnemy());
      },
      propose(fid=firstEnemy(),accepted=true,withAnnex=false){
        this.setupWar(fid);
        this.seedOccupation(fid);
        openPeaceDialog(fid);
        peaceLand=!!withAnnex; peaceMoney=0; peaceRepar=0; refreshPeaceDialog();
        const oldRandom=Math.random;
        Math.random=()=>accepted?0:1;
        try{proposePeace();}finally{Math.random=oldRandom;}
        return this.state(fid);
      },
      incoming(fid=firstEnemy(),mode='white'){
        this.setupWar(fid);
        this.seedOccupation(fid);
        const terms={
          keepPlayerLand:mode==='claimA'||mode==='keep',
          keepEnemyLand:mode==='claimB'||mode==='keep',
          tribute:25,
          playerOcc:occCount(PLAYER,fid),
          enemyOcc:occCount(fid,PLAYER)
        };
        peaceOfferQueue.push({fid,terms});
        showNextPeaceOffer();
        return this.state(fid);
      },
      acceptIncoming(fid=peaceOfferFrom??firstEnemy()){
        document.getElementById('peaceOfferYes')?.click();
        return this.state(fid);
      },
      declineIncoming(fid=peaceOfferFrom??firstEnemy()){
        document.getElementById('peaceOfferNo')?.click();
        return this.state(fid);
      },
      showWar(fid=firstEnemy()){
        closeAllPeaceTestModals();
        setWar(fid,PLAYER);
        notifyWarDeclared(fid);
        return this.state(fid);
      },
      state(fid=firstEnemy()){
        const seed=this.lastSeed;
        const playerCity=seed?findCityByIdx(seed.playerCity):null;
        const enemyCity=seed?findCityByIdx(seed.enemyCity):null;
        return {
          fid,
          peaceWin:modalState('peaceWin'),
          peaceOffer:modalState('peaceOffer'),
          peaceResult:modalState('peaceResult'),
          peaceResultTitle:document.getElementById('peaceResultTitle')?.textContent||'',
          peaceResultBody:document.getElementById('peaceResultBody')?.innerText||'',
          peaceOfferBody:document.getElementById('peaceOfferBody')?.innerText||'',
          warNotif:modalState('warNotif'),
          warNotifBody:document.getElementById('warNotifBody')?.innerText||'',
          landText:document.getElementById('ptLandBtn')?.textContent||'',
          landOn:document.getElementById('ptLandBtn')?.classList.contains('on')||false,
          atWar:atWar(PLAYER,fid),
          relation:relation(PLAYER,fid),
          occPlayer:occCount(PLAYER,fid),
          occEnemy:occCount(fid,PLAYER),
          seed,
          playerCityOwner:playerCity?playerCity.owner:null,
          enemyCityOwner:enemyCity?enemyCity.owner:null,
          playerCityOcc:playerCity?!!playerCity.occ:null,
          enemyCityOcc:enemyCity?!!enemyCity.occ:null
        };
      }
    };
  }catch(e){console.error('[peace-ui-test]',e);}
}
installPeaceUiTestHook();
