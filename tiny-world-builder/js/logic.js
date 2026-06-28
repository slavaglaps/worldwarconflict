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
    if(c.siegeOrbs)for(const o in c.siegeOrbs){scene.remove(c.siegeOrbs[o].mesh);c.siegeOrbs[o].lab.remove();}}
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
  gameOver=false;panelTab='upg';
  gold=FACTIONS.map(()=>60); politPts=FACTIONS.map(()=>POLIT_START); manpower=FACTIONS.map(()=>0); airOrder=FACTIONS.map(()=>null); initTech(); factionTimer=FACTIONS.map(()=>rand(0,4.5));
  relations={}; warSince={}; truceUntil={}; peaceCD={}; reparations=[]; gameTime=0; // все нейтральны; атаковать нельзя без объявления войны
  heroSlots=FACTIONS.map(()=>[]); heroBuffs=[]; closeHeroPick(); // 🎖 герои сбрасываются на старте партии
  warNotifQueue=[]; warNotifFrom=null; document.getElementById('warNotif').style.display='none';
  peaceOfferQueue=[]; peaceOfferFrom=null; document.getElementById('peaceOffer').style.display='none';
  if(techWinOpen)closeTech(); closeDiplo(); if(polWinOpen)closePol(); closePeace();
  CITY_DATA.forEach((d,i)=>cities.push(new City(d[0],d[1],d[2],d[3],d[4],i)));
  // capital = first city of each country
  for(const c of COUNTRIES){const city=cities.find(ci=>ci.country===c.name);if(city)city.capital=true;}
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
  for(const country of COUNTRIES){
    const cs=cities.filter(c=>c.country===country.name);
    if(cs.length===0)continue;
    const o=cs[0]?.owner;
    const ctrl=cs.every(c=>c.owner===o); // вся страна у одной фракции → бонус
    for(const c of cs)c.boosted=ctrl;
  }
}
function countryCtrl(countryName){
  const cs=cities.filter(c=>c.country===countryName);
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
  if(c.occ){if(c.owner===OWNER.PLAYER)toast('🏴 Оккупированный город — нельзя прокачивать (аннексируйте через мир)');return;}
  const tier=c.branchTier(track);
  if(c.owner!==OWNER.PLAYER||tier>=MAX_TIER)return;
  const cost=upgradeCost(tier);
  if(gold[c.owner]<cost){toast('Не хватает голды на прокачку');return;}
  gold[c.owner]-=cost;c[track+'Tier']=tier+1;c.syncLegacyTier(track);c.buildMeshes();markRegions();
}
function buyAmount(c,spec){
  const space=Math.floor(c.capacity-c.units-c.queued); if(space<=0)return 0;
  const cap=Math.min(space,Math.floor(gold[c.owner]/SOLDIER_PRICE),Math.floor((manpower[c.owner]||0)/SOLDIER_MP)); // лимит: место/голда/манпауэр
  if(spec==='max')return Math.max(0,cap);
  return Math.min(parseInt(spec,10),cap);
}
function buySoldiers(c,spec){
  if(MP.guest){ MP.cmd({cmd:'buy',c:c.idx,spec:String(spec)}); return; }
  if(c.occ){if(c.owner===OWNER.PLAYER)toast('🏴 Оккупированный город — нельзя набирать армию (аннексируйте через мир)');return;}
  const amt=buyAmount(c,spec); if(amt<=0)return;
  gold[c.owner]-=amt*SOLDIER_PRICE; manpower[c.owner]-=amt*SOLDIER_MP; c.batches.push({count:amt,time:amt*c.trainPer,elapsed:0});
}

