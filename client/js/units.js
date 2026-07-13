/* ── squads: рой мини-юнитов, число фигурок ∝ размеру армии ── */
const UNIT_FALLBACK_GEO=new T3.SphereGeometry(0.12,8,7);
const UNIT_GEO=UNIT_FALLBACK_GEO; // fallback, пока KayKit-модели не загрузились
const UNIT_ASSET={
  blue:'assets/hex-kit/units/blue/unit_blue_accent.gltf',
  red:'assets/hex-kit/units/red/unit_red_accent.gltf',
  green:'assets/hex-kit/units/green/unit_green_accent.gltf',
  yellow:'assets/hex-kit/units/yellow/unit_yellow_accent.gltf',
  neutral:'assets/hex-kit/units/neutral/unit.gltf',
  // 👥 модели типов из KayKit EXTRA: лошадь (конница) и лук (лучники), по цветам фракций
  'horse:blue':'assets/hex-kit/units/blue/horse_blue_accent.gltf',
  'horse:red':'assets/hex-kit/units/red/horse_red_accent.gltf',
  'horse:green':'assets/hex-kit/units/green/horse_green_accent.gltf',
  'horse:yellow':'assets/hex-kit/units/yellow/horse_yellow_accent.gltf',
  'horse:neutral':'assets/hex-kit/units/neutral/horse_A.gltf',
  'bow:blue':'assets/hex-kit/units/blue/bow_blue_accent.gltf',
  'bow:red':'assets/hex-kit/units/red/bow_red_accent.gltf',
  'bow:green':'assets/hex-kit/units/green/bow_green_accent.gltf',
  'bow:yellow':'assets/hex-kit/units/yellow/bow_yellow_accent.gltf',
  'bow:neutral':'assets/hex-kit/units/neutral/bow.gltf',
  // ⚔ экипировка из пака: шлем/меч/щит (пехота и конница)
  'sword:blue':'assets/hex-kit/units/blue/sword_blue_accent.gltf',
  'sword:red':'assets/hex-kit/units/red/sword_red_accent.gltf',
  'sword:green':'assets/hex-kit/units/green/sword_green_accent.gltf',
  'sword:yellow':'assets/hex-kit/units/yellow/sword_yellow_accent.gltf',
  'sword:neutral':'assets/hex-kit/units/neutral/sword.gltf',
  'shield:blue':'assets/hex-kit/units/blue/shield_blue_accent.gltf',
  'shield:red':'assets/hex-kit/units/red/shield_red_accent.gltf',
  'shield:green':'assets/hex-kit/units/green/shield_green_accent.gltf',
  'shield:yellow':'assets/hex-kit/units/yellow/shield_yellow_accent.gltf',
  'shield:neutral':'assets/hex-kit/units/neutral/shield.gltf',
  'helmet:blue':'assets/hex-kit/units/blue/helmet_blue_accent.gltf',
  'helmet:red':'assets/hex-kit/units/red/helmet_red_accent.gltf',
  'helmet:green':'assets/hex-kit/units/green/helmet_green_accent.gltf',
  'helmet:yellow':'assets/hex-kit/units/yellow/helmet_yellow_accent.gltf',
  'helmet:neutral':'assets/hex-kit/units/neutral/helmet.gltf',
};
const UNIT_PALETTE=[
  {key:'blue',color:new T3.Color(0x3f6fc8)},
  {key:'red',color:new T3.Color(0xc14a3a)},
  {key:'green',color:new T3.Color(0x3f9e7e)},
  {key:'yellow',color:new T3.Color(0xcaa233)},
];
const UNIT_MODEL_SCALE=0.581;   // 0.3875 ×1.5 — модельки крупнее на 50%
const unitModelCache={};
let unitModelPromise=null;
function unitKeyForOwner(owner){
  const hex=OWNER_COL&&OWNER_COL[owner]!=null?OWNER_COL[owner]:null;
  if(hex==null)return 'neutral';
  const c=new T3.Color(hex);
  const spread=Math.max(c.r,c.g,c.b)-Math.min(c.r,c.g,c.b);
  if(spread<0.12)return 'neutral';
  let best=UNIT_PALETTE[0].key, bd=Infinity;
  for(const p of UNIT_PALETTE){
    const dr=c.r-p.color.r, dg=c.g-p.color.g, db=c.b-p.color.b;
    const d=dr*dr+dg*dg+db*db;
    if(d<bd){bd=d;best=p.key;}
  }
  return best;
}
function prepareUnitModel(root){
  root.traverse(o=>{
    if(!o.isMesh)return;
    o.castShadow=false; o.receiveShadow=true; o.userData.perfGroup='units';
    if(o.material){
      o.material=o.material.clone();
      o.material.metalness=0;
      o.material.roughness=0.82;
    }
  });
  return root;
}
function ensureUnitModels(){
  if(unitModelPromise)return unitModelPromise;
  if(!T3.GLTFLoader)return Promise.resolve(unitModelCache);
  const loader=new T3.GLTFLoader();
  const jobs=Object.entries(UNIT_ASSET).map(([key,path])=>new Promise(res=>{
    loader.load(path,gltf=>{unitModelCache[key]=prepareUnitModel(gltf.scene);res();},
      undefined,err=>{console.warn('[unit] model skipped:',key,err);res();});
  }));
  unitModelPromise=Promise.all(jobs).then(()=>unitModelCache);
  return unitModelPromise;
}
function unitBatchSource(owner){
  const key=unitKeyForOwner(owner);
  const root=unitModelCache[key]||unitModelCache.neutral;
  if(!root)return null;
  root.updateWorldMatrix&&root.updateWorldMatrix(true,true);
  let mesh=null;
  root.traverse(o=>{if(!mesh&&o.isMesh)mesh=o;});
  if(!mesh)return null;
  return {
    key,
    geo:mesh.geometry,
    mat:mesh.material,
    local:mesh.matrixWorld?mesh.matrixWorld.clone():new T3.Matrix4(),
    scale:UNIT_MODEL_SCALE,
  };
}
ensureUnitModels();

