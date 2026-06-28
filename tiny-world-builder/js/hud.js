/* ── panel (DOM) ────────────────────────────────────────────── */
const tabUpgBtn=document.getElementById('tabUpg'), tabArmyBtn=document.getElementById('tabArmy');
tabUpgBtn.onclick=()=>{panelTab='upg';updatePanel();};
tabArmyBtn.onclick=()=>{panelTab='army';updatePanel();};
document.getElementById('ovBtn').onclick=openCountryPick;  // «Играть снова» → выбор страны

// постоянные строки кнопок (не пересоздаются на каждом тике → клики не теряются)
let panelCity=null, shipBuildRow=null, airRecallRow=null, aaUpgRow=null, yardShipRow=null, yardAirRow=null;
const upgRows={}, buyRows={};
function buildShip(yard,actor){
  if(MP.guest){ MP.cmd({cmd:'bship',c:yard.idx}); return; }   // гость → команда хосту
  const a=actor==null?PLAYER:actor, P=a===PLAYER;
  if(yard.owner!==a)return;
  if(yard.occ){if(P)toast('🏴 Оккупированная верфь — нельзя строить (аннексируйте через мир)');return;}
  if(!techFlag(a,'ships')){if(P)toast('🔒 Сначала исследуйте «Верфь» (🔬)');return;}
  if(gold[a]<SHIP_COST){if(P)toast('Не хватает голды на корабль');return;}
  if((manpower[a]||0)<SHIP_MP){if(P)toast(`👥 Не хватает манпауэра (нужно ${SHIP_MP})`);return;}
  gold[a]-=SHIP_COST; manpower[a]-=SHIP_MP; yard.shipQueue++; if(P)updatePanel();
}
function buildPlane(port,actor){
  if(MP.guest){ MP.cmd({cmd:'bplane',c:port.idx}); return; }
  const a=actor==null?PLAYER:actor, P=a===PLAYER;
  if(port.owner!==a)return;
  if(port.occ){if(P)toast('🏴 Оккупированный аэропорт — нельзя строить (аннексируйте через мир)');return;}
  if(!techFlag(a,'planes')){if(P)toast('🔒 Сначала исследуйте «Аэродром» (🔬)');return;}
  if(gold[a]<PLANE_COST){if(P)toast('Не хватает голды на самолёт');return;}
  if((manpower[a]||0)<PLANE_MP){if(P)toast(`👥 Не хватает манпауэра (нужно ${PLANE_MP})`);return;}
  gold[a]-=PLANE_COST; manpower[a]-=PLANE_MP; port.planeQueue++; if(P)updatePanel();
}
/* ── постройка верфи/аэродрома как отдельного под-города рядом с городом ── */
function isCoastal(c){ for(let r=1;r<=3;r++)for(let dx=-r;dx<=r;dx++)for(let dz=-r;dz<=r;dz++){
  if(Math.max(Math.abs(dx),Math.abs(dz))!==r)continue; const t=tiles[c.gx+dx]?.[c.gz+dz]; if(t&&t.isWater)return true; } return false; }
