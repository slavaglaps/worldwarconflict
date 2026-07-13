/* ── input: picking + camera orbit ──────────────────────────── */
const ray=new T3.Raycaster(), ndc=new T3.Vector2();
const groundPlane=new T3.Plane(new T3.Vector3(0,1,0),0); // adjusted for terrain
let cityHitSource=null, cityHitCount=-1, cityHitMeshes=[];
function invalidateCityHitCache(){
  cityHitSource=null; cityHitCount=-1; cityHitMeshes=[];
}
window.invalidateCityHitCache=invalidateCityHitCache;
function getCityHitMeshes(){
  // cities is replaced when a match restarts and appended to when a city is founded.
  if(cityHitSource!==cities||cityHitCount!==cities.length){
    cityHitSource=cities; cityHitCount=cities.length;
    cityHitMeshes=cities.map(c=>c.hit).filter(Boolean);
  }
  return cityHitMeshes;
}
function pickCity(cx,cy){
  ndc.x=(cx/innerWidth)*2-1; ndc.y=-(cy/innerHeight)*2+1;
  ray.setFromCamera(ndc,camera);
  const hit=ray.intersectObjects(getCityHitMeshes(),false);
  return hit.length?hit[0].object.userData.city:null;
}
function pickUnit(cx,cy){
  ndc.x=(cx/innerWidth)*2-1; ndc.y=-(cy/innerHeight)*2+1;
  ray.setFromCamera(ndc,camera);
  if(MP.guest){ // гость управляет своими кораблями/дирижаблями-зеркалами (ghosts)
    const groups=[]; for(const gh of MP.ghosts.values())if((gh.kind===1||gh.kind===2)&&gh.owner===PLAYER)groups.push(gh.group);
    if(!groups.length)return null;
    const hit=ray.intersectObjects(groups,true);
    if(!hit.length){
      let best=null,bd=1.8;
      for(const gh of MP.ghosts.values()){
        if(gh.kind!==2||gh.owner!==PLAYER)continue;
        const d=ray.ray.distanceSqToPoint(gh.group.position);
        if(d<bd){bd=d;best=gh;}
      }
      return best;
    }
    let o=hit[0].object; while(o&&!(o.userData&&o.userData.ghost))o=o.parent;
    return o?o.userData.ghost:null;
  }
  const units=[...ships,...planes].filter(u=>u&&u.group);
  if(!units.length)return null;
  const hit=ray.intersectObjects(units.map(s=>s.group),true);
  if(!hit.length)return null;
  let o=hit[0].object; while(o&&!(o.userData.ship||o.userData.plane))o=o.parent;
  return o?(o.userData.ship||o.userData.plane):null;
}
function waterPoint(cx,cy){
  ndc.x=(cx/innerWidth)*2-1; ndc.y=-(cy/innerHeight)*2+1;
  ray.setFromCamera(ndc,camera);
  const out=new T3.Vector3();
  return ray.ray.intersectPlane(groundPlane,out)?out:null;
}
let selectedUnits=new Set(), unitDrag=null, dragLead=null;
function clearUnits(){selectedUnits.clear();}
function groundPoint(cx,cy){
  ndc.x=(cx/innerWidth)*2-1; ndc.y=-(cy/innerHeight)*2+1;
  ray.setFromCamera(ndc,camera);
  const out=new T3.Vector3();
  return ray.ray.intersectPlane(groundPlane,out)?out:null;
}
function screenOf(c){
  const v=new T3.Vector3(c.gx,c.baseY+c.topY*CITY_SCALE+0.4,c.gz).project(camera);
  return {x:(v.x*0.5+0.5)*innerWidth, y:(-v.y*0.5+0.5)*innerHeight, vis:v.z<1};
}
const playerSel=()=>[...selectedSet].filter(c=>c.owner===OWNER.PLAYER);
function clearSel(){selectedSet.clear();}
// источники отправки при перетаскивании: если схваченный город входит в мультивыбор — все выбранные, иначе только он
function dragSources(){ const ps=playerSel(); return (dragFrom&&selectedSet.has(dragFrom)&&ps.length>1)?ps:(dragFrom?[dragFrom]:[]); }
function cityArrowPoint(c,dy=0.5){return {x:c.gx,y:c.baseY+dy,z:c.gz};}
function pushArrowPoint(list,p){
  const last=list[list.length-1];
  if(!last||Math.hypot(last.x-p.x,last.z-p.z)>0.05)list.push(p);
}
function edgeArrowPoints(from,to){
  const out=[cityArrowPoint(from)];
  const visual=typeof hexRoadPolyline==='function'?hexRoadPolyline(from.idx,to.idx):null;
  if(visual&&visual.length){
    for(const p of visual)pushArrowPoint(out,{x:p.x,y:getTerrainHeight(p.x,p.z)+0.5,z:p.z});
  }else{
    const eg=getEdge(from.idx,to.idx);
    if(eg&&eg.pts){
      const pts=(eg.a===from.idx)?eg.pts:[...eg.pts].reverse();
      for(let i=1;i<pts.length-1;i++){const p=pts[i];pushArrowPoint(out,{x:p.x,y:p.y+0.5,z:p.z});}
    }
  }
  pushArrowPoint(out,cityArrowPoint(to));
  return out;
}