/* ── 👥 типизированные модели юнитов: пехота (пешка) / лучник (пешка+лук) / конница (пешка на коне) ──
   Отдельных ассетов нет — аксессуары примитивами МЕРДЖАТСЯ с пешкой в одну геометрию
   (материалы массивом + groups → один InstancedMesh на тип). local впечатан в геометрию. */
function _mergeGeoParts(parts){   // parts: [{geo, matrix, tint?}] — тинт впечатывается ВЕРШИННЫМИ ЦВЕТАМИ (один материал, без групп)
  let vtx=0, idx=0;
  for(const p of parts){ vtx+=p.geo.attributes.position.count; idx+=(p.geo.index?p.geo.index.count:p.geo.attributes.position.count); }
  const pos=new Float32Array(vtx*3), nor=new Float32Array(vtx*3), uv=new Float32Array(vtx*2), col=new Float32Array(vtx*3);
  const index=vtx>65535?new Uint32Array(idx):new Uint16Array(idx);
  const out=new T3.BufferGeometry();
  let vo=0, io=0; const v=new T3.Vector3(), nm=new T3.Matrix3();
  for(const p of parts){
    const g=p.geo, pa=g.attributes.position, na=g.attributes.normal, ua=g.attributes.uv;
    const tr=p.tint?p.tint.r:1, tg=p.tint?p.tint.g:1, tb=p.tint?p.tint.b:1;
    nm.getNormalMatrix(p.matrix);
    for(let i=0;i<pa.count;i++){
      v.set(pa.getX(i),pa.getY(i),pa.getZ(i)).applyMatrix4(p.matrix);
      pos[(vo+i)*3]=v.x; pos[(vo+i)*3+1]=v.y; pos[(vo+i)*3+2]=v.z;
      if(na)v.set(na.getX(i),na.getY(i),na.getZ(i)).applyMatrix3(nm).normalize(); else v.set(0,1,0);
      nor[(vo+i)*3]=v.x; nor[(vo+i)*3+1]=v.y; nor[(vo+i)*3+2]=v.z;
      if(ua){ uv[(vo+i)*2]=ua.getX(i); uv[(vo+i)*2+1]=ua.getY(i); }
      col[(vo+i)*3]=tr; col[(vo+i)*3+1]=tg; col[(vo+i)*3+2]=tb;
    }
    if(g.index){ const ia=g.index; for(let i=0;i<ia.count;i++)index[io++]=ia.getX(i)+vo; }
    else for(let i=0;i<pa.count;i++)index[io++]=i+vo;
    vo+=pa.count;
  }
  out.setAttribute('position',new T3.BufferAttribute(pos,3));
  out.setAttribute('normal',new T3.BufferAttribute(nor,3));
  out.setAttribute('uv',new T3.BufferAttribute(uv,2));
  out.setAttribute('color',new T3.BufferAttribute(col,3));
  out.setIndex(new T3.BufferAttribute(index,1));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}