// свободный тайл-суша рядом с родителем (для верфи — у воды)
function findYardSpot(parent,kind){
  let best=null,bs=-1;
  for(let r=2;r<=4;r++)for(let dx=-r;dx<=r;dx++)for(let dz=-r;dz<=r;dz++){
    if(Math.max(Math.abs(dx),Math.abs(dz))!==r)continue;
    const x=parent.gx+dx,z=parent.gz+dz;
    if(x<2||z<2||x>=GRID-2||z>=GRID-2)continue;
    const t=tiles[x]?.[z]; if(!t||t.isWater)continue;             // суша
    if(cities.some(c=>(c.gx-x)**2+(c.gz-z)**2<5))continue;        // не на другом городе
    let score=10-r;                                              // ближе — лучше
    if(kind==='ship'){ let coast=false; for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++){const w=tiles[x+a]?.[z+b];if(w&&w.isWater)coast=true;} if(!coast)continue; score+=6; }
    if(score>bs){bs=score;best={x,z};}
  }
  return best;
}
// рантайм-ребро дороги по реальным позициям городов (CITY_DATA не содержит динамических)
function addEdgeRuntime(a,b){
  const key=edgeKey(a,b); if(EDGE_BY_KEY.has(key))return EDGE_BY_KEY.get(key);
  const A={x:cities[a].gx,z:cities[a].gz}, B={x:cities[b].gx,z:cities[b].gz};
  const len=Math.hypot(B.x-A.x,B.z-A.z), steps=Math.max(2,Math.ceil(len/0.6)), pts=[];
  for(let s=0;s<=steps;s++){const x=A.x+(B.x-A.x)*s/steps,z=A.z+(B.z-A.z)*s/steps;pts.push(new T3.Vector3(x,getTerrainHeight(x,z),z));}
  const e={a,b,type:'road',len,mult:1,time:len/SQUAD_SPEED,pts};
  EDGES.push(e); EDGE_BY_KEY.set(key,e);
  if(!ADJ.has(a))ADJ.set(a,[]); if(!ADJ.has(b))ADJ.set(b,[]);
  ADJ.get(a).push({to:b,e}); ADJ.get(b).push({to:a,e});
  return e;
}
function drawYardRoad(e){
  const g=new T3.Group();
  for(let i=0;i<e.pts.length-1;i++){ const p=e.pts[i],n=e.pts[i+1];
    const t=tiles[Math.round(p.x)]?.[Math.round(p.z)]; if(!t||t.isWater)continue;
    const box=new T3.Mesh(new T3.BoxGeometry(0.34,0.045,0.15),new T3.MeshLambertMaterial({color:0xd6c79b}));
    box.position.set(p.x,p.y+0.03,p.z); box.rotation.y=-Math.atan2(n.z-p.z,n.x-p.x); box.receiveShadow=true; g.add(box); }
  scene.add(g); return g;
}
// есть ли уже верфь/аэродром рядом с городом (включая исходные Бордо/Париж)
function hasYardNear(parent,ship){ return cities.some(c=>c!==parent&&(ship?c.isShipyard:c.isAirport)&&(c.gx-parent.gx)**2+(c.gz-parent.gz)**2<30); }
function buildYard(parent,kind,actor){
  if(MP.guest){ MP.cmd({cmd:'yard',c:parent.idx,kind}); return; }   // гость → команда хосту
  const a=actor==null?PLAYER:actor, P=a===PLAYER;
  if(!parent||parent.owner!==a)return;
  if(parent.occ){if(P)toast('🏴 Оккупированный город — нельзя строить');return;}
  const ship=kind==='ship';
  if(ship&&!techFlag(a,'ships')){if(P)toast('🔒 Исследуйте «Верфь» в дереве 🔬');return;}
  if(!ship&&!techFlag(a,'planes')){if(P)toast('🔒 Исследуйте «Аэродром» в дереве 🔬');return;}
  if(hasYardNear(parent,ship)){if(P)toast(ship?'⚓ Верфь рядом уже есть':'✈ Аэродром рядом уже есть');return;}
  if(ship&&!isCoastal(parent)){if(P)toast('⚓ Верфь можно строить только в прибрежном городе');return;}
  const cost=ship?SHIPYARD_BUILD_COST:AIRPORT_BUILD_COST;   // только голда — как на сервере (cmdBuildYard манпауэр НЕ берёт)
  if(gold[a]<cost){if(P)toast(`Не хватает голды (нужно ${cost})`);return;}
  const spot=findYardSpot(parent,kind);
  if(!spot){if(P)toast(ship?'⚓ Нет свободного места у воды':'✈ Нет свободного места рядом');return;}
  gold[a]-=cost;
  const idx=cities.length, name=(ship?'Верфь ':'Аэропорт ')+CITY_NAMES[parent.idx];
  CITY_NAMES[idx]=name; (ship?SHIPYARD_NAMES:AIRPORT_NAMES).add(name);
  const yc=new City(spot.x,spot.z,parent.country,1,parent.owner,idx); cities.push(yc);
  const e=addEdgeRuntime(idx,parent.idx);
  dynamicEdges.push({key:edgeKey(idx,parent.idx),a:idx,b:parent.idx,e});
  dynamicRoadMeshes.push(drawYardRoad(e));
  if(ship)parent.hasShipyard=true; else parent.hasAirport=true;
  markRegions(); scene.updateMatrixWorld(true); if(P)updatePanel();
  if(P)toast(ship?`⚓ Построена «${name}»`:`✈ Построен «${name}»`);
  if(MP.on&&MP.host)MP.send({t:'newcity',idx,gx:spot.x,gz:spot.z,country:parent.country,owner:parent.owner,kind,name,parentIdx:parent.idx}); // реплицировать гостям
}
function buildPanelRows(){
  const ub=document.getElementById('upgTab'); ub.innerHTML='';
  const bb0=document.getElementById('buyRows'); bb0.innerHTML='';
  if(panelCity.isShipyard||panelCity.isAirport){ // верфь/аэропорт — одна кнопка постройки
    const air=panelCity.isAirport;
    const row=document.createElement('div'); row.className='row'; row.style.background=air?'#7a6fd0':'#4a8fd0';
    row.innerHTML=`<span>${air?'✈ Построить самолёт':'⚓ Построить корабль'}</span><small></small>`;
    row.addEventListener('click',()=>{ if(!row.classList.contains('dis')&&panelCity){air?buildPlane(panelCity):buildShip(panelCity);} });
    bb0.appendChild(row); shipBuildRow=row;
    airRecallRow=null; aaUpgRow=null; yardShipRow=null; yardAirRow=null;
    if(air){ // кнопка отзыва авиации на базу (показывается только при активном приказе)
      const rr=document.createElement('div'); rr.className='row'; rr.style.background='#c0563f'; rr.style.display='none';
      rr.innerHTML=`<span>✈ Отозвать на базу</span><small></small>`;
      rr.addEventListener('click',()=>{ if(!rr.classList.contains('dis'))recallAir(); });
      bb0.appendChild(rr); airRecallRow=rr;
    }
    return;
  }
  shipBuildRow=null; airRecallRow=null;
  for(const tr of ['prod','def','atk']){
    const s=SPEC[tr];
    const row=document.createElement('div'); row.className='row'; row.style.background=s.color;
    row.innerHTML=`<span>${s.icon} ${s.name}</span><small></small>`;
    // обработчик стабилен; читает panelCity на момент клика, проверяет .dis сам
    row.addEventListener('click',()=>{ if(!row.classList.contains('dis')&&panelCity){upgradeCity(panelCity,tr);updatePanel();} });
    ub.appendChild(row); upgRows[tr]=row;
  }
  // 🚀 зенитка (ПВО) — отдельная строка постройки
  { const aaRow=document.createElement('div'); aaRow.className='row'; aaRow.style.background='#2f9e8f';
    aaRow.innerHTML=`<span>🚀 Зенитка (ПВО)</span><small></small>`;
    aaRow.addEventListener('click',()=>{ if(!aaRow.classList.contains('dis')&&panelCity){buildAA(panelCity);updatePanel();} });
    ub.appendChild(aaRow); aaUpgRow=aaRow; }
  // ⚓ верфь (только прибрежные города) и ✈ аэродром — строятся как отдельный под-город рядом
  yardShipRow=null; yardAirRow=null;
  if(isCoastal(panelCity)){
    const r=document.createElement('div'); r.className='row'; r.style.background='#4a8fd0';
    r.innerHTML=`<span>⚓ Построить верфь</span><small></small>`;
    r.addEventListener('click',()=>{ if(!r.classList.contains('dis')&&panelCity)buildYard(panelCity,'ship'); });
    ub.appendChild(r); yardShipRow=r;
  }
  { const r=document.createElement('div'); r.className='row'; r.style.background='#7a6fd0';
    r.innerHTML=`<span>✈ Построить аэродром</span><small></small>`;
    r.addEventListener('click',()=>{ if(!r.classList.contains('dis')&&panelCity)buildYard(panelCity,'air'); });
    ub.appendChild(r); yardAirRow=r;
  }
  const bb=document.getElementById('buyRows'); bb.innerHTML='';
  for(const spec of ['5','20','max']){
    const row=document.createElement('div'); row.className='row'; row.style.background='#ff9a4a';
    row.innerHTML=`<span>⚔ Купить ${spec==='max'?'максимум':'+'+spec}</span><small></small>`;
    row.addEventListener('click',()=>{ if(!row.classList.contains('dis')&&panelCity){buySoldiers(panelCity,spec);updatePanel();} });
    bb.appendChild(row); buyRows[spec]=row;
  }
}