/* ── камера: панорама/вращение/зум-к-курсору ────────────────── */
let orbiting=null, panning=null, camRotating=false, rmbDown=null;
let pointerX=innerWidth/2, pointerY=innerHeight/2, keyboardCameraMoving=false, hoverRefreshTimer=0;
function rememberPointer(e){pointerX=e.clientX;pointerY=e.clientY;}
function cancelHoverRefresh(){if(hoverRefreshTimer){clearTimeout(hoverRefreshTimer);hoverRefreshTimer=0;}}
function refreshHoverAfterCamera(){
  hoverRefreshTimer=0;
  if(orbiting||panning||keyboardCameraMoving)return;
  hoverCity=pickCity(pointerX,pointerY);
}
function scheduleHoverAfterCamera(delay=0){
  cancelHoverRefresh();
  if(delay>0)hoverRefreshTimer=setTimeout(refreshHoverAfterCamera,delay);
  else refreshHoverAfterCamera();
}
function clampTarget(){
  target.x=Math.max(3,Math.min(GRID-3,target.x));
  target.z=Math.max(3,Math.min(GRID-3,target.z));
}
// направления камеры на плоскости XZ (для панорамы)
function camAxes(){
  const fx=target.x-camera.position.x, fz=target.z-camera.position.z;
  const fl=Math.hypot(fx,fz)||1;
  return {fwd:{x:fx/fl,z:fz/fl}, right:{x:-fz/fl,z:fx/fl}};
}
function panBy(dx,dy){ // в пикселях; «хватаешь карту и тянешь»
  const s=orbit.r*0.0016;
  const {fwd,right}=camAxes();
  target.x += (-dx*right.x + dy*fwd.x)*s;
  target.z += (-dx*right.z + dy*fwd.z)*s;
  clampTarget(); applyCam();
}
/* ── RTS-приказы: правый клик = отправка/движение + классический «пинг» приказа ── */
// Классический RTS-индикатор: два кольца схлопываются внутрь и гаснут (~0.5с). Само-анимируется
// через rAF (главный цикл рендерит сцену каждый кадр — мутации колец видны сразу), без хука в loop.
function moveOrderPing(x,y,z,color){
  const grp=new T3.Group(); grp.position.set(x,(y||0)+0.12,z); grp.renderOrder=999;
  const rings=[];
  for(let i=0;i<2;i++){
    const g=new T3.RingGeometry(0.62,0.82,40);
    const m=new T3.MeshBasicMaterial({color:color||0x6fdf6a,transparent:true,opacity:0.95,depthTest:false,depthWrite:false,side:T3.DoubleSide});
    const r=new T3.Mesh(g,m); r.rotation.x=-Math.PI/2; grp.add(r); rings.push({r,ph:i*0.14});
  }
  scene.add(grp);
  const t0=performance.now(), dur=520;
  (function anim(){
    const now=performance.now(); let done=true;
    for(const it of rings){
      const k=Math.min(1,Math.max(0,(now-t0)/dur-it.ph));
      const s=1.9-1.35*k; it.r.scale.set(s,s,s); it.r.material.opacity=0.95*(1-k);
      if(k<1)done=false;
    }
    if(done){ scene.remove(grp); for(const it of rings){it.r.geometry.dispose();it.r.material.dispose();} }
    else requestAnimationFrame(anim);
  })();
}
// движение выбранных кораблей/дирижаблей в точку курсора (корабли — по воде, авиация — по земле/воздуху)
function _dispatchMovers(arr,gp,isAir){
  const n=arr.length; if(!n)return;
  if(MP.guest){
    const ids=arr.filter(u=>u._mpid!=null).map(u=>u._mpid);
    if(ids.length)MP.cmd({cmd:isAir?'planemove':'shipmove',ids,x:+gp.x.toFixed(2),z:+gp.z.toFixed(2)});
    return;
  }
  const cols=Math.ceil(Math.sqrt(n)), gapU=2.2;
  arr.forEach((u,i)=>{
    const ox=(i%cols)-(cols-1)/2, oz=Math.floor(i/cols)-(Math.ceil(n/cols)-1)/2;
    let tx=gp.x+ox*gapU, tz=gp.z+oz*gapU;
    if(!isAir&&!isWaterAt(tx,tz)){const w=nearestWaterPoint(tx,tz);tx=w.x;tz=w.z;}
    u.setTarget(tx,tz);
  });
}
function commandSelectedUnitsTo(cx,cy){
  const arr=[...selectedUnits]; if(!arr.length)return false;
  const sea=arr.filter(u=>!u.isAir), air=arr.filter(u=>u.isAir);
  let pingPt=null;
  if(sea.length){ const gp=waterPoint(cx,cy); if(gp){ _dispatchMovers(sea,gp,false); pingPt=gp; } }
  if(air.length){ const gp=groundPoint(cx,cy); if(gp){ _dispatchMovers(air,gp,true); pingPt=pingPt||gp; } }
  if(pingPt)moveOrderPing(pingPt.x,pingPt.y,pingPt.z,0x6fdf6a);
  return true;
}
// приказ правым кликом: приоритет — выбранные корабли/авиация; иначе выбранные города → город под курсором
function issueRightClickOrder(cx,cy){
  if(gameOver)return;
  if(selectedUnits.size){ commandSelectedUnitsTo(cx,cy); return; }
  const ps=playerSel(); if(!ps.length)return;
  const to=pickCity(cx,cy); if(!to)return;
  const enemy = to.owner!==OWNER.PLAYER && !allied(OWNER.PLAYER,to.owner);
  for(const s of ps) if(s!==to) sendUnits(s,to);   // sendUnits сам валидирует войну/путь и шлёт cmd (соло и MP)
  moveOrderPing(to.gx, to.baseY, to.gz, enemy?0xff5a44:0x6fdf6a);   // зелёный — движение/подкреп, красный — атака
}

renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());
renderer.domElement.addEventListener('mousedown',e=>{
  rememberPointer(e);
  if(e.button===1||(e.button===2&&e.shiftKey)){ // СКМ или Shift+ПКМ = вращение
    cancelHoverRefresh();
    orbiting={x:e.clientX,y:e.clientY,th:orbit.theta,ph:orbit.phi};
    e.preventDefault(); return;
  }
  if(e.button===2){ // ПКМ: короткий клик = приказ (RTS), перетаскивание = панорама
    cancelHoverRefresh();
    panning={x:e.clientX,y:e.clientY};
    rmbDown={x:e.clientX,y:e.clientY,moved:false};
    return;
  }
  if(e.button!==0||gameOver)return;
  // клик по своему кораблю/дирижаблю → выбрать и тянуть (если он уже в группе — тянем всю группу)
  const u=pickUnit(e.clientX,e.clientY);
  if(u&&u.owner===OWNER.PLAYER){
    if(!selectedUnits.has(u)){ if(!e.shiftKey)clearUnits(); selectedUnits.add(u); }
    dragLead=u; unitDrag={x:e.clientX,y:e.clientY};
    clearSel(); updatePanel();
    return;
  }
  const c=pickCity(e.clientX,e.clientY);
  if(c)clearUnits(); // клик по городу сбрасывает выбор юнитов
  // чужой город
  if(c&&c.owner!==OWNER.PLAYER){
    if(selectedSet.size&&atWar(OWNER.PLAYER,c.owner)){ // война + есть армия → атака
      for(const s of playerSel())sendUnits(s,c);
    } else {
      openDiplo(c.owner); // иначе открыть дипломатию страны
    }
    return;
  }
  if(c&&c.owner===OWNER.PLAYER){ dragFrom=c; dragStart={x:e.clientX,y:e.clientY}; dragMoved=false; }
  else { boxStart={x:e.clientX,y:e.clientY}; if(!e.shiftKey){clearSel();clearUnits();} updatePanel(); }
});
window.addEventListener('mousemove',e=>{
  rememberPointer(e);
  if(orbiting){
    orbit.theta=orbiting.th+(e.clientX-orbiting.x)*0.008;
    orbit.phi=Math.max(0.15,Math.min(1.40,orbiting.ph-(e.clientY-orbiting.y)*0.006));
    applyCam(); return;
  }
  if(panning){
    if(rmbDown&&Math.hypot(e.clientX-rmbDown.x,e.clientY-rmbDown.y)>6)rmbDown.moved=true;   // сдвинул → это панорама, не приказ
    panBy(e.clientX-panning.x, e.clientY-panning.y);
    panning.x=e.clientX; panning.y=e.clientY;
    return;
  }
  // Active city dragging still needs a live target even if a camera key is held.
  if(!keyboardCameraMoving||dragFrom)hoverCity=pickCity(e.clientX,e.clientY);
  if(unitDrag&&dragLead){
    const gp=dragLead.isAir?groundPoint(e.clientX,e.clientY):waterPoint(e.clientX,e.clientY);
    if(gp){const u=dragLead, ay=u.isAir?PLANE_ALT:WATER_Y_SHIP+0.3;
      updateDragArrow([{x:u.pos.x,y:ay,z:u.pos.z},{x:gp.x,y:ay,z:gp.z}],0x6fc0ff); // стрелка MW
    }
    return;
  }
  if(dragFrom){
    if(Math.hypot(e.clientX-dragStart.x,e.clientY-dragStart.y)>6)dragMoved=true;
    const srcs=dragSources();   // все выбранные города (или один схваченный)
    if(hoverCity&&hoverCity!==dragFrom){
      // превью маршрута по графу от КАЖДОГО источника; оранжевый = на пути чужой город (бой будет там)
      const list=[]; let col=0x6fc0ff;
      for(const s of srcs){ if(s===hoverCity)continue;
        const r=findPath(s.idx,hoverCity.idx,s.owner); if(!r)continue;
        const pathPts=[];
        for(let i=0;i<r.path.length-1;i++){
          for(const pt of edgeArrowPoints(r.path[i],r.path[i+1]))pushArrowPoint(pathPts,pt);
          if(i+1<r.path.length-1&&r.path[i+1].owner!==s.owner)col=0xffae4a;
        }
        list.push(pathPts);
      }
      if(list.length)updateDragArrows(list,col); else hideDragArrow();
    } else {
      const gp=groundPoint(e.clientX,e.clientY);
      if(gp)updateDragArrows(srcs.map(s=>[cityArrowPoint(s),{x:gp.x,y:gp.y+0.5,z:gp.z}]),0x6fc0ff);
    }
  } else if(boxStart){
    const x=Math.min(boxStart.x,e.clientX),y=Math.min(boxStart.y,e.clientY);
    boxEl.style.display='block'; boxEl.style.left=x+'px'; boxEl.style.top=y+'px';
    boxEl.style.width=Math.abs(e.clientX-boxStart.x)+'px'; boxEl.style.height=Math.abs(e.clientY-boxStart.y)+'px';
  }
});
window.addEventListener('mouseup',e=>{
  rememberPointer(e);
  const cameraDragEnded=!!(orbiting||panning);
  orbiting=null; panning=null;
  if(cameraDragEnded)scheduleHoverAfterCamera();
  if(e.button===2){ if(rmbDown&&!rmbDown.moved)issueRightClickOrder(e.clientX,e.clientY); rmbDown=null; return; }   // ПКМ без сдвига = приказ
  if(e.button!==0)return;
  hideDragArrow(); boxEl.style.display='none';
  if(gameOver){dragFrom=null;boxStart=null;unitDrag=null;dragLead=null;return;}
  if(unitDrag){ // корабли — по воде, дирижабли — по воздуху
    const air=!!(dragLead&&dragLead.isAir);
    const arr=[...selectedUnits].filter(u=>!!u.isAir===air), n=arr.length;
    const gp=air?groundPoint(e.clientX,e.clientY):waterPoint(e.clientX,e.clientY);
    if(gp)moveOrderPing(gp.x,gp.y,gp.z,0x6fdf6a);   // 🎯 пинг приказа (перетаскивание)
    if(MP.guest){ // гость → команда движения хосту (по id зеркал)
      const ids=arr.filter(u=>u._mpid!=null).map(u=>u._mpid);
      if(gp&&ids.length)MP.cmd({cmd:air?'planemove':'shipmove',ids,x:+gp.x.toFixed(2),z:+gp.z.toFixed(2)});
      unitDrag=null; dragLead=null; return;
    }
    const cols=Math.ceil(Math.sqrt(n)), gapU=2.2;
    if(gp)arr.forEach((u,i)=>{
      const cx=(i%cols)-(cols-1)/2, cz=Math.floor(i/cols)-(Math.ceil(n/cols)-1)/2;
      let tx=gp.x+cx*gapU, tz=gp.z+cz*gapU;
      if(!air&&!isWaterAt(tx,tz)){const w=nearestWaterPoint(tx,tz);tx=w.x;tz=w.z;}
      u.setTarget(tx,tz);
    });
    unitDrag=null; dragLead=null; return;
  }
  if(dragFrom){
    const t=pickCity(e.clientX,e.clientY);
    if(dragMoved&&t&&t!==dragFrom){ for(const s of dragSources()) if(s!==t) sendUnits(s,t);   // протащил на город → отправка из ВСЕХ выбранных
      moveOrderPing(t.gx,t.baseY,t.gz,(t.owner!==OWNER.PLAYER&&!allied(OWNER.PLAYER,t.owner))?0xff5a44:0x6fdf6a); }
    else if(!dragMoved){                                           // короткий клик → выбрать
      if(e.shiftKey){ if(selectedSet.has(dragFrom))selectedSet.delete(dragFrom); else selectedSet.add(dragFrom); } // Shift = добавить/убрать (мультивыбор)
      else { clearSel(); selectedSet.add(dragFrom); }
    }
    dragFrom=null; updatePanel();
  } else if(boxStart){
    const moved=Math.hypot(e.clientX-boxStart.x,e.clientY-boxStart.y)>8;
    if(moved){
      const x1=Math.min(boxStart.x,e.clientX),x2=Math.max(boxStart.x,e.clientX);
      const y1=Math.min(boxStart.y,e.clientY),y2=Math.max(boxStart.y,e.clientY);
      const inBox=(wx,wy,wz)=>{const v=new T3.Vector3(wx,wy,wz).project(camera);
        const sx=(v.x*0.5+0.5)*innerWidth, sy=(-v.y*0.5+0.5)*innerHeight;
        return v.z<1&&sx>=x1&&sx<=x2&&sy>=y1&&sy<=y2;};
      for(const c of cities){ if(c.owner!==OWNER.PLAYER)continue; const s=screenOf(c);
        if(s.vis&&s.x>=x1&&s.x<=x2&&s.y>=y1&&s.y<=y2)selectedSet.add(c); }
      // массовый выбор кораблей и дирижаблей в рамке
      let pickedUnit=false;
      const unitList = MP.guest ? [...MP.ghosts.values()].filter(g=>g.kind===1||g.kind===2) : [...ships,...planes];
      for(const u of unitList){ if(u.owner!==OWNER.PLAYER)continue;
        const y=u.isAir?PLANE_ALT:WATER_Y_SHIP+0.2;
        if(inBox(u.pos.x,y,u.pos.z)){selectedUnits.add(u);pickedUnit=true;} }
      if(pickedUnit){selectedSet.clear();clearSel();} // если в рамке юниты — города не выбираем
    }
    boxStart=null; updatePanel();
  }
});
renderer.domElement.addEventListener('wheel',e=>{
  e.preventDefault();
  rememberPointer(e); cancelHoverRefresh();
  const before=groundPoint(e.clientX,e.clientY);
  const oldR=orbit.r;
  orbit.r=Math.max(10,Math.min(520,orbit.r*(e.deltaY>0?1.12:1/1.12)));
  // зум к курсору: при приближении target подтягивается к точке под мышью
  if(before&&orbit.r<oldR){
    const k=1-orbit.r/oldR;
    target.x+=(before.x-target.x)*k;
    target.z+=(before.z-target.z)*k;
    clampTarget();
  }
  applyCam();
  scheduleHoverAfterCamera(100);
},{passive:false});