/* ── исследования: граф-дерево, слоты, время ─────────────────── */
const TEFF_LBL={tr:'радиус башен',td:'урон башен',sh:'HP кораблей',ph:'HP самолётов',sr:'дальность кораблей',bd:'урон бомб',cc:'вместимость города'};
const TUNLOCK_LBL={ships:'строить корабли',shipMissile:'обстрел берега',planes:'строить самолёты',planeBomb:'бомбёжка городов',towers:'стрельба башен'};
function techEff(n){
  const p=[];
  if(n.a)p.push(`урон +${Math.round(n.a*100)}%`);
  if(n.d)p.push(`защита +${Math.round(n.d*100)}%`);
  if(n.e)p.push(`доход +${Math.round(n.e*100)}%`);
  if(n.s)p.push(`скорость +${Math.round(n.s*100)}%`);
  if(n.p)p.push(`найм +${Math.round(n.p*100)}%`);
  if(n.v)for(const k in n.v)p.push(`${TEFF_LBL[k]||k} +${Math.round(n.v[k]*100)}%`);
  if(n.u)p.push('🔓 '+TUNLOCK_LBL[n.u]);
  if(n.slot)p.push('🔬 +1 слот');
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
  if(!nodeReady(PLAYER,n)){toast('Нужно: '+n.req.filter(r=>!techHas(PLAYER,r)).map(r=>NODE[r].name).join(', '));return;}
  if(techRes[PLAYER].length>=slotCount(PLAYER)){toast('Нет свободных слотов исследования');return;}
  if(gold[PLAYER]<n.g){toast('Не хватает голды на исследование');return;}
  gold[PLAYER]-=n.g; techRes[PLAYER].push({id,t:0}); buildTechWindow();
}
function techSlotsInner(){
  const sc=slotCount(PLAYER); let h=`<span class="tg">💰 ${gold[PLAYER]|0}</span>`;
  for(let i=0;i<3;i++){
    if(i>=sc){h+=`<div class="tslot lk">🔒 слот ${i+1} — нужна Лаборатория</div>`;continue;}
    const r=techRes[PLAYER][i];
    if(r){const n=NODE[r.id],pct=Math.min(100,r.t/n.t*100);
      h+=`<div class="tslot ac"><div class="tsf" style="width:${pct}%"></div><span>${n.ic} ${n.name} · ${Math.ceil(n.t-r.t)}с</span></div>`;}
    else h+=`<div class="tslot fr">слот ${i+1}: выберите узел</div>`;
  }
  return h;
}
function techSVG(){
  let s='<svg viewBox="0 0 680 460" class="techSvg" xmlns="http://www.w3.org/2000/svg">';
  for(const k in TCOLS){const C=TCOLS[k];
    s+=`<rect x="${C.x}" y="52" width="150" height="386" rx="10" fill="${C.c}" opacity="0.13"/>`;
    s+=`<text x="${C.x+75}" y="74" text-anchor="middle" fill="${C.cb}" font-size="12" font-weight="700">${C.name}</text>`;}
  s+='<line x1="40" y1="212" x2="664" y2="212" stroke="#1f2c38"/><line x1="40" y1="324" x2="664" y2="324" stroke="#1f2c38"/>';
  s+='<text x="22" y="152" text-anchor="middle" fill="#3a4a5a" font-size="19">I</text><text x="20" y="274" text-anchor="middle" fill="#3a4a5a" font-size="19">II</text><text x="18" y="386" text-anchor="middle" fill="#3a4a5a" font-size="19">III</text>';
  s+='<g stroke="#46586a" stroke-width="1.1" opacity="0.5">';
  for(const n of NODES)for(const r of n.req){const pa=NODE[r];if(pa)s+=`<line x1="${pa.x}" y1="${pa.y}" x2="${n.x}" y2="${n.y}"/>`;}
  s+='</g>';
  for(const n of NODES){
    const C=TCOLS[n.col], st=nodeState(n);
    let fill='#0f1822',stroke='#243240',sw=1.2,op=0.45,cls='';
    let bottom=`<text x="${n.x}" y="${n.y+11}" text-anchor="middle" font-size="9" font-weight="700" fill="#caa64a">${n.g}</text>`;
    if(st==='done'){fill='#16331f';stroke=C.cb;sw=2.2;op=1;bottom=`<text x="${n.x}" y="${n.y+12}" text-anchor="middle" font-size="11" fill="#3fd089">✓</text>`;}
    else if(st==='avail'){fill='#1a2735';stroke=C.c;sw=1.7;op=0.95;bottom=`<text x="${n.x}" y="${n.y+11}" text-anchor="middle" font-size="9" font-weight="700" fill="#ffcf66">${n.g}</text>`;}
    else if(st==='inprog'){fill='#2a2113';stroke='#ff8a3a';sw=2.2;op=1;cls='inprog';bottom=`<text x="${n.x}" y="${n.y+12}" text-anchor="middle" font-size="9" fill="#ffb877">⏳</text>`;}
    const tag=n.u?'#e8714a':n.slot?'#9a7bff':null;
    s+=`<g class="tnode ${cls}" data-id="${n.id}" style="cursor:${st==='avail'?'pointer':'default'}">`;
    s+=`<rect x="${n.x-13}" y="${n.y-15}" width="26" height="30" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
    s+=`<text x="${n.x}" y="${n.y-1}" text-anchor="middle" font-size="13" opacity="${op}">${n.ic}</text>`;
    s+=bottom;
    if(tag)s+=`<rect x="${n.x+6}" y="${n.y-14}" width="6" height="6" rx="1.5" fill="${tag}"/>`;
    s+='</g>';
  }
  return s+'</svg>';
}
let techWinOpen=false;
function buildTechWindow(){ // полная перестройка (только по событиям, не по таймеру — иначе теряются клики)
  document.getElementById('techGrid').innerHTML=`<div class="techSlots" id="techSlots">${techSlotsInner()}</div><div id="techGraph">${techSVG()}</div>`;
}
function refreshTechAfford(){ // частый тик: обновляем ТОЛЬКО слоты (прогресс), граф не трогаем
  if(!techWinOpen)return; const s=document.getElementById('techSlots'); if(s)s.innerHTML=techSlotsInner();
}
function techTip(e){
  const g=e.target.closest&&e.target.closest('[data-id]');
  const tip=document.getElementById('techTip'); if(!tip)return;
  if(!g){tip.style.display='none';return;}
  const n=NODE[g.dataset.id]; if(!n){tip.style.display='none';return;}
  const st=nodeState(n);
  const lbl=st==='done'?'<span style="color:#3fd089">✓ изучено</span>'
    :st==='inprog'?'<span style="color:#ffb877">⏳ исследуется…</span>'
    :st==='avail'?'<span style="color:#9fe1cb">▶ можно исследовать — клик</span>'
    :'<span style="color:#ff8a6a">🔒 нужно: '+n.req.filter(r=>!techHas(PLAYER,r)).map(r=>NODE[r].name).join(', ')+'</span>';
  tip.innerHTML=`<b>${n.ic} ${n.name}</b><div class="te">${techEff(n)||'—'}</div><div class="tc">💰 ${n.g} · ⏱ ${n.t}с</div><div class="ts2">${lbl}</div>`;
  tip.style.display='block';
  let x=e.clientX+16,y=e.clientY+16; const w=tip.offsetWidth,hh=tip.offsetHeight;
  if(x+w>innerWidth-8)x=e.clientX-w-16; if(y+hh>innerHeight-8)y=e.clientY-hh-16;
  tip.style.left=Math.max(4,x)+'px'; tip.style.top=Math.max(4,y)+'px';
}
function openTech(){techWinOpen=true;buildTechWindow();document.getElementById('techWin').style.display='flex';}
function closeTech(){techWinOpen=false;document.getElementById('techWin').style.display='none';const t=document.getElementById('techTip');if(t)t.style.display='none';}
document.getElementById('sbTech').onclick=()=>{techWinOpen?closeTech():openTech();};
document.getElementById('techClose').onclick=closeTech;
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
// разрешение оккупации между a и b при мире: 'keep'=каждый оставляет занятое (аннексия); 'white'=вернуть всё
function resolveOccupation(a,b,terms){
  for(const c of cities){
    if(!c.occ)continue;
    if(!((c.owner===a&&c.occFrom===b)||(c.owner===b&&c.occFrom===a)))continue;
    if(terms==='keep'){ c.occ=false; c.occFrom=null; }                       // аннексия по статус-кво
    else { c.owner=c.occFrom; c.occ=false; c.occFrom=null; c.units=Math.max(1,c.units); c.goldTimer=0; c.batches=[]; c.recolor(); } // белый мир — вернуть
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
    if(byFid===PLAYER) toast(`🏴 ${FACTIONS[deadFid].country} пал! Захвачено: ${g}💰`+(pp?` · ${pp}🏛`:'')+(mp?` · ${mp}👥`:''));
  }
}
// шанс что ai примет мир от vs на условиях terms{land,money,repar}
function peaceAcceptChance(ai,vs,terms){
  const P=POLITICS.peace, strAi=factionStrength(ai), strVs=factionStrength(vs);   // коэффициенты — из _balance.gen.js (канон balance.js)
  let s=P.base + (strVs/(strAi+1)-1)*P.strengthWeight;     // ты сильнее → охотнее соглашаются
  s += occCount(vs,ai)*P.occBonus;            // держишь их города → они хотят мира
  if(terms.land) s -= occCount(vs,ai)*P.landPenalty;   // но «оставить занятое» = отъём, сложнее
  s -= ((terms.money||0)/100)*P.moneyWeight;  // контрибуция (||0 как на сервере — без NaN при неполных terms)
  s -= ((terms.repar||0)/100)*P.reparWeight;  // репарации — самое тяжёлое
  return Math.max(P.min,Math.min(P.max,s));
}

function politEnough(cost){ if(politPts[PLAYER]>=cost)return true; toast(`🏛 Не хватает политических очков: нужно ${cost} (есть ${Math.floor(politPts[PLAYER])})`); return false; }
// союзники атакованной стороны автоматически втягиваются в войну против агрессора
function dragAlliesIntoWar(aggressor,target){
  const allies=FACTIONS.filter(f=>f.id!==target&&f.id!==aggressor&&allied(target,f.id)&&!atWar(aggressor,f.id));
  for(const a of allies)setWar(aggressor,a.id);
  return allies;
}
function declareWar(t){
  if(MP.guest){ MP.cmd({cmd:'war',tg:t}); return; }
  const tl=truceLeft(PLAYER,t);
  if(tl>0){toast(`🕊 Перемирие с ${FACTIONS[t].country}: ещё ${Math.ceil(tl)}с`);return;}
  if(!politEnough(POLIT_WAR))return;
  politPts[PLAYER]-=POLIT_WAR; setWar(PLAYER,t);
  const dragged=dragAlliesIntoWar(PLAYER,t);
  toast(`⚔ Война объявлена: ${FACTIONS[t].country} · мобилизация ${WAR_PREP}с · −${POLIT_WAR}🏛`);
  if(dragged.length){ dragged.forEach(f=>{ if(f.id===PLAYER)return; if(diploTarget===f.id)refreshDiplo(); });
    toast(`🤝 Союзники втянуты в войну: ${dragged.map(f=>f.country).join(', ')}`); }
  refreshDiplo(); if(polWinOpen)buildPolWindow();
}
function formAlliance(t){
  if(MP.guest){ MP.cmd({cmd:'ally',tg:t}); return; }
  if(atWar(PLAYER,t)){toast('Сначала заключите мир');return;}
  if(!politEnough(POLIT_ALLY))return;
  if(acceptAlliance(t,PLAYER)){politPts[PLAYER]-=POLIT_ALLY;setRelation(PLAYER,t,'ally');toast(`🤝 Союз заключён: ${FACTIONS[t].country} · −${POLIT_ALLY}🏛`);}
  else toast(`${FACTIONS[t].country} отклоняет союз`);
  refreshDiplo();
}
function breakAlliance(t){
  if(MP.guest){ MP.cmd({cmd:'break',tg:t}); return; }
  if(!politEnough(POLIT_BREAK))return;
  politPts[PLAYER]-=POLIT_BREAK; setRelation(PLAYER,t,'neutral'); toast(`💔 Союз расторгнут: ${FACTIONS[t].country} · −${POLIT_BREAK}🏛`); refreshDiplo();
}
function sendSupport(t){
  if(MP.guest){ MP.cmd({cmd:'sup',tg:t}); return; }   // сервер спишет/переведёт → ack 'supDone' (точная сумма) или 'denied' (мало голды)
  const amt=Math.min(POLITICS.supportMax,gold[PLAYER]|0);
  if(amt<POLITICS.supportMin){toast('Мало голды для поддержки');return;}
  gold[PLAYER]-=amt; gold[t]+=amt;
  toast(`💰 Поддержка ${amt}💰 → ${FACTIONS[t].country}`); refreshDiplo();
}

/* ── переговоры о мире: игрок предлагает (с данью), ИИ решает ── */
let peaceTarget=null, peaceLand=false, peaceMoney=0, peaceRepar=0;
function openPeaceDialog(t){
  if(!atWar(PLAYER,t))return;
  peaceTarget=t; peaceLand=occCount(PLAYER,t)>0; peaceMoney=0; peaceRepar=0; // по умолчанию оставляем занятое
  document.getElementById('peaceWin').style.display='flex'; refreshPeaceDialog();
}
function closePeace(){peaceTarget=null;document.getElementById('peaceWin').style.display='none';}
function peaceTermsObj(){ const occ=occCount(PLAYER,peaceTarget); return {land:peaceLand&&occ>0, money:peaceMoney, repar:peaceRepar, occ}; }
function refreshPeaceDialog(){
  if(peaceTarget==null)return;
  const f=FACTIONS[peaceTarget], T=peaceTermsObj();
  const nm=document.getElementById('peaceName'); nm.textContent='🕊 Мир: '+f.country; nm.style.color=hex6(f.color);
  document.getElementById('peaceInfo').innerHTML=
    `Их сила <b>${Math.round(factionStrength(peaceTarget))}</b> · Ваша <b>${Math.round(factionStrength(PLAYER))}</b> · казна врага <b style="color:#ffd23f">${gold[peaceTarget]|0}💰</b>`;
  document.getElementById('ptLandV').textContent = T.occ?`${T.occ} занятых` : 'нечего занимать';
  document.getElementById('ptLandBtn').classList.toggle('on', T.land);
  document.getElementById('ptMoneyV').textContent=peaceMoney+'%';
  document.getElementById('ptReparV').textContent=peaceRepar+'%';
  const ch=Math.round(peaceAcceptChance(peaceTarget,PLAYER,T)*100);
  const grab=Math.floor((gold[peaceTarget]|0)*peaceMoney/100);
  const havePol=Math.floor(politPts[PLAYER]||0), okPol=havePol>=POLIT_PEACE;
  const cd=peaceCDLeft(PLAYER,peaceTarget);
  document.getElementById('peaceChance').innerHTML=
    `Шанс: <b style="color:${ch>=60?'#5fd06a':ch>=30?'#ffce6a':'#ff7a6a'}">${ch}%</b>`+
    (grab?` · заберёте <b style="color:#ffd23f">${grab}💰</b>`:'')+
    ` · стоит <b style="color:${okPol?'#cfe0f0':'#ff7a6a'}">${POLIT_PEACE}🏛</b>`+
    (cd>0?` · <b style="color:#ff9a6a">⏳ повтор через ${Math.ceil(cd)}с</b>`:'');
  const pb=document.getElementById('peacePropose'); pb.classList.toggle('cd',cd>0); pb.style.opacity=cd>0?'0.5':''; // кнопка приглушена на кулдауне
}
function proposePeace(){
  const t=peaceTarget;
  const cd=peaceCDLeft(PLAYER,t);
  if(cd>0){ toast(`🕊 Переговоры на паузе: ещё ${Math.ceil(cd)}с`); return; } // анти-спам: нельзя сразу перепредложить
  if(!politEnough(POLIT_PEACE))return;          // мир стоит политочки
  const T=peaceTermsObj();
  if(MP.guest){ MP.cmd({cmd:'peace',tg:t,land:T.land,money:T.money,repar:T.repar}); closePeace(); return; }
  setPeaceCD(PLAYER,t);                          // одно предложение раз в PEACE_CD секунд (успех или отказ)
  if(Math.random()<peaceAcceptChance(t,PLAYER,T)){
    politPts[PLAYER]-=POLIT_PEACE;
    resolveOccupation(PLAYER,t,T.land?'keep':'white');
    let grab=0; if(T.money>0){ grab=Math.floor((gold[t]|0)*T.money/100); gold[t]-=grab; gold[PLAYER]+=grab; }
    if(T.repar>0) reparations.push({from:t,to:PLAYER,pct:T.repar/100,until:gameTime+REPARATION_TIME});
    setRelation(PLAYER,t,'neutral'); setTruce(PLAYER,t);
    const parts=[]; if(T.land)parts.push(`${T.occ} земель`); if(grab)parts.push(`+${grab}💰`); if(T.repar)parts.push(`репарации ${T.repar}%`);
    toast(`🕊 Мир: ${FACTIONS[t].country}${parts.length?' · '+parts.join(' · '):' · белый мир'} · перемирие ${TRUCE_TIME}с`);
    closePeace(); refreshDiplo(); if(polWinOpen)buildPolWindow();
  } else {
    toast(`${FACTIONS[t].country} отклонил мир — смягчите условия (повтор через ${PEACE_CD}с)`);
    refreshPeaceDialog();
  }
}

/* ── ИИ предлагает мир игроку (когда проигрывает) ────────────── */
let peaceOfferQueue=[], peaceOfferFrom=null, peaceOfferTribute=0;
function proposePeaceToPlayer(fid){
  if(peaceOfferFrom===fid||peaceOfferQueue.some(o=>o.fid===fid))return;
  const tribute=Math.min(gold[fid]|0,40+Math.floor(Math.random()*90)); // ИИ предлагает дань
  peaceOfferQueue.push({fid,tribute});
  if(document.getElementById('peaceOffer').style.display!=='flex')showNextPeaceOffer();
}
function showNextPeaceOffer(){
  // пропустить уже неактуальные (мир уже не нужен / не воюем)
  while(peaceOfferQueue.length){
    const o=peaceOfferQueue[0];
    if(!atWar(PLAYER,o.fid)){peaceOfferQueue.shift();continue;}
    peaceOfferFrom=o.fid; peaceOfferTribute=o.tribute; peaceOfferQueue.shift();
    const f=FACTIONS[o.fid];
    document.getElementById('peaceOfferBody').innerHTML=
      `<b style="color:${hex6(f.color)}">${f.country}</b> предлагает мир.`+
      (o.tribute>0?`<br>Предлагает дань: <b style="color:#ffd23f">${o.tribute}💰</b>`:'');
    document.getElementById('peaceOffer').style.display='flex';
    return;
  }
  peaceOfferFrom=null; document.getElementById('peaceOffer').style.display='none';
}
function acceptPlayerPeace(){
  const fid=peaceOfferFrom, tr=peaceOfferTribute;
  if(fid!=null&&atWar(PLAYER,fid)){
    resolveOccupation(PLAYER,fid,'white');  // предложение ИИ = белый мир (занятое возвращается)
    setRelation(PLAYER,fid,'neutral'); setTruce(PLAYER,fid);
    const pay=Math.min(tr,gold[fid]|0); gold[fid]-=pay; gold[PLAYER]+=pay;
    toast(`🕊 Мир с ${FACTIONS[fid].country}${pay?` · получено ${pay}💰`:''} · белый мир · перемирие ${TRUCE_TIME}с`);
    refreshDiplo(); if(polWinOpen)buildPolWindow();
  }
  showNextPeaceOffer();
}
function declinePlayerPeace(){
  if(peaceOfferFrom!=null)toast(`Вы отклонили мир с ${FACTIONS[peaceOfferFrom].country}`);
  showNextPeaceOffer();
}

let diploTarget=null;
function openDiplo(fid){
  if(fid===PLAYER||fid==null)return; // своя страна — без дипломатии
  diploTarget=fid; document.getElementById('diploWin').style.display='flex'; refreshDiplo();
}
function closeDiplo(){diploTarget=null;document.getElementById('diploWin').style.display='none';}
// плавающий список войн в стадии мобилизации (виден без открытия попапа)
function updateWarPreps(){
  let html='';
  for(const f of FACTIONS){
    if(f.id===PLAYER||!atWar(PLAYER,f.id))continue;
    const cd=warCountdown(PLAYER,f.id);
    if(cd>0)html+=`<div style="background:rgba(48,20,10,.86);color:#ffce6a;font-weight:800;font-size:12px;padding:6px 11px;border-radius:8px;">⏳ Война · ${f.country}: ${Math.ceil(cd)}с до атаки</div>`;
  }
  document.getElementById('warPreps').innerHTML=html;
}
const REL_RU={neutral:'нейтралитет',war:'⚔ ВОЙНА',ally:'🤝 СОЮЗ'};
function refreshDiplo(){
  if(diploTarget==null)return;
  const f=FACTIONS[diploTarget];
  const nm=document.getElementById('diploName');
  nm.textContent=f.country; nm.style.color='#'+f.color.toString(16).padStart(6,'0');
  const nc=cities.filter(c=>c.owner===diploTarget).length;
  const army=Math.round(cities.filter(c=>c.owner===diploTarget).reduce((s,c)=>s+c.units,0));
  document.getElementById('diploInfo').textContent=`Города: ${nc} · Армия: ${army}`;
  const wl=warList(diploTarget), al=allyList(diploTarget), rel=relation(PLAYER,diploTarget);
  // полоса мобилизации при войне с игроком
  let prep='';
  if(rel==='war'){
    const cd=warCountdown(PLAYER,diploTarget);
    prep=cd>0
      ? `<div style="color:#ffb24a;font-weight:800">⏳ Мобилизация: ${Math.ceil(cd)}с — атака пока недоступна</div>`
      : `<div style="color:#5fd06a;font-weight:800">✓ Готовы к атаке</div>`;
  }
  document.getElementById('diploRel').innerHTML=
    `<div class="you">С вами: ${REL_RU[rel]}</div>`+prep+
    `<div>⚔ Воюет с: ${wl.length?wl.join(', '):'—'}</div>`+
    `<div>🤝 Союзы: ${al.length?al.join(', '):'—'}</div>`;
  const box=document.getElementById('diploBtns'); box.innerHTML='';
  const mk=(label,cls,fn)=>{const b=document.createElement('button');b.className='dbtn '+cls;b.textContent=label;b.onclick=fn;box.appendChild(b);};
  if(rel==='neutral'){
    mk(`⚔ Объявить войну (${POLIT_WAR}🏛)`,'war',()=>declareWar(diploTarget));
    mk(`🤝 Заключить союз (${POLIT_ALLY}🏛)`,'ally',()=>formAlliance(diploTarget));
    mk('💰 Отправить поддержку','sup',()=>sendSupport(diploTarget));
  } else if(rel==='war'){
    mk(`🕊 Заключить мир (${POLIT_PEACE}🏛)`,'peace',()=>openPeaceDialog(diploTarget));
  } else if(rel==='ally'){
    mk(`⚔ Война + разрыв союза (${POLIT_WAR}🏛)`,'war',()=>{if(!politEnough(POLIT_WAR))return;setRelation(PLAYER,diploTarget,'neutral');declareWar(diploTarget);});
    mk(`💔 Расторгнуть союз (${POLIT_BREAK}🏛)`,'neutral',()=>breakAlliance(diploTarget));
    mk('💰 Отправить поддержку','sup',()=>sendSupport(diploTarget));
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
  const col=`#${f.color.toString(16).padStart(6,'0')}`;
  const head=via
    ? `<b style="color:${col}">${f.country}</b> напал на вашего союзника <b>${via}</b> — вы втянуты в войну!`
    : `<b style="color:${col}">${f.country}</b> объявил вам войну!`;
  document.getElementById('warNotifBody').innerHTML=
    `<div class="wHead">${head}</div>`+
    `<div class="wStats"><span>🏛 Города:<b>${nc}</b></span><span class="sep"></span><span>🛡 Армия:<b>${army}</b></span></div>`+
    `<div class="wMob">Мобилизация <b>${WAR_PREP}с</b> — затем начнутся атаки.</div>`;
  document.getElementById('warNotif').style.display='flex';
}
function dismissWarNotif(){showNextWarNotif();}
document.getElementById('warNotifOk').onclick=dismissWarNotif;
document.getElementById('warNotifDiplo').onclick=()=>{const t=warNotifFrom;dismissWarNotif();openDiplo(t);};
