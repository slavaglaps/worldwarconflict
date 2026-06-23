/* ── squads: рой мини-юнитов, число кружочков ∝ размеру армии ── */
const UNIT_GEO=new T3.SphereGeometry(0.12,8,7);
// сколько видимых юнитов на армию данного размера
function unitsForCount(n){ return Math.max(1,Math.min(18,Math.round(n/6)+1)); }
/* Squad — в серверном Sim (отряды рендерятся призраками-роями, см. ghostSwarm в loop.js) */

/* ── корабли: свободное движение по воде + морской бой ──────── */
function nearestWaterTile(gx,gz){
  for(let r=1;r<=6;r++)for(let dx=-r;dx<=r;dx++)for(let dz=-r;dz<=r;dz++){
    if(Math.max(Math.abs(dx),Math.abs(dz))!==r)continue;
    const x=gx+dx,z=gz+dz,t=tiles[x]?.[z];
    if(t&&t.isWater)return {x,z};
  }
  return {x:gx-2,z:gz};
}
function isWaterAt(x,z){const t=tiles[Math.round(x)]?.[Math.round(z)];return !t||t.isWater;}
function nearestWaterPoint(x,z){
  if(isWaterAt(x,z))return {x,z};
  for(let r=1;r<=6;r++)for(let dx=-r;dx<=r;dx++)for(let dz=-r;dz<=r;dz++){
    if(Math.max(Math.abs(dx),Math.abs(dz))!==r)continue;
    if(isWaterAt(x+dx,z+dz))return {x:x+dx,z:z+dz};
  }
  return {x,z};
}

/* ── поиск морского пути (A* по водным тайлам, обход суши) ──── */
class MinHeap{
  constructor(){this.a=[];}
  get size(){return this.a.length;}
  push(key,f){const a=this.a;a.push({key,f});let i=a.length-1;
    while(i>0){const p=(i-1)>>1;if(a[p].f<=a[i].f)break;const t=a[p];a[p]=a[i];a[i]=t;i=p;}}
  pop(){const a=this.a,top=a[0],last=a.pop();
    if(a.length){a[0]=last;let i=0;const n=a.length;
      for(;;){let l=2*i+1,r=l+1,s=i;
        if(l<n&&a[l].f<a[s].f)s=l;if(r<n&&a[r].f<a[s].f)s=r;
        if(s===i)break;const t=a[s];a[s]=a[i];a[i]=t;i=s;}}
    return top.key;}
}
const _waterTile=(x,z)=>{const t=tiles[x]?.[z];return !!(t&&t.isWater);}; // строго в границах
const _coast=(x,z)=>{ // вода у берега: есть несухой сосед (или край карты)
  for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++){if(!a&&!b)continue;if(!_waterTile(x+a,z+b))return true;}
  return false;
};
// «водная видимость» отрезка с зазором margin от берега (перпендикулярные пробы)
function waterClear(x0,z0,x1,z1,margin){
  const dx=x1-x0, dz=z1-z0, L=Math.hypot(dx,dz);
  const steps=Math.ceil(L*2.5)+1;
  let px=0,pz=0;
  if(L>1e-6){ px=-dz/L*margin; pz=dx/L*margin; }
  for(let i=0;i<=steps;i++){const t=i/steps, x=x0+dx*t, z=z0+dz*t;
    if(!isWaterAt(x,z))return false;
    if(margin>0 && (!isWaterAt(x+px,z+pz)||!isWaterAt(x-px,z-pz)))return false;
  }
  return true;
}
function waterLineClear(x0,z0,x1,z1){return waterClear(x0,z0,x1,z1,0);}
// сглаживание грид-пути в редкие прямые сегменты (с зазором от берега)
function smoothWaterPath(cells){
  if(cells.length<=2)return cells.map(c=>({x:c.x,z:c.z}));
  const out=[{x:cells[0].x,z:cells[0].z}];
  let i=0;
  while(i<cells.length-1){
    let j=cells.length-1;
    while(j>i+1 && !waterClear(cells[i].x,cells[i].z,cells[j].x,cells[j].z,0.85))j--;
    out.push({x:cells[j].x,z:cells[j].z});
    i=j;
  }
  return out;
}
// путь от (sx,sz) к (tx,tz) по воде; null если не найден (тогда зовущий идёт прямо)
function findWaterPath(sx,sz,tx,tz){
  const cl=(v)=>Math.max(0,Math.min(GRID-1,Math.round(v)));
  const start=nearestWaterPoint(cl(sx),cl(sz));
  const goal =nearestWaterPoint(cl(tx),cl(tz));
  if(!_waterTile(start.x,start.z)||!_waterTile(goal.x,goal.z))return null;
  const sKey=start.x*512+start.z, gKey=goal.x*512+goal.z;
  if(sKey===gKey)return [{x:tx,z:tz}];
  // уже видно цель напрямую по воде (с зазором) — путь не нужен
  if(waterClear(sx,sz,tx,tz,0.85))return [{x:tx,z:tz}];
  const open=new MinHeap(), came=new Map(), g=new Map();
  g.set(sKey,0);
  open.push(sKey, Math.hypot(goal.x-start.x,goal.z-start.z));
  const dirs=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  let found=false, exp=0; const MAXEXP=40000;
  while(open.size && exp<MAXEXP){
    const cur=open.pop();
    if(cur===gKey){found=true;break;}
    exp++;
    const cx=Math.floor(cur/512), cz=cur%512, cg=g.get(cur);
    if(cg===undefined)continue;
    for(const d of dirs){
      const nx=cx+d[0], nz=cz+d[1];
      if(!_waterTile(nx,nz))continue;
      if(d[0]&&d[1]&&(!_waterTile(cx+d[0],cz)||!_waterTile(cx,cz+d[1])))continue; // не срезаем угол суши
      // штраф за прибрежные тайлы → держимся глубокой воды (но проливы остаются проходимы)
      const nk=nx*512+nz, ng=cg+((d[0]&&d[1])?1.41421356:1)+(_coast(nx,nz)?0.9:0);
      if(ng<(g.get(nk)??Infinity)){
        g.set(nk,ng); came.set(nk,cur);
        open.push(nk, ng+Math.hypot(goal.x-nx,goal.z-nz));
      }
    }
  }
  if(!found)return null;
  const cells=[]; let c=gKey;
  while(c!==sKey){cells.push({x:Math.floor(c/512), z:c%512}); c=came.get(c); if(c===undefined)break;}
  cells.push({x:start.x,z:start.z}); cells.reverse();
  const pts=smoothWaterPath(cells);
  if(pts.length>1)pts.shift();              // первая точка = старт, убираем
  pts[pts.length-1]={x:tx,z:tz};            // финал — точная запрошенная точка (она на воде)
  return pts;
}

