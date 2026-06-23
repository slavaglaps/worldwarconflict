/* ── input: picking + camera orbit ──────────────────────────── */
const ray=new T3.Raycaster(), ndc=new T3.Vector2();
const groundPlane=new T3.Plane(new T3.Vector3(0,1,0),0); // adjusted for terrain
function pickCity(cx,cy){
  ndc.x=(cx/innerWidth)*2-1; ndc.y=-(cy/innerHeight)*2+1;
  ray.setFromCamera(ndc,camera);
  const hit=ray.intersectObjects(cities.map(c=>c.hit),false);
  return hit.length?hit[0].object.userData.city:null;
}
function pickUnit(cx,cy){ // только корабли (авиация командуется из аэропорта, не выбирается)
  ndc.x=(cx/innerWidth)*2-1; ndc.y=-(cy/innerHeight)*2+1;
  ray.setFromCamera(ndc,camera);
  if(MP.guest){ // гость управляет своими кораблями-зеркалами (ghosts)
    const groups=[]; for(const gh of MP.ghosts.values())if(gh.kind===1&&gh.owner===PLAYER)groups.push(gh.group);
    if(!groups.length)return null;
    const hit=ray.intersectObjects(groups,true); if(!hit.length)return null;
    let o=hit[0].object; while(o&&!(o.userData&&o.userData.ghost))o=o.parent;
    return o?o.userData.ghost:null;
  }
  if(!ships.length)return null;
  const hit=ray.intersectObjects(ships.map(s=>s.group),true);
  if(!hit.length)return null;
  let o=hit[0].object; while(o&&!o.userData.ship)o=o.parent;
  return o?o.userData.ship:null;
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

/* ── камера: панорама/вращение/зум-к-курсору ────────────────── */
let orbiting=null, panning=null, camRotating=false;
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
renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());
renderer.domElement.addEventListener('mousedown',e=>{
  if(e.button===1||(e.button===2&&e.shiftKey)){ // СКМ или Shift+ПКМ = вращение
    orbiting={x:e.clientX,y:e.clientY,th:orbit.theta,ph:orbit.phi};
    e.preventDefault(); return;
  }
  if(e.button===2){ // ПКМ = панорама
    panning={x:e.clientX,y:e.clientY};
    return;
  }
  if(e.button!==0||gameOver)return;
  // клик по своему кораблю/самолёту → выбрать и тянуть (если он уже в группе — тянем всю группу)
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
  hoverCity=pickCity(e.clientX,e.clientY);
  if(orbiting){
    orbit.theta=orbiting.th+(e.clientX-orbiting.x)*0.008;
    orbit.phi=Math.max(0.15,Math.min(1.40,orbiting.ph-(e.clientY-orbiting.y)*0.006));
    applyCam(); return;
  }
  if(panning){
    panBy(e.clientX-panning.x, e.clientY-panning.y);
    panning.x=e.clientX; panning.y=e.clientY;
    return;
  }
  if(unitDrag&&dragLead){
    const gp=waterPoint(e.clientX,e.clientY);
    if(gp){const u=dragLead, ay=u.isAir?PLANE_ALT:WATER_Y_SHIP+0.3;
      updateDragArrow([{x:u.pos.x,y:ay,z:u.pos.z},{x:gp.x,y:ay,z:gp.z}],0x6fc0ff); // стрелка MW
    }
    return;
  }
  if(dragFrom){
    if(Math.hypot(e.clientX-dragStart.x,e.clientY-dragStart.y)>6)dragMoved=true;
    if(dragFrom.isAirport){ // авиация: прямая стрелка к цели (летят напрямую, не по дорогам)
      const tc=(hoverCity&&hoverCity!==dragFrom)?hoverCity:null, gp=groundPoint(e.clientX,e.clientY);
      const tx=tc?tc.gx:(gp?gp.x:dragFrom.gx), tz=tc?tc.gz:(gp?gp.z:dragFrom.gz), ty=tc?tc.baseY:(gp?gp.y:0);
      const col=(tc&&tc.owner!==dragFrom.owner&&atWar(dragFrom.owner,tc.owner))?0xff5a4a:0x6fc0ff; // красный = бомбить
      updateDragArrow([{x:dragFrom.gx,y:dragFrom.baseY+0.5,z:dragFrom.gz},{x:tx,y:ty+0.5,z:tz}],col);
      return;
    }
    const srcs=dragSources();   // все выбранные города (или один схваченный)
    if(hoverCity&&hoverCity!==dragFrom){
      // превью маршрута по графу от КАЖДОГО источника; оранжевый = на пути чужой город (бой будет там)
      const list=[]; let col=0x6fc0ff;
      for(const s of srcs){ if(s===hoverCity)continue;
        const r=findPath(s.idx,hoverCity.idx,s.owner); if(!r)continue;
        const pathPts=[{x:s.gx,y:s.baseY+0.5,z:s.gz}];
        for(let i=0;i<r.path.length-1;i++){
          const eg=getEdge(r.path[i].idx,r.path[i+1].idx);
          const pts=(eg.a===r.path[i].idx)?eg.pts:[...eg.pts].reverse();
          for(const pt of pts)pathPts.push({x:pt.x,y:pt.y+0.5,z:pt.z});
          if(i+1<r.path.length-1&&r.path[i+1].owner!==s.owner)col=0xffae4a;
        }
        list.push(pathPts);
      }
      if(list.length)updateDragArrows(list,col); else hideDragArrow();
    } else {
      const gp=groundPoint(e.clientX,e.clientY);
      if(gp)updateDragArrows(srcs.map(s=>[{x:s.gx,y:s.baseY+0.5,z:s.gz},{x:gp.x,y:gp.y+0.5,z:gp.z}]),0x6fc0ff);
    }
  } else if(boxStart){
    const x=Math.min(boxStart.x,e.clientX),y=Math.min(boxStart.y,e.clientY);
    boxEl.style.display='block'; boxEl.style.left=x+'px'; boxEl.style.top=y+'px';
    boxEl.style.width=Math.abs(e.clientX-boxStart.x)+'px'; boxEl.style.height=Math.abs(e.clientY-boxStart.y)+'px';
  }
});
window.addEventListener('mouseup',e=>{
  orbiting=null; panning=null;
  if(e.button!==0)return;
  hideDragArrow(); boxEl.style.display='none';
  if(gameOver){dragFrom=null;boxStart=null;unitDrag=null;dragLead=null;return;}
  if(unitDrag){ // только корабли (расстановка в сетку вокруг точки)
    const arr=[...selectedUnits], n=arr.length;
    const gp=waterPoint(e.clientX,e.clientY);
    if(MP.guest){ // гость → команда движения кораблей хосту (по id зеркал)
      const ids=arr.filter(u=>u._mpid!=null).map(u=>u._mpid);
      if(gp&&ids.length)MP.cmd({cmd:'shipmove',ids,x:+gp.x.toFixed(2),z:+gp.z.toFixed(2)});
      unitDrag=null; dragLead=null; return;
    }
    const cols=Math.ceil(Math.sqrt(n)), gapU=2.2;
    if(gp)arr.forEach((u,i)=>{
      const cx=(i%cols)-(cols-1)/2, cz=Math.floor(i/cols)-(Math.ceil(n/cols)-1)/2;
      let tx=gp.x+cx*gapU, tz=gp.z+cz*gapU;
      if(!isWaterAt(tx,tz)){const w=nearestWaterPoint(tx,tz);tx=w.x;tz=w.z;}
      u.setTarget(tx,tz);
    });
    unitDrag=null; dragLead=null; return;
  }
  if(dragFrom){
    const t=pickCity(e.clientX,e.clientY);
    if(dragFrom.isAirport&&dragMoved){ // аэропорт командует авиацией (приказ на цель)
      const gp=groundPoint(e.clientX,e.clientY);
      setAirOrder(dragFrom, t, gp?gp.x:dragFrom.gx, gp?gp.z:dragFrom.gz);
    }
    else if(dragMoved&&t&&t!==dragFrom){ for(const s of dragSources()) if(s!==t) sendUnits(s,t); }  // протащил на город → отправка из ВСЕХ выбранных
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
      // массовый выбор кораблей в рамке (авиация не выбирается — командуется из аэропорта)
      let pickedUnit=false;
      const shipList = MP.guest ? [...MP.ghosts.values()].filter(g=>g.kind===1) : ships;
      for(const u of shipList){ if(u.owner!==OWNER.PLAYER)continue;
        if(inBox(u.pos.x,WATER_Y_SHIP+0.2,u.pos.z)){selectedUnits.add(u);pickedUnit=true;} }
      if(pickedUnit){selectedSet.clear();clearSel();} // если в рамке юниты — города не выбираем
    }
    boxStart=null; updatePanel();
  }
});
renderer.domElement.addEventListener('wheel',e=>{
  e.preventDefault();
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
},{passive:false});
const keysDown=new Set();
window.addEventListener('keydown',e=>{
  if(document.activeElement&&document.activeElement.tagName==='INPUT')return;
  keysDown.add(e.code);
  if(e.key==='r'||e.key==='R'){openCountryPick();return;}  // рестарт → снова выбор страны
  if(e.code==='KeyT'){techWinOpen?closeTech():openTech();return;}
  if(e.code==='KeyP'){polWinOpen?closePol():openPol();return;}
  if(e.code==='KeyH'){const o=document.getElementById('heroWin').style.display==='flex';o?closeHeroPick():openHeroPick();return;}
  if(e.code==='Escape'){if(techWinOpen)closeTech();if(diploTarget!=null)closeDiplo();if(polWinOpen)closePol();closeHeroPick();return;}
  if(e.code==='Home'){target.set(GRID/2,2,GRID/2);orbit.r=240;applyCam();return;}
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
  if(!dx&&!dz&&!rot)return;
  if(rot){orbit.theta+=rot*1.8*dt;}
  if(dx||dz){
    const sp=orbit.r*0.9*dt;
    const {fwd,right}=camAxes();
    target.x+=(dx*right.x+dz*fwd.x)*sp;
    target.z+=(dx*right.z+dz*fwd.z)*sp;
    clampTarget();
  }
  applyCam();
}

