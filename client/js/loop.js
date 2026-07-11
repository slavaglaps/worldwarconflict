/* ── resize & loop ──────────────────────────────────────────── */
function resize(){renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();}
addEventListener('resize',resize);

let perfOverlay=null, perfLastText='', perfLastUpdate=0;
function perfTriCount(g){
  if(!g)return 0;
  if(g.index)return g.index.count/3;
  const p=g.attributes&&g.attributes.position;
  return p?p.count/3:0;
}
function perfGroupOf(o){
  for(let p=o;p;p=p.parent)if(p.userData&&p.userData.perfGroup)return p.userData.perfGroup;
  if(o.isInstancedMesh)return 'instanced';
  if(o.isMesh)return 'mesh';
  return o.type||'other';
}
function perfStats(renderNow=false){
  if(renderNow)renderer.render(scene,camera);
  const groups={}, totals={meshes:0,instanced:0,normalMeshes:0,shadowCasters:0,triangles:0,instances:0};
  scene.traverse(o=>{
    if(!(o.isMesh||o.isInstancedMesh)||o.visible===false)return;
    const mats=Array.isArray(o.material)?o.material:[o.material];
    if(mats.length&&mats.every(m=>m&&m.visible===false))return;
    const group=perfGroupOf(o), inst=o.isInstancedMesh?o.count:1, tris=perfTriCount(o.geometry)*inst;
    const g=groups[group]||(groups[group]={meshes:0,instanced:0,normalMeshes:0,shadowCasters:0,triangles:0,instances:0});
    g.meshes++; totals.meshes++;
    if(o.isInstancedMesh){g.instanced++; totals.instanced++;}else{g.normalMeshes++; totals.normalMeshes++;}
    if(o.castShadow){g.shadowCasters++; totals.shadowCasters++;}
    g.triangles+=tris; totals.triangles+=tris; g.instances+=inst; totals.instances+=inst;
  });
  const info=renderer.info;
  return {
    calls:info.render.calls,
    triangles:info.render.triangles,
    points:info.render.points,
    lines:info.render.lines,
    geometries:info.memory.geometries,
    textures:info.memory.textures,
    totals,
    groups:Object.fromEntries(Object.entries(groups).sort((a,b)=>b[1].triangles-a[1].triangles))
  };
}
function ensurePerfOverlay(){
  if(perfOverlay)return perfOverlay;
  perfOverlay=document.createElement('pre');
  perfOverlay.style.cssText='position:fixed;left:12px;bottom:12px;z-index:80;display:none;max-width:440px;max-height:48vh;overflow:auto;margin:0;padding:10px 12px;border-radius:8px;background:rgba(7,12,18,.88);color:#d8ecff;font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;border:1px solid rgba(150,190,230,.28);pointer-events:none;white-space:pre-wrap;';
  document.body.appendChild(perfOverlay);
  return perfOverlay;
}
function formatPerfStats(s){
  const rows=Object.entries(s.groups).slice(0,10).map(([k,v])=>
    `${k.padEnd(16)} mesh ${String(v.meshes).padStart(4)} inst ${String(v.instances).padStart(6)} shadow ${String(v.shadowCasters).padStart(4)} tri ${Math.round(v.triangles).toLocaleString('ru')}`);
  return [
    `draw calls: ${s.calls}   tris(frame): ${s.triangles.toLocaleString('ru')}`,
    `meshes: ${s.totals.meshes} (${s.totals.instanced} instanced)   shadow casters: ${s.totals.shadowCasters}`,
    `geometries: ${s.geometries}   textures: ${s.textures}`,
    '',
    ...rows
  ].join('\n');
}
function updatePerfOverlay(now){
  if(!perfOverlay||perfOverlay.style.display==='none'||now-perfLastUpdate<350)return;
  perfLastUpdate=now;
  perfLastText=formatPerfStats(perfStats(false));
  perfOverlay.textContent=perfLastText;
}
window.__perfStats=()=>perfStats(true);
window.__perfOverlay=(on=true)=>{const el=ensurePerfOverlay();el.style.display=on?'block':'none';if(on)el.textContent=formatPerfStats(perfStats(true));return on;};
if(new URLSearchParams(location.search).has('perf'))setTimeout(()=>window.__perfOverlay(true),0);
window.addEventListener('keydown',e=>{if(e.code==='F10'){const el=ensurePerfOverlay();window.__perfOverlay(el.style.display==='none');}});

let perfStressApplied=false, perfStressGroup=null;
const perfStressDummy=new T3.Object3D();
function perfStressEnabled(){
  try{return new URLSearchParams(location.search).get('stress')==='max';}
  catch(_){return false;}
}
function applyPerfStressOnce(){
  if(perfStressApplied||!perfStressEnabled()||!cities||!cities.length)return;
  perfStressApplied=true;
  for(const c of cities){
    if(c.isShipyard||c.isAirport)continue;
    c.prodTier=3; c.defTier=3; c.atkTier=0; c.spec='def'; c.tier=3;
    c.units=Math.max(c.units||0,220);
    if(typeof c.buildMeshes==='function')c.buildMeshes();
  }
  if(perfStressGroup)scene.remove(perfStressGroup);
  perfStressGroup=new T3.Group();
  perfStressGroup.name='perf-stress-max';
  scene.add(perfStressGroup);

  const owner=typeof PLAYER!=='undefined'?PLAYER:0;
  const col=OWNER_COL&&OWNER_COL[owner]!=null?OWNER_COL[owner]:0x4c7ad8;
  const unitSrc=typeof unitBatchSource==='function'?unitBatchSource(owner):null;
  const unitMat=unitSrc?unitSrc.mat:new T3.MeshLambertMaterial({color:col});
  const shipHullMat=new T3.MeshLambertMaterial({color:0x6b4a2c});
  const shipSailMat=new T3.MeshLambertMaterial({color:col});
  const planeBodyMat=new T3.MeshLambertMaterial({color:0xe8edf2});
  const planeWingMat=new T3.MeshLambertMaterial({color:col});
  const shipHullGeo=new T3.BoxGeometry(0.55,0.16,0.24);
  const shipBowGeo=new T3.ConeGeometry(0.12,0.3,4);
  const shipMastGeo=new T3.CylinderGeometry(0.014,0.014,0.4);
  const shipSailGeo=new T3.BoxGeometry(0.03,0.26,0.22);
  const planeBodyGeo=new T3.CylinderGeometry(0.06,0.035,0.5,8);
  const planeWingGeo=new T3.BoxGeometry(0.1,0.025,0.5);
  const planeTailGeo=new T3.BoxGeometry(0.08,0.02,0.2);
  const planeFinGeo=new T3.BoxGeometry(0.08,0.1,0.02);
  const planeNoseGeo=new T3.ConeGeometry(0.035,0.12,8);

  const squadsMax=typeof MAX_SQUADS!=='undefined'?MAX_SQUADS:50;
  const shipsMax=typeof MAX_SHIPS!=='undefined'?MAX_SHIPS:60;
  const planesMax=typeof MAX_PLANES!=='undefined'?MAX_PLANES:60;
  const center=target||new T3.Vector3(GRID/2,0,GRID/2);
  for(let s=0;s<squadsMax;s++){
    const bx=center.x-26+(s%10)*5.8, bz=center.z-18+Math.floor(s/10)*5.4, by=getTerrainHeight(bx,bz)+0.35;
    const im=new T3.InstancedMesh(unitSrc?unitSrc.geo:UNIT_GEO,unitMat,18);
    im.castShadow=false; im.receiveShadow=true; im.userData.perfGroup='units';
    for(let i=0;i<18;i++){
      const a=i*2.399963, r=0.18+Math.sqrt((i+0.5)/18)*0.75;
      perfStressDummy.position.set(bx+Math.cos(a)*r,by,bz+Math.sin(a)*r);
      perfStressDummy.rotation.set(0,a,0); perfStressDummy.scale.setScalar(unitSrc?unitSrc.scale:1); perfStressDummy.updateMatrix();
      if(unitSrc){const m=new T3.Matrix4().multiplyMatrices(perfStressDummy.matrix,unitSrc.local);im.setMatrixAt(i,m);}
      else im.setMatrixAt(i,perfStressDummy.matrix);
    }
    im.instanceMatrix.needsUpdate=true;
    perfStressGroup.add(im);
  }
  const stressMatrix=new T3.Matrix4();
  const stressShipParts=[
    {geo:shipHullGeo,mat:shipHullMat,pos:[0,0.08,0],rot:[0,0,0]},
    {geo:shipBowGeo, mat:shipHullMat,pos:[0.4,0.08,0],rot:[0,Math.PI/4,-Math.PI/2]},
    {geo:shipMastGeo,mat:shipHullMat,pos:[0,0.34,0],rot:[0,0,0]},
    {geo:shipSailGeo,mat:shipSailMat,pos:[0,0.42,0],rot:[0,0,0]},
  ].map(p=>{
    const d=new T3.Object3D(); d.position.set(p.pos[0],p.pos[1],p.pos[2]); d.rotation.set(p.rot[0],p.rot[1],p.rot[2]); d.updateMatrix();
    const im=new T3.InstancedMesh(p.geo,p.mat,shipsMax);
    im.castShadow=false; im.receiveShadow=true; im.frustumCulled=false; im.userData.perfGroup='ships'; perfStressGroup.add(im);
    return {...p,im,local:d.matrix.clone()};
  });
  for(let i=0;i<shipsMax;i++){
    const x=center.x-35+(i%12)*6.5, z=center.z+23+Math.floor(i/12)*3.8;
    perfStressDummy.position.set(x,typeof WATER_Y_SHIP!=='undefined'?WATER_Y_SHIP+0.18:0.15,z);
    perfStressDummy.rotation.set(0,(i%8)*Math.PI/4,0);
    perfStressDummy.scale.setScalar(typeof SHIP_SCALE!=='undefined'?SHIP_SCALE:5);
    perfStressDummy.updateMatrix();
    for(const p of stressShipParts){
      stressMatrix.multiplyMatrices(perfStressDummy.matrix,p.local);
      p.im.setMatrixAt(i,stressMatrix);
    }
  }
  for(const p of stressShipParts){p.im.count=shipsMax;p.im.instanceMatrix.needsUpdate=true;}
  const stressPlaneParts=[
    {geo:planeBodyGeo,mat:planeBodyMat,pos:[0,0,0],rotZ:Math.PI/2},
    {geo:planeWingGeo,mat:planeWingMat,pos:[0,0,0],rotZ:0},
    {geo:planeTailGeo,mat:planeWingMat,pos:[-0.2,0,0],rotZ:0},
    {geo:planeFinGeo,mat:planeWingMat,pos:[-0.2,0.06,0],rotZ:0},
    {geo:planeNoseGeo,mat:planeBodyMat,pos:[0.3,0,0],rotZ:-Math.PI/2},
  ].map(p=>{
    const d=new T3.Object3D(); d.position.set(p.pos[0],p.pos[1],p.pos[2]); d.rotation.z=p.rotZ; d.updateMatrix();
    const im=new T3.InstancedMesh(p.geo,p.mat,planesMax);
    im.castShadow=false; im.receiveShadow=true; im.frustumCulled=false; im.userData.perfGroup='planes'; perfStressGroup.add(im);
    return {...p,im,local:d.matrix.clone()};
  });
  for(let i=0;i<planesMax;i++){
    const x=center.x-35+(i%12)*6.5, z=center.z-45+Math.floor(i/12)*4.2;
    perfStressDummy.position.set(x,typeof PLANE_ALT!=='undefined'?PLANE_ALT:4.5,z);
    perfStressDummy.rotation.set(0,(i%10)*Math.PI/5,0);
    perfStressDummy.scale.setScalar(typeof PLANE_SCALE!=='undefined'?PLANE_SCALE:5);
    perfStressDummy.updateMatrix();
    for(const p of stressPlaneParts){
      const m=new T3.Matrix4().multiplyMatrices(perfStressDummy.matrix,p.local);
      p.im.setMatrixAt(i,m);
    }
  }
  for(const p of stressPlaneParts){
    p.im.count=planesMax; p.im.instanceMatrix.needsUpdate=true;
  }
  if(typeof window.rebuildCityBatchesIfDirty==='function')window.rebuildCityBatchesIfDirty();
  console.info('[perf-stress] max visual load applied',{cities:cities.length,squads:squadsMax,ships:shipsMax,planes:planesMax});
}