/* Ship + spawnShip — в серверном Sim */
class Missile{
  constructor(owner,from,tgt){
    this.owner=owner; this.tgt=tgt; this.t=0;
    this.sx=from.x; this.sz=from.z; this.sy=WATER_Y_SHIP+0.6;
    this.tx=tgt.x; this.tz=tgt.z;
    this.ty=getTerrainHeight(tgt.x,tgt.z)+0.3;
    const dist=Math.hypot(this.tx-this.sx,this.tz-this.sz);
    this.dur=0.5+dist*0.06; this.arc=2+dist*0.25;
    const m=new T3.MeshBasicMaterial({color:0x2a2f38});
    this.mesh=new T3.Mesh(new T3.ConeGeometry(0.12,0.55,7),m); scene.add(this.mesh);
    this.prev=new T3.Vector3(this.sx,this.sy,this.sz);
    this.dud = tgt.kind==='city' && aaIntercepts(tgt.ref,owner); this.dudAt=0.45+Math.random()*0.3; // ПВО цели может сбить
  }
  update(dt){
    this.t+=dt; const f=Math.min(1,this.t/this.dur);
    const x=this.sx+(this.tx-this.sx)*f, z=this.sz+(this.tz-this.sz)*f;
    const y=this.sy+(this.ty-this.sy)*f+this.arc*Math.sin(f*Math.PI);
    this.mesh.position.set(x,y,z);
    if(this.dud&&f>=this.dudAt){ aaInterceptFX(x,y,z); scene.remove(this.mesh); return true; } // сбита зениткой
    // нос по направлению полёта
    const d=new T3.Vector3(x-this.prev.x,y-this.prev.y,z-this.prev.z);
    if(d.lengthSq()>1e-6){d.normalize();this.mesh.quaternion.setFromUnitVectors(new T3.Vector3(0,1,0),d);}
    this.prev.set(x,y,z);
    if(f>=1){ this.impact(); return true; }
    return false;
  }
  impact(){
    const t=this.tgt;
    if(t.kind==='city'){ const c=t.ref; if(atWar(this.owner,c.owner)){ c.units=Math.max(1,c.units-SHIP_MISSILE_DMG); suppressAA(c); } }
    else if(t.kind==='squad'){ const s=t.ref; if(squads.includes(s)&&atWar(this.owner,s.owner))s.fcount-=SHIP_MISSILE_DMG; }
    spawnBlast(this.tx,this.ty,this.tz);
    scene.remove(this.mesh);
  }
}
function fireMissile(ship,tgt){ missiles.push(new Missile(ship.owner,ship.pos,tgt)); spawnMuzzle(ship); }
function spawnBlast(x,y,z){
  const m=new T3.Mesh(new T3.SphereGeometry(0.3,10,8),new T3.MeshBasicMaterial({color:0xffb24a,transparent:true,opacity:.9}));
  m.position.set(x,y+0.3,z); scene.add(m); fx.push({mesh:m,life:0.35,max:0.35,grow:6});
}
function spawnMuzzle(ship){
  const m=new T3.Mesh(new T3.SphereGeometry(0.25,8,6),new T3.MeshBasicMaterial({color:0xfff0c0,transparent:true,opacity:.9}));
  m.position.set(ship.pos.x,WATER_Y_SHIP+0.6,ship.pos.z); scene.add(m); fx.push({mesh:m,life:0.18,max:0.18,grow:3});
}
function updateMissiles(dt){
  for(let i=missiles.length-1;i>=0;i--)if(missiles[i].update(dt))missiles.splice(i,1);
  for(let i=fx.length-1;i>=0;i--){const e=fx[i];e.life-=dt;
    const k=1-e.life/e.max; e.mesh.scale.setScalar(1+k*e.grow); e.mesh.material.opacity=Math.max(0,e.life/e.max*0.9);
    if(e.life<=0){scene.remove(e.mesh);fx.splice(i,1);}}
}