const _typedCache={};
// первый меш модели из кэша + его worldMatrix
function _modelPart(key){
  const root=unitModelCache[key]; if(!root)return null;
  root.updateWorldMatrix&&root.updateWorldMatrix(true,true);
  let mesh=null; root.traverse(o=>{if(!mesh&&o.isMesh)mesh=o;});
  if(!mesh)return null;
  return {geo:mesh.geometry, mat:mesh.material, local:mesh.matrixWorld.clone()};
}
// нормализация: низ модели → y=0, центр XZ → 0; возвращает матрицу и габариты
function _partNorm(key){
  const p=_modelPart(key); if(!p)return null;
  const g=p.geo; if(!g.boundingBox)g.computeBoundingBox();
  const bb=g.boundingBox, v=new T3.Vector3();
  const min=new T3.Vector3(Infinity,Infinity,Infinity), max=new T3.Vector3(-Infinity,-Infinity,-Infinity);
  for(const cx of [bb.min.x,bb.max.x])for(const cy of [bb.min.y,bb.max.y])for(const cz of [bb.min.z,bb.max.z]){
    v.set(cx,cy,cz).applyMatrix4(p.local); min.min(v); max.max(v); }
  const norm=new T3.Matrix4().makeTranslation(-(min.x+max.x)/2,-min.y,-(min.z+max.z)/2).multiply(p.local);
  return {geo:p.geo, mat:p.mat, norm, size:new T3.Vector3(max.x-min.x,max.y-min.y,max.z-min.z)};
}
// ⚙️ раскладка экипировки (лок. оси юнита: «перёд»=+X, правая рука=+Z, левая=−Z; H=рост пешки, W=ширина).
//    Части пака смоделированы 1:1 под пешку → s=1 это НАТИВНЫЙ масштаб (не пересчитываем под габарит).
//    Щит в пак-осях: плоскость X-Y, норма ±Z → на левом боку лежит лицом наружу без разворота.
//    Live-тюнинг: window.__unitTune={sword:{...}} → window.__rebuildTypedUnits().
// раскладка подобрана вручную в unit-viewer.html (правки → «Копировать JSON» → вставлены сюда).
// Оси детали: X — вперёд, Y — вверх, Z — вбок; s — масштаб; rx/ry/rz — поворот (рад); у всадника lift/fwd — посадка.
const UNIT_EQUIP={
  helmet:  {s:1.11, x:-0.02, y:0.74, z:0.02, rx:0,    rz:-0.05, ry:1.5},     // шлем на голове
  sword:   {s:1.7,  x:-0.12, y:0.16, z:0.58, rz:-0.55, rx:0.15, ry:-0.15},   // меч в правой руке
  shield:  {s:1.62, x:0.38,  y:0.02, z:-0.46, rz:0.05, ry:2.25, rx:-0.05},   // щит на левой руке
  bow:     {s:1.76, x:0.34,  y:0.1,  z:-1.3, ry:1.571, rx:1},                // лук в левой руке
  rider:   {s:1.09, lift:0.69, fwd:-0.07},                                   // посадка всадника в седло
  swordCav:{s:1.68, x:-0.06, y:0.26, z:0.48, rz:-0.75, rx:0.15, ry:-0.2},    // меч всадника
  shieldCav:{s:1.41, x:0.12, y:-0.16, z:-0.7, rz:0,   ry:2.6},               // щит всадника
};
function _equip(part,cfg,H,W,dy,ds,dx){                        // ds: масштаб (конник 0.8), dy: подъём (седло), dx: сдвиг вперёд (посадка)
  const q=(typeof window!=='undefined'&&window.__unitTune&&window.__unitTune[cfg])||UNIT_EQUIP[cfg];
  const s=q.s*(ds||1);
  const m=new T3.Matrix4().makeScale(s,s,s).multiply(part.norm);
  if(q.ry)m.premultiply(new T3.Matrix4().makeRotationY(q.ry));
  if(q.rx)m.premultiply(new T3.Matrix4().makeRotationX(q.rx));
  if(q.rz)m.premultiply(new T3.Matrix4().makeRotationZ(q.rz));
  m.premultiply(new T3.Matrix4().makeTranslation((dx||0)+H*q.x*(ds||1), (dy||0)+H*q.y*(ds||1), W*q.z*(ds||1)));   // x,y в долях H; z (бок) в долях W
  return {geo:part.geo, matrix:m};
}
function unitTypedSource(owner,type){
  const base=unitBatchSource(owner); if(!base)return null;
  const t=(type==='arc'||type==='cav')?type:'inf';
  const ck=base.key+':'+t;
  if(_typedCache[ck])return _typedCache[ck];
  // тело: пешка с ВПЕЧАТАННЫМ local (низ у 0); аксессуары — ОТДЕЛЬНЫЙ InstancedMesh с теми же матрицами
  // (все части пака на одном атласе hexagons_medieval → один accMat на все аксессуары)
  const pawnM=base.local?base.local.clone():new T3.Matrix4();
  const bb=base.geo.boundingBox||(base.geo.computeBoundingBox(),base.geo.boundingBox);
  const bmin=bb.min.clone().applyMatrix4(pawnM), bmax=bb.max.clone().applyMatrix4(pawnM);
  const H=Math.abs(bmax.y-bmin.y)||1, W=Math.max(bmax.x-bmin.x,bmax.z-bmin.z)||H*0.5;
  const P=k=>_partNorm(k+':'+base.key)||_partNorm(k+':neutral');
  const helmet=P('helmet'), sword=P('sword'), shield=P('shield');
  let src=null, acc=[], accMat=null;
  const push=(part,cfg,dy,ds,dx)=>{ acc.push(_equip(part,cfg,H,W,dy,ds,dx)); accMat=accMat||part.mat; };
  if(t==='arc'){
    // 🏹 лук в ЛЕВОЙ руке, дугой вперёд (раньше висел сбоку и выглядел приклеенным)
    const bow=P('bow');
    if(bow)push(bow,'bow');
    src={body:[{geo:base.geo,matrix:pawnM}]};
  } else if(t==='cav'){
    // 🐎 пешка в седле + шлем/меч/щит на всаднике
    const horse=P('horse');
    if(horse){
      const rq=(typeof window!=='undefined'&&window.__unitTune&&window.__unitTune.rider)||UNIT_EQUIP.rider;
      const hm=new T3.Matrix4().makeRotationY(Math.PI/2).multiply(horse.norm);   // пак смотрит вдоль Z, юнит — +X
      const lift=horse.size.y*rq.lift, rs=rq.s, fwd=rq.fwd||0;
      const up=new T3.Matrix4().makeScale(rs,rs,rs).premultiply(new T3.Matrix4().makeTranslation(fwd,lift,0)).multiply(pawnM.clone());
      acc.push({geo:horse.geo,matrix:hm}); accMat=accMat||horse.mat;
      // всадник = пешка в седле: шлем на голове; меч/щит по cav-раскладке (у видимого торса, не режут лицо)
      if(helmet)push(helmet,'helmet',lift,rs,fwd);
      if(sword) push(sword,'swordCav',lift,rs,fwd);
      if(shield)push(shield,'shieldCav',lift,rs,fwd);
      src={body:[{geo:base.geo,matrix:up}]};
    }
  }
  if(!src){ // 🪖 пехота: шлем + меч (правая) + щит (левая)
    if(helmet)push(helmet,'helmet');
    if(sword) push(sword,'sword');
    if(shield)push(shield,'shield');
    src={body:[{geo:base.geo,matrix:pawnM}]};
  }
  src={key:ck, geo:_mergeGeoParts(src.body), mat:base.mat,
    accGeo:acc.length?_mergeGeoParts(acc):null, accMat:acc.length?accMat:null, local:null, scale:base.scale};
  _typedCache[ck]=src;
  return src;
}
// live-тюнинг раскладки: window.__unitTune={sword:{...}} → __rebuildTypedUnits() (хук вешает loop.js)
window.__clearTypedUnitCache=function(){ for(const k in _typedCache)delete _typedCache[k]; };