function updatePanel(){
  const p=document.getElementById('panel');
  const sel=playerSel();
  if(sel.length!==1||gameOver){p.style.display='none';panelCity=null;return;}
  const c=sel[0]; p.style.display='block';
  const occ=!!c.occ;   // 🏴 оккупированный город: своя территория де-факто, но стройка/армия запрещены до аннексии
  const yard=c.isShipyard||c.isAirport;
  if(c!==panelCity){ panelCity=c; if(yard)panelTab='army'; buildPanelRows(); }   // пересборка ТОЛЬКО при смене города
  const tiers=['prod','def','atk'].filter(tr=>c.branchTier(tr)>0).map(tr=>`${SPEC[tr].icon}${c.branchTier(tr)}`).join(' ');
  document.getElementById('pName').textContent=tiers?`${CITY_NAMES[c.idx]} · ${tiers}`:CITY_NAMES[c.idx];
  document.getElementById('pGold').textContent=gold[PLAYER]|0;
  // верфь/аэропорт: скрываем вкладку прокачки, только армия
  tabUpgBtn.style.display=yard?'none':'';
  if(yard)panelTab='army';
  tabUpgBtn.classList.toggle('active',panelTab==='upg');
  tabArmyBtn.classList.toggle('active',panelTab==='army');
  document.getElementById('upgTab').style.display=(panelTab==='upg'&&!yard)?'block':'none';
  document.getElementById('armyTab').style.display=panelTab==='army'?'block':'none';

  if(yard){ // верфь/аэропорт — очередь техники
    const air=c.isAirport;
    const COST=air?PLANE_COST:SHIP_COST, BT=air?PLANE_BUILD_TIME:SHIP_BUILD_TIME;
    const Q=air?c.planeQueue:c.shipQueue, TM=air?c.planeTimer:c.shipTimer;
    const MPC=air?PLANE_MP:SHIP_MP;
    document.getElementById('info').textContent=air
      ? `✈ Аэропорт · ${COST}💰+${MPC}👥/самолёт · 👥 ${Math.floor(manpower[PLAYER]||0)}`
      : `⚓ Верфь · ${COST}💰+${MPC}👥/корабль · 👥 ${Math.floor(manpower[PLAYER]||0)}`;
    const fill=document.getElementById('qfill'), qt=document.getElementById('qtext');
    if(Q>0){fill.style.width=Math.min(100,TM/BT*100)+'%';
      qt.textContent=`⏳ в очереди: ${Q} · ~${Math.ceil(Q*BT-TM)}с`;}
    else{fill.style.width='0';qt.textContent='очередь пуста';}
    const unlocked=techFlag(PLAYER,air?'planes':'ships');
    if(shipBuildRow){const ok=!occ&&unlocked&&gold[PLAYER]>=COST&&(manpower[PLAYER]||0)>=MPC;shipBuildRow.classList.toggle('dis',!ok);
      shipBuildRow.querySelector('small').textContent=occ?'🏴 оккупация':!unlocked?'🔒 исследуйте':(manpower[PLAYER]||0)<MPC?`−${MPC}👥 мало`:`−${COST}💰 −${MPC}👥`;}
    if(air&&airRecallRow){ const act=!!airOrder[PLAYER]; airRecallRow.style.display=act?'':'none';
      if(act)airRecallRow.querySelector('small').textContent=airOrderLabel(); }
    if(occ)document.getElementById('info').textContent=air
      ? '🏴 Оккупированный аэропорт — стройка только после аннексии (мир)'
      : '🏴 Оккупированная верфь — стройка только после аннексии (мир)';
    else if(!unlocked)document.getElementById('info').textContent=air
      ? '🔒 Исследуйте «Аэродром» в дереве 🔬, чтобы строить самолёты'
      : '🔒 Исследуйте «Верфь» в дереве 🔬, чтобы строить корабли';
    return;
  }

  // прокачка — обновляем только текст/состояние постоянных строк
  for(const tr of ['prod','def','atk']){
    const row=upgRows[tr]; let enabled,right;
    const tier=c.branchTier(tr);
    if(tier>=MAX_TIER){enabled=false;right=`${tier} · MAX`;}
    else{const cost=upgradeCost(tier);enabled=gold[PLAYER]>=cost;right=`${tier} → ${tier+1} · −${cost}💰`;}
    if(occ){enabled=false;right='🏴 оккупация';}
    row.classList.toggle('dis',!enabled);
    row.querySelector('small').textContent=right;
  }
  // 🚀 зенитка (ПВО)
  if(aaUpgRow){ const max=(c.aa||0)>=AA_MAX, cost=aaCost(c);
    const enabled=!occ&&!max&&gold[PLAYER]>=cost&&(manpower[PLAYER]||0)>=AA_MP;
    aaUpgRow.classList.toggle('dis',!enabled);
    aaUpgRow.querySelector('small').textContent = occ?'🏴 оккупация' : max?`🚀${c.aa} MAX` : `🚀${c.aa||0} · −${cost}💰 −${AA_MP}👥`;
  }
  // ⚓ верфь
  if(yardShipRow){ const has=hasYardNear(c,true), tech=techFlag(PLAYER,'ships');
    const enabled=!occ&&!has&&tech&&gold[PLAYER]>=SHIPYARD_BUILD_COST;
    yardShipRow.classList.toggle('dis',!enabled);
    yardShipRow.querySelector('small').textContent = occ?'🏴 оккупация' : has?'✓ есть' : !tech?'🔒 исследуйте' : `−${SHIPYARD_BUILD_COST}💰`;
  }
  // ✈ аэродром
  if(yardAirRow){ const has=hasYardNear(c,false), tech=techFlag(PLAYER,'planes');
    const enabled=!occ&&!has&&tech&&gold[PLAYER]>=AIRPORT_BUILD_COST;
    yardAirRow.classList.toggle('dis',!enabled);
    yardAirRow.querySelector('small').textContent = occ?'🏴 оккупация' : has?'✓ есть' : !tech?'🔒 исследуйте' : `−${AIRPORT_BUILD_COST}💰`;
  }
  // армия
  document.getElementById('info').textContent=occ
    ? `🏴 Оккупирован · гарнизон ${c.units|0}/${c.capacity|0} · набор армии после аннексии (мир)`
    : `Гарнизон ${c.units|0}/${c.capacity|0} · ${SOLDIER_PRICE}💰+1👥/солдат · 👥 ${Math.floor(manpower[PLAYER]||0)}`;
  const q=c.queued, fill=document.getElementById('qfill'), qt=document.getElementById('qtext');
  if(q>0){const b=c.batches[0];fill.style.width=Math.min(100,b.elapsed/b.time*100)+'%';
    const eta=c.batches.reduce((s,x)=>s+x.time,0)-b.elapsed; qt.textContent=`⏳ готовится ${q} · ~${eta.toFixed(0)}с`;}
  else{fill.style.width='0';qt.textContent='очередь пуста';}
  for(const spec of ['5','20','max']){
    const row=buyRows[spec]; const amt=buyAmount(c,spec), cost=amt*SOLDIER_PRICE;
    row.classList.toggle('dis',occ||amt<=0);
    let reason='нет места';
    if(amt<=0){ const space=Math.floor(c.capacity-c.units-c.queued);
      reason = space<=0?'нет места' : (Math.floor(manpower[PLAYER]||0)<1?'нет манпауэра':'нет голды'); }
    row.querySelector('small').textContent=occ?'🏴 оккупация':(amt>0?`+${amt} · −${cost}💰 −${amt}👥`:reason);
  }
}