/* ── ⚔ обстрел из города: башня atk-города бьёт по врагам в радиусе ── */
class TowerShot{
  constructor(owner,from,tgt){
    this.owner=owner; this.tgt=tgt; this.t=0;
    this.sx=from.x; this.sy=from.y; this.sz=from.z;
    this.tx=tgt.x; this.ty=tgt.y; this.tz=tgt.z;
    const dist=Math.hypot(this.tx-this.sx,this.tz-this.sz);
    this.dur=0.16+dist*0.025; this.arc=0.6+dist*0.1;
    this.mesh=new T3.Mesh(new T3.SphereGeometry(0.16,8,6),new T3.MeshBasicMaterial({color:0x33291f}));
    scene.add(this.mesh);
    this.dud = tgt.kind==='city' && aaIntercepts(tgt.ref,owner); this.dudAt=0.45+Math.random()*0.3; // ПВО города-цели может сбить
  }
  update(dt){
    this.t+=dt; const f=Math.min(1,this.t/this.dur);
    const x=this.sx+(this.tx-this.sx)*f, z=this.sz+(this.tz-this.sz)*f;
    const y=this.sy+(this.ty-this.sy)*f+this.arc*Math.sin(f*Math.PI);
    this.mesh.position.set(x,y,z);
    if(this.dud&&f>=this.dudAt){ aaInterceptFX(x,y,z); scene.remove(this.mesh); return true; } // сбита зениткой
    if(f>=1){ this.impact(); return true; }
    return false;
  }
  impact(){
    const t=this.tgt, s=t.ref;
    if(t.kind==='squad'){ if(squads.includes(s)&&atWar(this.owner,s.owner))s.fcount-=t.dmg; }
    else if(t.kind==='ship'){ if(ships.includes(s)&&atWar(this.owner,s.owner))s.hp-=t.dmg; }
    else if(t.kind==='plane'){ if(planes.includes(s)&&atWar(this.owner,s.owner))s.hp-=t.dmg; }
    else if(t.kind==='city'){ if(cities.includes(s)&&s.owner!==this.owner&&atWar(this.owner,s.owner)){ s.units=Math.max(1,s.units-t.dmg); suppressAA(s); } }
    spawnBlast(this.tx,this.ty,this.tz);
    scene.remove(this.mesh);
  }
}
/* cityTowers (урон) — в серверном Sim; клиент рисует трассеры в cityTowersFX (ниже, dmg:0) */