// 1 боец армии = 1 фигурка (как в Mushroom Wars). SWARM_MAX — perf-бэкстоп на гигантские армии.
const SWARM_MAX=90;
function unitsForCount(n){ return Math.max(1,Math.min(SWARM_MAX,Math.round(n))); }
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
// общие геометрии FX-пуфов (раньше new SphereGeometry на КАЖДЫЙ спавн → GPU-churn + утечка, т.к. при удалении не диспоузились).
//   Геометрия шареная (диспоузить нельзя); материал остаётся per-instance (opacity гаснет индивидуально в updateMissiles) и
//   диспоузится при удалении из пула (см. updateMissiles).
const FXGEO_BLAST=new T3.SphereGeometry(0.3,10,8), FXGEO_MUZZLE=new T3.SphereGeometry(0.25,8,6),
      FXGEO_DUST=new T3.SphereGeometry(0.11,6,5), FXGEO_SPARK=new T3.SphereGeometry(0.09,6,5), FXGEO_CLASHDUST=new T3.SphereGeometry(0.14,6,5);
function spawnBlast(x,y,z){
  const m=new T3.Mesh(FXGEO_BLAST,new T3.MeshBasicMaterial({color:0xffb24a,transparent:true,opacity:.9}));
  m.position.set(x,y+0.3,z); scene.add(m); fx.push({mesh:m,life:0.35,max:0.35,grow:6});
}
function spawnMuzzle(ship){
  const m=new T3.Mesh(FXGEO_MUZZLE,new T3.MeshBasicMaterial({color:0xfff0c0,transparent:true,opacity:.9}));
  m.position.set(ship.pos.x,WATER_Y_SHIP+0.6,ship.pos.z); scene.add(m); fx.push({mesh:m,life:0.18,max:0.18,grow:3});
}
// 🚶 пыль марша: тусклый пуф под бегущей колонной (реюз fx-пула updateMissiles)
function spawnMarchDust(x,y,z){
  const d=new T3.Mesh(FXGEO_DUST,new T3.MeshBasicMaterial({color:0xa6977c,transparent:true,opacity:.38}));
  d.position.set(x,y+0.06,z); scene.add(d); fx.push({mesh:d,life:0.45,max:0.45,grow:1.8});
}
// ⚔ искра сшибки в полевом бою: маленькая жёлтая вспышка + редкая пыль (дешёвая, реюз fx-пула updateMissiles)
function spawnClashFX(x,y,z){
  const m=new T3.Mesh(FXGEO_SPARK,new T3.MeshBasicMaterial({color:Math.random()<0.5?0xfff3c0:0xffd870,transparent:true,opacity:.95}));
  m.position.set(x,y+0.32+Math.random()*0.25,z); scene.add(m); fx.push({mesh:m,life:0.22,max:0.22,grow:2.2});
  if(Math.random()<0.45){ const d=new T3.Mesh(FXGEO_CLASHDUST,new T3.MeshBasicMaterial({color:0x9a8a70,transparent:true,opacity:.5}));
    d.position.set(x+(Math.random()-0.5)*0.3,y+0.12,z+(Math.random()-0.5)*0.3); scene.add(d); fx.push({mesh:d,life:0.5,max:0.5,grow:1.6}); }
}
// урон гхост-отряду в момент попадания трассера: наносим авторитетно в LOCALSIM (соло — сим только выбрал цель, урон за клиентом).
// remote-MP: LOCALSIM нет → урон считает сервер, здесь только косметический разлёт.
function applyGhostTowerHit(g,dmg){
  if(typeof LOCALSIM==='undefined'||!LOCALSIM||!LOCALSIM._clientTowerDmg)return;
  const id=g._mpid; if(typeof id!=='string'||id[0]!=='s'||id[1]!=='q')return;
  const sid=+id.slice(2); const sq=LOCALSIM.squads.find(s=>s&&s.id===sid);
  if(sq)sq.fcount=Math.max(0,sq.fcount-dmg);
}
// ⚔ урон башни по ОСАДНОМУ пулу (армия, штурмующая город, живёт в city.siege, а не в squads)
function applySiegeTowerHit(cityIdx,owner,dmg){
  if(typeof LOCALSIM==='undefined'||!LOCALSIM||!LOCALSIM._clientTowerDmg)return;
  const c=LOCALSIM.cities[cityIdx]; if(!c||!c.siege||!c.siege[owner])return;
  const p=c.siege[owner];
  p.units=Math.max(0,p.units-dmg);
  if(p.comp){ const s=(p.comp.inf||0)+(p.comp.arc||0)+(p.comp.cav||0);
    if(s>0){ const k=p.units/s; p.comp.inf*=k; p.comp.arc*=k; p.comp.cav*=k; } }
  if(p.units<((LOCALSIM.K&&LOCALSIM.K.SIEGE_POOL_MIN)||0.4))delete c.siege[owner];   // добитый пул снимается (как в симе)
}
// ⚔ РАЗЛЁТ юнитов от попадания: N юнит-осколков (N=урон) вылетают из точки удара, летят по баллисте, кувыркаются и тают.
const _scatter=[];
function spawnUnitScatter(x,y,z,n,ownerCol,fromX,fromZ){
  n=Math.max(1,Math.min(10,Math.round(n)));                                    // 4 урона → 4 осколка (кап 10)
  let ax=x-(fromX==null?x-1:fromX), az=z-(fromZ==null?z:fromZ); const al=Math.hypot(ax,az)||1; ax/=al; az/=al;  // направление «от башни»
  const mat=new T3.MeshLambertMaterial({color:ownerCol==null?0xcc4030:ownerCol});
  for(let i=0;i<n;i++){
    const m=new T3.Mesh(UNIT_GEO,mat); m.scale.setScalar(0.5); m.userData.perfGroup='units';
    const spread=(i/n-0.5)*1.4, dir=Math.atan2(az,ax)+spread+(Math.random()-0.5)*0.5, sp=1.8+Math.random()*2.2;
    m.position.set(x+(Math.random()-0.5)*0.2,y+0.1,z+(Math.random()-0.5)*0.2);
    scene.add(m);
    _scatter.push({m, vx:Math.cos(dir)*sp, vy:2.6+Math.random()*1.8, vz:Math.sin(dir)*sp,
      rx:(Math.random()-0.5)*16, rz:(Math.random()-0.5)*16, y0:y, t:0, life:0.55+Math.random()*0.25});
  }
}
function _updateScatter(dt){
  for(let i=_scatter.length-1;i>=0;i--){ const s=_scatter[i]; s.t+=dt;
    s.vy-=15*dt;                                                              // гравитация
    s.m.position.x+=s.vx*dt; s.m.position.y+=s.vy*dt; s.m.position.z+=s.vz*dt;
    if(s.m.position.y<s.y0){ s.m.position.y=s.y0; s.vy*=-0.35; s.vx*=0.6; s.vz*=0.6; }  // отскок от земли
    s.m.rotation.x+=s.rx*dt; s.m.rotation.z+=s.rz*dt;
    const k=Math.max(0,1-s.t/s.life); s.m.scale.setScalar(0.5*k);            // тают, съёживаясь
    if(s.t>=s.life){ scene.remove(s.m); _scatter.splice(i,1); }
  }
}
function updateMissiles(dt){
  for(let i=missiles.length-1;i>=0;i--)if(missiles[i].update(dt))missiles.splice(i,1);
  for(let i=fx.length-1;i>=0;i--){const e=fx[i];e.life-=dt;
    const k=1-e.life/e.max; e.mesh.scale.setScalar(1+k*e.grow); e.mesh.material.opacity=Math.max(0,e.life/e.max*0.9);
    if(e.life<=0){scene.remove(e.mesh); if(e.mesh.material&&e.mesh.material.dispose)e.mesh.material.dispose(); fx.splice(i,1);}}   // диспоуз per-instance материала (геометрия шареная — не трогаем)
  _updateScatter(dt);
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
    else if(t.kind==='siege'){                                             // ⚔ штурмующая город армия (осадный пул)
      if(s&&atWar(this.owner,s.owner)){
        applySiegeTowerHit(s.cityIdx,s.owner,Math.max(1,Math.round(t.dmg||1)));
        const col=(typeof OWNER_COL!=='undefined'&&OWNER_COL[s.owner]!=null)?OWNER_COL[s.owner]:0xcc4030;
        spawnUnitScatter(this.tx,this.ty,this.tz,Math.max(1,Math.round(t.dmg||1)),col,this.sx,this.sz);
      }
    }
    else if(t.kind==='ghost'){                                            // 🎯 guest: попадание по гхост-отряду → урон в этот момент + разлёт N юнитов
      const g=s;
      if(g&&(g.count||0)>0&&atWar(this.owner,g.owner)){
        const gp=g.group.position, dmg=Math.max(1,Math.round(t.dmg||1));
        applyGhostTowerHit(g,dmg);                                         // урон наносится в момент попадания
        const col=(typeof OWNER_COL!=='undefined'&&OWNER_COL[g.owner]!=null)?OWNER_COL[g.owner]:0xcc4030;
        spawnUnitScatter(gp.x,gp.y,gp.z,dmg,col,this.sx,this.sz);          // N осколков вылетают «от башни»
      }
    }
    spawnBlast(this.tx,this.ty,this.tz);
    scene.remove(this.mesh);
  }
}
/* cityTowers (урон) — в серверном Sim; клиент рисует трассеры в cityTowersFX (ниже, dmg:0) */