/* ── флаги фракций в эмблеме (клип по гексагону) ─────────────── */
function _hcross(cross,cw){return `<rect x="${(3+38*0.30).toFixed(1)}" y="2" width="${cw}" height="46" fill="${cross}"/><rect x="3" y="${(25-cw/2).toFixed(1)}" width="38" height="${cw}" fill="${cross}"/>`;}
function _nordic(field,cross){return {field,overlay:_hcross(cross,5.5)};}
const FLAG_SPECS={
  'Франция':{v:['#0055a4','#ffffff','#ef4135']},
  'Италия':{v:['#009246','#f1f2f1','#ce2b37']},
  'Германия':{h:['#000000','#dd0000','#ffce00']},
  'Россия':{h:['#ffffff','#0039a6','#d52b1e']},
  'Украина':{h:['#0057b7','#ffd700']},
  'Польша':{h:['#ffffff','#dc143c']},
  'Испания':{hw:[['#aa151b',1],['#f1bf00',2],['#aa151b',1]]},
  'Португалия':{vw:[['#046a38',2],['#da291c',3]],overlay:'<circle cx="18.2" cy="25" r="3.4" fill="#ffcc00" stroke="#fff" stroke-width="0.7"/>'},
  'Бенилюкс':{h:['#ae1c28','#ffffff','#21468b']},
  'Центр':{h:['#ed2939','#ffffff','#ed2939']},
  'Балканы':{h:['#c6363c','#0c4076','#ffffff']},
  'Латвия':{hw:[['#9e3039',2],['#ffffff',1],['#9e3039',2]]},
  'Эстония':{h:['#0072ce','#000000','#ffffff']},
  'Литва':{h:['#fdb913','#006a44','#c1272d']},
  'Армения':{h:['#d90012','#0033a0','#f2a800']},
  'Азербайджан':{h:['#0092bc','#ef3340','#509e2f']},
  'Швеция':_nordic('#006aa7','#fecc00'),
  'Финляндия':_nordic('#ffffff','#003580'),
  'Дания':_nordic('#c8102e','#ffffff'),
  'Норвегия':{field:'#ba0c2f',overlay:_hcross('#ffffff',7)+_hcross('#00205b',3)},
  'Греция':{h:['#0d5eaf','#ffffff','#0d5eaf','#ffffff','#0d5eaf'],overlay:'<rect x="3" y="2" width="17" height="24" fill="#0d5eaf"/><rect x="9.5" y="2" width="4" height="24" fill="#fff"/><rect x="3" y="11" width="17" height="4" fill="#fff"/>'},
  'Турция':{field:'#e30a17',overlay:'<circle cx="18" cy="25" r="9" fill="#fff"/><circle cx="21.2" cy="25" r="7.2" fill="#e30a17"/><text x="28" y="29.4" font-size="10" fill="#fff" text-anchor="middle">★</text>'},
  'Грузия':{field:'#ffffff',overlay:'<rect x="17" y="2" width="6" height="46" fill="#ff0000"/><rect x="3" y="22" width="38" height="6" fill="#ff0000"/><g fill="#ff0000"><rect x="9" y="11" width="3.2" height="1"/><rect x="10.1" y="9.9" width="1" height="3.2"/><rect x="31.8" y="11" width="3.2" height="1"/><rect x="32.9" y="9.9" width="1" height="3.2"/><rect x="9" y="39" width="3.2" height="1"/><rect x="10.1" y="37.9" width="1" height="3.2"/><rect x="31.8" y="39" width="3.2" height="1"/><rect x="32.9" y="37.9" width="1" height="3.2"/></g>'},
  'Британия':{field:'#012169',overlay:'<path d="M3 2 L41 48" stroke="#fff" stroke-width="7"/><path d="M41 2 L3 48" stroke="#fff" stroke-width="7"/><path d="M3 2 L41 48" stroke="#c8102e" stroke-width="2.6"/><path d="M41 2 L3 48" stroke="#c8102e" stroke-width="2.6"/><rect x="17.5" y="2" width="9" height="46" fill="#fff"/><rect x="3" y="20.5" width="38" height="9" fill="#fff"/><rect x="19.5" y="2" width="5" height="46" fill="#c8102e"/><rect x="3" y="22.5" width="38" height="5" fill="#c8102e"/>'},
};
function _flagInner(country){
  const X=3,Y=2,W=38,H=46;
  const s=FLAG_SPECS[country]||{h:['#7f8a96','#aeb6c2']};
  let inner='';
  if(s.h){const n=s.h.length;for(let i=0;i<n;i++)inner+=`<rect x="${X}" y="${(Y+H*i/n).toFixed(2)}" width="${W}" height="${(H/n+0.5).toFixed(2)}" fill="${s.h[i]}"/>`;}
  else if(s.v){const n=s.v.length;for(let i=0;i<n;i++)inner+=`<rect x="${(X+W*i/n).toFixed(2)}" y="${Y}" width="${(W/n+0.5).toFixed(2)}" height="${H}" fill="${s.v[i]}"/>`;}
  else if(s.hw){const t=s.hw.reduce((a,x)=>a+x[1],0);let acc=0;for(const[c,w]of s.hw){inner+=`<rect x="${X}" y="${(Y+H*acc/t).toFixed(2)}" width="${W}" height="${(H*w/t+0.5).toFixed(2)}" fill="${c}"/>`;acc+=w;}}
  else if(s.vw){const t=s.vw.reduce((a,x)=>a+x[1],0);let acc=0;for(const[c,w]of s.vw){inner+=`<rect x="${(X+W*acc/t).toFixed(2)}" y="${Y}" width="${(W*w/t+0.5).toFixed(2)}" height="${H}" fill="${c}"/>`;acc+=w;}}
  else if(s.field){inner+=`<rect x="${X}" y="${Y}" width="${W}" height="${H}" fill="${s.field}"/>`;}
  if(s.overlay)inner+=s.overlay;
  return inner;
}
let _fcid=0;
function flagHexSVG(country,size){
  const hex='22,2 41,12.5 41,37.5 22,48 3,37.5 3,12.5', cid='fc'+(_fcid++);
  return `<svg viewBox="0 0 44 50" width="${size}" height="${(size*50/44).toFixed(1)}">`+
    `<defs><clipPath id="${cid}"><polygon points="${hex}"/></clipPath></defs>`+
    `<g clip-path="url(#${cid})">${_flagInner(country)}</g>`+
    `<polygon points="${hex}" fill="none" stroke="#b3a079" stroke-width="2.4"/></svg>`;
}
function buildEmblem(country){
  const hex='22,2 41,12.5 41,37.5 22,48 3,37.5 3,12.5';
  document.getElementById('emblemSvg').innerHTML=
    `<defs><clipPath id="embClip"><polygon points="${hex}"/></clipPath></defs>`+
    `<g clip-path="url(#embClip)">${_flagInner(country)}</g>`+
    `<polygon points="${hex}" fill="none" stroke="#b3a079" stroke-width="2.4"/>`;
}
let _lastEmblem=null;