/* ── touch: iPad/tablet adapter over the established mouse controls ────────
   One finger on a city/unit keeps the RTS drag interaction. One finger on
   empty terrain pans the camera. Two fingers pan and pinch-zoom. */
renderer.domElement.style.touchAction='none';
let touchControl=null, touchPinch=null;
const touchMid=(a,b)=>({x:(a.clientX+b.clientX)*0.5,y:(a.clientY+b.clientY)*0.5});
const touchDist=(a,b)=>Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);
function touchMouse(type,x,y,button,target){
  const buttons=button===0?1:(button===1?4:2);
  (target||window).dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,button,buttons:type==='mouseup'?0:buttons}));
}
function findTouch(list,id){for(let i=0;i<list.length;i++)if(list[i].identifier===id)return list[i];return list[0]||null;}
function startTouchControl(control){
  if(!control||control.started)return;
  control.started=true;
  touchMouse('mousedown',control.x,control.y,control.button,renderer.domElement);
  if(control.button===2&&rmbDown)rmbDown.moved=true;
}
function cancelTouchControl(){
  orbiting=null;panning=null;rmbDown=null;dragFrom=null;boxStart=null;unitDrag=null;dragLead=null;
  hideDragArrow();boxEl.style.display='none';touchControl=null;
}
function beginTouchPinch(e){
  cancelTouchControl();
  const a=e.touches[0],b=e.touches[1],m=touchMid(a,b);
  touchPinch={dist:Math.max(1,touchDist(a,b)),r:orbit.r,x:m.x,y:m.y};
  cancelHoverRefresh();
}
renderer.domElement.addEventListener('touchstart',e=>{
  e.preventDefault();
  if(e.touches.length>=2){beginTouchPinch(e);return;}
  const t=e.touches[0];if(!t)return;
  rememberPointer(t);touchPinch=null;
  const interactive=!!pickUnit(t.clientX,t.clientY)||!!pickCity(t.clientX,t.clientY);
  const button=interactive?0:2;
  // Defer the synthetic press until move/end: a second finger may still arrive for pinch.
  touchControl={id:t.identifier,button,x:t.clientX,y:t.clientY,moved:false,started:false};
},{passive:false});
renderer.domElement.addEventListener('touchmove',e=>{
  e.preventDefault();
  if(e.touches.length>=2){
    if(!touchPinch)beginTouchPinch(e);
    const a=e.touches[0],b=e.touches[1],m=touchMid(a,b),d=Math.max(1,touchDist(a,b));
    panBy(m.x-touchPinch.x,m.y-touchPinch.y);
    orbit.r=Math.max(10,Math.min(520,touchPinch.r*touchPinch.dist/d));
    touchPinch.x=m.x;touchPinch.y=m.y;applyCam();
    return;
  }
  if(!touchControl)return;
  const t=findTouch(e.touches,touchControl.id);if(!t)return;
  if(Math.hypot(t.clientX-touchControl.x,t.clientY-touchControl.y)>6)touchControl.moved=true;
  startTouchControl(touchControl);
  touchMouse('mousemove',t.clientX,t.clientY,touchControl.button,window);
},{passive:false});
renderer.domElement.addEventListener('touchend',e=>{
  e.preventDefault();
  if(touchPinch){
    if(e.touches.length===1){
      const t=e.touches[0];touchPinch=null;
      touchControl={id:t.identifier,button:2,x:t.clientX,y:t.clientY,moved:true,started:false};
      startTouchControl(touchControl);
    }else{touchPinch=null;scheduleHoverAfterCamera(80);}
    return;
  }
  if(!touchControl)return;
  if(e.touches.length)return;
  const t=findTouch(e.changedTouches,touchControl.id);
  const x=t?t.clientX:touchControl.x,y=t?t.clientY:touchControl.y,button=touchControl.button,moved=touchControl.moved;
  startTouchControl(touchControl);
  touchMouse('mouseup',x,y,button,window);
  if(button===0&&!moved)touchMouse('click',x,y,0,renderer.domElement); // construction placement uses click capture
  // тап по пустой местности (не панорама) = снять выделение и закрыть панель города — как ЛКМ по пустому месту на десктопе
  else if(button===2&&!moved&&!selectedUnits.size){ clearSel(); if(typeof updatePanel==='function')updatePanel(); }
  touchControl=null;
},{passive:false});
renderer.domElement.addEventListener('touchcancel',e=>{e.preventDefault();cancelTouchControl();touchPinch=null;},{passive:false});