// ВИЗУАЛ для онлайн-гостя: сим заморожен, поэтому atk-города сами не «стреляли» на экране.
// Здесь пускаем ТОЛЬКО трассеры (kind:'none', dmg:0 → без урона; урон считает сервер) по тем же целям:
// ближайший мобильный враг + осадный обстрел ближайшего вражеского города в радиусе.
function cityTowersFX(dt){
  // мобильные враги: в guest/LOCALSIM юниты — ГХОСТЫ (squads/ships/planes массивы пусты), поэтому цели берём из MP.ghosts.
  // kind: 0=армия(y=земля+0.3), 1=корабль(y=вода), 2=самолёт(y=высота полёта).
  // 🎯 цель ТОЛЬКО юниты (здания больше НЕ обстреливаем). В guest юниты — гхосты; в соло-хосте — squads/ships/planes.
  const guest=(typeof MP!=='undefined'&&MP.guest&&MP.ghosts);
  const enemyTargets=(owner)=>{ const out=[];
    if(guest){ for(const g of MP.ghosts.values()){ if((g.count||0)<0.5||!atWar(owner,g.owner))continue;
        const p=g.group.position; const y=g.kind===2?PLANE_ALT:(g.kind===1?WATER_Y_SHIP+0.2:getTerrainHeight(p.x,p.z)+0.3);
        out.push({x:p.x,z:p.z,y,ref:g}); } }
    else { for(const s of squads){ if(s.fcount<0.5||!atWar(owner,s.owner))continue; out.push({x:s.pos.x,z:s.pos.z,y:getTerrainHeight(s.pos.x,s.pos.z)+0.3,ref:s,kind:'squad'}); }
      for(const s of ships){ if(s.hp<=0||!atWar(owner,s.owner))continue; out.push({x:s.pos.x,z:s.pos.z,y:WATER_Y_SHIP+0.2,ref:s,kind:'ship'}); }
      for(const s of planes){ if(s.hp<=0||!atWar(owner,s.owner))continue; out.push({x:s.pos.x,z:s.pos.z,y:PLANE_ALT,ref:s,kind:'plane'}); } }
    return out; };
  const targetsByOwner=new Map();
  for(const c of cities){
    const range=c.fireRange; if(range<=0)continue;
    c._fxT=(c._fxT||0)+dt;
    c._fxRetry=Math.max(0,(c._fxRetry||0)-dt);
    if(c._fxT<TOWER_FIRE_CD||c._fxRetry>0)continue;
    const cgx=c._visualGX==null?c.gx:c._visualGX, cgz=c._visualGZ==null?c.gz:c._visualGZ;  // hex-город смещён — стреляем из ВИЗУАЛЬНОЙ башни
    const cvy=c._visualY==null?c.baseY:c._visualY;
    const fromY=cvy+(c.topY||0.6)*CITY_SCALE+0.3, from={x:cgx,y:fromY,z:cgz};
    // ближайший ВРАЖЕСКИЙ ЮНИТ в радиусе
    let best=null,bd=range*range;
    let targets=targetsByOwner.get(c.owner); if(!targets){targets=enemyTargets(c.owner);targetsByOwner.set(c.owner,targets);}
    for(const t of targets){ const dx=cgx-t.x,dz=cgz-t.z,dd=dx*dx+dz*dz; if(dd<bd){bd=dd;best=t;} }
    if(!best){c._fxRetry=0.15;continue;}             // без цели повторяем редким сканом, а не каждый кадр
    c._fxT=0;
    c._fxRetry=0;
    const dmg=Math.max(1,Math.round(c.fireDmg||1));
    missiles.push(new TowerShot(c.owner,from,{kind:best.ref&&guest?'ghost':(best.kind||'none'),ref:best.ref||null,x:best.x,y:best.y,z:best.z,dmg}));
  }
}