// ВИЗУАЛ для онлайн-гостя: сим заморожен, поэтому atk-города сами не «стреляли» на экране.
// Здесь пускаем ТОЛЬКО трассеры (kind:'none', dmg:0 → без урона; урон считает сервер) по тем же целям:
// ближайший мобильный враг + осадный обстрел ближайшего вражеского города в радиусе.
function cityTowersFX(dt){
  for(const c of cities){
    const range=c.fireRange; if(range<=0)continue;
    c._fxT=(c._fxT||0)+dt; if(c._fxT<TOWER_FIRE_CD)continue; c._fxT=0;
    const fromY=c.baseY+(c.topY||0.6)*CITY_SCALE+0.3, from={x:c.gx,y:fromY,z:c.gz};
    const shot=(x,z,y)=>missiles.push(new TowerShot(c.owner,from,{kind:'none',ref:null,x,y,z,dmg:0}));
    // ближайший мобильный враг (армия/корабль/самолёт)
    let mx=null,mz=null,my=null,bd=range*range;
    for(const s of squads){ if(s.fcount<0.5||!atWar(c.owner,s.owner))continue; const dx=c.gx-s.pos.x,dz=c.gz-s.pos.z,dd=dx*dx+dz*dz; if(dd<bd){bd=dd;mx=s.pos.x;mz=s.pos.z;my=getTerrainHeight(s.pos.x,s.pos.z)+0.3;} }
    for(const s of ships){ if(s.hp<=0||!atWar(c.owner,s.owner))continue; const dx=c.gx-s.pos.x,dz=c.gz-s.pos.z,dd=dx*dx+dz*dz; if(dd<bd){bd=dd;mx=s.pos.x;mz=s.pos.z;my=WATER_Y_SHIP+0.2;} }
    for(const s of planes){ if(s.hp<=0||!atWar(c.owner,s.owner))continue; const dx=c.gx-s.pos.x,dz=c.gz-s.pos.z,dd=dx*dx+dz*dz; if(dd<bd){bd=dd;mx=s.pos.x;mz=s.pos.z;my=PLANE_ALT;} }
    if(mx!==null)shot(mx,mz,my);
    // осадный обстрел ближайшего вражеского города
    const R=Math.max(range,CITY_BOMBARD_RANGE); let cx=null,cz=null,cb=R*R;
    for(const o of cities){ if(o===c||o.owner===c.owner||!atWar(c.owner,o.owner))continue; const dx=c.gx-o.gx,dz=c.gz-o.gz,dd=dx*dx+dz*dz; if(dd<cb){cb=dd;cx=o.gx;cz=o.gz;} }
    if(cx!==null)shot(cx,cz,getTerrainHeight(cx,cz)+0.3);
  }
}