let last=performance.now(), panelTick=0, cityLabelTick=0;
const cityLabelCamPos=new T3.Vector3().copy(camera.position),cityLabelCamQuat=new T3.Quaternion().copy(camera.quaternion);
function loop(now){
  const dt=Math.min((now-last)/1000,.05); last=now;
  updateCameraKeys(dt);
  // update water shader (время + позиция камеры для бликов/Френеля)
  waterShader.uniforms.time.value = now / 1000;
  waterShader.uniforms.camPos.value.copy(camera.position);
  if(window.HEXWATER)window.HEXWATER.uTime.value = now / 1000;   // ⬡ хекс-карта: шейдерная вода (flow+пена)
  // дрейф облаков (с заворотом за край карты)
  if(typeof updateClouds==='function')updateClouds(dt);
  else for(const c of cloudList){
    c.position.x+=c.userData.speed*dt;
    if(c.position.x>GRID+12)c.position.x=-12;
  }
  if(typeof fogUpdate==='function')fogUpdate(dt);   // 🌫 туман войны: маска + лерп текстуры + патч материалов
  if(typeof minimapUpdate==='function')minimapUpdate(dt);   // 🗺 миникарта: территория × туман + города/армии/вьюпорт
  const gdt=dt*gameSpeed; // игровое время с учётом паузы/ускорения
  if(MP.localSim){   // 🧪 соло на ЛОКАЛЬНОМ серверном Sim: тик Sim → проекция в guest-рендер, визуал как у гостя
    if(typeof localSimStep==='function')localSimStep(gdt);
    if(!gameOver&&gdt>0){ for(const c of cities)c.drawProdRing(); if(typeof cityTowersFX==='function')cityTowersFX(gdt); if(typeof shipBombardFX==='function')shipBombardFX(gdt); if(typeof updateMissiles==='function')updateMissiles(gdt); }
  } else if(MP.guest && !gameOver && gdt>0){
    // гость: сим заморожен, но локально продвигаем ТОЛЬКО таймеры (плавность между снапшотами; сервер их корректирует)
    gameTime+=gdt;                                                          // ⏳ отсчёт мобилизации войны
    for(const c of cities){
      if(c.batches.length){ const b=c.batches[0]; if(b.elapsed<b.time)b.elapsed=Math.min(b.time,b.elapsed+gdt); } // найм
      if((c.isShipyard||c.hasShipyard)&&c.shipQueue>0&&c.shipTimer<SHIP_BUILD_TIME)c.shipTimer=Math.min(SHIP_BUILD_TIME,c.shipTimer+gdt);   // ⚓
      if((c.isAirport||c.hasAirport)&&c.planeQueue>0&&c.planeTimer<PLANE_BUILD_TIME)c.planeTimer=Math.min(PLANE_BUILD_TIME,c.planeTimer+gdt); // ✈
      c.drawProdRing();
    }
    const rs=techRes[PLAYER]; if(rs)for(const r of rs){ const n=NODE[r.id]; if(n&&r.t<n.t)r.t=Math.min(n.t,r.t+gdt); }      // 🔬
    cityTowersFX(gdt);     // ⚔ визуал выстрелов atk-городов в онлайне (урон авторитетно считает сервер)
    shipBombardFX(gdt);    // 🚀 визуал обстрела берега кораблями (урон авторитетно считает сервер)
    updateMissiles(gdt);   // анимируем трассеры/взрывы
  }
  if(!gameOver&&gdt>0&&typeof window.updateMapBuildings==='function')window.updateMapBuildings(gdt);
  // во время поворота камеры (Q/E или мышь) прячем DOM-подписи целиком — иначе они дрожат
  const _rot=camRotating; document.getElementById('labels').style.visibility=_rot?'hidden':'visible';
  const cityLabelCamMoved=cityLabelCamPos.distanceToSquared(camera.position)>1e-6||1-Math.abs(cityLabelCamQuat.dot(camera.quaternion))>1e-7;
  if(cityLabelCamMoved){cityLabelCamPos.copy(camera.position);cityLabelCamQuat.copy(camera.quaternion);}
  const updateCityLabels=!_rot&&(cityLabelCamMoved||now>=cityLabelTick);
  if(updateCityLabels)cityLabelTick=now+33;
  for(const c of cities){if(updateCityLabels)c.updateLabel();c.updateSiegeViz(now);}
  if(!_rot)for(const s of squads)s.updateLabel();
  const tintUnit=s=>{const m=s.tintMat;if(m&&m.emissive)m.emissive.setHex(s.foe?0x6b1a12:(selectedUnits.has(s)?0x1f6fc0:0x000000));};
  for(const s of ships){if(!_rot)s.updateLabel();tintUnit(s);
    const sel=selectedUnits.has(s); s.rangeRing.visible=sel;
    if(sel)s.rangeRing.position.set(s.pos.x,WATER_Y_SHIP+0.1,s.pos.z); // кольцо следует за кораблём
  }
  for(const s of planes){if(!_rot)s.updateLabel();tintUnit(s);}
  // selection rings (multi) + drag source highlight + pulse
  const k=1+Math.sin(now/220)*0.08;
  const bk=1+Math.sin(now/110)*0.14;
  for(const c of cities){
    const on=selectedSet.has(c)||c===dragFrom;
    c.ring.visible=on;
    if(on)c.ring.scale.set(k,k,k);
    // кольцо радиуса обстрела для выбранного atk-города (башни стреляют от прокачки; перестраиваем геометрию при смене радиуса)
    const fr=c.fireRange;
    if(on&&fr>0){
      if(c._ringR!==fr){c._ringR=fr;c.rangeRing.geometry.dispose();c.rangeRing.geometry=new T3.TorusGeometry(fr,0.12,8,72);}
      c.rangeRing.material.color.setHex(0xff7a3a); c.rangeRing.material.opacity=0.5;
      c.rangeRing.visible=true;
    } else c.rangeRing.visible=false;
    c.bring.visible=!!c.siege;
    if(c.siege)c.bring.scale.set(bk,bk,bk);
  }
  if(MP.on)mpTick(now,dt);   // хост рассылает снапшот/сущности; гость интерполирует зеркала
  updateHUD(); updateWarPreps();
  panelTick+=dt; if(panelTick>0.25){panelTick=0;if(regionsDirty){regionsDirty=false;assignRegions();}updatePanel();refreshTechAfford();refreshHeroBar();if(diploTarget!=null)refreshDiplo();refreshPol();if(peaceTarget!=null)refreshPeaceDialog();}  // refresh UI
  applyPerfStressOnce();
  if(typeof window.rebuildCityBatchesIfDirty==='function')window.rebuildCityBatchesIfDirty();
  if(window._shadowWarmUntil&&now<window._shadowWarmUntil)renderer.shadowMap.needsUpdate=true;   // прогрев теней после загрузки карты (страховка от async-геометрии)
  if(typeof bakeDynShadowIfDirty==='function')bakeDynShadowIfDirty();   // 🌗 динамическая карта теней (города/постройки): перепечь только при изменениях, события кадра коалесятся
  if(typeof fogRender==='function')fogRender(renderer,scene,camera);    // 🌫 туман войны: пост-процесс (сцена → RT → затемнение вне вижена)
  else renderer.render(scene,camera);
  updatePerfOverlay(now);
  requestAnimationFrame(loop);
}

/* ===================== МУЛЬТИПЛЕЕР (Colyseus server-authoritative) =====================
 * Клиент в online-режиме всегда гость рендера: сервер крутит Sim, Colyseus шлёт schema state,
 * bridge ниже переводит его в локальные snap/ent события для существующего UI.
 */