// 🚀 ВИЗУАЛ обстрела берега кораблём: урон считает Sim (сервер/локальный), здесь ТОЛЬКО
// трассер+вспышка (kind:'none', dmg:0) по той же цели, что и Sim.shipBombard:
// ближайший вражеский город/отряд в радиусе SHIP_ATTACK_RANGE×sr, корабль с tech shipMissile.
// Каденс зеркалит сим (таймер сбрасываем только при наличии цели, как fireTimer на сервере).
function shipBombardFX(dt){
  const guest=(typeof MP!=='undefined'&&MP.guest&&MP.ghosts);
  const CELL=8, groundGrid=new Map(); let gridReady=false;
  const gridKey=(x,z)=>((Math.floor(x/CELL)*100003)+Math.floor(z/CELL));
  const buildGroundGrid=()=>{
    if(gridReady)return; gridReady=true;
    const add=(owner,x,z)=>{const k=gridKey(x,z);let a=groundGrid.get(k);if(!a){a=[];groundGrid.set(k,a);}a.push({owner,x,z});};
    if(guest){for(const g of MP.ghosts.values())if(g.kind===0&&(g.count||0)>=0.5){const p=g.group.position;add(g.owner,p.x,p.z);}}
    else for(const q of squads)if(q.fcount>=0.5)add(q.owner,q.pos.x,q.pos.z);
  };
  const fire=(owner,x,z,fxObj,muzzle,alive)=>{
    if(!alive||!techFlag(owner,'shipMissile'))return;
    fxObj._fxT=(fxObj._fxT||0)+dt;
    fxObj._fxRetry=Math.max(0,(fxObj._fxRetry||0)-dt);
    if(fxObj._fxT<SHIP_FIRE_CD||fxObj._fxRetry>0)return;
    const R=SHIP_ATTACK_RANGE*techVal(owner,'sr'), R2=R*R;
    let tx=null,tz=null,ty=null,bd=R2;
    for(const c of cities){ if(c.owner===owner||!atWar(owner,c.owner))continue;
      const cx=c._visualGX==null?c.gx:c._visualGX, cz=c._visualGZ==null?c.gz:c._visualGZ;
      const dx=x-cx,dz=z-cz,dd=dx*dx+dz*dz; if(dd<bd){bd=dd;tx=cx;tz=cz;ty=getTerrainHeight(cx,cz)+0.3;} }
    buildGroundGrid();
    const cr=Math.ceil(R/CELL),cx0=Math.floor(x/CELL),cz0=Math.floor(z/CELL);
    for(let ox=-cr;ox<=cr;ox++)for(let oz=-cr;oz<=cr;oz++){const a=groundGrid.get((cx0+ox)*100003+(cz0+oz));if(!a)continue;
      for(const u of a){if(!atWar(owner,u.owner))continue;const dx=x-u.x,dz=z-u.z,dd=dx*dx+dz*dz;if(dd<bd){bd=dd;tx=u.x;tz=u.z;ty=getTerrainHeight(u.x,u.z)+0.3;}}}
    if(tx===null){fxObj._fxRetry=0.15;return;} fxObj._fxT=0; fxObj._fxRetry=0;
    missiles.push(new TowerShot(owner,{x,y:WATER_Y_SHIP+0.6,z},{kind:'none',ref:null,x:tx,y:ty,z:tz,dmg:0}));
    if(muzzle&&typeof spawnMuzzle==='function')spawnMuzzle(muzzle);
  };
  if(guest){for(const g of MP.ghosts.values()){if(g.kind!==1||g.transport)continue;const p=g.group.position;fire(g.owner,p.x,p.z,g,null,(g.count||1)>0);}}
  else for(const s of ships)fire(s.owner,s.pos.x,s.pos.z,s,s,s.hp>0);
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
    if(P)toast(t('toast.airBombing',{name:cityDisp(toCity.idx)})+(techFlag(a,'planeBomb')?'':t('toast.airBombingLocked')));
  } else if(toCity===fromAirport){ airOrder[a]=null; if(P)toast(t('toast.airRecalled')); }
  else { airOrder[a]={kind:'patrol',x:gx,z:gz}; if(P)toast(t('toast.airPatrol')); }
}
function recallAir(){ if(MP.guest){ MP.cmd({cmd:'airorder',recall:true}); return; } if(!airOrder[PLAYER])return; airOrder[PLAYER]=null; toast(t('toast.airRecalled')); if(typeof updatePanel==='function')updatePanel(); }
// краткое описание текущего приказа авиации (для кнопки/статуса)
function airOrderLabel(){
  const o=airOrder[PLAYER]; if(!o)return '';
  if(o.kind==='bomb')return o.city?t('toast.airOrderBombing',{name:cityDisp(o.city.idx)}):t('toast.airOrderBomb');
  if(o.kind==='patrol')return t('toast.airOrderPatrol');
  return '';
}
/* Plane + spawnPlane — в серверном Sim (юниты рендерятся призраками) */
/* airBattles — в серверном Sim (воздушный бой считает серверный сим) */