// 🚀 ВИЗУАЛ обстрела берега кораблём: урон считает Sim (сервер/локальный), здесь ТОЛЬКО
// трассер+вспышка (kind:'none', dmg:0) по той же цели, что и Sim.shipBombard:
// ближайший вражеский город/отряд в радиусе SHIP_ATTACK_RANGE×sr, корабль с tech shipMissile.
// Каденс зеркалит сим (таймер сбрасываем только при наличии цели, как fireTimer на сервере).
function shipBombardFX(dt){
  for(const s of ships){
    if(s.hp<=0||!techFlag(s.owner,'shipMissile'))continue;
    s._fxT=(s._fxT||0)+dt; if(s._fxT<SHIP_FIRE_CD)continue;
    const R=SHIP_ATTACK_RANGE*techVal(s.owner,'sr'), R2=R*R;
    let tx=null,tz=null,ty=null,bd=R2;
    for(const c of cities){ if(c.owner===s.owner||!atWar(s.owner,c.owner))continue; const dx=s.pos.x-c.gx,dz=s.pos.z-c.gz,dd=dx*dx+dz*dz; if(dd<bd){bd=dd;tx=c.gx;tz=c.gz;ty=getTerrainHeight(c.gx,c.gz)+0.3;} }
    for(const q of squads){ if(q.fcount<0.5||!atWar(s.owner,q.owner))continue; const dx=s.pos.x-q.pos.x,dz=s.pos.z-q.pos.z,dd=dx*dx+dz*dz; if(dd<bd){bd=dd;tx=q.pos.x;tz=q.pos.z;ty=getTerrainHeight(q.pos.x,q.pos.z)+0.3;} }
    if(tx===null)continue; s._fxT=0;
    const from={x:s.pos.x,y:WATER_Y_SHIP+0.6,z:s.pos.z};
    missiles.push(new TowerShot(s.owner,from,{kind:'none',ref:null,x:tx,y:ty,z:tz,dmg:0}));
    spawnMuzzle(s);
  }
}
/* ── авиабомба: падает с самолёта на город ──────────────────── */
class Bomb{
  constructor(owner,from,city){
    this.owner=owner; this.city=city; this.t=0;
    this.sx=from.x; this.sy=from.y; this.sz=from.z;
    this.tx=city.gx+(Math.random()-0.5)*0.9; this.tz=city.gz+(Math.random()-0.5)*0.9;
    this.ty=getTerrainHeight(this.tx,this.tz)+0.15;
    this.dur=0.5;
    this.mesh=new T3.Mesh(new T3.SphereGeometry(0.13,8,6),new T3.MeshBasicMaterial({color:0x23262b}));
    scene.add(this.mesh);
    // бомбы НЕ перехватываются ПВО — самолёт пробивает оборону и выбивает зенитки (suppressAA в impact)
  }
  update(dt){
    this.t+=dt; const f=Math.min(1,this.t/this.dur);
    const x=this.sx+(this.tx-this.sx)*f, z=this.sz+(this.tz-this.sz)*f;
    const y=this.sy+(this.ty-this.sy)*(f*f); // ускоряющееся падение
    this.mesh.position.set(x,y,z);
    if(f>=1){ this.impact(); return true; }
    return false;
  }
  impact(){
    const c=this.city;
    if(c&&cities.includes(c)&&atWar(this.owner,c.owner)){ c.units=Math.max(1,c.units-PLANE_BOMB_DMG*techVal(this.owner,'bd')); suppressAA(c); } // ×тех «урон бомб» + выбивает зенитки
    spawnBlast(this.tx,this.ty,this.tz);
    scene.remove(this.mesh);
  }
}
function dropBomb(plane,city){ missiles.push(new Bomb(plane.owner,plane.pos,city)); }

/* ── авиация командуется из аэропорта (приказ на город), а не выбором ── */
function angDiff(a,b){let d=a-b;while(d>Math.PI)d-=2*Math.PI;while(d<-Math.PI)d+=2*Math.PI;return d;}
function nearestAirport(owner){ return cities.find(c=>c.owner===owner&&c.isAirport)||cities.find(c=>c.owner===owner)||null; }
function setAirOrder(fromAirport,toCity,gx,gz,actor){
  if(MP.guest){ MP.cmd({cmd:'airorder',fromIdx:fromAirport.idx,cityIdx:toCity?toCity.idx:-1,x:+gx.toFixed(2),z:+gz.toFixed(2)}); return; }
  const a=actor==null?PLAYER:actor, P=a===PLAYER;
  if(toCity&&toCity!==fromAirport&&toCity.owner!==a&&atWar(a,toCity.owner)){
    airOrder[a]={kind:'bomb',city:toCity,x:toCity.gx,z:toCity.gz};
    if(P)toast(`✈ Бомбардировка: ${CITY_NAMES[toCity.idx]}`+(techFlag(a,'planeBomb')?'':' — откройте «Бомбардировка» 🔬'));
  } else if(toCity===fromAirport){ airOrder[a]=null; if(P)toast('✈ Авиация отозвана на базу'); }
  else { airOrder[a]={kind:'patrol',x:gx,z:gz}; if(P)toast('✈ Патруль/прикрытие'); }
}
function recallAir(){ if(MP.guest){ MP.cmd({cmd:'airorder',recall:true}); return; } if(!airOrder[PLAYER])return; airOrder[PLAYER]=null; toast('✈ Авиация отозвана на базу'); if(typeof updatePanel==='function')updatePanel(); }
// краткое описание текущего приказа авиации (для кнопки/статуса)
function airOrderLabel(){
  const o=airOrder[PLAYER]; if(!o)return '';
  if(o.kind==='bomb')return o.city?`бомбит ${CITY_NAMES[o.city.idx]}`:'бомбардировка';
  if(o.kind==='patrol')return 'патруль';
  return '';
}
/* Plane + spawnPlane — в серверном Sim (юниты рендерятся призраками) */
/* airBattles — в серверном Sim (воздушный бой считает серверный сим) */