const keysDown=new Set();
window.addEventListener('keydown',e=>{
  if(document.activeElement&&document.activeElement.tagName==='INPUT')return;
  keysDown.add(e.code);
  if(e.key==='r'||e.key==='R'){openCountryPick();return;}  // рестарт → снова выбор страны
  if(e.code==='KeyT'){techWinOpen?closeTech():openTech();return;}
  if(e.code==='KeyP'){polWinOpen?closePol():openPol();return;}
  if(e.code==='KeyH'){const o=document.getElementById('heroWin').style.display==='flex';o?closeHeroPick():openHeroPick();return;}
  if(e.code==='Escape'){if(techWinOpen)closeTech();if(diploTarget!=null)closeDiplo();if(polWinOpen)closePol();closeHeroPick();return;}
  if(e.code==='Home'){target.set(GRID/2,2,GRID/2);orbit.r=240;applyCam();scheduleHoverAfterCamera();return;}
  const sel=playerSel();
  if(sel.length){
    if(e.key==='1')for(const c of sel)upgradeCity(c,'prod');
    if(e.key==='2')for(const c of sel)upgradeCity(c,'def');
    if(e.key==='3')for(const c of sel)upgradeCity(c,'atk');
    updatePanel();
  }
});
window.addEventListener('keyup',e=>keysDown.delete(e.code));
window.addEventListener('blur',()=>keysDown.clear());