(function mpBoot(){
  const params=new URLSearchParams(location.search);
  const isMP=params.get('mp')||params.get('room')||params.has('cs');
  // 🟢 ЕДИНЫЙ авторитетный Sim: соло — локальный серверный Sim в браузере, MP — Colyseus.
  //    Старого клиентского сима больше нет (двойной сим устранён).
  const room=isMP?(params.get('mp')||params.get('room')||'cs'):'local';
  MP.host=false; MP.guest=true;             // гость рендера: сервер/локальный Sim крутит логику
  if(!isMP){ MP.on=true; MP.localSim=true; }// соло: локальный Sim + драйвер тика (без сети)
  const SPEC2ID={prod:1,def:2,atk:3}, ID2SPEC=[null,'prod','def','atk'];
  const labels=document.getElementById('labels');
  let prevWar=new Set(), prevAlly=new Set(), tSnap=0, tEnt=0, tKey=0;

  /* ── UI: статус-плашка + баннер ожидания ── */
  const pill=document.createElement('div');
  pill.style.cssText='position:fixed;bottom:12px;right:216px;z-index:30;background:rgba(8,16,26,.85);color:#cfe0f0;'+   /* 🗺 сдвиг влево от миникарты */
    'font-size:12px;font-weight:700;padding:8px 12px;border-radius:9px;user-select:none;border:1px solid rgba(120,150,180,.22);';
  pill.textContent=t('toast.mpConnecting'); document.body.appendChild(pill);
  const waitBanner=document.createElement('div');
  waitBanner.style.cssText='position:fixed;top:92px;left:50%;transform:translateX(-50%);z-index:31;display:none;'+
    'background:rgba(8,16,26,.92);color:#ffd23f;font-size:15px;font-weight:800;padding:12px 20px;border-radius:10px;'+
    'border:1px solid rgba(255,210,63,.45);box-shadow:0 6px 22px rgba(0,0,0,.5);';
  waitBanner.textContent=t('toast.waitHostCountry');
  document.body.appendChild(waitBanner);
  function setPill(){ const role=MP.host?t('toast.roleHost'):(MP.guest?t('toast.roleGuest'):'—');
    const me=FACTIONS[PLAYER]?countryDisp(FACTIONS[PLAYER].country):'—';
    const extra=MP.host?(t('toast.pillHumans',{n:MP.humans?MP.humans.size:1})+(gameSpeed===0?t('toast.pillPickCountry'):'')):'';
    pill.textContent=`🌐 ${room} · ${role} · ${me} · `+t('toast.pillPlayers',{n:MP.players||1})+`${extra}`; }

  /* ── транспорт ── */
  MP.send=o=>{ const s=MP.sock; if(s&&s.readyState===1){ try{s.send(JSON.stringify(o));}catch(e){} } };
  MP.cmd =o=>{ o.t='cmd'; MP.send(o); };    // широковещательно — обрабатывает только хост
  function recalcHumans(){ MP.humans=new Set(Object.values(MP.assign)); MP.humans.add(PLAYER); }

  /* ── O(1) индекс городов по idx (вместо O(n) cities.find) ── */
  let byIdx=new Map(), sent=new Map(), keyframeDue=true, relSig='';
  MP.reindex=()=>{ byIdx.clear(); for(const c of cities)byIdx.set(c.idx,c); if(MP.host){keyframeDue=true;sent.clear();} };
  function ensureIndex(){ if(byIdx.size!==cities.length || (cities.length&&byIdx.get(cities[0].idx)!==cities[0]))MP.reindex(); }
  const ci=i=>byIdx.get(i);

  /* ── хост: стратегический снапшот (дельта городов + дипломатия по изменению) ── */
  const recruitQueueTuple=c=>(c.batches||[]).slice(0,6).map(b=>[
    Math.round(b.count||0),
    Math.round((b.time||0)*10),
    Math.round((b.elapsed||0)*10),
    b.type||c.recruitType||'inf',
  ]);
  const cityTuple=c=>[c.idx,c.owner,Math.min(8191,Math.round(c.units)),SPEC2ID[c.spec]||0,c.tier,c.occ?1:0,
    Math.round(c.queued||0),undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,
    c.branchTier('prod'),c.branchTier('def'),c.branchTier('atk'),undefined,undefined,undefined,c.occ&&c.occFrom!=null?c.occFrom:255,recruitQueueTuple(c)];
  const packCity=c=>[c.owner|0,Math.min(8191,Math.round(c.units)),SPEC2ID[c.spec]||0,c.tier|0,c.occ?1:0,
    c.branchTier('prod'),c.branchTier('def'),c.branchTier('atk'),c.occ&&c.occFrom!=null?c.occFrom:255,
    JSON.stringify(recruitQueueTuple(c))].join(':');
  function buildSnap(now){
    ensureIndex();
    const msg={t:'snap',time:gameTime,over:gameOver?1:0,
      g:gold.map(v=>Math.round(v||0)), p:politPts.map(v=>Math.round(v||0)), m:manpower.map(v=>Math.round(v||0))};
    if(keyframeDue||now-tKey>3000){ keyframeDue=false; tKey=now; sent.clear();
      msg.c=cities.map(c=>{ sent.set(c.idx,packCity(c)); return cityTuple(c); });   // keyframe: все города
    } else {
      const dc=[]; for(const c of cities){ const p=packCity(c); if(sent.get(c.idx)!==p){ sent.set(c.idx,p); dc.push(cityTuple(c)); } }
      if(dc.length)msg.dc=dc;                                                       // дельта: только изменённые
    }
    const sig=JSON.stringify([Object.entries(relations),Object.entries(warSince)]);  // дипломатия меняется редко
    if(sig!==relSig){ relSig=sig; msg.rel=Object.entries(relations); msg.ws=Object.entries(warSince); }
    return msg;
  }

  /* ── хост: движущиеся сущности (армии/флот/авиация/ракеты) ── */
  const R=v=>Math.round(v*10)/10, eid=e=>e._mpid||(e._mpid=MP._eid++);
  function buildEnt(){
    const e=[];
    for(const s of squads) e.push([eid(s),0,s.owner,R(s.pos.x),R(s.pos.y),R(s.pos.z),Math.ceil(s.fcount)]);
    for(const s of ships)  e.push([eid(s),1,s.owner,R(s.pos.x),R(s.pos.y),R(s.pos.z),0]);
    for(const s of planes) e.push([eid(s),2,s.owner,R(s.pos.x),R(s.pos.y),R(s.pos.z),0]);
    for(const m of missiles) if(m.mesh) e.push([eid(m),3,m.owner,R(m.mesh.position.x),R(m.mesh.position.y),R(m.mesh.position.z),0]);
    return e.length?{t:'ent',e}:null;   // пусто — не шлём
  }

  /* ── гость: применить состояние одного города ── */
  function applyCity(c,owner,units,specId,tier,occ,queued,siegeUnits,siegeOwner,prodTime,prodElapsed,shipQ,shipT,planeQ,planeT,prodTier,defTier,atkTier,compI,compA,compC,occFrom,queueList){
    // 🌫 туман войны: units===null → город вне вижена. Обновляем только публичную «оболочку»
    //    (владелец/оккупация); приватное замораживаем как last-seen (units/comp/очереди/осада).
    if(units==null){
      const pOwner=c.owner;
      c.owner=owner; c.occ=!!occ;
      c.occFrom = c.occ ? (occFrom!=null && occFrom!==255 ? occFrom : c.occFrom) : null;
      if(!c._fog){ c._fog=true; c._seenUnits=(typeof c.units==='number'&&c._everSeen)?Math.round(c.units):null; }
      if(pOwner!==owner){ try{c.recolor&&c.recolor();}catch(e){} if(typeof markRegions==='function')markRegions(); }
      return;
    }
    if(c._fog||!c._everSeen){ c._fog=false; c._everSeen=true; }
    const spec=ID2SPEC[specId]||null, prevOwner=c.owner;
    const nextProd=prodTier==null?(spec==='prod'?tier:0):prodTier;
    const nextDef=defTier==null?(spec==='def'?tier:0):defTier;
    const nextAtk=atkTier==null?(spec==='atk'?tier:0):atkTier;
    const specChanged=c.spec!==spec||c.tier!==tier||c.prodTier!==nextProd||c.defTier!==nextDef||c.atkTier!==nextAtk;
    c.owner=owner; c.units=units; c.spec=spec; c.tier=tier; c.prodTier=nextProd; c.defTier=nextDef; c.atkTier=nextAtk; c.occ=!!occ;
    c.occFrom = c.occ ? (occFrom!=null && occFrom!==255 ? occFrom : c.occFrom) : null;
    if(Array.isArray(queueList)){
      c.batches = queueList.slice(0,6).filter(q=>(q&&q[0]>0)).map(q=>({count:q[0],time:Math.max(0.1,(q[1]||10)/10),elapsed:Math.min(Math.max(0.1,(q[1]||10)/10),(q[2]||0)/10),type:q[3]||'inf'}));
    } else if(queued!=null) {  // ⏳ fallback: старый сервер отдаёт только агрегат очереди
      c.batches = queued>0 ? [{count:queued, time:Math.max(0.1,(prodTime||10)/10), elapsed:Math.min((prodTime||10)/10,(prodElapsed||0)/10), type:c.recruitType||'inf'}] : [];
    }
    if(shipQ!=null){ c.shipQueue=shipQ|0; c.shipTimer=(shipT||0)/10; }                            // ⚓ верфь: очередь + таймер
    if(planeQ!=null){ c.planeQueue=planeQ|0; c.planeTimer=(planeT||0)/10; }                       // ✈ аэродром: очередь + таймер
    c.aa=0;                                                        // legacy ПВО больше не отображаем, даже если старый сервер прислал aa
    if(siegeUnits!=null) c.siege = siegeUnits>0 ? {[siegeOwner]:{units:siegeUnits,atkMult:1}} : null; // осада → орбы + кольцо боя + тряска
    if(compI!=null) c.comp={inf:compI,arc:compA||0,cav:compC||0};   // 👥 состав гарнизона (панель города)
    else if(c.comp){
      const sum=(c.comp.inf||0)+(c.comp.arc||0)+(c.comp.cav||0);
      if(sum>0){ const k=Math.max(0,units)/sum; c.comp={inf:c.comp.inf*k,arc:c.comp.arc*k,cav:c.comp.cav*k}; }
    }
    if(specChanged){ try{c.buildMeshes&&c.buildMeshes();}catch(e){} }
    if(prevOwner!==owner){
      try{c.recolor&&c.recolor();}catch(e){}
      if(typeof markRegions==='function')markRegions();
    }
  }
  /* ── гость: оповестить о новых войнах со своей фракцией (вызывается только при изменении дипломатии) ── */
  function warNotify(){
    const curWar=new Set();
    for(const k in relations)if(relations[k]==='war'){ const ns=(k.match(/\d+/g)||[]).map(Number);
      if(ns.includes(PLAYER)){ const o=ns.find(x=>x!==PLAYER); if(o!=null)curWar.add(o); } }
    for(const fid of curWar)if(!prevWar.has(fid)&&!playerStartedWarRecently(fid)){
      if(typeof notifyWarDeclared==='function')notifyWarDeclared(fid);
      else toast(t('toast.warDeclaredOn',{name:FACTIONS[fid]?countryDisp(FACTIONS[fid].country):t('toast.enemyWord')}));
    }
    prevWar=curWar;
  }
  /* ── гость: оповестить о новых СОЮЗАХ со своей фракцией ── */
  function allyNotify(){
    const cur=new Set();
    for(const k in relations)if(relations[k]==='ally'){ const ns=(k.match(/\d+/g)||[]).map(Number);
      if(ns.includes(PLAYER)){ const o=ns.find(x=>x!==PLAYER); if(o!=null)cur.add(o); } }
    for(const fid of cur)if(!prevAlly.has(fid))toast(t('toast.allianceWith',{name:FACTIONS[fid]?countryDisp(FACTIONS[fid].country):t('toast.aCountryWord')}));
    prevAlly=cur;
  }
  /* ── гость: применить снапшот ── */
  function applySnap(m){
    ensureIndex();
    if(m.time===MP._lastTime){ if((MP._stall=(MP._stall||0)+1)>3)waitBanner.style.display='block'; }  // хост на паузе → баннер
    else { MP._stall=0; waitBanner.style.display='none'; }
    MP._lastTime=m.time; gameTime=m.time;
    const list=m.c||m.dc;
    if(m.c)MP._synced=true;   // получили полный keyframe → можно судить о победе/поражении
    if(list){ for(const d of list){ const c=ci(d[0]); if(c)applyCity(c,d[1],d[2],d[3],d[4],d[5],d[6],d[7],d[8],d[9],d[10],d[11],d[12],d[13],d[14],d[15],d[16],d[17],d[18],d[19],d[20],d[21],d[22]); } regionsDirty=true; }
    if(m.g){ const g=m.g; for(let i=0;i<g.length;i++){gold[i]=g[i];politPts[i]=m.p[i];manpower[i]=m.m[i];} }  // в cs-режиме экономика идёт через 'econ'; в relay — здесь
    if(m.rel){ relations={}; for(const [k,v] of m.rel)relations[k]=v; warSince={}; for(const [k,v] of m.ws)warSince[k]=+v; warNotify(); allyNotify(); }
    // победа/поражение — только после keyframe И если видели партию ИДУЩЕЙ (не врываемся в уже оконченную)
    const mine=cities.some(c=>c.owner===PLAYER);
    if(MP._synced && !m.over && mine) MP._sawRunning=true;
    const lost=!mine&&![...MP.ghosts.values()].some(g=>g.owner===PLAYER&&g.kind===0);
    if(MP._synced && MP._sawRunning && document.getElementById('countryWin').style.display!=='flex'){
      const ov=document.getElementById('overlay');
      if((m.over||lost)&&!gameOver){ gameOver=true; document.getElementById('ovTitle').textContent=mine?t('toast.victory'):t('toast.defeat'); ov.style.display='flex'; }
      else if(!m.over&&mine&&gameOver){ gameOver=false; ov.style.display='none'; }
    }
  }

  /* ── KayKit ship assets for guest/local-sim mirrors ── */
  const SHIP_ASSET = {
    // accent-вариант: деревянный корпус с нормальной текстурой + паруса в цвет фракции (full был целиком залит цветом)
    blue: 'assets/hex-kit/units/blue/ship_blue_accent.gltf',
    red: 'assets/hex-kit/units/red/ship_red_accent.gltf',
    green: 'assets/hex-kit/units/green/ship_green_accent.gltf',
    yellow: 'assets/hex-kit/units/yellow/ship_yellow_accent.gltf',
    neutral: 'assets/hex-kit/units/neutral/ship.gltf',
  };
  const SHIP_PALETTE = [
    { key: 'blue', color: new T3.Color(0x3f6fc8) },
    { key: 'red', color: new T3.Color(0xc14a3a) },
    { key: 'green', color: new T3.Color(0x3f9e7e) },
    { key: 'yellow', color: new T3.Color(0xcaa233) },
  ];
  const SHIP_MODEL_SCALE = 1.1;   // модель пака 2.26 в длину → ~2.5 юнита (при 1.55 корабль был больше города)
  const SHIP_MODEL_ROT_Y = Math.PI / 2; // KayKit ship length is on local Z; game heading expects +X.
  const shipModelCache = {};
  let shipModelPromise = null;

  function shipKeyForOwner(owner) {
    const hex = OWNER_COL[owner] != null ? OWNER_COL[owner] : null;
    if (hex == null) return 'neutral';
    const c = new T3.Color(hex);
    const spread = Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
    if (spread < 0.12) return 'neutral';
    let best = SHIP_PALETTE[0].key, bd = Infinity;
    for (const p of SHIP_PALETTE) {
      const dr = c.r - p.color.r, dg = c.g - p.color.g, db = c.b - p.color.b;
      const d = dr * dr + dg * dg + db * db;
      if (d < bd) { bd = d; best = p.key; }
    }
    return best;
  }

  function prepareShipModel(root) {
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      if (o.material) {
        o.material = o.material.clone();
        o.material.metalness = 0;
        o.material.roughness = 0.82;
      }
    });
    return root;
  }

  function ensureShipModels() {
    if (shipModelPromise) return shipModelPromise;
    if (!T3.GLTFLoader) return Promise.resolve(shipModelCache);
    const loader = new T3.GLTFLoader();
    const jobs = Object.entries(SHIP_ASSET).map(([key, path]) => new Promise((res) => {
      loader.load(path, (gltf) => { shipModelCache[key] = prepareShipModel(gltf.scene); res(); },
        undefined, (err) => { console.warn('[ship] model skipped:', key, err); res(); });
    }));
    shipModelPromise = Promise.all(jobs).then(() => {
      for (const gh of MP.ghosts.values()) if (gh.kind === 1 && gh.group.userData.fallbackShip) installShipVisual(gh.group, gh.owner, gh);
      return shipModelCache;
    });
    return shipModelPromise;
  }

  function cloneShipModel(owner) {
    const src = shipModelCache[shipKeyForOwner(owner)] || shipModelCache.neutral;
    if (!src) return null;
    const model = src.clone(true);
    let mat = null;
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = false;
      o.receiveShadow = true;
      o.userData.perfGroup = 'ships';
      if (o.material) {
        o.material = o.material.clone();
        if (!mat) mat = o.material;
      }
    });
    model.rotation.y = SHIP_MODEL_ROT_Y;
    model.scale.setScalar(SHIP_MODEL_SCALE);
    return { model, mat };
  }

  function fallbackShipVisual(g, owner) {
    const col = OWNER_COL[owner] != null ? OWNER_COL[owner] : 0x9aa6b2;
    const hullM = new T3.MeshLambertMaterial({ color: 0x6b4a2c });
    const mat = new T3.MeshLambertMaterial({ color: col });
    const hull = new T3.Mesh(new T3.BoxGeometry(0.55, 0.16, 0.24), hullM); hull.position.y = 0.08; hull.castShadow = false; hull.userData.perfGroup='ships'; g.add(hull);
    const bow = new T3.Mesh(new T3.ConeGeometry(0.12, 0.3, 4), hullM); bow.rotation.z = -Math.PI / 2; bow.rotation.y = Math.PI / 4; bow.position.set(0.4, 0.08, 0); g.add(bow);
    const mast = new T3.Mesh(new T3.CylinderGeometry(0.014, 0.014, 0.4), hullM); mast.position.y = 0.34; g.add(mast);
    const sail = new T3.Mesh(new T3.BoxGeometry(0.03, 0.26, 0.22), mat); sail.position.set(0, 0.42, 0); sail.castShadow = false; sail.userData.perfGroup='ships'; g.add(sail);
    g.scale.setScalar(typeof SHIP_SCALE !== 'undefined' ? SHIP_SCALE : 5);
    g.userData.fallbackShip = true;
    ensureShipModels();
    return mat;
  }

  function installShipVisual(g, owner, gh) {
    while (g.children.length) g.remove(g.children[0]);
    g.scale.setScalar(1);
    const built = cloneShipModel(owner);
    if (!built) return fallbackShipVisual(g, owner);
    ensureShipHitbox(g);
    g.userData.fallbackShip = false;
    g.userData.batchedShip = true;
    if (gh) gh.mat = null;
    return null;
  }
  ensureShipModels();
  // 🚢 ТРАНСПОРТ ПЕХОТЫ: сухопутные юниты остаются на обычном road stream,
  //    а корабль — отдельная kind-1 сущность 'shq…' над водой с авторитетным курсом.
  function rebuildTypedUnits(){
    for(const gh of MP.ghosts.values())if(gh.kind===0&&gh.group?.userData){
      const ud=gh.group.userData;
      if(ud.tm){for(const b of ud.tm){if(b.mesh)gh.group.remove(b.mesh);if(b.acc)gh.group.remove(b.acc);} ud.tm=null;} ud.unitSourceKey=null;
      ud.orbN=-1;
      ghostSwarm(gh,unitsForCount(gh.count||1));
    }
  }
  if(typeof ensureUnitModels==='function')ensureUnitModels().then(rebuildTypedUnits);
  // dev: window.__unitTune={sword:{...}} → пересборка роёв с новой раскладкой экипировки
  window.__rebuildTypedUnits=function(){ if(typeof window.__clearTypedUnitCache==='function')window.__clearTypedUnitCache(); rebuildTypedUnits(); };

  const shipHitGeo=new T3.BoxGeometry(1.35,0.55,0.75);
  const shipHitMat=new T3.MeshBasicMaterial({visible:false});
  const ghostShipBatchRoot=new T3.Group();
  ghostShipBatchRoot.name='ghost-ship-batches';
  scene.add(ghostShipBatchRoot);
  const ghostShipBatches=new Map();
  const ghostShipEntityDummy=new T3.Object3D();
  const ghostShipMatrix=new T3.Matrix4();
  function ensureShipHitbox(g){
    if(g.userData.shipHit)return g.userData.shipHit;
    const hit=new T3.Mesh(shipHitGeo,shipHitMat);
    hit.position.y=0.25; hit.castShadow=false; hit.receiveShadow=false;
    g.add(hit); g.userData.shipHit=hit; return hit;
  }
  function shipBatchSource(key){
    const root=shipModelCache[key]||shipModelCache.neutral;
    if(!root)return null;
    root.updateWorldMatrix&&root.updateWorldMatrix(true,true);
    let mesh=null;
    root.traverse(o=>{if(!mesh&&o.isMesh)mesh=o;});
    if(!mesh)return null;
    return {geo:mesh.geometry, mat:mesh.material, local:mesh.matrixWorld?mesh.matrixWorld.clone():new T3.Matrix4()};
  }
  function ensureGhostShipBatch(key,count){
    const src=shipBatchSource(key); if(!src)return null;
    let b=ghostShipBatches.get(key);
    if(b&&b.cap>=count&&b.geo===src.geo&&b.mat===src.mat)return b;
    if(b)ghostShipBatchRoot.remove(b.im);
    const cap=Math.max(1,count);
    const im=new T3.InstancedMesh(src.geo,src.mat,cap);
    im.castShadow=false; im.receiveShadow=true; im.frustumCulled=false; im.userData.perfGroup='ships';
    ghostShipBatchRoot.add(im);
    b={im,cap,geo:src.geo,mat:src.mat,local:src.local}; ghostShipBatches.set(key,b); return b;
  }
  function updateGhostShipBatches(){
    for(const b of ghostShipBatches.values()){b.im.count=0;b.im.visible=false;}
    const byKey=new Map();
    for(const gh of MP.ghosts.values())if(gh.kind===1&&!gh.group.userData.fallbackShip){
      if(gh.transport && typeof isWaterAt==='function' && !isWaterAt(gh.group.position.x,gh.group.position.z))continue;   // 🏝 транспорт НЕ рисуем над видимой сушей (не заезжает на остров)
      const key=shipKeyForOwner(gh.owner);
      const list=byKey.get(key)||[]; list.push(gh); byKey.set(key,list);
    }
    for(const [key,list] of byKey){
      const b=ensureGhostShipBatch(key,list.length); if(!b)continue;
      for(let i=0;i<list.length;i++){
        const gh=list[i];
        ghostShipEntityDummy.position.copy(gh.group.position);
        ghostShipEntityDummy.rotation.set(0,gh.group.rotation.y+SHIP_MODEL_ROT_Y,0);
        ghostShipEntityDummy.scale.setScalar(SHIP_MODEL_SCALE);
        ghostShipEntityDummy.updateMatrix();
        ghostShipMatrix.multiplyMatrices(ghostShipEntityDummy.matrix,b.local);
        b.im.setMatrixAt(i,ghostShipMatrix);
      }
      b.im.count=list.length; b.im.visible=list.length>0; b.im.instanceMatrix.needsUpdate=true;
    }
  }

  const ghostPlaneBodyMat=new T3.MeshLambertMaterial({color:0xe8edf2});
  const ghostPlaneEntityDummy=new T3.Object3D();
  const ghostPlaneMatrix=new T3.Matrix4();
  function ghostPlaneLocal(x,y,z,rz=0,sx=1,sy=1,sz=1){
    const d=new T3.Object3D();
    d.position.set(x,y,z); d.rotation.z=rz; d.scale.set(sx,sy,sz); d.updateMatrix();
    return d.matrix.clone();
  }
  const GHOST_PLANE_PARTS=[
    {key:'bag',   geo:new T3.SphereGeometry(0.18,16,8),        mat:null, body:true,  local:ghostPlaneLocal(0,0.03,0,0,2.3,0.82,0.82)},
    {key:'gond',  geo:new T3.BoxGeometry(0.34,0.08,0.12),       mat:null, body:false, local:ghostPlaneLocal(0,-0.18,0,0)},
    {key:'tailH', geo:new T3.BoxGeometry(0.12,0.025,0.34),      mat:null, body:false, local:ghostPlaneLocal(-0.35,0.03,0,0)},
    {key:'tailV', geo:new T3.BoxGeometry(0.12,0.26,0.025),      mat:null, body:false, local:ghostPlaneLocal(-0.35,0.07,0,0)},
    {key:'nose',  geo:new T3.SphereGeometry(0.12,12,6),         mat:null, body:true,  local:ghostPlaneLocal(0.38,0.03,0,0,1.15,0.78,0.78)},
  ];
  const ghostPlaneBatchRoot=new T3.Group();
  ghostPlaneBatchRoot.name='ghost-plane-batches';
  scene.add(ghostPlaneBatchRoot);
  const ghostPlaneBatches=new Map();
  function ensureGhostPlaneBatch(owner,part,count){
    const key=owner+':'+part.key;
    let b=ghostPlaneBatches.get(key);
    if(b&&b.cap>=count)return b;
    if(b)ghostPlaneBatchRoot.remove(b.im);
    const color=OWNER_COL[owner]!=null?OWNER_COL[owner]:0x9aa6b2;
    const mat=part.body?ghostPlaneBodyMat:new T3.MeshLambertMaterial({color});
    const cap=Math.max(1,count);
    const im=new T3.InstancedMesh(part.geo,mat,cap);
    im.castShadow=false; im.receiveShadow=true; im.frustumCulled=false; im.userData.perfGroup='planes';
    ghostPlaneBatchRoot.add(im);
    b={im,cap}; ghostPlaneBatches.set(key,b); return b;
  }
  function updateGhostPlaneBatches(){
    for(const b of ghostPlaneBatches.values()){b.im.count=0;b.im.visible=false;}
    const byOwner=new Map();
    for(const gh of MP.ghosts.values())if(gh.kind===2){
      const list=byOwner.get(gh.owner)||[]; list.push(gh); byOwner.set(gh.owner,list);
    }
    for(const [owner,list] of byOwner){
      const batches=GHOST_PLANE_PARTS.map(p=>ensureGhostPlaneBatch(owner,p,list.length));
      for(let i=0;i<list.length;i++){
        const gh=list[i];
        ghostPlaneEntityDummy.position.copy(gh.group.position);
        ghostPlaneEntityDummy.rotation.set(0,gh.group.rotation.y,0);
        ghostPlaneEntityDummy.scale.setScalar(typeof PLANE_SCALE!=='undefined'?PLANE_SCALE:5);
        ghostPlaneEntityDummy.updateMatrix();
        for(let p=0;p<GHOST_PLANE_PARTS.length;p++){
          ghostPlaneMatrix.multiplyMatrices(ghostPlaneEntityDummy.matrix,GHOST_PLANE_PARTS[p].local);
          batches[p].im.setMatrixAt(i,ghostPlaneMatrix);
        }
      }
      for(const b of batches){b.im.count=list.length;b.im.visible=list.length>0;b.im.instanceMatrix.needsUpdate=true;}
    }
  }

  /* ── гость: зеркала сущностей ── */
  function ghostMesh(kind,owner){
    const col=(OWNER_COL[owner]!=null?OWNER_COL[owner]:0x9aa6b2), g=new T3.Group(); let lab=null, mat=null;
    g.userData.perfGroup=kind===0?'units':kind===1?'ships':kind===2?'planes':'projectiles';
    if(kind===0){ mat=new T3.MeshLambertMaterial({color:col}); g.userData.orbs=[]; g.userData.orbN=0;   // 🪖 рой KayKit-юнитов, число ∝ армии — строится в reconcile/ghostSwarm
      lab=document.createElement('div'); lab.className='lab'; labels&&labels.appendChild(lab); }
    else if(kind===1){ // ⚓ KayKit ship model; primitive fallback until GLTFs finish loading.
      mat=installShipVisual(g,owner,null); }
    else if(kind===2){ // ✈ дирижабли рисуются общим InstancedMesh-батчем, группа хранит только позицию/поворот.
      mat=new T3.MeshLambertMaterial({color:col}); g.userData.batchedPlane=true; }
    else { g.add(new T3.Mesh(new T3.ConeGeometry(0.1,0.4,6),new T3.MeshBasicMaterial({color:0xff7a3a}))); }
    scene.add(g);
    const obj={kind,owner,group:g,lab,count:0,target:new T3.Vector3(),mat,isAir:kind===2,pos:g.position};
    g.userData.ghost=obj; return obj;
  }
  function killGhost(gh){ scene.remove(gh.group); if(gh.lab)gh.lab.remove();
    // 🧹 диспоуз per-ghost GPU-ресурсов (утечка при высокой ротации отрядов): инстанс-буферы роя + собственный материал.
    //    Геометрию/материал инстансов НЕ трогаем — они шареные (src.geo/src.mat общей модели); InstancedMesh.dispose()
    //    освобождает только instanceMatrix/instanceColor. gh.mat — per-ghost MeshLambertMaterial (kind 0/2) / клон материала корабля.
    const ud=gh.group.userData;
    if(ud&&ud.tm){ for(const b of ud.tm){ if(b.mesh&&b.mesh.dispose)b.mesh.dispose(); if(b.acc&&b.acc.dispose)b.acc.dispose(); b.mesh=null; b.acc=null; } ud.tm=null; }
    if(gh.mat&&gh.mat.dispose)gh.mat.dispose();
  }
  // рой отряда-призрака: n мини-юнитов по диску (золотой угол) — зеркало солошного Squad._buildCluster
  const ghostUnitDummy=new T3.Object3D();
  ghostUnitDummy.rotation.order='YXZ';                                   // yaw (курс) → pitch (наклон в беге)
  const ghostUnitMatrix=new T3.Matrix4();
  const unitGroundY=(x,z)=>((typeof getTerrainHeight==='function'?getTerrainHeight(x,z):0)+0.2);
  // ⚔ темпы для анимации павших (без аллокаций в кадре)
  const _cm=new T3.Matrix4(), _cv=new T3.Vector3(), _cq=new T3.Quaternion(), _cs=new T3.Vector3();
  // 🪖 ПОХОДНАЯ КОЛОННА-«ЗМЕЙКА»: голова у лидера, каждый ряд держится на rankSp ПОЗАДИ предыдущего.
  // Голова заходит на дугу — хвост ещё идёт прямо; поворот перетекает по колонне (как поезд). Никаких резких разворотов.
  function placeGhostSwarm(gh,now){
    const ud=gh.group.userData; if(!ud.tm||!ud.putUnitMatrix)return;   // 👥 бакеты типов создаёт ghostSwarm
    const tt=now/1000, sc=ud.unitScale||1, n=ud.orbN;
    const dt=Math.min(0.1,Math.max(0,(now-(ud._lt||now))/1000)); ud._lt=now;
    const p=gh.group.position, t=gh.target, dx=t.x-p.x, dz=t.z-p.z, dist=Math.hypot(dx,dz);
    const moving=dist>0.02;
    if(moving){ const nd=[dx/dist,dz/dist];                                     // курс головы сглаживаем
      if(!ud.fwd) ud.fwd=nd; else { const kf=Math.min(1,dt*5), fx=ud.fwd[0]+(nd[0]-ud.fwd[0])*kf, fz=ud.fwd[1]+(nd[1]-ud.fwd[1])*kf, l=Math.hypot(fx,fz)||1; ud.fwd=[fx/l,fz/l]; } }
    let fwd=ud.fwd||[1,0];
    // ⚔ БОЙ: стоя в сцепке (moving=false → fwd не обновлялся бы) голова ПЛАВНО разворачивается к врагу
    const bt=gh.fighting?ud.battleTgt:null; let battle=0;
    if(bt){ const bx=bt[0]-p.x, bz=bt[1]-p.z, bl=Math.hypot(bx,bz);
      if(bl>1e-4){ const nd=[bx/bl,bz/bl], kf=Math.min(1,dt*6);
        ud.fwd=ud.fwd?[ud.fwd[0]+(nd[0]-ud.fwd[0])*kf, ud.fwd[1]+(nd[1]-ud.fwd[1])*kf]:nd;
        const l=Math.hypot(ud.fwd[0],ud.fwd[1])||1; ud.fwd=[ud.fwd[0]/l,ud.fwd[1]/l]; fwd=ud.fwd; battle=1; } }
    // 🚶 run от РЕАЛЬНОЙ скорости головы (смещение за кадр), не от зазора до цели лерпа → не мерцает при лагах/gameSpeed
    const jump=ud._lastP?Math.hypot(p.x-ud._lastP[0],p.z-ud._lastP[1]):0, teleport=jump>2; ud._lastP=[p.x,p.z];
    const spd0=(((typeof LOCALSIM!=='undefined'&&LOCALSIM&&LOCALSIM.K&&LOCALSIM.K.SQUAD_SPEED)||(typeof SQUAD_SPEED!=='undefined'?SQUAD_SPEED:0.8)))*(typeof gameSpeed!=='undefined'?Math.max(0.25,gameSpeed):1);
    if(!teleport&&dt>1e-4)ud.runS=(ud.runS||0)+(Math.min(1,(jump/dt)/(spd0*0.85))-(ud.runS||0))*Math.min(1,dt*8);
    const run=ud.runS||0, lean=run*0.30;
    // ⚔ численное преимущество: побеждающий бьёт агрессивнее, меньшинство — короче выпад + дрожь
    let adv=0; if(battle){ const ec=ud.battleFoeCount||gh.count||1; adv=Math.max(-1,Math.min(1,((gh.count||1)-ec)/Math.max(ec,1))); }
    const advW=Math.max(0,adv), advL=Math.max(0,-adv);
    // 🎉 чир победы: короткая радость после выигранной сцепки (ставится в mpTick при fighting→false)
    let cheer=0; if(ud.cheerT>0){ ud.cheerT-=dt; cheer=Math.min(1,ud.cheerT/0.55); }
    // ⚔ прессинг: в бою ряды поджимаются к передним («толпа напирает»); плавный переход туда и обратно
    ud.press=(ud.press==null?1:ud.press)+((battle?0.78:1)-(ud.press==null?1:ud.press))*Math.min(1,dt*4);
    const press=ud.press;
    const W=ud.colW||3, rankSp=sc*0.95, ranks=Math.ceil(n/W);
    const fileSp=Math.min(sc*0.31, W>1?(((typeof window!=='undefined'&&window.HEXWIDTH)?window.HEXWIDTH:1.63)*0.5)/((W-1)+0.3):sc*0.31);  // отступ между юнитами в шеренге сокращён ×2 (плотнее), но не шире полхекса
    // 🚪 постепенный ВЫХОД: ряд «выезжает» из ворот по мере удаления головы от точки спавна (голова — первой).
    //    ряд r встаёт у ворот ровно когда голова ушла на r·rankSp, поэтому колонна вытекает из города, а не вспыхивает целиком.
    if(!ud.spawnPos){ ud.spawnPos=[p.x,p.z];                             // привязываем точку выхода СТРОГО к зданию-источнику → выходят из здания, не «сбоку»
      if(typeof cities!=='undefined'){ let bd=4,best=null; for(const c of cities){ if(!c)continue; const cx=c._visualGX==null?c.gx:c._visualGX, cz=c._visualGZ==null?c.gz:c._visualGZ; const d2=(cx-p.x)*(cx-p.x)+(cz-p.z)*(cz-p.z); if(d2<bd){bd=d2;best=[cx,cz];} } if(best)ud.spawnPos=best; } }
    const visRanks=Math.max(1, Math.floor((ud.travelled||0)/rankSp)+1);  // раскрываем ряды по ПРОЙДЕННОМУ пути (арк-длина) → совпадает с раскладкой по следу, на изгибах колонна не обрезается
    // 🏰 постепенный ВХОД: при роспуске (dying) голова уходит вглубь города, ряды по очереди «заходят в ворота» и гаснут.
    let hideRanks=0, advIn=0;
    if(gh._dying && ud._dieAt){ advIn=Math.hypot(p.x-ud._dieAt[0], p.z-ud._dieAt[1]); hideRanks=Math.floor(advIn/rankSp); }
    // ⚠ строй управляется ТОЛЬКО следом (дорогой). Прежний «прямой выход/вход» (exitB/enterB) уводил длинную
    //   колонну на прямую с дороги, отрывал цифру от строя и давал рывок — убран. Выход/вход = раскрытие+таяние по следу.
    const colLen=ranks*rankSp;
    // ── ТРЕК-СЛЕД: пишем РЕАЛЬНЫЙ путь головы (хлебные крошки) и ставим каждую шеренгу на дуговой длине r·rankSp назад по нему.
    //    Каждый ряд идёт ТОЧНО по дороге → длинная колонна не ломается даже в резких поворотах (в отличие от пружинной цепочки).
    let tr=ud.trail;
    if(!tr || teleport){ tr=ud.trail=[[p.x,p.z]]; ud.travelled=0; }                                                    // новый отряд / телепорт → сброс следа и пути
    else {
      ud.travelled=(ud.travelled||0)+jump;
      const last=tr[tr.length-1], lx=last[0], lz=last[1], seg=Math.hypot(p.x-lx,p.z-lz);
      if(seg>0.08){
        const steps=Math.min(12,Math.floor(seg/0.08));
        for(let s=1;s<=steps;s++){ const q=s/steps; tr.push([lx+(p.x-lx)*q,lz+(p.z-lz)*q]); }
      }
    }  // копим ПРОЙДЕННЫЙ путь + частые крошки → хвост не срезает повороты дороги
    const maxTrail=Math.ceil(colLen/0.1)+30; while(tr.length>maxTrail) tr.shift();                                     // след не длиннее колонны
    // один проход назад по следу: позиция+курс каждой шеренги
    const ch=[], rdir=[]; ch[0]=[p.x,p.z]; rdir[0]=fwd;
    { let px=p.x,pz=p.z,acc=0,r=1;
      for(let i=tr.length-1;i>=0 && r<ranks;i--){ const tx=tr[i][0],tz=tr[i][1], ddx=tx-px,ddz=tz-pz,seg=Math.hypot(ddx,ddz); if(seg<1e-6)continue;
        const fx=-ddx/seg,fz=-ddz/seg;                                                                                 // курс вперёд (к голове)
        while(r<ranks && acc+seg>=r*rankSp*press){ const q=(r*rankSp*press-acc)/seg; ch[r]=[px+ddx*q,pz+ddz*q]; rdir[r]=[fx,fz]; r++; }   // press<1 в бою → ряды поджаты
        acc+=seg; px=tx; pz=tz; }
      while(r<ranks){ const L=ch[r-1],D=rdir[r-1]; ch[r]=[L[0]-D[0]*rankSp*press,L[1]-D[1]*rankSp*press]; rdir[r]=D; r++; }         // след кончился → прямо назад
    }
    // 🚪 ВОРОТА / 🌉 МОСТ — воронка ПО-РЯДНО: каждый ряд сужается у СВОЕЙ позиции, а не по голове.
    //    Колонна расширяется только когда КОНКРЕТНЫЙ ряд реально миновал узкое место (раньше: голова прошла → все разом).
    //    Кэшируем два города-со-стенами (ближайший к голове и к хвосту — длинная колонна может тянуться между двумя).
    const fc=ud._fc||(ud._fc={t:-1e9,px:0,pz:0,a:null,b:null});
    if(now-fc.t>300||Math.hypot(p.x-fc.px,p.z-fc.pz)>1){ fc.t=now; fc.px=p.x; fc.pz=p.z; fc.a=null; fc.b=null;
      if(typeof cities!=='undefined'){ const tail=ch[ranks-1]||[p.x,p.z]; let ba=Infinity,bb=Infinity;
        for(const c of cities){ if(!c||!c._wallR)continue; const cx=c._visualGX==null?c.gx:c._visualGX, cz=c._visualGZ==null?c.gz:c._visualGZ;
          const dh=(cx-p.x)*(cx-p.x)+(cz-p.z)*(cz-p.z); if(dh<ba){ba=dh;fc.a=c;}
          const dtl=(cx-tail[0])*(cx-tail[0])+(cz-tail[1])*(cz-tail[1]); if(dtl<bb){bb=dtl;fc.b=c;} } } }
    const _cityFun=(x,z,c)=>{ if(!c)return 1; const cx=c._visualGX==null?c.gx:c._visualGX, cz=c._visualGZ==null?c.gz:c._visualGZ, wr=c._wallR, d2=(cx-x)*(cx-x)+(cz-z)*(cz-z);
      if(d2>=wr*1.7*wr*1.7)return 1; const dC=Math.sqrt(d2); return Math.max(0.35,Math.min(1,Math.abs(dC-wr*0.95)/(wr*0.6)+0.35)); };
    const BR=window.HEXBRIDGES;
    const funnelR=[];
    for(let r=0;r<ranks;r++){ const cc=ch[r];
      let f=_cityFun(cc[0],cc[1],fc.a); if(fc.b&&fc.b!==fc.a)f=Math.min(f,_cityFun(cc[0],cc[1],fc.b));
      if(BR&&BR.length){ let bd=Infinity; for(const b of BR){ const d2=(b.gx-cc[0])*(b.gx-cc[0])+(b.gz-cc[1])*(b.gz-cc[1]); if(d2<bd)bd=d2; }
        const R=1.5; if(bd<R*R){ const dB=Math.sqrt(bd); f=Math.min(f,Math.max(0.4,Math.min(1,Math.max(0,dB-R*0.5)/(R*0.5)+0.4))); } }
      funnelR[r]=f; }
    for(let i=0;i<n;i++){
      const u=ud.orbs[i], file=i%W, rank=(i/W)|0, c=ch[rank], d=rdir[rank];
      // 🏰 ВХОД: ряд, пройдя центр здания, ПЛАВНО тает (уменьшается+тонет) — постепенно пропадает, а не гаснет рывком
      let fadeK=1;
      if(gh._dying){ const depth=advIn-rank*rankSp; if(depth>0) fadeK=1-depth/(rankSp*2.2); }   // тают ~2 ряда сразу → заметно «постепенно пропадают»
      if(gh._perish) fadeK*=Math.max(0,1-(now-gh._perish)/750);           // ⚔ погиб в бою → весь остаток тает на месте
      // 🚪 плавный ВЫХОД (зеркально входу): ряд ВЫРАСТАЕТ у ворот по мере пройденного пути, а не вспыхивает
      const born=(ud.travelled||0)-rank*rankSp;
      fadeK*=born>=rankSp*0.6?1:Math.max(0,born/(rankSp*0.6));
      if(rank>=visRanks || fadeK<=0.02){                                   // ещё в здании (не вышел) / уже полностью втянулся → скрыт
        ghostUnitDummy.position.set(0,-999,0); ghostUnitDummy.scale.set(0,0,0); ghostUnitDummy.updateMatrix();
        if(ud.unitLocal)ghostUnitMatrix.multiplyMatrices(ghostUnitDummy.matrix,ud.unitLocal); else ghostUnitMatrix.copy(ghostUnitDummy.matrix);
        ud.putUnitMatrix(i,ghostUnitMatrix); continue; }
      const cx=c[0], cz=c[1], dx2=d[0], dz2=d[1];                         // ряд стоит ТОЧНО на следе (дороге) — без прямых блендов
      const rowHead=-Math.atan2(dz2,dx2);
      let acOff=((file-(W-1)/2)+(u.lj||0))*fileSp*(funnelR[rank]||1);   // поперёк ряда — ровно по центру оси; воронка СВОЕГО ряда
      if(gh._dying)acOff*=0.3+0.7*fadeK;                                 // 🏰 вход: тающий ряд стягивается к оси двери (заходят в проём, а не в стену)
      const wx=cx-dz2*acOff, wz=cz+dx2*acOff;                             // perp к курсу ряда
      const phase=tt*(6+u.sp*3.2)+u.ph, hop=Math.abs(Math.sin(phase));
      // ⚔ выпад в бою: резкий удар вперёд (острая фаза sin⁴, у каждого своя), сила спадает к задним рядам;
      //    численный перевес (advW) → чаще и дальше; меньшинство (advL) → короче выпад
      const rankK=battle?Math.max(0,1-rank*0.45):0;
      const atk=rankK>0?Math.pow(Math.max(0,Math.sin(tt*(5+u.sp*2.5+advW*1.6)+u.ph*3.1)),4)*rankK*(1+0.45*advW-0.35*advL):0;
      // 🎉 чир: подпрыгивания выше обычного + лёгкий вертёж после победы
      const joy=cheer?cheer*Math.abs(Math.sin(phase*1.8+u.ph*2))*0.08:0;
      const bob=hop*(0.035+run*0.06)+atk*0.05+joy, sqv=(hop-0.4)*(0.4+run*0.4);   // амплитуда шага умеренная (была великовата)
      const lead=i===0?1.12:1;                                           // 🚩 лидер-знаменосец чуть крупнее
      const sy=sc*(1+sqv*0.34)*fadeK*lead, sxz=sc*(1-sqv*0.18)*fadeK*lead;   // fadeK<1 у входящих/выходящих → шеренга тает/вырастает
      const jm=1+battle*1.8;                                              // в сцепке толкучка заметнее
      const jx=Math.sin(tt*3.1+u.ph*1.7)*0.012*jm, jz=Math.cos(tt*2.7+u.ph)*0.012*jm;
      const gy=unitGroundY(wx,wz);
      // адаптивный снап (как в потоке): нормальный шаг — строго по следу (не срезаем острый угол),
      // сглаживаем ТОЛЬКО телепорт-скачки; выпад/джиттер/bob добавляются ПОСЛЕ (не демпфируются)
      const snapMax=Math.max(0.5, (typeof gameSpeed!=='undefined'?gameSpeed:1)*0.8*dt*6);
      if(u.ex==null || Math.hypot(wx-u.ex,wz-u.ez)<=snapMax){ u.ex=wx; u.ez=wz; u.ey=gy; }
      else { const ke=Math.min(1,dt*9); u.ex+=(wx-u.ex)*ke; u.ez+=(wz-u.ez)*ke; u.ey+=(gy-u.ey)*ke; }
      // 💧 боец НЕ встаёт на открытую воду (та же защита, что в потоке): ось следа (cx,cz) на суше → поджимаем к ней
      let fwx=u.ex+dx2*atk*0.19+jx, fwz=u.ez+dz2*atk*0.19+jz;
      if(typeof isWaterAt==='function' && isWaterAt(fwx,fwz) && !isWaterAt(cx,cz)){
        let ok=false; for(let kk=0.7;kk>0;kk-=0.23){ const tx=cx+(fwx-cx)*kk, tz=cz+(fwz-cz)*kk; if(!isWaterAt(tx,tz)){ fwx=tx; fwz=tz; ok=true; break; } } if(!ok){ fwx=cx; fwz=cz; }
      }
      ghostUnitDummy.position.set(fwx-p.x, (u.ey-p.y)+bob-(1-fadeK)*sc*0.7, fwz-p.z);   // каждый боец стоит на своей высоте дороги/склона
      const tgtY=rowHead+(u.yaw||0)*0.4+(cheer?Math.sin(tt*5+u.ph*3)*0.25*cheer:0);   // плавный доворот (+вертёж в чире)
      if(u.cy==null)u.cy=tgtY; else u.cy+=angDiff(tgtY,u.cy)*Math.min(1,dt*10);
      const flinch=battle?advL*0.05*Math.sin(tt*8+u.ph*2):0;             // дрожь проигрывающего меньшинства
      const doorLean=gh._dying?(1-fadeK)*0.18:0;                         // 🏰 вход: тающий наклоняется в проём двери
      const pitch=ud.hasUnitModel?0:(-lean-hop*0.10*run-atk*0.55+flinch-doorLean); // KayKit-модель уже ориентирована — наклон заваливал юнитов в пути
      ghostUnitDummy.rotation.set(pitch, u.cy, 0);
      ghostUnitDummy.scale.set(sxz,sy,sxz); ghostUnitDummy.updateMatrix();
      if(ud.unitLocal)ghostUnitMatrix.multiplyMatrices(ghostUnitDummy.matrix,ud.unitLocal); else ghostUnitMatrix.copy(ghostUnitDummy.matrix);
      ud.putUnitMatrix(i,ghostUnitMatrix);
    }
    // ⚔ ПАВШИЕ: заваливаются на месте гибели, лежат и тают (слоты n..n+cN-1 того же InstancedMesh; кап ёмкости orbCap)
    let cN=0;
    if(ud.corpses&&ud.corpses.length){
      for(let j=ud.corpses.length-1;j>=0;j--){ const c2=ud.corpses[j]; c2.t+=dt; if(c2.t>0.95)ud.corpses.splice(j,1); }
      const ti=ud.tmInf||ud.tm[0];
      cN=Math.min(ud.corpses.length,Math.max(0,(ti.cap||n)-(ti.n||n)));
      for(let j=0;j<cN;j++){ const c2=ud.corpses[j];
        // аккуратный «сплэт» вместо кувырка: короткий подскок → приплющивается к земле → лежит → тонет и тает
        const fall=Math.min(1,c2.t/0.25), sink=Math.max(0,(c2.t-0.55)/0.4);
        const rx=(c2.wx!=null?c2.wx-p.x:0), rz=(c2.wz!=null?c2.wz-p.z:0);   // мировая точка смерти — труп лежит на месте
        const splatY=Math.max(0.2,1-fall*0.8), splatXZ=1+fall*0.2;          // приплющивание: ниже и чуть шире
        const k2=1-sink*0.6;
        ghostUnitDummy.position.set(rx, Math.sin(fall*Math.PI)*0.05-sink*sc*0.35, rz);   // лёгкий подскок → на землю → тонет
        ghostUnitDummy.rotation.set(-fall*0.22,c2.cy||0,0);                 // лёгкий клевок вперёд, без заваливания
        ghostUnitDummy.scale.set(sc*splatXZ*k2, sc*splatY*k2, sc*splatXZ*k2);
        ghostUnitDummy.updateMatrix();
        if(ud.unitLocal)ghostUnitMatrix.multiplyMatrices(ghostUnitDummy.matrix,ud.unitLocal); else ghostUnitMatrix.copy(ghostUnitDummy.matrix);
        { const s=ud.corpseSlot(j); if(ti.mesh&&s<ti.cap)ti.mesh.setMatrixAt(s,ghostUnitMatrix); }
      }
    }
    ud.finalizeUnits(cN);
    // ⚔ искры/пыль в линии соприкосновения двух армий (кап по fx-пулу, редкая каденция)
    if(battle&&bt&&typeof spawnClashFX==='function'&&(typeof fx==='undefined'||fx.length<70)){
      ud._clashT=(ud._clashT||0)+dt;
      if(ud._clashT>0.26+Math.random()*0.22){ ud._clashT=0;
        const mx=p.x+(bt[0]-p.x)*0.5+(Math.random()-0.5)*0.5, mz=p.z+(bt[1]-p.z)*0.5+(Math.random()-0.5)*0.5;
        spawnClashFX(mx,typeof getTerrainHeight==='function'?getTerrainHeight(mx,mz):p.y,mz);
      }
    }
    // 🚶 пыль марша: редкие пуфы под бегущей колонной
    if(!battle&&run>0.6&&!gh._dying&&typeof spawnMarchDust==='function'&&(typeof fx==='undefined'||fx.length<70)){
      ud._dustT=(ud._dustT||0)+dt;
      if(ud._dustT>0.45+Math.random()*0.4){ ud._dustT=0;
        const rr=Math.min(ranks-1,(Math.random()*ranks)|0), cc=ch[rr];
        if(cc){ const mx=cc[0]+(Math.random()-0.5)*0.3, mz=cc[1]+(Math.random()-0.5)*0.3;
          spawnMarchDust(mx,typeof getTerrainHeight==='function'?getTerrainHeight(mx,mz):p.y,mz); }
      }
    }
  }
  // ── 🍄 ПОТОК (Mushroom Wars): юниты бегут живым ручьём по сплайну дороги — каждый со своей арк-позицией,
  //    скоростным «дыханием», вилянием и высотой из профиля дороги (склоны рампой, мосты по полотну).
  //    window.UNIT_STREAM=false → мгновенный ОТКАТ на старый строй-рендер (placeGhostSwarm остался нетронут).
  //    БОЙ рисует ТОТ ЖЕ поток (без переключения рендера, как в классических RTS): толпа стоит на своих местах,
  //    прижимается к линии контакта, передние делают выпады к врагу, павшие валятся на месте.
  function placeGhostStream(gh,now){
    if(window.UNIT_STREAM===false) return false;
    const a=gh.edgeA,b=gh.edgeB;
    if(a==null||b==null||typeof hexRoadSample!=='function'||typeof hexRoadLen!=='function') return false;
    const ud=gh.group.userData; if(!ud.tm||!ud.putUnitMatrix) return false;
    const len=hexRoadLen(a,b); if(!len) return false;
    const n=ud.orbN, sc=ud.unitScale||1, tt=now/1000, p=gh.group.position;
    const dt=Math.min(0.1,Math.max(0,(now-(ud._lt||now))/1000)); ud._lt=now;
    const key=Math.min(a,b)+'_'+Math.max(a,b);
    // Не рефайним дорогу из горячего цикла рендера: путь уже имеет precomputed samples.
    let st=ud.st;
    const _fr=(gh._fracR!=null?gh._fracR:(gh.frac||0));               // сглаженная (предсказанная) фракция из mpTick — гладкая голова между снапшотами
    if(!st) st=ud.st={key,a,b,len,sHead:_fr*len,prev:null,v:0};
    else if(st.key!==key){
      st.prev=(a===st.b)?{a:st.a,b:st.b,len:st.len}:null;   // следующее ребро пути → хвост доезжает по прошлому; редирект → без хвостового ребра
      st.key=key; st.a=a; st.b=b; st.len=len;
    } else { st.a=a; st.b=b; st.len=len; }
    // голова: в норме — точная арк-позиция сима (срезания невозможны); при роспуске — сама дошагивает до здания
    const spd=((typeof LOCALSIM!=='undefined'&&LOCALSIM&&LOCALSIM.K&&LOCALSIM.K.SQUAD_SPEED!=null)?LOCALSIM.K.SQUAD_SPEED:0.8)*(typeof gameSpeed!=='undefined'?gameSpeed:1);
    const target=gh._dying? st.sHead+spd*Math.min(0.05,dt) : _fr*len;
    st.v=st.v+((target-st.sHead)/(dt||0.016)-st.v)*Math.min(1,dt*6);      // сглаженная скорость головы
    st.sHead=target;
    const run=Math.max(0,Math.min(1,Math.abs(st.v)/(spd*0.6||0.5)));
    // ⚔ бой в ТОМ ЖЕ рендере: цель — ближайший дерущийся враг (battleTgt из mpTick)
    const battle=gh.fighting?1:0, bt=battle?ud.battleTgt:null;
    const cheer=Math.max(0,ud.cheerT||0); if(cheer>0)ud.cheerT=cheer-dt;   // 🎉 чир после победы
    // след поддерживаем и в потоке → бой/откат/полевой режим подхватываются без телепорта хвоста
    { const jump=ud._lastP?Math.hypot(p.x-ud._lastP[0],p.z-ud._lastP[1]):0; ud._lastP=[p.x,p.z];
      let tr=ud.trail; if(!tr||jump>2){tr=ud.trail=[[p.x,p.z]]; ud.travelled=0;}
      else { ud.travelled=(ud.travelled||0)+jump; const last=tr[tr.length-1]; if(Math.hypot(p.x-last[0],p.z-last[1])>0.1)tr.push([p.x,p.z]); }
      while(tr.length>160)tr.shift(); }
    // 👥 спокойный поток: стабильные дорожки без маршевого бокового "столкновения".
    // Боевую толкучку добавляем отдельно только при fighting.
    const LANES=3, laneSp=0.18, rowGap=sc*0.62;
    // 🐎 конница крупнее пешки (конь ~0.45×0.17 при пеших интервалах 0.26×0.15) → её рядам и дорожкам
    //    нужен свой шаг, иначе кони друг в друге. Оффсеты рядов накапливаем с учётом типа ряда
    //    (типы в колонне непрерывны: cav→inf→arc, тип ряда = тип его первого юнита).
    const CAV_ROW=1.85, CAV_LANE=2.0;
    const rowsN=Math.ceil(n/LANES), rowOff=ud._rowOff||(ud._rowOff=[]);
    { rowOff.length=rowsN; let accOff=0, prevCav=ud.bucketOf(0).t==='cav';
      rowOff[0]=0;
      for(let r=1;r<rowsN;r++){ const cav=ud.bucketOf(Math.min(n-1,r*LANES)).t==='cav';
        accOff+=rowGap*((cav||prevCav)?CAV_ROW:1); rowOff[r]=accOff; prevCav=cav; } }
    const smpAt=(s)=> s>=0 ? hexRoadSample(st.a,st.b,Math.min(1,s/st.len))
                           : (st.prev?hexRoadSample(st.prev.a,st.prev.b,Math.max(0,(st.prev.len+s)/st.prev.len)):null);
    const rowSmp=[], rowSmp2=[];
    let tailS=1e9;
    for(let row=0;row<rowsN;row++){
      const wob=battle?(Math.sin(tt*0.9+row*0.73)*0.04+Math.sin(tt*0.37+row*1.17)*0.02)*sc:0;
      const s=st.sHead-(row===0?0:rowOff[row]+wob);
      if(s<tailS)tailS=s;
      rowSmp[row]={s, smp:smpAt(s)};
      rowSmp2[row]=smpAt(s+0.06);
    }
    for(let i=0;i<n;i++){
      const u=ud.orbs[i];
      if(u.gj==null){ u.gj=0.88+Math.random()*0.24; }                     // лёгкая рваность рядов
      const row=(i/LANES)|0, lane=i%LANES;
      const rowData=rowSmp[row], s=rowData?rowData.s:st.sHead;
      let fadeK=1;
      if(gh._dying){ const over=s-(st.len-0.3); if(over>0)fadeK=Math.max(0,1-over/0.45); }  // у здания-цели тает
      if(gh._perish) fadeK*=Math.max(0,1-(now-gh._perish)/750);           // ⚔ погиб в бою → тает на месте
      const smp=rowData&&rowData.smp;
      // 🚢 ПОСАДКА/ВЫСАДКА: ряд над открытой водой плавно «поднимается на борт» (тает+тонет, ~0.35с).
      //    Ряды достигают воды по очереди → волна исчезновения идёт от ПЕРВОГО ряда к последним;
      //    на высадке зеркально проявляются. Гейт по морскому режиму отряда — мосты не трогает.
      if(gh.mode===2)ud._seaUntil=now+1500;
      if(smp&&(gh.mode===2||now<(ud._seaUntil||0))&&typeof isWaterAt==='function'){
        const wet=isWaterAt(smp.x,smp.z);
        const bk=(typeof window!=='undefined'&&window.SEA_BOARD_K)||1, uk=(typeof window!=='undefined'&&window.SEA_UNBOARD_K)||1;   // 🎚 dbg-sea: живые множители
        u.seaT=Math.max(0,Math.min(0.35,(u.seaT||0)+(wet?dt*3*bk:-dt*0.85*uk)));   // посадка быстрая (~0.12с), высадка неспешная (~0.4с)
        if(u.seaT>0)fadeK*=1-u.seaT/0.35;
      } else if(u.seaT)u.seaT=0;
      if(!smp||(s<=0.001&&!st.prev)||fadeK<=0.02){                        // ещё в здании-источнике / уже втянулся / на борту
        ghostUnitDummy.position.set(0,-999,0); ghostUnitDummy.scale.set(0,0,0); ghostUnitDummy.updateMatrix();
        if(ud.unitLocal)ghostUnitMatrix.multiplyMatrices(ghostUnitDummy.matrix,ud.unitLocal); else ghostUnitMatrix.copy(ghostUnitDummy.matrix);
        ud.putUnitMatrix(i,ghostUnitMatrix); continue; }
      const smp2=rowSmp2[row]||smp;                                      // fallback для старого sampler; новый уже отдаёт tangent
      let txv=smp.tx||1,tzv=smp.tz||0; { const l0=Math.hypot(txv,tzv); if(l0>1e-4){txv/=l0;tzv/=l0;} else { const ddx=smp2.x-smp.x,ddz=smp2.z-smp.z,l=Math.hypot(ddx,ddz); if(l>1e-4){txv=ddx/l;tzv=ddz/l;} } }
      const isCav=ud.bucketOf(i).t==='cav';
      const laneMul=isCav?CAV_LANE:1, jitMul=battle?(isCav?0.4:1):0.12;    // 🐎 конные дорожки шире; в марше почти без бокового джиттера
      const latW=(lane-(LANES-1)/2)*laneSp*laneMul+((u.lj||0)*0.18+Math.sin(tt*1.3*u.sp+u.ph*3.7)*0.012)*jitMul;  // своя дорожка + лёгкая живость
      const wx=smp.x-tzv*latW, wz=smp.z+txv*latW, wy=smp.y+0.05;         // профиль = реальная поверхность полотна (рейкаст) + малый клиренс
      // адаптивный снап: на НОРМАЛЬНОМ шаге сажаем СТРОГО на дорогу (не режем острый угол — лерп отставал и срезал внутрь);
      // сглаживаем ТОЛЬКО телепорт-скачки (стык рёбер / редирект пути), где цель прыгает далеко.
      const snapMax=Math.max(0.5, spd*dt*6);
      if(u.ex==null || Math.hypot(wx-u.ex,wz-u.ez)<=snapMax){ u.ex=wx; u.ez=wz; u.ey=wy; }
      else { const ke=Math.min(1,dt*10); u.ex+=(wx-u.ex)*ke; u.ez+=(wz-u.ez)*ke; u.ey+=(wy-u.ey)*ke; }
      // ⚔ боевое поведение поверх позиции толпы (классическое RTS: линия контакта, выпады передних, толкучка)
      let atk=0, offX=0, offZ=0, faceE=null;
      if(bt){ const ex2=bt[0]-u.ex, ez2=bt[1]-u.ez, de=Math.hypot(ex2,ez2)||1e-6, dirx=ex2/de, dirz=ez2/de;
        const eng=Math.max(0,1-de/2.4);                                   // ближе к врагу → сильнее вовлечён
        if(ud.bucketOf(i).t==='arc'){
          // 🏹 ЛУЧНИК: не лезет в ближний — стреляет с места (отдача назад + стрела из пула осадных)
          if(eng>0.02){
            faceE=-Math.atan2(dirz,dirx);
            u.shotT=(u.shotT==null?Math.random()*1.4:u.shotT)+dt;
            const period=1.15+(u.ph%1)*0.6;                               // свой каденс
            if(u.shotT>=period){ u.shotT=0; u.recoilT=0.2;
              if(typeof _spawnArrow==='function'){
                const ty=(typeof getTerrainHeight==='function'?getTerrainHeight(bt[0],bt[1]):u.ey)+0.25;
                _spawnArrow(u.ex, u.ey+sc*0.55, u.ez, bt[0]+(Math.random()-0.5)*0.9, ty, bt[1]+(Math.random()-0.5)*0.9);
              }
            }
            if(u.recoilT>0){ u.recoilT-=dt; const r=Math.max(0,u.recoilT/0.2);
              offX=-dirx*r*0.1; offZ=-dirz*r*0.1; }                       // отдача назад при выстреле
          }
        } else {
          atk=eng>0.05?Math.pow(Math.max(0,Math.sin(tt*(5+u.sp*2.5)+u.ph*3.1)),4)*eng:0;   // острый удар (своя фаза)
          const press=eng*0.13+atk*0.17;                                  // прижим к линии + рывок удара
          offX=dirx*press; offZ=dirz*press;
          if(eng>0.12)faceE=-Math.atan2(dirz,dirx);                       // передние разворачиваются к врагу
        }
      }
      const jm=battle?2.8:0.35;                                           // в марше не болтаем строй, в сцепке толкучка заметнее
      const jx2=Math.sin(tt*3.1+u.ph*1.7)*0.012*jm, jz2=Math.cos(tt*2.7+u.ph)*0.012*jm;
      const phase=tt*(6+u.sp*3.2)+u.ph, hop=Math.abs(Math.sin(phase));
      const joy=cheer?cheer*Math.abs(Math.sin(phase*1.8+u.ph*2))*0.08:0;  // 🎉 подпрыгивания после победы
      const bob=hop*(0.045+run*0.11)+atk*0.05+joy, sqv=(hop-0.4)*(0.45+run*0.5);
      const sy2=sc*(1+sqv*0.34)*fadeK, sxz=sc*(1-sqv*0.18)*fadeK;
      const tgtY=(faceE!=null?faceE:-Math.atan2(tzv,txv))+(u.yaw||0)*0.35+(cheer?Math.sin(tt*5+u.ph*3)*0.25*cheer:0);
      if(u.cy==null)u.cy=tgtY; else u.cy+=angDiff(tgtY,u.cy)*Math.min(1,dt*9);
      const pitch=ud.hasUnitModel?0:(-run*0.26-hop*0.10*run-atk*0.55-(gh._dying?(1-fadeK)*0.18:0));   // модель не наклоняем (заваливались в пути)
      // 💧 боец НЕ встаёт на открытую воду: если финальная XZ на воде, а ось дороги на суше —
      //    поджимаем к оси, пока не суша (боевой веер/берег у развилок вылезал на реку). Мост не трогаем (ось=вода).
      let fwx=u.ex+offX+jx2, fwz=u.ez+offZ+jz2;
      if(typeof isWaterAt==='function' && isWaterAt(fwx,fwz) && !isWaterAt(smp.x,smp.z)){
        let ok=false; for(let kk=0.7;kk>0;kk-=0.23){ const tx=smp.x+(fwx-smp.x)*kk, tz=smp.z+(fwz-smp.z)*kk; if(!isWaterAt(tx,tz)){ fwx=tx; fwz=tz; ok=true; break; } } if(!ok){ fwx=smp.x; fwz=smp.z; }
      }
      // 🛟 кламп высоты к реальной поверхности ПОД фактической позицией юнита (fwx,fwz): на высадке/подъёме
      //    берега лерп u.ey отстаёт от растущей дороги, а боковое смещение (latW) уводит с оси на склон —
      //    юнит проваливался под берег. max(u.ey, поверхность) поднимает только вверх (мосты/рампы не трогает).
      let eyR=u.ey;
      if(typeof hexGroundY==='function'){ const gy=hexGroundY(fwx,fwz)+0.05; if(gy>eyR)eyR=gy; }
      ghostUnitDummy.position.set(fwx-p.x, (eyR-p.y)+bob-(1-fadeK)*sc*0.7, fwz-p.z);
      ghostUnitDummy.rotation.set(pitch, u.cy, 0);
      ghostUnitDummy.scale.set(sxz,sy2,sxz); ghostUnitDummy.updateMatrix();
      if(ud.unitLocal)ghostUnitMatrix.multiplyMatrices(ghostUnitDummy.matrix,ud.unitLocal); else ghostUnitMatrix.copy(ghostUnitDummy.matrix);
      ud.putUnitMatrix(i,ghostUnitMatrix);
    }
    st.tailS=tailS;
    // ⚔ искры/пыль в линии соприкосновения двух армий
    if(battle&&bt&&typeof spawnClashFX==='function'&&(typeof fx==='undefined'||fx.length<70)){
      ud._clashT=(ud._clashT||0)+dt;
      if(ud._clashT>0.26+Math.random()*0.22){ ud._clashT=0;
        const mx=p.x+(bt[0]-p.x)*0.5+(Math.random()-0.5)*0.5, mz=p.z+(bt[1]-p.z)*0.5+(Math.random()-0.5)*0.5;
        spawnClashFX(mx,typeof getTerrainHeight==='function'?getTerrainHeight(mx,mz):p.y,mz);
      }
    }
    // павшие после сцепки дотаивают тем же кодом слотов n.. (как в строе)
    let cN=0;
    if(ud.corpses&&ud.corpses.length){
      for(let j=ud.corpses.length-1;j>=0;j--){ const c2=ud.corpses[j]; c2.t+=dt; if(c2.t>0.95)ud.corpses.splice(j,1); }
      const ti=ud.tmInf||ud.tm[0];
      cN=Math.min(ud.corpses.length,Math.max(0,(ti.cap||n)-(ti.n||n)));
      for(let j=0;j<cN;j++){ const c2=ud.corpses[j];
        const fall=Math.min(1,c2.t/0.25), sink=Math.max(0,(c2.t-0.55)/0.4);
        const rx=(c2.wx!=null?c2.wx-p.x:0), rz=(c2.wz!=null?c2.wz-p.z:0);
        const splatY=Math.max(0.2,1-fall*0.8), splatXZ=1+fall*0.2, k2=1-sink*0.6;
        ghostUnitDummy.position.set(rx, Math.sin(fall*Math.PI)*0.05-sink*sc*0.35, rz);
        ghostUnitDummy.rotation.set(-fall*0.22,c2.cy||0,0);
        ghostUnitDummy.scale.set(sc*splatXZ*k2, sc*splatY*k2, sc*splatXZ*k2);
        ghostUnitDummy.updateMatrix();
        if(ud.unitLocal)ghostUnitMatrix.multiplyMatrices(ghostUnitDummy.matrix,ud.unitLocal); else ghostUnitMatrix.copy(ghostUnitDummy.matrix);
        { const s=ud.corpseSlot(j); if(ti.mesh&&s<ti.cap)ti.mesh.setMatrixAt(s,ghostUnitMatrix); }
      }
    }
    ud.finalizeUnits(cN);
    // 🚶 пыль марша под потоком
    if(run>0.6&&!gh._dying&&typeof spawnMarchDust==='function'&&(typeof fx==='undefined'||fx.length<70)){
      ud._dustT=(ud._dustT||0)+dt;
      if(ud._dustT>0.45+Math.random()*0.4){ ud._dustT=0;
        const si=st.sHead-Math.random()*Math.min(Math.ceil(n/LANES)*rowGap,st.sHead), sm=smpAt(si);
        if(sm)spawnMarchDust(sm.x+(Math.random()-0.5)*0.25, sm.y, sm.z+(Math.random()-0.5)*0.25); }
    }
    return true;
  }
  // диспетчер: поток по дороге, иначе (бой/поле/откат UNIT_STREAM=false) — старый строй
  function placeGhostUnits(gh,now){ if(placeGhostStream(gh,now))return; placeGhostSwarm(gh,now); }
  // 👥 квоты типов юнитов в рое из состава отряда (comp); остаток — в пехоту
  function typeQuotas(gh,n){
    const c=gh.comp&&(gh.comp.inf+gh.comp.arc+gh.comp.cav)>0?gh.comp:{inf:n,arc:0,cav:0};
    const tot=c.inf+c.arc+c.cav;
    let nArc=Math.round(n*c.arc/tot), nCav=Math.round(n*c.cav/tot);
    if(nArc+nCav>n){ nCav=Math.max(0,n-nArc); }
    return {inf:n-nArc-nCav, arc:nArc, cav:nCav};
  }
  function ghostSwarm(gh,n){
    const ud=gh.group.userData;
    const base=typeof unitBatchSource==='function'?unitBatchSource(gh.owner):null;
    const srcKey=base?`model:${base.key}`:'fallback';
    const q=typeQuotas(gh,n);
    const qKey=q.inf+','+q.arc+','+q.cav;
    if(n===ud.orbN&&ud.unitSourceKey===srcKey&&ud._qKey===qKey)return;
    // ⚔ убыль в бою → ПАВШИЕ: снимаем текущие матрицы исчезающих бойцов, они лягут трупами (анимация в placeGhostSwarm).
    if(gh.fighting&&ud.tm&&ud.unitSourceKey===srcKey&&n<ud.orbN){
      ud.corpses=ud.corpses||[];
      const gp=gh.group.position;
      for(let i=n;i<ud.orbN&&ud.corpses.length<12;i++){
        if(!ud.getUnitMatrix||!ud.getUnitMatrix(i,_cm))continue;
        _cm.decompose(_cv,_cq,_cs);
        if(_cs.x<1e-3)continue;                                                 // скрытый (ещё в здании) — без трупа
        ud.corpses.push({wx:_cv.x+gp.x,wz:_cv.z+gp.z, cy:(ud.orbs[i]&&ud.orbs[i].cy)||0,t:0});
      }
    }
    // 👥 три бакета по типам (inf/arc/cav): свой InstancedMesh на тип (merged-модели из unitTypedSource).
    //    Пересоздаём бакет только при смене модели или нехватке ёмкости; смещения (off) пересчитываем всегда.
    const modelChanged=ud.unitSourceKey!==srcKey;
    if(modelChanged&&ud.tm){ for(const b of ud.tm){if(b.mesh)gh.group.remove(b.mesh);if(b.acc)gh.group.remove(b.acc);} ud.tm=null; ud.orbs.length=0; ud.corpses=null; }
    ud.unitSourceKey=srcKey; ud.unitLocal=null;                                 // typed-геометрии уже нормализованы (local впечатан)
    ud.hasUnitModel=!!base;                                                     // модель уже ориентирована — без наклона в беге (заваливались в пути)
    // 🐎→🪖→🏹 порядок марша: конница ВПЕРЕДИ колонны, пехота в середине, лучники замыкают
    //    (индексы бакетов идут от головы: rank=(i/W)|0, off накапливается по порядку tm)
    if(!ud.tm)ud.tm=[{t:'cav',mesh:null,cap:0,off:0,n:0},{t:'inf',mesh:null,cap:0,off:0,n:0},{t:'arc',mesh:null,cap:0,off:0,n:0}];
    ud.tmInf=ud.tm.find(b=>b.t==='inf');                                        // трупы живут в пехотном бакете (см. corpseSlot)
    let off=0;
    for(const b of ud.tm){
      b.n=q[b.t]; b.off=off; off+=b.n;
      const extra=b.t==='inf'?14:0;                                             // запас на трупы (бакет пехоты)
      if(b.n>0&&(!b.mesh||b.cap<b.n+extra)){
        if(b.mesh)gh.group.remove(b.mesh);
        if(b.acc){gh.group.remove(b.acc);b.acc=null;}
        const src=typeof unitTypedSource==='function'?unitTypedSource(gh.owner,b.t):null;
        b.cap=Math.max(18,Math.ceil((b.n+extra)*1.3));
        b.mesh=new T3.InstancedMesh(src?src.geo:UNIT_GEO,src?src.mat:gh.mat,b.cap);
        b.mesh.count=0; b.mesh.castShadow=false; b.mesh.receiveShadow=true; b.mesh.userData.perfGroup='units';
        gh.group.add(b.mesh);
        if(src&&src.accGeo){                                                    // 👥 аксессуар (лук/конь): отдельный меш, те же матрицы
          b.acc=new T3.InstancedMesh(src.accGeo,src.accMat,b.cap);
          b.acc.count=0; b.acc.castShadow=false; b.acc.receiveShadow=true; b.acc.userData.perfGroup='units';
          gh.group.add(b.acc);
        }
      }
    }
    ud._qKey=qKey;
    // helpers: глобальный индекс юнита → бакет по типу
    ud.bucketOf=(i)=>{ for(const b of ud.tm){ if(i<b.off+b.n)return b; } return ud.tm[0]; };
    ud.putUnitMatrix=(i,m4)=>{ const b=ud.bucketOf(i); const j=i-b.off;
      if(b.mesh&&j<b.cap){ b.mesh.setMatrixAt(j,m4); if(b.acc)b.acc.setMatrixAt(j,m4); } };
    ud.getUnitMatrix=(i,out)=>{ const b=ud.bucketOf(i); if(!b.mesh||i-b.off>=b.cap)return false; b.mesh.getMatrixAt(i-b.off,out); return true; };
    ud.finalizeUnits=(cN)=>{ for(const b of ud.tm){ if(!b.mesh)continue;
      b.mesh.count=Math.min(b.cap,b.n+(b.t==='inf'?(cN||0):0));
      b.mesh.instanceMatrix.needsUpdate=true;
      if(b.acc){ b.acc.count=Math.min(b.cap,b.n); b.acc.instanceMatrix.needsUpdate=true; } } };
    ud.corpseSlot=(j)=>(ud.tmInf||ud.tm[0]).n+j;                                // трупы — в хвосте бакета ПЕХОТЫ (не первого: порядок tm теперь cav→inf→arc)
    // СТАБИЛЬНЫЙ рой: позиция по индексу (золотая спираль, не зависит от n) → при убыли армии
    // лишние фигурки просто прячутся с краю, остальные не «перетасовываются».
    while(ud.orbs.length<n){
      ud.orbs.push({ry:Math.random()*6.283, yaw:(Math.random()-0.5)*0.6, ph:Math.random()*6.28, sp:0.9+Math.random()*0.5, lj:(Math.random()-0.5)*0.15}); }
    ud.orbN=n;
    // ширина шеренги по числу юнитов: ≤5→1, 6–20→2, 21–40→3, 40+→4.
    // ⚔ В БОЮ ширина ЗАМОРОЖЕНА: армия тает, но строй не перетасовывается (ряды просто исчезают с хвоста);
    //    после боя (fighting=false) выжившие перестраиваются под новую численность.
    if(!gh.fighting || ud.colW==null) ud.colW = n<=5?1 : n<=20?2 : n<=40?3 : 4;
    ud.unitScale=(base?base.scale:1);   // 🔒 размер юнита ФИКСИРОВАН (не зависит от числа) — большие армии просто плотнее/шире по шеренге, а не мельче
    placeGhostUnits(gh,performance.now());
  }
  function reconcile(list){
    const seen=new Set();
    for(const d of list){ const id=d[0],kind=d[1];
      let gh=MP.ghosts.get(id);
      if(!gh||gh.kind!==kind){ if(gh)killGhost(gh); gh=ghostMesh(kind,d[2]); MP.ghosts.set(id,gh); gh.group.position.set(d[3],d[4],d[5]); }
      gh._mpid=id; gh.target.set(d[3],d[4],d[5]);
      if(kind===1){ gh.transport=(id.charCodeAt(0)===115&&id.charCodeAt(1)===104&&id.charCodeAt(2)===113); gh.authHeading=(d[7]!=null?d[7]:null); }  // 🚢 транспорт 'shq…' → авторитетный курс [7]
      if(kind===0&&gh.count>d[6])gh._dmgT=performance.now();               // 🔴 потери → красная вспышка метки
      gh.count=d[6]; gh.fighting=!!d[7];
      gh.mode=d[14]|0; gh.seaHeading=d[16]||0;                                          // 🚢 режим / курс (рад)
      gh.edgeA=d[8]!=null?d[8]:null; gh.edgeB=d[9]!=null?d[9]:null; gh.frac=d[10]||0;   // текущее ребро пути → поток юнитов (UNIT_STREAM)
      gh.comp=d[11]!=null?{inf:d[11],arc:d[12]||0,cav:d[13]||0}:null;                    // 👥 состав отряда (для рендера/лейбла)
      if(kind===0)ghostSwarm(gh,unitsForCount(d[6])); seen.add(id);
    }
    for(const [id,gh] of MP.ghosts) if(!seen.has(id)){
      const ud=gh.group.userData;
      if(gh.kind===0 && ud.orbN>0 && !gh._dying && !gh._perish){
        // где исчез отряд? Рядом с городом → ПРИБЫТИЕ (втекает в здание). Иначе (бой/башня/урон в пути) → ПОГИБ,
        // тает на месте — раньше убитый в пути отряд «прибывал», и его последний юнит бежал через полкарты к городу.
        const p=gh.group.position; let best=null;
        if(typeof cities!=='undefined'){ let bd=4; for(const c of cities){ if(!c)continue; const cx=c._visualGX==null?c.gx:c._visualGX, cz=c._visualGZ==null?c.gz:c._visualGZ; const d2=(cx-p.x)*(cx-p.x)+(cz-p.z)*(cz-p.z); if(d2<bd){bd=d2;best=[cx,cz];} } }
        if(gh.fighting || !best || (gh.count||0)<1 || gh.mode===2){      // бой / вдали / пусто / 🚢 ещё море → гаснет на месте
          gh._perish=performance.now();
          if(gh.lab)gh.lab.style.display='none';
        } else {                                                          // прибытие по суше: заходит в здание
          gh._dying=performance.now(); ud._dieAt=best;
          const f=ud.fwd||[1,0];
          ud.dieDir=[f[0],f[1]];                                          // курс входа фиксируем → колонна заходит СТРОГО прямо в центр здания
          gh.target.set(p.x,p.y,p.z);
          if(gh.lab)gh.lab.style.display='none';
        }
      } else if(gh.kind!==0){ killGhost(gh); MP.ghosts.delete(id); }      // корабли/самолёты — как раньше, мгновенно
    }
  }

  const _labV=new T3.Vector3();   // переиспользуемый вектор проекции меток (без new Vector3 на метку/кадр)
  window.mpTick=(now,dt)=>{
    if(MP.host){ if(MP._lastGS!==gameSpeed){MP._lastGS=gameSpeed;setPill();}
      if(now-tSnap>140){tSnap=now;MP.send(buildSnap(now));}
      if(now-tEnt>70){tEnt=now;const ent=buildEnt();if(ent)MP.send(ent);} return; }
    if(!MP.guest)return;
    if(MP._lastFid!==PLAYER){ MP._lastFid=PLAYER; MP.send({t:'joinInfo',fid:PLAYER,country:PLAYER_COUNTRY}); setPill(); } // надёжно сообщаем хосту свою фракцию
    // ⚔ grid дерущихся kind-0 ghost'ов (раз в кадр): поиск боевой цели становится O(1) на отряд вместо O(N²) по всем ghost'ам.
    //    Ячейка = радиус пары (3). Позиции читаются живьём в поиске; ячейка с прошлого микро-шага — для facing-анимации точности хватает.
    const FCELL=3, _fgrid=(MP._fgrid||(MP._fgrid=new Map())); _fgrid.clear();
    const _fkey=(x,z)=>(((x/FCELL)|0)*100003+((z/FCELL)|0));
    for(const g2 of MP.ghosts.values()){ if(g2.kind!==0||!g2.fighting)continue; const q=g2.group.position; const kk=_fkey(q.x,q.z); let a=_fgrid.get(kk); if(!a){a=[];_fgrid.set(kk,a);} a.push(g2); }
    for(const [id,gh] of MP.ghosts){
      const p=gh.group.position,t=gh.target,k=Math.min(1,dt*12),dx=t.x-p.x,dz=t.z-p.z;
      if(gh._perish){                                                     // ⚔ погиб в бою: гаснет на месте и снимается
        if(now-gh._perish>750){ killGhost(gh); MP.ghosts.delete(id); continue; }
        if(gh.kind===0&&gh.group.userData.orbs)placeGhostUnits(gh,now);
        continue; }
      if(gh._dying){ const ud=gh.group.userData, f=ud.dieDir||ud.fwd||[1,0];  // 🏰 роспуск: ряды по очереди заходят СТРОГО прямо в центр здания (по одному ряду), независимо от gameSpeed
        if(window.UNIT_STREAM!==false && gh.edgeA!=null && ud.st){          // 🍄 поток: юниты сами дотекают по дороге до здания и тают у двери
          if((ud.st.tailS!=null && ud.st.tailS>ud.st.len+0.25) || now-gh._dying>60000){ killGhost(gh); MP.ghosts.delete(id); continue; }
          if(gh.kind===0&&ud.orbs)placeGhostUnits(gh,now);
          continue; }
        const rankSp=(ud.unitScale||1)*0.95, colLen=Math.ceil((ud.orbN||1)/(ud.colW||3))*rankSp;
        const adv=ud._dieAt?Math.hypot(p.x-ud._dieAt[0], p.z-ud._dieAt[1]):0;
        // ⚠ гасим ТОЛЬКО когда ПОСЛЕДНИЙ ряд полностью растаял (depth ≥ 2.2·rankSp), иначе хвост исчезал рывком на ~23% масштабе → «засасывало в конце»
        if(adv>=colLen+rankSp*1.4 || now-gh._dying>60000){ killGhost(gh); MP.ghosts.delete(id); continue; }
        // 🚶 марш В ГОРОД идёт ровно со СКОРОСТЬЮ ДВИЖЕНИЯ отряда (SQUAD_SPEED×gameSpeed), а не быстрее —
        //    поэтому колонна НЕ ускоряется на прибытии («не засасывает»), а спокойно доходит и тает у двери.
        const spd=((typeof LOCALSIM!=='undefined'&&LOCALSIM&&LOCALSIM.K&&LOCALSIM.K.SQUAD_SPEED!=null)?LOCALSIM.K.SQUAD_SPEED:(typeof SQUAD_SPEED!=='undefined'?SQUAD_SPEED:0.8))*(typeof gameSpeed!=='undefined'?gameSpeed:1);
        const s=spd*Math.min(0.05,dt); gh.target.x+=f[0]*s; gh.target.z+=f[1]*s;   // виртуальная цель едет со скоростью хода…
        const kk=Math.min(1,dt*12); p.x+=(gh.target.x-p.x)*kk; p.z+=(gh.target.z-p.z)*kk; p.y=unitGroundY(p.x,p.z);  // …голова догоняет тем же лерпом, но высота берётся с дороги/земли
        if(gh.kind===0&&ud.orbs)placeGhostSwarm(gh,now);
        continue; }
      if(gh.kind===0){
        if(gh.edgeA!=null){
          // 🛰 client-side prediction фракции: голова гладко едет вперёд по дороге КАЖДЫЙ кадр + мягкая коррекция к
          //   авторитетной серверной frac (снапшоты 12.5 Гц — без предсказания дёргалось бы). Смена ребра / откат /
          //   большой рассинхрон → снап. В соло frac обновляется каждый кадр → коррекция сходится сразу (без регресса).
          const ekey=gh.edgeA*100003+(gh.edgeB==null?-1:gh.edgeB), len=(typeof hexRoadLen==='function')?hexRoadLen(gh.edgeA,gh.edgeB):0, sf=gh.frac||0;
          if(gh._fracR==null||gh._fracEdge!==ekey||!(len>0)){ gh._fracR=sf; gh._fracEdge=ekey; }
          else{
            const spd=((typeof LOCALSIM!=='undefined'&&LOCALSIM&&LOCALSIM.K&&LOCALSIM.K.SQUAD_SPEED!=null)?LOCALSIM.K.SQUAD_SPEED:0.8)*(typeof gameSpeed!=='undefined'?gameSpeed:1);
            gh._fracR+=(spd/len)*dt;                                 // предсказание вперёд
            const err=sf-gh._fracR;
            if(err<-0.12||err>0.30) gh._fracR=sf;                    // откат/редирект/большой скачок → снап
            else gh._fracR+=err*Math.min(1,dt*7);                    // мягкая коррекция к серверу
            gh._fracR=gh._fracR<0?0:(gh._fracR>1?1:gh._fracR);
          }
          const sm=(typeof hexRoadSample==='function')?hexRoadSample(gh.edgeA,gh.edgeB,gh._fracR):null;
          if(sm){ p.x=sm.x; p.z=sm.z; } else { p.x=t.x; p.z=t.z; }   // предсказанная арк-позиция; fallback — снапшот
        }else{
          gh._fracR=null;                                           // без ребра → сглаживаем лерпом к снапшоту
          p.x+=dx*k; p.z+=dz*k;                                     // online Colyseus без edge/frac приходит снапшотами → сглаживаем
        }
        p.y=unitGroundY(p.x,p.z);
      } else {
        p.x+=dx*k; p.y+=(t.y-p.y)*k; p.z+=dz*k;
        if(gh.kind===1&&gh.authHeading!=null){                                                    // 🚢 транспорт: АВТОРИТЕТНЫЙ курс (сглажен) → не шатается, не зависит от дельт
          const tgt=-gh.authHeading; gh._ry=(gh._ry==null)?tgt:gh._ry+angDiff(tgt,gh._ry)*Math.min(1,dt*8); gh.group.rotation.y=gh._ry;
        } else if((gh.kind===1||gh.kind===2)&&dx*dx+dz*dz>1e-4)gh.group.rotation.y=-Math.atan2(dz,dx);   // нос моделей смотрит +X → разворот по курсу
      }
      if(gh.mat&&gh.mat.emissive)gh.mat.emissive.setHex(selectedUnits.has(gh)?0x1f6fc0:0x000000); // подсветка выбранных
      // ⚔ цель боя: ближайший ВРАЖЕСКИЙ дерущийся отряд рядом → передний ряд разворачивается к нему (боевая анимация)
      if(gh.kind===0){
        const ud2=gh.group.userData;
        if(gh.fighting){ let bt=null,bd2=9,bc=0;   // радиус поиска пары ~3 (позиции обоих уже впритык по симу)
          const cx=(p.x/FCELL)|0, cz=(p.z/FCELL)|0;   // только соседние ячейки grid'а бойцов (не все ghost'ы)
          for(let ax=-1;ax<=1;ax++)for(let az=-1;az<=1;az++){ const a=_fgrid.get((cx+ax)*100003+(cz+az)); if(!a)continue;
            for(let gi=0;gi<a.length;gi++){ const g2=a[gi]; if(g2===gh||g2.owner===gh.owner)continue;   // grid уже отфильтровал kind===0 && fighting
              const q=g2.group.position,ex=q.x-p.x,ez=q.z-p.z,dd2=ex*ex+ez*ez; if(dd2<bd2){bd2=dd2;bt=[q.x,q.z];bc=g2.count||1;} } }
          ud2.battleTgt=bt; ud2.battleFoeCount=bc;   // счёт врага → агрессия победителя/дрожь меньшинства
        } else ud2.battleTgt=null;
        // 🎉 сцепка кончилась, отряд жив и не расходится → чир победы
        if(gh._wasF&&!gh.fighting&&!gh._dying&&(gh.count||0)>0)ud2.cheerT=0.9;
        gh._wasF=gh.fighting;
      }
      if(gh.kind===0&&gh.group.userData.orbs){   // 🪖 юниты отряда: 🍄 поток по дороге / строй (бой, поле, откат UNIT_STREAM=false)
        // гейт: не пересчитываем рой (и не перезаливаем инстанс-буфер) для СТАТИЧНОГО отряда — не двигался, не дерётся,
        //   не чирит, число не менялось. Движущийся отряд (общий случай) рендерится всегда; экономит кадр на стоящих/паузе.
        const ud0=gh.group.userData;
        if(gh._lastUX==null||Math.abs(p.x-gh._lastUX)>1e-4||Math.abs(p.z-gh._lastUZ)>1e-4||gh.fighting||(ud0.cheerT>0)||gh.count!==gh._lastUC){
          gh._lastUX=p.x; gh._lastUZ=p.z; gh._lastUC=gh.count; placeGhostUnits(gh,now); }
      }
      if(gh.lab && !gh._dying){ const v=_labV.set(p.x,p.y+0.4,p.z).project(camera);   // переиспользуемый вектор + запись в DOM ТОЛЬКО при изменении (без reflow каждый кадр)
        const vis=v.z<1;
        if(gh._labVis!==vis){ gh._labVis=vis; gh.lab.style.display=vis?'block':'none'; }
        if(vis){
          const lx=((v.x*0.5+0.5)*innerWidth)|0, ly=((-v.y*0.5+0.5)*innerHeight)|0;
          if(lx!==gh._labX){ gh._labX=lx; gh.lab.style.left=lx+'px'; }
          if(ly!==gh._labY){ gh._labY=ly; gh.lab.style.top=ly+'px'; }
          if(gh.count!==gh._labN){ gh._labN=gh.count; gh.lab.textContent=gh.count; }
          const col=(gh._dmgT&&now-gh._dmgT<400)?'#ff6a6a':'';   // 🔴 вспышка метки при потерях
          if(col!==gh._labC){ gh._labC=col; gh.lab.style.color=col; }
        } }
    }
    updateGhostShipBatches();
    updateGhostPlaneBatches();
  };

  /* ── хост: применить команду гостя (с проверкой фракции) ── */
  function hostCmd(m){
    const fid=MP.assign[m.from]; if(fid==null)return;
    ensureIndex();
    const c=m.c!=null?ci(m.c):null;
    if(m.cmd==='army'){ const a=ci(m.a),b=ci(m.b); if(a&&b&&a.owner===fid)sendUnits(a,b,(m.pct||50)/100); }
    else if(m.cmd==='buy'){ if(c&&c.owner===fid&&!c.occ){ const amt=buyAmount(c,m.spec); if(amt>0){gold[fid]-=amt*SOLDIER_PRICE;manpower[fid]-=amt;c.batches.push({count:amt,time:amt*c.trainPer,elapsed:0,type:m.unit||c.recruitType||'inf'});} } }
    else if(m.cmd==='upg'){ if(c&&c.owner===fid&&!c.occ&&CITY_UPGRADE_TRACKS.includes(m.track)){ const tier=c.branchTier(m.track); const cost=upgradeCost(tier); if(tier<MAX_TIER&&gold[fid]>=cost){gold[fid]-=cost;c[m.track+'Tier']=tier+1;c.syncLegacyTier(m.track);c.buildMeshes();markRegions();} } }
    else if(m.cmd==='war'){ if(fid!==m.tg&&!atWar(fid,m.tg)&&(politPts[fid]||0)>=POLIT_WAR){ politPts[fid]-=POLIT_WAR; setWar(fid,m.tg); try{dragAlliesIntoWar(fid,m.tg);}catch(e){} } }
    else if(m.cmd==='ally'){ if(fid!==m.tg&&!atWar(fid,m.tg)&&(politPts[fid]||0)>=POLIT_ALLY){ politPts[fid]-=POLIT_ALLY; setRelation(fid,m.tg,'ally'); } }
    else if(m.cmd==='peace'){ if(atWar(fid,m.tg)&&(politPts[fid]||0)>=POLIT_PEACE){ politPts[fid]-=POLIT_PEACE; resolveOccupation(fid,m.tg,m.land?'claimA':'white'); setRelation(fid,m.tg,'neutral'); if(typeof setTruce==='function')setTruce(fid,m.tg); } }
    else if(m.cmd==='bship'){ const y=ci(m.c); if(y&&y.owner===fid&&(y.isShipyard||y.hasShipyard))buildShip(y,fid); }
    else if(m.cmd==='bplane'){ const y=ci(m.c); if(y&&y.owner===fid&&(y.isAirport||y.hasAirport))buildPlane(y,fid); }
    else if(m.cmd==='yard'){ const c=ci(m.c); if(c&&c.owner===fid)buildYard(c,m.kind,fid); }
    else if(m.cmd==='shipmove'){ if(Array.isArray(m.ids))for(const s of ships)if(s._mpid!=null&&m.ids.includes(s._mpid)&&s.owner===fid)s.setTarget(m.x,m.z); }
    else if(m.cmd==='planemove'){ if(Array.isArray(m.ids))for(const p of planes)if(p._mpid!=null&&m.ids.includes(p._mpid)&&p.owner===fid&&p.setTarget)p.setTarget(m.x,m.z); }
    else if(m.cmd==='airorder'){ if(m.recall){ airOrder[fid]=null; } else { const from=ci(m.fromIdx), to=m.cityIdx>=0?ci(m.cityIdx):null; if(from&&from.owner===fid)setAirOrder(from,to,m.x,m.z,fid); } }
    else if(m.cmd==='break'){ if(allied(fid,m.tg)&&(politPts[fid]||0)>=POLIT_BREAK){ politPts[fid]-=POLIT_BREAK; setRelation(fid,m.tg,'neutral'); } }
    else if(m.cmd==='sup'){ const amt=Math.min(100,gold[fid]|0); if(amt>=20){gold[fid]-=amt;gold[m.tg]=(gold[m.tg]||0)+amt;} }
  }

  function onMsg(ev){
    let m; try{m=JSON.parse(ev.data);}catch(e){return;}
    switch(m.t){
      case 'hello':
        MP.id=m.id; MP.hostId=m.hostId; MP.on=true;   // роль уже задана из URL, не переопределяем
        MP.players=1+((m.peers&&m.peers.length)||0);
        if(MP.host){ MP.assign[MP.id]=PLAYER; recalcHumans(); }
        else MP.send({t:'joinInfo',fid:PLAYER,country:PLAYER_COUNTRY});
        setPill(); break;
      case 'join': MP.players=(MP.players||1)+1; if(m.hostId)MP.hostId=m.hostId; if(MP.host)keyframeDue=true; setPill(); break;  // новый игрок → полный кадр
      case 'leave':
        if(MP.assign[m.id]!=null){ delete MP.assign[m.id]; if(MP.host)recalcHumans(); }
        MP.players=Math.max(1,(MP.players||1)-1); setPill(); break;
      case 'joinInfo': if(MP.host){ const fid=(m.fid!=null?m.fid:FACT_BY_COUNTRY[m.country]); if(fid!=null){MP.assign[m.from]=fid;recalcHumans();} keyframeDue=true; setPill(); } break;
      case 'cmd':  if(MP.host)hostCmd(m); break;
      case 'snap': if(MP.guest)applySnap(m); break;
      case 'ent':  if(MP.guest)reconcile(m.e); break;
      case 'newcity': if(MP.guest && !cities.some(c=>c.idx===m.idx)){   // хост построил верфь/аэропорт → создать у гостя
        try{ CITY_NAMES[m.idx]=m.name; (m.kind==='ship'?SHIPYARD_NAMES:AIRPORT_NAMES).add(m.name);
          cities.push(new City(m.gx,m.gz,m.country,1,m.owner,m.idx)); MP.reindex(); markRegions(); }catch(e){}
      } break;
    }
  }

  function connect(){
    MP._onMsg = onMsg; MP._pill = pill;      // отдать guest-пайплайн + плашку статуса мосту Colyseus
    return;                                  // транспорт подключает только Colyseus bridge ниже
  }
  connect();
  if(MP.localSim){ MP.send=()=>{}; if(pill)pill.textContent=t('toast.localSimPill'); if(typeof initLocalSim==='function')initLocalSim(); }

  // при выборе страны: гость уведомляет хоста, хост обновляет список людей
  const _sc=selectCountry;
  selectCountry=function(c){ _sc(c);
    if(MP.on){ if(MP.guest){ MP._synced=false; MP._sawRunning=false; MP.send({t:'joinInfo',fid:PLAYER,country:PLAYER_COUNTRY}); }  // ждём свежий keyframe для новой фракции
               if(MP.host){MP.assign[MP.id]=PLAYER;recalcHumans();} setPill(); } };
})();

