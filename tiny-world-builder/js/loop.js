/* ── resize & loop ──────────────────────────────────────────── */
function resize(){renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();}
addEventListener('resize',resize);

let last=performance.now(), panelTick=0;
function loop(now){
  const dt=Math.min((now-last)/1000,.05); last=now;
  updateCameraKeys(dt);
  // update water shader (время + позиция камеры для бликов/Френеля)
  waterShader.uniforms.time.value = now / 1000;
  waterShader.uniforms.camPos.value.copy(camera.position);
  // дрейф облаков (с заворотом за край карты)
  for(const c of cloudList){
    c.position.x+=c.userData.speed*dt;
    if(c.position.x>GRID+12)c.position.x=-12;
  }
  const gdt=dt*gameSpeed; // игровое время с учётом паузы/ускорения
  if(MP.localSim){   // 🧪 соло на ЛОКАЛЬНОМ серверном Sim: тик Sim → проекция в guest-рендер, визуал как у гостя
    if(typeof localSimStep==='function')localSimStep(gdt);
    if(!gameOver&&gdt>0){ for(const c of cities)c.drawProdRing(); if(typeof cityTowersFX==='function')cityTowersFX(gdt); if(typeof updateMissiles==='function')updateMissiles(gdt); }
  } else if(MP.guest && !gameOver && gdt>0){
    // гость: сим заморожен, но локально продвигаем ТОЛЬКО таймеры (плавность между снапшотами; сервер их корректирует)
    gameTime+=gdt;                                                          // ⏳ отсчёт мобилизации войны
    for(const c of cities){
      if(c.batches.length){ const b=c.batches[0]; if(b.elapsed<b.time)b.elapsed=Math.min(b.time,b.elapsed+gdt); } // найм
      if(c.isShipyard&&c.shipQueue>0&&c.shipTimer<SHIP_BUILD_TIME)c.shipTimer=Math.min(SHIP_BUILD_TIME,c.shipTimer+gdt);   // ⚓
      if(c.isAirport&&c.planeQueue>0&&c.planeTimer<PLANE_BUILD_TIME)c.planeTimer=Math.min(PLANE_BUILD_TIME,c.planeTimer+gdt); // ✈
      c.drawProdRing();
    }
    const rs=techRes[PLAYER]; if(rs)for(const r of rs){ const n=NODE[r.id]; if(n&&r.t<n.t)r.t=Math.min(n.t,r.t+gdt); }      // 🔬
    cityTowersFX(gdt);     // ⚔ визуал выстрелов atk-городов в онлайне (урон авторитетно считает сервер)
    updateMissiles(gdt);   // анимируем трассеры/взрывы
  }
  // во время поворота камеры (Q/E или мышь) прячем DOM-подписи целиком — иначе они дрожат
  const _rot=camRotating; document.getElementById('labels').style.visibility=_rot?'hidden':'visible';
  for(const c of cities){if(!_rot)c.updateLabel();c.updateSiegeViz(now);}
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
  renderer.render(scene,camera);
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
  pill.style.cssText='position:fixed;bottom:12px;right:12px;z-index:30;background:rgba(8,16,26,.85);color:#cfe0f0;'+
    'font-size:12px;font-weight:700;padding:8px 12px;border-radius:9px;user-select:none;border:1px solid rgba(120,150,180,.22);';
  pill.textContent='🌐 MP: подключение…'; document.body.appendChild(pill);
  const waitBanner=document.createElement('div');
  waitBanner.style.cssText='position:fixed;top:92px;left:50%;transform:translateX(-50%);z-index:31;display:none;'+
    'background:rgba(8,16,26,.92);color:#ffd23f;font-size:15px;font-weight:800;padding:12px 20px;border-radius:10px;'+
    'border:1px solid rgba(255,210,63,.45);box-shadow:0 6px 22px rgba(0,0,0,.5);';
  waitBanner.textContent='⏳ Ожидание хоста — он выбирает страну…';
  document.body.appendChild(waitBanner);
  function setPill(){ const role=MP.host?'ХОСТ':(MP.guest?'ГОСТЬ':'—');
    const me=FACTIONS[PLAYER]?FACTIONS[PLAYER].country:'—';
    const extra=MP.host?(` · людей: ${MP.humans?MP.humans.size:1}`+(gameSpeed===0?' · ⏸ ВЫБЕРИТЕ СТРАНУ':'')):'';
    pill.textContent=`🌐 ${room} · ${role} · ${me} · игроков: ${MP.players||1}${extra}`; }

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
  const cityTuple=c=>[c.idx,c.owner,Math.min(8191,Math.round(c.units)),SPEC2ID[c.spec]||0,c.tier,c.occ?1:0];
  const packCity=c=>((c.owner|0)|(Math.min(8191,Math.round(c.units))<<5)|((SPEC2ID[c.spec]||0)<<18)|((c.tier|0)<<20)|((c.occ?1:0)<<22));
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
  function applyCity(c,owner,units,specId,tier,occ,queued,siegeUnits,siegeOwner,prodTime,prodElapsed,shipQ,shipT,planeQ,planeT){
    const spec=ID2SPEC[specId]||null, prevOwner=c.owner, specChanged=(c.spec!==spec||c.tier!==tier);
    c.owner=owner; c.units=units; c.spec=spec; c.tier=tier; c.occ=!!occ;
    if(queued!==undefined)   // ⏳ найм: реальные время/прогресс партии с сервера (дс→с) → кольцо и прогресс-бар идут
      c.batches = queued>0 ? [{count:queued, time:Math.max(0.1,(prodTime||10)/10), elapsed:Math.min((prodTime||10)/10,(prodElapsed||0)/10)}] : [];
    if(shipQ!==undefined){ c.shipQueue=shipQ|0; c.shipTimer=(shipT||0)/10; }                            // ⚓ верфь: очередь + таймер
    if(planeQ!==undefined){ c.planeQueue=planeQ|0; c.planeTimer=(planeT||0)/10; }                       // ✈ аэродром: очередь + таймер
    if(siegeUnits!==undefined) c.siege = siegeUnits>0 ? {[siegeOwner]:{units:siegeUnits,atkMult:1}} : null; // осада → орбы + кольцо боя + тряска
    if(specChanged){ try{c.buildMeshes&&c.buildMeshes();}catch(e){} }
    if(prevOwner!==owner){ try{c.recolor&&c.recolor();}catch(e){} }
  }
  /* ── гость: оповестить о новых войнах со своей фракцией (вызывается только при изменении дипломатии) ── */
  function warNotify(){
    const curWar=new Set();
    for(const k in relations)if(relations[k]==='war'){ const ns=(k.match(/\d+/g)||[]).map(Number);
      if(ns.includes(PLAYER)){ const o=ns.find(x=>x!==PLAYER); if(o!=null)curWar.add(o); } }
    for(const fid of curWar)if(!prevWar.has(fid))toast(`⚔ ${FACTIONS[fid]?FACTIONS[fid].country:'Враг'} объявил вам войну!`);
    prevWar=curWar;
  }
  /* ── гость: оповестить о новых СОЮЗАХ со своей фракцией ── */
  function allyNotify(){
    const cur=new Set();
    for(const k in relations)if(relations[k]==='ally'){ const ns=(k.match(/\d+/g)||[]).map(Number);
      if(ns.includes(PLAYER)){ const o=ns.find(x=>x!==PLAYER); if(o!=null)cur.add(o); } }
    for(const fid of cur)if(!prevAlly.has(fid))toast(`🤝 Союз с ${FACTIONS[fid]?FACTIONS[fid].country:'страной'}`);
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
    if(list){ for(const d of list){ const c=ci(d[0]); if(c)applyCity(c,d[1],d[2],d[3],d[4],d[5],d[6],d[7],d[8],d[9],d[10],d[11],d[12],d[13],d[14]); } regionsDirty=true; }
    if(m.g){ const g=m.g; for(let i=0;i<g.length;i++){gold[i]=g[i];politPts[i]=m.p[i];manpower[i]=m.m[i];} }  // в cs-режиме экономика идёт через 'econ'; в relay — здесь
    if(m.rel){ relations={}; for(const [k,v] of m.rel)relations[k]=v; warSince={}; for(const [k,v] of m.ws)warSince[k]=+v; warNotify(); allyNotify(); }
    // победа/поражение — только после keyframe И если видели партию ИДУЩЕЙ (не врываемся в уже оконченную)
    const mine=cities.some(c=>c.owner===PLAYER);
    if(MP._synced && !m.over && mine) MP._sawRunning=true;
    const lost=!mine&&![...MP.ghosts.values()].some(g=>g.owner===PLAYER&&g.kind===0);
    if(MP._synced && MP._sawRunning && document.getElementById('countryWin').style.display!=='flex'){
      const ov=document.getElementById('overlay');
      if((m.over||lost)&&!gameOver){ gameOver=true; document.getElementById('ovTitle').textContent=mine?'Победа!':'Поражение'; ov.style.display='flex'; }
      else if(!m.over&&mine&&gameOver){ gameOver=false; ov.style.display='none'; }
    }
  }

  /* ── гость: зеркала сущностей ── */
  function ghostMesh(kind,owner){
    const col=(OWNER_COL[owner]!=null?OWNER_COL[owner]:0x9aa6b2), g=new T3.Group(); let lab=null, mat=null;
    if(kind===0){ mat=new T3.MeshLambertMaterial({color:col}); g.userData.orbs=[]; g.userData.orbN=0;   // 🪖 рой мини-юнитов (как солошный Squad), число ∝ армии — строится в reconcile/ghostSwarm
      lab=document.createElement('div'); lab.className='lab'; labels&&labels.appendChild(lab); }
    else if(kind===1){ // ⚓ корабль: корпус + нос + мачта + парус (а не «прямоугольник»)
      const hullM=new T3.MeshLambertMaterial({color:0x6b4a2c}); mat=new T3.MeshLambertMaterial({color:col});
      const hull=new T3.Mesh(new T3.BoxGeometry(0.55,0.16,0.24),hullM); hull.position.y=0.08; hull.castShadow=true; g.add(hull);
      const bow=new T3.Mesh(new T3.ConeGeometry(0.12,0.3,4),hullM); bow.rotation.z=-Math.PI/2; bow.rotation.y=Math.PI/4; bow.position.set(0.4,0.08,0); g.add(bow);
      const mast=new T3.Mesh(new T3.CylinderGeometry(0.014,0.014,0.4),hullM); mast.position.y=0.34; g.add(mast);
      const sail=new T3.Mesh(new T3.BoxGeometry(0.03,0.26,0.22),mat); sail.position.set(0,0.42,0); sail.castShadow=true; g.add(sail);
      g.scale.setScalar(typeof SHIP_SCALE!=='undefined'?SHIP_SCALE:5); }
    else if(kind===2){ // ✈ самолёт: фюзеляж + крылья + хвост + нос (а не «конус»)
      const bodyM=new T3.MeshLambertMaterial({color:0xe8edf2}); mat=new T3.MeshLambertMaterial({color:col});
      const fus=new T3.Mesh(new T3.CylinderGeometry(0.06,0.035,0.5,8),bodyM); fus.rotation.z=Math.PI/2; fus.castShadow=true; g.add(fus);
      const wing=new T3.Mesh(new T3.BoxGeometry(0.1,0.025,0.5),mat); wing.castShadow=true; g.add(wing);
      const tail=new T3.Mesh(new T3.BoxGeometry(0.08,0.02,0.2),mat); tail.position.x=-0.2; g.add(tail);
      const fin=new T3.Mesh(new T3.BoxGeometry(0.08,0.1,0.02),mat); fin.position.set(-0.2,0.06,0); g.add(fin);
      const nose=new T3.Mesh(new T3.ConeGeometry(0.035,0.12,8),bodyM); nose.rotation.z=-Math.PI/2; nose.position.set(0.3,0,0); g.add(nose);
      g.scale.setScalar(typeof PLANE_SCALE!=='undefined'?PLANE_SCALE:5); }
    else { g.add(new T3.Mesh(new T3.ConeGeometry(0.1,0.4,6),new T3.MeshBasicMaterial({color:0xff7a3a}))); }
    scene.add(g);
    const obj={kind,owner,group:g,lab,count:0,target:new T3.Vector3(),mat,isAir:kind===2,pos:g.position};
    g.userData.ghost=obj; return obj;
  }
  function killGhost(gh){ scene.remove(gh.group); if(gh.lab)gh.lab.remove(); }
  // рой отряда-призрака: n мини-юнитов по диску (золотой угол) — зеркало солошного Squad._buildCluster
  function ghostSwarm(gh,n){
    const ud=gh.group.userData; if(n===ud.orbN)return; ud.orbN=n;
    for(const u of ud.orbs)gh.group.remove(u.mesh); ud.orbs.length=0;
    const R=0.05+Math.sqrt(n)*0.085;
    for(let i=0;i<n;i++){ const m=new T3.Mesh(UNIT_GEO,gh.mat); m.castShadow=true;
      const a=i*2.399963, r=R*Math.sqrt((i+0.5)/n);
      ud.orbs.push({mesh:m, ox:Math.cos(a)*r+(Math.random()-0.5)*0.04, oz:Math.sin(a)*r+(Math.random()-0.5)*0.04, ph:Math.random()*6.28, sp:0.9+Math.random()*0.5});
      gh.group.add(m); }
  }
  function reconcile(list){
    const seen=new Set();
    for(const d of list){ const id=d[0],kind=d[1];
      let gh=MP.ghosts.get(id);
      if(!gh||gh.kind!==kind){ if(gh)killGhost(gh); gh=ghostMesh(kind,d[2]); MP.ghosts.set(id,gh); gh.group.position.set(d[3],d[4],d[5]); }
      gh._mpid=id; gh.target.set(d[3],d[4],d[5]); gh.count=d[6]; if(kind===0)ghostSwarm(gh,unitsForCount(d[6])); seen.add(id);
    }
    for(const [id,gh] of MP.ghosts) if(!seen.has(id)){ killGhost(gh); MP.ghosts.delete(id); }
  }

  window.mpTick=(now,dt)=>{
    if(MP.host){ if(MP._lastGS!==gameSpeed){MP._lastGS=gameSpeed;setPill();}
      if(now-tSnap>140){tSnap=now;MP.send(buildSnap(now));}
      if(now-tEnt>70){tEnt=now;const ent=buildEnt();if(ent)MP.send(ent);} return; }
    if(!MP.guest)return;
    if(MP._lastFid!==PLAYER){ MP._lastFid=PLAYER; MP.send({t:'joinInfo',fid:PLAYER,country:PLAYER_COUNTRY}); setPill(); } // надёжно сообщаем хосту свою фракцию
    for(const [id,gh] of MP.ghosts){
      const p=gh.group.position,t=gh.target,k=Math.min(1,dt*12),dx=t.x-p.x,dz=t.z-p.z;
      p.x+=dx*k; p.y+=(t.y-p.y)*k; p.z+=dz*k;
      if((gh.kind===1||gh.kind===2)&&dx*dx+dz*dz>1e-4)gh.group.rotation.y=-Math.atan2(dz,dx);   // нос моделей смотрит +X (как у солошного корабля) → разворот по курсу
      if(gh.mat&&gh.mat.emissive)gh.mat.emissive.setHex(selectedUnits.has(gh)?0x1f6fc0:0x000000); // подсветка выбранных
      if(gh.kind===0&&gh.group.userData.orbs){ const tt=now/1000;   // 🪖 покачивание роя отряда (как солошный _placeOrbs)
        for(const u of gh.group.userData.orbs){ const bob=Math.abs(Math.sin(tt*4*u.sp+u.ph))*0.08; u.mesh.position.set(u.ox,bob,u.oz); } }
      if(gh.lab){ const v=new T3.Vector3(p.x,p.y+0.4,p.z).project(camera);
        gh.lab.style.display=v.z<1?'block':'none';
        gh.lab.style.left=(v.x*0.5+0.5)*innerWidth+'px'; gh.lab.style.top=(-v.y*0.5+0.5)*innerHeight+'px';
        gh.lab.textContent=gh.count; }
    }
  };

  /* ── хост: применить команду гостя (с проверкой фракции) ── */
  function hostCmd(m){
    const fid=MP.assign[m.from]; if(fid==null)return;
    ensureIndex();
    const c=m.c!=null?ci(m.c):null;
    if(m.cmd==='army'){ const a=ci(m.a),b=ci(m.b); if(a&&b&&a.owner===fid)sendUnits(a,b,(m.pct||50)/100); }
    else if(m.cmd==='buy'){ if(c&&c.owner===fid&&!c.occ){ const amt=buyAmount(c,m.spec); if(amt>0){gold[fid]-=amt*SOLDIER_PRICE;manpower[fid]-=amt;c.batches.push({count:amt,time:amt*c.trainPer,elapsed:0});} } }
    else if(m.cmd==='upg'){ if(c&&c.owner===fid&&!c.occ&&c.tier<MAX_TIER&&(!c.spec||c.spec===m.track)){ const cost=upgradeCost(c.tier); if(gold[fid]>=cost){gold[fid]-=cost;c.spec=m.track;c.tier++;c.buildMeshes();markRegions();} } }
    else if(m.cmd==='war'){ if(fid!==m.tg&&!atWar(fid,m.tg)&&(politPts[fid]||0)>=POLIT_WAR){ politPts[fid]-=POLIT_WAR; setWar(fid,m.tg); try{dragAlliesIntoWar(fid,m.tg);}catch(e){} } }
    else if(m.cmd==='ally'){ if(fid!==m.tg&&!atWar(fid,m.tg)&&(politPts[fid]||0)>=POLIT_ALLY){ politPts[fid]-=POLIT_ALLY; setRelation(fid,m.tg,'ally'); } }
    else if(m.cmd==='peace'){ if(atWar(fid,m.tg)&&(politPts[fid]||0)>=POLIT_PEACE){ politPts[fid]-=POLIT_PEACE; resolveOccupation(fid,m.tg,'white'); setRelation(fid,m.tg,'neutral'); if(typeof setTruce==='function')setTruce(fid,m.tg); } }
    else if(m.cmd==='bship'){ const y=ci(m.c); if(y&&y.owner===fid&&y.isShipyard)buildShip(y,fid); }
    else if(m.cmd==='bplane'){ const y=ci(m.c); if(y&&y.owner===fid&&y.isAirport)buildPlane(y,fid); }
    else if(m.cmd==='yard'){ const c=ci(m.c); if(c&&c.owner===fid)buildYard(c,m.kind,fid); }
    else if(m.cmd==='shipmove'){ if(Array.isArray(m.ids))for(const s of ships)if(s._mpid!=null&&m.ids.includes(s._mpid)&&s.owner===fid)s.setTarget(m.x,m.z); }
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
  if(MP.localSim){ MP.send=()=>{}; if(pill)pill.textContent='🧪 Локальный серверный Sim (соло)'; if(typeof initLocalSim==='function')initLocalSim(); }

  // при выборе страны: гость уведомляет хоста, хост обновляет список людей
  const _sc=selectCountry;
  selectCountry=function(c){ _sc(c);
    if(MP.on){ if(MP.guest){ MP._synced=false; MP._sawRunning=false; MP.send({t:'joinInfo',fid:PLAYER,country:PLAYER_COUNTRY}); }  // ждём свежий keyframe для новой фракции
               if(MP.host){MP.assign[MP.id]=PLAYER;recalcHumans();} setPill(); } };
})();