/* ── HUD ────────────────────────────────────────────────────── */
function updateHUD(){
  // подсчёт городов по фракциям
  const counts=FACTIONS.map(()=>0);
  for(const c of cities)counts[c.owner]++;
  const mine=counts[PLAYER]|0;
  const aliveCount=counts.filter(n=>n>0).length;
  // место игрока по числу городов
  const sorted=[...counts].sort((a,b)=>b-a);
  const rank=sorted.indexOf(counts[PLAYER])+1;
  const colHex='#'+OWNER_COL[PLAYER].toString(16).padStart(6,'0');
  document.getElementById('hFaction').textContent=PLAYER_COUNTRY;
  document.getElementById('fBar').style.background=colHex;
  if(_lastEmblem!==PLAYER_COUNTRY){_lastEmblem=PLAYER_COUNTRY;buildEmblem(PLAYER_COUNTRY);}
  document.getElementById('hGold').textContent=gold[PLAYER]|0;
  document.getElementById('hGoldRate').textContent='+'+cities.filter(c=>c.owner===PLAYER).reduce((s,c)=>s+c.goldRate,0).toFixed(1)+'/с';
  document.getElementById('hPol').textContent=Math.floor(politPts[PLAYER]||0);
  document.getElementById('hPolRate').textContent='+'+politRate(PLAYER).toFixed(2)+'/с';
  {const mp=Math.floor(manpower[PLAYER]||0), mpcap=Math.round(manpowerCap(PLAYER));
   const hmp=document.getElementById('hMp'); hmp.textContent=mp; hmp.style.color=mp<mpcap*0.12?'#ff7a6a':'';
   document.getElementById('hMpCap').textContent=mpcap;}
  document.getElementById('hMine').textContent=mine;
  document.getElementById('hTotal').textContent=cities.length;
  document.getElementById('hRank').textContent=rank;
  document.getElementById('hRankTot').textContent=aliveCount;
  document.getElementById('hAlive').textContent=aliveCount;
  document.getElementById('hUnits').textContent=Math.round(cities.filter(c=>c.owner===PLAYER).reduce((s,c)=>s+c.units,0));
  document.getElementById('sbTech').classList.toggle('active',!!techWinOpen);
  document.getElementById('sbPol').classList.toggle('active',!!polWinOpen);
}