/* ── 🌍 выбор страны на старте ─────────────────────────────── */
let countryPickChoice=null;
function countryCityCount(country){
  return CITY_LIST.reduce((n,c)=>n+((typeof canonicalCountry==='function'?canonicalCountry(c[5]):c[5])===country?1:0),0);
}
function cityWord(n){return n===1?t('polit.cityWordOne'):t('polit.cityWordMany');}
function focusStartCameraOnCountry(country){
  const cname=typeof canonicalCountry==='function'?canonicalCountry(country):country;
  const own=cities.filter(c=>c&&((typeof canonicalCountry==='function'?canonicalCountry(c.country):c.country)===cname||c.owner===PLAYER));
  const list=own.length?own:cities.filter(c=>c&&c.owner===PLAYER);
  if(!list.length)return;
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity,sumX=0,sumZ=0,sumW=0;
  for(const c of list){
    const x=c._visualGX==null?c.gx:c._visualGX, z=c._visualGZ==null?c.gz:c._visualGZ;
    const w=Math.max(1,c.size||1);
    minX=Math.min(minX,x); maxX=Math.max(maxX,x);
    minZ=Math.min(minZ,z); maxZ=Math.max(maxZ,z);
    sumX+=x*w; sumZ+=z*w; sumW+=w;
  }
  const span=Math.max(maxX-minX,maxZ-minZ);
  const centerX=sumX/(sumW||1), centerZ=sumZ/(sumW||1);
  const maxSize=Math.max(...list.map(c=>c.size||1));
  let anchor=list[0], bestD=Infinity;
  for(const c of list){
    if((c.size||1)!==maxSize)continue;
    const x=c._visualGX==null?c.gx:c._visualGX, z=c._visualGZ==null?c.gz:c._visualGZ;
    const d=(x-centerX)**2+(z-centerZ)**2;
    if(d<bestD){bestD=d;anchor=c;}
  }
  const ax=anchor._visualGX==null?anchor.gx:anchor._visualGX, az=anchor._visualGZ==null?anchor.gz:anchor._visualGZ;
  const cx=ax*0.72+centerX*0.28, cz=az*0.72+centerZ*0.28;
  target.set(Math.max(4,Math.min(GRID-4,cx)),2,Math.max(4,Math.min(GRID-4,cz)));
  orbit.r=Math.max(34,Math.min(62,span*0.22+34));
  orbit.phi=0.78;
  applyCam();
}
function buildCountryPick(){
  const list=document.getElementById('countryList'); if(!list)return; list.innerHTML='';
  const playable=Array.isArray(PLAYABLE_COUNTRIES)&&PLAYABLE_COUNTRIES.length?PLAYABLE_COUNTRIES:FACTIONS.map(f=>f.country);
  const taken=(window.MP_TAKEN instanceof Set)?window.MP_TAKEN:new Set();   // 🔒 занятые другими игроками страны (MP)
  const isTaken=(c)=>taken.has(c)&&c!==PLAYER_COUNTRY;
  const free=playable.filter(c=>!isTaken(c));
  // сохранить текущий выбор, если он ещё валиден и свободен; иначе — своя страна / первая свободная
  if(!countryPickChoice||!free.includes(countryPickChoice))
    countryPickChoice=(playable.includes(PLAYER_COUNTRY)&&!isTaken(PLAYER_COUNTRY))?PLAYER_COUNTRY:(free[0]||playable[0]);
  const start=document.getElementById('countryStart');
  const render=()=>{
    list.innerHTML='';
    playable.forEach(c=>{
      const cityCount=countryCityCount(c);
      const col='#'+(FACTION_COLOR[c]||0x9aa6b2).toString(16).padStart(6,'0');
      const art=(COUNTRY_CARD_ART&&COUNTRY_CARD_ART[c])||'';
      const tk=isTaken(c);
      const el=document.createElement('button');
      el.type='button';
      const cDisp=countryDisp(c);
      el.className='cpick'+(c===countryPickChoice?' sel':'')+(cDisp.length>12?' long':'')+(tk?' taken':'');
      el.dataset.country=c;
      el.disabled=tk;
      el.style.setProperty('--ccol',col);
      el.style.setProperty('--art',art?`url("${art}")`:'linear-gradient(180deg,#1a2733,#101a24)');
      el.setAttribute('aria-pressed',c===countryPickChoice?'true':'false');
      if(tk)el.setAttribute('aria-disabled','true');
      const flag=typeof flagHexSVG==='function'?flagHexSVG(c,60):`<span>${flagOf(c)}</span>`;
      el.innerHTML=`<div class="cflag">${flag}</div>`+
        `<div class="cbody"><div class="cnm">${cDisp}</div><div class="cmeta">${tk?t('net.countryTaken'):cityCount+' '+cityWord(cityCount)}</div></div>`+
        (tk?`<div class="cLock">🔒</div>`:'');
      if(!tk)el.addEventListener('click',()=>{countryPickChoice=c;render();});
      list.appendChild(el);
    });
    if(start)start.disabled=isTaken(countryPickChoice);
  };
  if(start)start.onclick=()=>{ if(isTaken(countryPickChoice))return; selectCountry(countryPickChoice||free[0]||playable[0]); };
  render();
}
function openCountryPick(){
  buildCountryPick();
  if(typeof window.hideGameLoading==='function')window.hideGameLoading();
  document.getElementById('countryWin').style.display='flex';
  gameSpeed=0;
} // пауза, пока выбирают
function selectCountry(country){
  PLAYER_COUNTRY=country;
  buildFactions();                 // переустановить PLAYER/OWNER.PLAYER на выбранную страну
  newGame();                       // новая партия за выбранную фракцию
  focusStartCameraOnCountry(country);
  document.getElementById('countryWin').style.display='none';
  gameSpeed=1;
  toast(`${flagOf(country)} `+t('toast.youPlayAs',{country:countryDisp(country)}));
}

buildWorld();
resize();
newGame();
openCountryPick();   // на старте — окно выбора страны (партия за Францию идёт фоном до выбора)
requestAnimationFrame(loop);