/* ── 🌍 выбор страны на старте ─────────────────────────────── */
function buildCountryPick(){
  const list=document.getElementById('countryList'); if(!list)return; list.innerHTML='';
  const countries=[...new Set(CITY_LIST.map(c=>c[5]))]; // те же страны, что в buildFactions
  // по убыванию числа городов (крупные сверху)
  countries.map(c=>({c,n:CITY_LIST.filter(x=>x[5]===c).length}))
    .sort((a,b)=>b.n-a.n)
    .forEach(({c,n})=>{
      const col='#'+(FACTION_COLOR[c]||0x9aa6b2).toString(16).padStart(6,'0');
      const el=document.createElement('div'); el.className='cpick';
      el.innerHTML=`<div class="cflag">${flagOf(c)}</div><div class="cdot" style="background:${col}"></div>`+
        `<div class="cbody"><div class="cnm">${c}</div><div class="cmeta">${n} ${n%10===1&&n%100!==11?'город':(n%10>=2&&n%10<=4&&(n%100<10||n%100>=20)?'города':'городов')}</div></div>`;
      el.addEventListener('click',()=>selectCountry(c));
      list.appendChild(el);
    });
}
function openCountryPick(){ buildCountryPick(); document.getElementById('countryWin').style.display='flex'; gameSpeed=0; } // пауза, пока выбирают
function selectCountry(country){
  PLAYER_COUNTRY=country;
  buildFactions();                 // переустановить PLAYER/OWNER.PLAYER на выбранную страну
  newGame();                       // новая партия за выбранную фракцию
  document.getElementById('countryWin').style.display='none';
  gameSpeed=1;
  toast(`${flagOf(country)} Вы играете за ${country}`);
}

buildWorld();
resize();
newGame();
openCountryPick();   // на старте — окно выбора страны (партия за Францию идёт фоном до выбора)
requestAnimationFrame(loop);
