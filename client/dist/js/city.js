/* ── City ───────────────────────────────────────────────────── */
// Тор с tubular-major порядком индексов: строим ОДИН раз (полное кольцо), а прогресс
// рисуем через setDrawRange (без пересоздания геометрии каждый кадр → без лагов/GC).
// Возвращает {geo, idxPerSeg, tub}. Плоскость XY, тюб по Z — как у THREE.TorusGeometry.
function _makeArcTorus(R, tube, radial, tubular){
  const pos=[], idx=[], rw=radial+1;
  for(let i=0;i<=tubular;i++){ const u=i/tubular*Math.PI*2, cu=Math.cos(u), su=Math.sin(u);
    for(let j=0;j<=radial;j++){ const v=j/radial*Math.PI*2, r=R+tube*Math.cos(v);
      pos.push(r*cu, r*su, tube*Math.sin(v)); } }
  for(let i=0;i<tubular;i++){ for(let j=0;j<radial;j++){        // сегмент i — непрерывный блок индексов (растёт по дуге)
    const a=i*rw+j, b=(i+1)*rw+j, c=(i+1)*rw+j+1, d=i*rw+j+1;
    idx.push(a,b,d, b,c,d); } }
  const geo=new T3.BufferGeometry();
  geo.setAttribute('position', new T3.Float32BufferAttribute(pos,3));
  geo.setIndex(idx); geo.computeVertexNormals();
  return { geo, idxPerSeg: radial*6, tub: tubular };
}
// общие dummy для роя осаждающих юнитов (тот же приём, что ghostUnitDummy в loop.js)
const _siegeDummy=new T3.Object3D(); _siegeDummy.rotation.order='YXZ';
const _siegeMat=new T3.Matrix4();
// ── FX осады: общий пул пыли и стрел, анимируется раз в кадр ──
const _dust=[], _arrows=[]; let _fxInit=false, _fxNow=0;
function _initSiegeFX(){ if(_fxInit)return; _fxInit=true;
  const cv=document.createElement('canvas'); cv.width=cv.height=64; const g=cv.getContext('2d');
  const rg=g.createRadialGradient(32,32,1,32,32,31); rg.addColorStop(0,'rgba(255,255,255,1)'); rg.addColorStop(0.35,'rgba(242,238,230,0.85)'); rg.addColorStop(0.7,'rgba(225,218,205,0.4)'); rg.addColorStop(1,'rgba(210,203,190,0)');
  g.fillStyle=rg; g.fillRect(0,0,64,64); const tex=new T3.CanvasTexture(cv);
  for(let i=0;i<22;i++){ const s=new T3.Sprite(new T3.SpriteMaterial({map:tex,transparent:true,depthWrite:false,opacity:0})); s.visible=false; s.userData.perfGroup='units'; scene.add(s); _dust.push({sp:s,t0:-1,life:0.45,x:0,y:0,z:0,sc:0.4}); }
  const ag=new T3.BoxGeometry(0.02,0.02,0.24), am=new T3.MeshBasicMaterial({color:0x2e2620});
  for(let i=0;i<16;i++){ const m=new T3.Mesh(ag,am); m.visible=false; m.userData.perfGroup='units'; scene.add(m); _arrows.push({m,t0:-1,life:0.4,x0:0,y0:0,z0:0,x1:0,y1:0,z1:0,arc:0.5}); }
}
function _spawnDust(x,y,z,sc){ _initSiegeFX(); for(const d of _dust){ if(d.t0<0||(_fxNow-d.t0)/1000>d.life){ d.t0=_fxNow; d.x=x;d.y=y;d.z=z;d.sc=sc; d.sp.visible=true; return; } } }
function _spawnArrow(x0,y0,z0,x1,y1,z1){ _initSiegeFX(); for(const a of _arrows){ if(a.t0<0||(_fxNow-a.t0)/1000>a.life){ a.t0=_fxNow; a.x0=x0;a.y0=y0;a.z0=z0;a.x1=x1;a.y1=y1;a.z1=z1; a.arc=0.35+Math.random()*0.3; a.m.visible=true; return; } } }
function _updateSiegeFX(now){ const first=now!==_fxNow; _fxNow=now; if(!first||!_fxInit)return;
  for(const d of _dust){ if(d.t0<0)continue; const k=(now-d.t0)/1000/d.life; if(k>=1){ d.sp.visible=false; d.t0=-1; continue; }
    const s=d.sc*(0.5+k*1.9); d.sp.scale.set(s,s,s); d.sp.position.set(d.x,d.y+k*0.32,d.z); d.sp.material.opacity=(1-k*k)*0.95; }   // поднимается + тает (ярче, дольше держит непрозрачность)
  for(const a of _arrows){ if(a.t0<0)continue; const k=(now-a.t0)/1000/a.life; if(k>=1){ a.m.visible=false; a.t0=-1; continue; }
    const x=a.x0+(a.x1-a.x0)*k, z=a.z0+(a.z1-a.z0)*k, y=a.y0+(a.y1-a.y0)*k+Math.sin(k*Math.PI)*a.arc;
    a.m.position.set(x,y,z); a.m.lookAt(a.x1,a.y1,a.z1); }
}
class City{
  constructor(gx,gz,country,size,owner,idx){
    this.gx=gx; this.gz=gz; this.country=country; this.size=size; this.owner=owner; this.idx=idx;
    this.occ=false; this.occFrom=null;   // оккупация: занят в войне, но не аннексирован (решается миром)
    this.spec=null; this.tier=0;
    this.prodTier=0; this.defTier=0; this.atkTier=0;
    this.isShipyard=SHIPYARD_NAMES.has(CITY_NAMES[idx]); // верфь
    this.isAirport=AIRPORT_NAMES.has(CITY_NAMES[idx]);   // аэропорт
    this.hasShipyard=false;                              // внешняя верфь у обычного города
    this.hasAirport=false;                               // внешний аэропорт у обычного города
    this.shipQueue=0; this.shipTimer=0;   // очередь кораблей
    this.planeQueue=0; this.planeTimer=0; // очередь самолётов
    this.units = 8+this.size*4; // стартовый гарнизон по размеру
    const sc=(typeof START_COMP!=='undefined'&&START_COMP)||{inf:0.7,arc:0.2,cav:0.1};
    this.comp={inf:this.units*(sc.inf||0),arc:this.units*(sc.arc||0),cav:this.units*(sc.cav||0)};
    this.aa=0; this.aaTimer=0;   // legacy ПВО больше не показываем/не строим
    this.goldTimer=0; this.batches=[]; this.boosted=false;
    this.capital = false;
    // position on terrain
    const terrainH = getTerrainHeight(gx, gz);
    const baseY = terrainH;
    this.baseY = baseY;
    this.buildGroup=new T3.Group();
    this.buildGroup.userData.perfGroup='city';
    this.buildGroup.position.set(gx,baseY,gz);
    scene.add(this.buildGroup);
    this.mats=[];
    this.buildMeshes();
    this.buildGroup.scale.setScalar(CITY_SCALE); // города крупнее
    // hitbox for raycast
    this.hit=new T3.Mesh(new T3.CylinderGeometry(0.55*CITY_SCALE,0.55*CITY_SCALE,2.4*CITY_SCALE,10),
      new T3.MeshBasicMaterial({visible:false}));
    this.hit.userData.perfGroup='city-hit';
    this.hit.position.set(this.gx,this.baseY+0.8*CITY_SCALE,this.gz); this.hit.userData.city=this; scene.add(this.hit);
    // selection ring
    this.ring=new T3.Mesh(new T3.TorusGeometry(0.62*CITY_SCALE,0.06*CITY_SCALE,8,28),
      new T3.MeshBasicMaterial({color:0xffffff}));
    this.ring.userData.perfGroup='city-ui';
    this.ring.rotation.x=Math.PI/2; this.ring.position.set(this.gx,this.baseY+0.03,this.gz); this.ring.visible=false;
    scene.add(this.ring);
    // кольцо радиуса обстрела (видно при выборе atk-города)
    this.rangeRing=new T3.Mesh(new T3.TorusGeometry(1,0.12,8,64),
      new T3.MeshBasicMaterial({color:0xff7a3a,transparent:true,opacity:0.5}));
    this.rangeRing.userData.perfGroup='city-ui';
    this.rangeRing.rotation.x=Math.PI/2; this.rangeRing.position.set(this.gx,this.baseY+0.1,this.gz);
    this.rangeRing.visible=false; this._ringR=0; scene.add(this.rangeRing);
    // production ring — полное кольцо один раз, прогресс через setDrawRange
    const _pat=_makeArcTorus(0.7*CITY_SCALE,0.05*CITY_SCALE,8,48);
    this._pringIdxPerSeg=_pat.idxPerSeg; this._pringTub=_pat.tub; this._pringSeg=-1;
    this.pring=new T3.Mesh(_pat.geo, new T3.MeshBasicMaterial({color:0xff9a4a}));
    this.pring.userData.perfGroup='city-ui';
    this.pring.geometry.setDrawRange(0,0);
    this.pring.rotation.x=Math.PI/2; this.pring.position.set(this.gx,this.baseY+0.05,this.gz); this.pring.visible=false;
    scene.add(this.pring);
    // battle ring (осада)
    this.siege=null; // {ownerId:{units,atkMult}}
    this.bring=new T3.Mesh(new T3.TorusGeometry(0.55*CITY_SCALE,0.055*CITY_SCALE,8,28),
      new T3.MeshBasicMaterial({color:0xff5030}));
    this.bring.userData.perfGroup='city-ui';
    this.bring.rotation.x=Math.PI/2; this.bring.position.set(this.gx,this.baseY+0.08,this.gz); this.bring.visible=false;
    scene.add(this.bring);
    this.siegeOrbs={};  // ownerId → {mesh,lab} осаждающие армии (видимы как в бою)
    // dom label
    this.lab=document.createElement('div'); this.lab.className='lab cityLab';
    document.getElementById('labels').appendChild(this.lab);
  }
  branchTier(track){const v=this[track+'Tier'];return v==null?(this.spec===track?this.tier:0):v;}
  get totalTier(){return this.branchTier('prod')+this.branchTier('def')+this.branchTier('atk');}
  get visualTier(){return Math.max(this.branchTier('prod'),this.branchTier('def'),this.branchTier('atk'));}
  syncLegacyTier(track){this.spec=track;this.tier=this.visualTier;}
  get capacity(){let c=CITY_CAP_BASE+this.size*CITY_CAP_PER_SIZE;c*=1+CITY_DEF_CAP_PER_TIER*this.branchTier('prod');if(this.boosted)c*=CITY_BOOST_CAP;return c*techVal(this.owner,'cc');}
  get goldInterval(){let g=CITY_GOLD_INTERVAL;if(this.boosted)g*=CITY_BOOST_GOLD;return g/techMul(this.owner,'eco');}
  get goldRate(){return this.size/this.goldInterval;}
  get defMult(){return (1+CITY_DEF_MULT_PER_TIER*this.branchTier('def'))*techMul(this.owner,'def');}
  get atkMult(){return (1+CITY_ATK_MULT_PER_TIER*this.branchTier('atk'))*techMul(this.owner,'atk');}
  get speedMult(){return (1+.18*this.branchTier('atk'))*techMul(this.owner,'speed');}
  get fireRange(){const tier=this.branchTier('atk');return tier>0?(TOWER_RANGE_BASE+TOWER_RANGE_PER*tier)*techVal(this.owner,'tr'):0;}
  get fireDmg(){return (TOWER_DMG_BASE+this.branchTier('atk'))*techMul(this.owner,'atk')*techVal(this.owner,'td');}
  get trainPer(){let t=CITY_TRAIN_BASE-this.size*CITY_TRAIN_PER_SIZE;if(this.boosted)t*=CITY_BOOST_TRAIN;return t/techMul(this.owner,'prod');}
  get queued(){return this.batches.reduce((s,b)=>s+b.count,0);}