// плавная панорама/поворот с клавиатуры (вызывается из loop)
function updateCameraKeys(dt){
  let dx=0,dz=0;
  if(keysDown.has('KeyW')||keysDown.has('ArrowUp'))dz+=1;
  if(keysDown.has('KeyS')||keysDown.has('ArrowDown'))dz-=1;
  if(keysDown.has('KeyA')||keysDown.has('ArrowLeft'))dx-=1;
  if(keysDown.has('KeyD')||keysDown.has('ArrowRight'))dx+=1;
  let rot=0;
  if(keysDown.has('KeyQ'))rot-=1;
  if(keysDown.has('KeyE'))rot+=1;
  camRotating = !!rot || !!orbiting;   // во время поворота прячем подписи (иначе дрожат)
  const moving=!!(dx||dz||rot);
  if(!moving){
    if(keyboardCameraMoving){keyboardCameraMoving=false;scheduleHoverAfterCamera();}
    return;
  }
  if(!keyboardCameraMoving){keyboardCameraMoving=true;cancelHoverRefresh();}
  if(rot){orbit.theta+=rot*1.8*dt;}
  if(dx||dz){
    const moveLen=Math.hypot(dx,dz); dx/=moveLen; dz/=moveLen;
    const sp=orbit.r*0.9*dt;
    // Направления берём из уже обновлённого theta: при WASD + Q/E движение
    // не отстаёт от поворота камеры на один кадр.
    const fwd={x:-Math.cos(orbit.theta),z:-Math.sin(orbit.theta)};
    const right={x:Math.sin(orbit.theta),z:-Math.cos(orbit.theta)};
    target.x+=(dx*right.x+dz*fwd.x)*sp;
    target.z+=(dx*right.z+dz*fwd.z)*sp;
    clampTarget();
  }
  applyCam();
}