  buildMeshes(){
    // 🌗 город — ДИНАМИЧЕСКИЙ кастер: после сборки детей (микротаск) уходит в отдельную карту теней
    //    (castShadow=false — из статичной исключён) и перепекает только её (~0.4M, статика 1.7M не трогается)
    if(typeof scheduleCityShadowRefresh==='function')scheduleCityShadowRefresh(this);
    while(this.buildGroup.children.length)this.buildGroup.remove(this.buildGroup.children[0]);
    this.mats=[];
    const col=OWNER_COL[this.owner], cold=OWNER_COLD[this.owner];
    if(this.isShipyard){ this.buildShipyard(col,cold); return; }   // верфь — отдельный город-сущность → рендерим как док
    if(this.isAirport){ this.buildAirport(col,cold); return; }
    const wallMat=new T3.MeshLambertMaterial({color:0xf2dfb0});   // wallCream движка
    const wallMatD=new T3.MeshLambertMaterial({color:0xd9c08e});

    // центральная башня-кип: высота = размер + тир
    const keepH=0.42+0.16*(this.size+this.tier);
    const keepRoofMat=new T3.MeshLambertMaterial({color:cold}); this.mats.push(keepRoofMat);
    const keep=new T3.Mesh(new T3.BoxGeometry(0.32,keepH,0.32),wallMat);
    keep.position.y=keepH/2; keep.castShadow=true; this.buildGroup.add(keep);
    const keepRoof=new T3.Mesh(new T3.ConeGeometry(0.295,0.3,4),keepRoofMat);
    keepRoof.position.y=keepH+0.148; keepRoof.rotation.y=Math.PI/4;
    keepRoof.castShadow=true; this.buildGroup.add(keepRoof);
    // тир: золотые пояса на башне
    for(let t=0;t<this.tier;t++){
      const band=new T3.Mesh(new T3.BoxGeometry(0.345,0.045,0.345),
        new T3.MeshLambertMaterial({color:0xf2c14e}));
      band.position.y=keepH-0.12-t*0.13; this.buildGroup.add(band);
    }

    // домики вокруг: количество = size, скатные крыши цвета владельца
    const houses=1+this.size*2;
    for(let i=0;i<houses;i++){
      const a=(i/houses)*Math.PI*2 + this.idx*0.7;
      const d=0.42+0.07*(i%2);
      const hx=Math.cos(a)*d, hz=Math.sin(a)*d;
      const hw=0.20,hh=0.15,hd=0.27;
      const hg=new T3.Group(); hg.position.set(hx,0,hz); hg.rotation.y=-a;
      const walls=new T3.Mesh(new T3.BoxGeometry(hw,hh,hd),i%3===2?wallMatD:wallMat);
      walls.position.y=hh/2; walls.castShadow=true; hg.add(walls);
      const roofMat=new T3.MeshLambertMaterial({color:col}); this.mats.push(roofMat);
      // скатная крыша: две наклонные пластины + конёк (как pitchedRoof движка)
      const rise=0.10, halfW=hw/2, slabLen=Math.hypot(halfW,rise)+0.02;
      const ang=Math.atan2(rise,halfW);
      for(const s of [-1,1]){
        const slab=new T3.Mesh(new T3.BoxGeometry(slabLen,0.028,hd+0.06),roofMat);
        slab.position.set(s*halfW/2, hh+rise/2, 0);
        slab.rotation.z=-s*ang; slab.castShadow=true; hg.add(slab);
      }
      const ridge=new T3.Mesh(new T3.BoxGeometry(0.035,0.025,hd+0.07),roofMat);
      ridge.position.y=hh+rise+0.01; hg.add(ridge);
      this.buildGroup.add(hg);
    }

    // столица: золотой штандарт на башне
    if(this.capital){
      const pole=new T3.Mesh(new T3.CylinderGeometry(0.014,0.014,0.34),
        new T3.MeshLambertMaterial({color:0x6b5030}));
      pole.position.y=keepH+0.42; this.buildGroup.add(pole);
      const ban=new T3.Mesh(new T3.BoxGeometry(0.2,0.12,0.03),
        new T3.MeshLambertMaterial({color:0xf2c14e}));
      ban.position.set(0.11,keepH+0.5,0); this.buildGroup.add(ban);
    }
    // спец-флажок
    if(this.spec){
      const fy=keepH+(this.capital?0.18:0.42);
      const pole=new T3.Mesh(new T3.CylinderGeometry(0.014,0.014,0.3),
        new T3.MeshLambertMaterial({color:0x6b5030}));
      pole.position.set(this.capital?-0.12:0,fy,this.capital?0.1:0); this.buildGroup.add(pole);
      const flag=new T3.Mesh(new T3.BoxGeometry(0.16,0.11,0.03),
        new T3.MeshLambertMaterial({color:new T3.Color(SPEC[this.spec].color)}));
      flag.position.set((this.capital?-0.12:0)+0.09,fy+0.07,this.capital?0.1:0); this.buildGroup.add(flag);
    }

    // ── постройки-специализации: силуэт зависит от ветки, растёт с тиром ──
    if(this.spec==='def'){
      // 🛡 КРЕПОСТЬ: зубчатая каменная стена + угловые башни
      const stone=new T3.MeshLambertMaterial({color:0x9a958c});
      const stoneD=new T3.MeshLambertMaterial({color:0x817c73});
      const R=0.58, merlons=8+this.tier*4, wallH=0.12+0.05*this.tier;
      for(let i=0;i<merlons;i++){
        const a=i/merlons*Math.PI*2;
        const m=new T3.Mesh(new T3.BoxGeometry(0.12,wallH+(i%2?0.06:0),0.1),i%2?stone:stoneD);
        m.position.set(Math.cos(a)*R,(wallH+(i%2?0.06:0))/2,Math.sin(a)*R);
        m.rotation.y=-a; m.castShadow=true; this.buildGroup.add(m);
      }
      // угловые башни на тире 2+
      if(this.tier>=2)for(let i=0;i<4;i++){
        const a=i/4*Math.PI*2+0.78, th=0.26+0.08*this.tier;
        const tw=new T3.Mesh(new T3.CylinderGeometry(0.075,0.085,th,7),stone);
        tw.position.set(Math.cos(a)*R,th/2,Math.sin(a)*R); tw.castShadow=true; this.buildGroup.add(tw);
        const cap=new T3.Mesh(new T3.ConeGeometry(0.09,0.1,7),keepRoofMat);
        cap.position.set(Math.cos(a)*R,th+0.05,Math.sin(a)*R); this.buildGroup.add(cap);
      }
    } else if(this.spec==='atk'){
      // ⚔ ВОЕННЫЙ ЛАГЕРЬ: частокол копий + красные боевые штандарты
      const spear=new T3.MeshLambertMaterial({color:0xb8b2a4});
      const shaft=new T3.MeshLambertMaterial({color:0x6b5030});
      const warRed=new T3.MeshLambertMaterial({color:0xc23a2a});
      const spears=5+this.tier*3, R=0.56;
      for(let i=0;i<spears;i++){
        const a=i/spears*Math.PI*2;
        const g=new T3.Group(); g.position.set(Math.cos(a)*R,0,Math.sin(a)*R);
        g.rotation.z=Math.cos(a)*0.25; g.rotation.x=-Math.sin(a)*0.25;
        const sh=new T3.Mesh(new T3.CylinderGeometry(0.012,0.012,0.34),shaft);
        sh.position.y=0.17; g.add(sh);
        const tip=new T3.Mesh(new T3.ConeGeometry(0.03,0.09,5),spear);
        tip.position.y=0.38; g.add(tip); g.children.forEach(o=>o.castShadow=true);
        this.buildGroup.add(g);
      }
      // боевые знамёна (число = тир)
      for(let i=0;i<this.tier;i++){
        const a=i/Math.max(1,this.tier)*Math.PI*2+0.4;
        const p=new T3.Mesh(new T3.CylinderGeometry(0.014,0.014,0.4),shaft);
        p.position.set(Math.cos(a)*0.34,0.2,Math.sin(a)*0.34); this.buildGroup.add(p);
        const b=new T3.Mesh(new T3.BoxGeometry(0.03,0.16,0.1),warRed);
        b.position.set(Math.cos(a)*0.34,0.32,Math.sin(a)*0.34); b.castShadow=true; this.buildGroup.add(b);
      }
    } else if(this.spec==='prod'){
      // 💰 ТОРГОВЫЙ ГОРОД: золотой купол на башне + рынки + штабели монет
      const goldM=new T3.MeshLambertMaterial({color:0xf2c14e});
      const goldD=new T3.MeshLambertMaterial({color:0xcf9a2e});
      const dome=new T3.Mesh(new T3.SphereGeometry(0.2+0.03*this.tier,12,8,0,Math.PI*2,0,Math.PI/2),goldM);
      dome.position.y=keepH+0.02; dome.castShadow=true; this.buildGroup.add(dome);
      const finial=new T3.Mesh(new T3.SphereGeometry(0.03,8,6),goldM);
      finial.position.y=keepH+0.2+0.03*this.tier; this.buildGroup.add(finial);
      // штабели монет вокруг (число растёт с тиром)
      const stacks=2+this.tier*2;
      for(let i=0;i<stacks;i++){
        const a=i/stacks*Math.PI*2+0.3, R=0.5+0.06*(i%2);
        const coins=2+(i%3);
        for(let c=0;c<coins;c++){
          const coin=new T3.Mesh(new T3.CylinderGeometry(0.05,0.05,0.022,12),c%2?goldD:goldM);
          coin.position.set(Math.cos(a)*R,0.011+c*0.024,Math.sin(a)*R);
          coin.castShadow=true; this.buildGroup.add(coin);
        }
      }
      // полосатые рыночные навесы на тире 2+
      if(this.tier>=2)for(let i=0;i<3;i++){
        const a=i/3*Math.PI*2, R=0.4;
        const aw=new T3.Mesh(new T3.BoxGeometry(0.16,0.02,0.16),
          new T3.MeshLambertMaterial({color:i%2?0xe8554a:0xf2dfb0}));
        aw.position.set(Math.cos(a)*R,0.14,Math.sin(a)*R); aw.castShadow=true; this.buildGroup.add(aw);
        for(const s of [-1,1]){const leg=new T3.Mesh(new T3.CylinderGeometry(0.008,0.008,0.14),wallMatD);
          leg.position.set(Math.cos(a)*R+s*0.06,0.07,Math.sin(a)*R); this.buildGroup.add(leg);}
      }
    }
    this.topY=keepH+0.34;
  }
  // модель верфи: помост-причал, краны, корпус строящегося корабля, склад
  buildShipyard(col,cold){
    const wood=new T3.MeshLambertMaterial({color:0x8a6038});
    const woodD=new T3.MeshLambertMaterial({color:0x6b4a2c});
    const metal=new T3.MeshLambertMaterial({color:0x9aa0a8});
    const roofMat=new T3.MeshLambertMaterial({color:col}); this.mats.push(roofMat);
    // настил-причал
    const deck=new T3.Mesh(new T3.BoxGeometry(0.95,0.08,0.7),wood);
    deck.position.y=0.04; deck.castShadow=true; deck.receiveShadow=true; this.buildGroup.add(deck);
    // сваи
    for(const[px,pz]of[[-0.4,-0.3],[0.4,-0.3],[-0.4,0.3],[0.4,0.3]]){
      const pile=new T3.Mesh(new T3.CylinderGeometry(0.03,0.03,0.3),woodD);
      pile.position.set(px,-0.1,pz); this.buildGroup.add(pile);
    }
    // склад с двускатной крышей
    const shedW=new T3.Mesh(new T3.BoxGeometry(0.34,0.22,0.28),new T3.MeshLambertMaterial({color:0xc9b890}));
    shedW.position.set(-0.28,0.19,0); shedW.castShadow=true; this.buildGroup.add(shedW);
    for(const s of[-1,1]){const sl=new T3.Mesh(new T3.BoxGeometry(0.13,0.025,0.34),roofMat);
      sl.position.set(-0.28+s*0.085,0.34,0); sl.rotation.z=-s*0.7; sl.castShadow=true; this.buildGroup.add(sl);}
    // кран: стойка + стрела + крюк
    const mast=new T3.Mesh(new T3.BoxGeometry(0.05,0.6,0.05),metal);
    mast.position.set(0.18,0.3,0); mast.castShadow=true; this.buildGroup.add(mast);
    const jib=new T3.Mesh(new T3.BoxGeometry(0.5,0.04,0.04),metal);
    jib.position.set(0.32,0.58,0); jib.rotation.z=0.18; jib.castShadow=true; this.buildGroup.add(jib);
    const cable=new T3.Mesh(new T3.CylinderGeometry(0.006,0.006,0.22),woodD);
    cable.position.set(0.52,0.46,0); this.buildGroup.add(cable);
    // корпус строящегося корабля на стапеле
    const hull=new T3.Mesh(new T3.BoxGeometry(0.5,0.12,0.18),woodD);
    hull.position.set(0.28,0.16,0); hull.castShadow=true; this.buildGroup.add(hull);
    const rib=new T3.Mesh(new T3.BoxGeometry(0.42,0.1,0.14),wood);
    rib.position.set(0.28,0.24,0); this.buildGroup.add(rib);
    // флаг владельца
    const pole=new T3.Mesh(new T3.CylinderGeometry(0.014,0.014,0.4),woodD);
    pole.position.set(-0.42,0.28,0); this.buildGroup.add(pole);
    const flag=new T3.Mesh(new T3.BoxGeometry(0.2,0.13,0.03),new T3.MeshLambertMaterial({color:cold}));
    this.mats.push(flag.material); flag.position.set(-0.31,0.42,0); flag.castShadow=true; this.buildGroup.add(flag);
    this.topY=0.7;
  }
  // модель аэропорта: ВПП с разметкой, терминал, диспетчерская вышка, припаркованный самолёт
  buildAirport(col,cold){
    const tar=new T3.MeshLambertMaterial({color:0x55585e});  // асфальт
    const term=new T3.MeshLambertMaterial({color:0xd6dbe0}); // терминал
    const glass=new T3.MeshLambertMaterial({color:0x6fb0d0});
    const roofMat=new T3.MeshLambertMaterial({color:col}); this.mats.push(roofMat);
    // взлётная полоса
    const rw=new T3.Mesh(new T3.BoxGeometry(1.05,0.06,0.34),tar);
    rw.position.y=0.03; rw.receiveShadow=true; this.buildGroup.add(rw);
    for(let i=-2;i<=2;i++){const dash=new T3.Mesh(new T3.BoxGeometry(0.12,0.065,0.03),new T3.MeshLambertMaterial({color:0xeeeeee}));
      dash.position.set(i*0.2,0.032,0); this.buildGroup.add(dash);}
    // терминал
    const t=new T3.Mesh(new T3.BoxGeometry(0.4,0.2,0.22),term);
    t.position.set(-0.3,0.16,0.3); t.castShadow=true; this.buildGroup.add(t);
    const roof=new T3.Mesh(new T3.BoxGeometry(0.42,0.03,0.24),roofMat);
    roof.position.set(-0.3,0.27,0.3); this.buildGroup.add(roof);
    // диспетчерская вышка
    const tower=new T3.Mesh(new T3.CylinderGeometry(0.05,0.06,0.5),term);
    tower.position.set(0.05,0.25,0.32); tower.castShadow=true; this.buildGroup.add(tower);
    const cab=new T3.Mesh(new T3.BoxGeometry(0.14,0.1,0.14),glass);
    cab.position.set(0.05,0.53,0.32); cab.castShadow=true; this.buildGroup.add(cab);
    const cabRoof=new T3.Mesh(new T3.ConeGeometry(0.11,0.08,4),roofMat);
    cabRoof.position.set(0.05,0.62,0.32); cabRoof.rotation.y=Math.PI/4; this.buildGroup.add(cabRoof);
    // припаркованный самолётик (цвет владельца на хвосте)
    const body=new T3.MeshLambertMaterial({color:0xe8edf2});
    const fus=new T3.Mesh(new T3.CylinderGeometry(0.04,0.025,0.36,8),body);
    fus.rotation.z=Math.PI/2; fus.position.set(0.2,0.1,-0.12); fus.castShadow=true; this.buildGroup.add(fus);
    const wing=new T3.Mesh(new T3.BoxGeometry(0.06,0.02,0.3),body);
    wing.position.set(0.2,0.1,-0.12); this.buildGroup.add(wing);
    const tail=new T3.Mesh(new T3.BoxGeometry(0.05,0.1,0.02),roofMat);
    tail.position.set(0.04,0.14,-0.12); this.buildGroup.add(tail);
    this.topY=0.7;
  }
  recolor(){ const col=OWNER_COL[this.owner],cold=OWNER_COLD[this.owner];
    this.mats.forEach((m,i)=>m.color.setHex(i===0?cold:col)); }
  addSiege(owner,units,atkMult){
    if(!this.siege)this.siege={};
    const p=this.siege[owner]||(this.siege[owner]={units:0,atkMult:1});
    p.atkMult=(p.atkMult*p.units+atkMult*units)/((p.units+units)||1); // средневзвеш.
    p.units+=units;
  }
  update(dt){
    if(this._visualGX!=null){
      const vx=this._visualGX,vz=this._visualGZ,vy=this._visualY==null?this.baseY:this._visualY;
      this.buildGroup.position.x=vx;this.buildGroup.position.z=vz;
      this.hit.position.x=vx;this.hit.position.z=vz;this.hit.position.y=vy+0.8*CITY_SCALE;
      this.ring.position.x=vx;this.ring.position.z=vz;this.ring.position.y=vy+0.03;
      this.rangeRing.position.x=vx;this.rangeRing.position.z=vz;this.rangeRing.position.y=vy+0.1;
      this.pring.position.x=vx;this.pring.position.z=vz;
      this.bring.position.x=vx;this.bring.position.z=vz;this.bring.position.y=vy+0.08;
    }
    // ── осада: бой за город во времени ──
    if(this.siege){
      const pools=Object.values(this.siege);
      const totalAtk=pools.reduce((s,p)=>s+p.units,0);
      if(totalAtk<UNIT_MIN){this.siege=null;}
      else{
        // атакующие бьют гарнизон, гарнизон отвечает пропорционально пулам
        let dmgToCity=0;
        for(const p of pools)dmgToCity+=p.units*p.atkMult*SIEGE_ATK;
        const defDps=this.units*this.defMult*SIEGE_DEF;
        for(const p of pools)p.units-=defDps*(p.units/totalAtk)*dt;
        this.units=Math.max(0,this.units-dmgToCity*dt);
        for(const o of Object.keys(this.siege))if(this.siege[o].units<SIEGE_POOL_MIN)delete this.siege[o];
        if(this.units<=CITY_CAPTURE_MIN){
          // город пал — берёт сильнейший пул
          let bo=null,bu=0;
          for(const o of Object.keys(this.siege)){const p=this.siege[o];if(p.units>bu){bu=p.units;bo=+o;}}
          if(bo!=null){
            const prev=this.owner;
            this.owner=bo; this.units=Math.max(GARRISON_FLOOR,this.siege[bo].units);
            if(this.occ&&this.occFrom===bo){ this.occ=false; this.occFrom=null; } // вернул свой город
            else { this.occ=true; this.occFrom=prev; }                            // оккупация (провизорно, до мира)
            if(prev!==bo&&!cities.some(c=>c.owner===prev))permanentAnnex(prev,bo);   // prev капитулировал → аннексия земель + захват ресурсов
            delete this.siege[bo];
            this.goldTimer=0; this.batches=[]; this.recolor(); markRegions(); updatePanel();
          } else this.units=GARRISON_FLOOR; // взаимное истощение
        }
        if(this.siege&&Object.keys(this.siege).length===0)this.siege=null;
      }
    }
    // все фракции производят голду и солдат (×size×YIELD; оккупированный город — ×OCCUPY_INCOME) — формула как на сервере
    let income=0;
    this.goldTimer+=dt;
    while(this.goldTimer>=this.goldInterval){this.goldTimer-=this.goldInterval;income+=this.size*CITY_GOLD_YIELD;}
    if(this.occ)income*=OCCUPY_INCOME;
    gold[this.owner]+=income;
    if(this.batches.length){
      const b=this.batches[0]; b.elapsed+=dt;
      if(b.elapsed>=b.time){ this.units=Math.min(this.capacity,this.units+b.count); this.batches.shift(); }
    }
    // верфь/аэродром строят флот/авиацию в серверном Sim (City.update — мёртвый клиентский путь)
    this.drawProdRing();   // кольцо производства (вынесено — гость тоже его рисует)
  }
  drawProdRing(){
    let frac=null;
    if(this.batches.length){ const b=this.batches[0]; frac=Math.min(1,b.elapsed/b.time); }                                                  // найм солдат
    else if(this.isShipyard&&this.shipQueue>0&&typeof SHIP_BUILD_TIME!=='undefined'){ frac=Math.min(1,this.shipTimer/SHIP_BUILD_TIME); }     // ⚓ постройка корабля
    else if(this.isAirport&&this.planeQueue>0&&typeof PLANE_BUILD_TIME!=='undefined'){ frac=Math.min(1,this.planeTimer/PLANE_BUILD_TIME); }   // ✈ постройка самолёта
    if(frac!==null){
      this.pring.visible=true;
      const seg=Math.max(1,Math.round(frac*this._pringTub));                 // сколько сегментов дуги показать
      if(seg!==this._pringSeg){ this._pringSeg=seg; this.pring.geometry.setDrawRange(0,seg*this._pringIdxPerSeg); }
      this.pring.position.y=(this._visualY==null?this.baseY:this._visualY)+this.topY*CITY_SCALE+0.35;
    } else if(this.pring.visible){ this.pring.visible=false; this._pringSeg=-1; }
  }
  updateLabel(){
    const v=new T3.Vector3(this._visualGX==null?this.gx:this._visualGX,(this._visualY==null?this.baseY:this._visualY)+this.topY*CITY_SCALE+0.7,this._visualGZ==null?this.gz:this._visualGZ).project(camera);
    if(v.z>1){showLab(this.lab,false);return;}
    const zoomR=typeof orbit!=='undefined'?orbit.r:100;
    const isSelected=typeof selected!=='undefined'&&selected===this;
    if(zoomR>360&&!this.capital&&!isSelected){showLab(this.lab,false);return;}
    showLab(this.lab,true);
    const labelScale=zoomR<=120?1:zoomR<=210?.84:zoomR<=320?.68:.58;
    this.lab.style.setProperty('--city-label-scale',labelScale);
    this.lab.classList.toggle('cityLabFar',zoomR>210&&!isSelected);
    posLab(this.lab,(v.x*0.5+0.5)*innerWidth,(-v.y*0.5+0.5)*innerHeight);
    const q=this.queued;
    const ownerCountry=(FACTIONS[this.owner]&&FACTIONS[this.owner].country)||this.country;
    const cap=Math.round(this.capacity), units=Math.round(this.units);
    const capacity=`<span class="cityCapacity"><span class="cityCapacityCurrent${this.units>this.capacity?' over':''}">${units}</span><span class="cityCapacityDivider">/</span><span>${cap}</span></span>`;
    const head=`<span class="cityHead"><span class="cityFlag">${flagOf(ownerCountry)}</span><span class="nm">${cityDisp(this.idx)}</span>${capacity}</span>`;
    // гарнизон трясётся красным когда обороняется
    const def=this.siege?'<span style="color:#ff6a4a">🛡</span>':'';
    const occm=this.occ?`<span style="color:#${(OWNER_COL[this.occFrom]||0).toString(16).padStart(6,'0')};text-shadow:0 0 2px #000">⚑</span>`:''; // занят (флаг де-юре владельца)
    // 👥 гарнизон по типам (⚔ пехота · 🏹 лучники · 🐎 конница); без comp — просто число
    let garr='';
    const comp=this.comp||null;
    if(comp){ const parts=[];
      if(comp.inf>=0.5)parts.push('⚔'+Math.round(comp.inf));
      if(comp.arc>=0.5)parts.push('🏹'+Math.round(comp.arc));
      if(comp.cav>=0.5)parts.push('🐎'+Math.round(comp.cav));
      if(parts.length)garr=parts.join(' ');
    }
    const status=`${occm}${def}${garr}${q>0?`<span class="q">⏳${q}</span>`:''}`;
    setLabHTML(this.lab,`${head}<span class="cityStats"><span class="cityComposition">${status}</span></span>`);
    setLabColor(this.lab,'#06121e');
  }
  // осаждающие армии видны как сферы у города, дрожат и светятся красным (как полевой бой)
  updateSiegeViz(now){
    _updateSiegeFX(now);                                                   // пыль/осколки (раз в кадр)
    const orbs=this.siegeOrbs;
    const bx=this._visualGX==null?this.gx:this._visualGX, bz=this._visualGZ==null?this.gz:this._visualGZ, by=this._visualY==null?this.baseY:this._visualY;
    if(!this.siege){
      for(const o in orbs){this._killSiegeOrb(orbs[o]);delete orbs[o];}    // старый рой (если остался) — убрать
      if(this._siegeLab)showLab(this._siegeLab,false);
      this.buildGroup.position.set(bx,by,bz);                              // снять тряску
      return;
    }
    for(const o in orbs){this._killSiegeOrb(orbs[o]);delete orbs[o];}      // рой осаждающих больше НЕ рисуем — бой идёт ВНУТРИ здания
    // ── как в Mushroom Wars: юниты просто зашли в здание, а из здания летит пыль + осколки и оно трясётся ──
    const beat=Math.floor(now/150);
    if(this._sBeat!==beat){ this._sBeat=beat;
      for(let d=0;d<2;d++){ const a=Math.random()*6.283, r=0.12+Math.random()*0.45;                        // 2 клуба пыли за удар → всегда видно с любого угла
        _spawnDust(bx+Math.cos(a)*r, by+0.2+Math.random()*0.6, bz+Math.sin(a)*r, 1.2+Math.random()*0.9); }  // пыль летит из здания
      if((beat&1)===0){ const a2=Math.random()*6.283; _spawnArrow(bx, by+0.5+Math.random()*0.4, bz, bx+Math.cos(a2)*1.45, by+0.03, bz+Math.sin(a2)*1.35); }  // осколок наружу
    }
    const sh=0.05;                                                          // здание вздрагивает от боя
    this.buildGroup.position.set(bx+Math.sin(now/43)*sh, by, bz+Math.cos(now/36)*sh);
    // ── красная цифра: суммарная осаждающая сила ──
    let total=0; for(const o in this.siege) total+=this.siege[o].units;
    if(!this._siegeLab){ this._siegeLab=document.createElement('div'); this._siegeLab.className='lab'; document.getElementById('labels').appendChild(this._siegeLab); }
    const v=new T3.Vector3(bx,by+0.72,bz).project(camera);
    if(v.z>1)showLab(this._siegeLab,false);
    else{ showLab(this._siegeLab,true); posLab(this._siegeLab,(v.x*.5+.5)*innerWidth,(-v.y*.5+.5)*innerHeight); setLabText(this._siegeLab,Math.ceil(total)); setLabColor(this._siegeLab,'#ff6a4a'); }
  }
  _killSiegeOrb(orb){ if(!orb)return; if(orb.mesh)scene.remove(orb.mesh); orb.lab&&orb.lab.remove(); if(orb.banner)scene.remove(orb.banner); }
}
const CITY_NAMES = CITY_LIST.map(c => c[0]);   // внутренние ключи (join): остаются на русском
// дисплей-имя города: локализованное имя по внутреннему ключу (фолбэк = русский ключ)
function cityDisp(idx){ const n=CITY_NAMES[idx]; if(typeof tName!=='function')return n;
  const m=/^(Верфь|Аэропорт) (.+)$/.exec(n);                              // динамические верфи/аэропорты: имя-джойн-ключ RU, локализуем при показе
  if(m)return t(m[1]==='Верфь'?'hud.yard_ship':'hud.yard_air',{city:tName('city',m[2])});
  return tName('city',n); }
