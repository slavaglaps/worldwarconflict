/* ── City ───────────────────────────────────────────────────── */
class City{
  constructor(gx,gz,country,size,owner,idx){
    this.gx=gx; this.gz=gz; this.country=country; this.size=size; this.owner=owner; this.idx=idx;
    this.occ=false; this.occFrom=null;   // оккупация: занят в войне, но не аннексирован (решается миром)
    this.spec=null; this.tier=0;
    this.prodTier=0; this.defTier=0; this.atkTier=0;
    this.isShipyard=SHIPYARD_NAMES.has(CITY_NAMES[idx]); // верфь
    this.isAirport=AIRPORT_NAMES.has(CITY_NAMES[idx]);   // аэропорт
    this.shipQueue=0; this.shipTimer=0;   // очередь кораблей
    this.planeQueue=0; this.planeTimer=0; // очередь самолётов
    this.units = 8+this.size*4; // стартовый гарнизон по размеру
    this.aa=0; this.aaTimer=0;   // 🚀 зенитки (ПВО) и таймер залпа
    this.goldTimer=0; this.batches=[]; this.boosted=false;
    this.capital = false;
    // position on terrain
    const terrainH = getTerrainHeight(gx, gz);
    const baseY = terrainH;
    this.baseY = baseY;
    this.buildGroup=new T3.Group();
    this.buildGroup.position.set(gx,baseY,gz);
    scene.add(this.buildGroup);
    this.mats=[];
    this.buildMeshes();
    this.buildGroup.scale.setScalar(CITY_SCALE); // города крупнее
    // hitbox for raycast
    this.hit=new T3.Mesh(new T3.CylinderGeometry(0.55*CITY_SCALE,0.55*CITY_SCALE,2.4*CITY_SCALE,10),
      new T3.MeshBasicMaterial({visible:false}));
    this.hit.position.set(this.gx,this.baseY+0.8*CITY_SCALE,this.gz); this.hit.userData.city=this; scene.add(this.hit);
    // selection ring
    this.ring=new T3.Mesh(new T3.TorusGeometry(0.62*CITY_SCALE,0.06*CITY_SCALE,8,28),
      new T3.MeshBasicMaterial({color:0xffffff}));
    this.ring.rotation.x=Math.PI/2; this.ring.position.set(this.gx,this.baseY+0.03,this.gz); this.ring.visible=false;
    scene.add(this.ring);
    // кольцо радиуса обстрела (видно при выборе atk-города)
    this.rangeRing=new T3.Mesh(new T3.TorusGeometry(1,0.12,8,64),
      new T3.MeshBasicMaterial({color:0xff7a3a,transparent:true,opacity:0.5}));
    this.rangeRing.rotation.x=Math.PI/2; this.rangeRing.position.set(this.gx,this.baseY+0.1,this.gz);
    this.rangeRing.visible=false; this._ringR=0; scene.add(this.rangeRing);
    // production ring
    this.pring=new T3.Mesh(new T3.TorusGeometry(0.7*CITY_SCALE,0.05*CITY_SCALE,8,32,0.001),
      new T3.MeshBasicMaterial({color:0xff9a4a}));
    this.pring.rotation.x=Math.PI/2; this.pring.position.set(this.gx,this.baseY+0.05,this.gz); this.pring.visible=false;
    scene.add(this.pring);
    // battle ring (осада)
    this.siege=null; // {ownerId:{units,atkMult}}
    this.bring=new T3.Mesh(new T3.TorusGeometry(0.55*CITY_SCALE,0.055*CITY_SCALE,8,28),
      new T3.MeshBasicMaterial({color:0xff5030}));
    this.bring.rotation.x=Math.PI/2; this.bring.position.set(this.gx,this.baseY+0.08,this.gz); this.bring.visible=false;
    scene.add(this.bring);
    this.siegeOrbs={};  // ownerId → {mesh,lab} осаждающие армии (видимы как в бою)
    // dom label
    this.lab=document.createElement('div'); this.lab.className='lab';
    document.getElementById('labels').appendChild(this.lab);
  }
  branchTier(track){const v=this[track+'Tier'];return v==null?(this.spec===track?this.tier:0):v;}
  get totalTier(){return this.branchTier('prod')+this.branchTier('def')+this.branchTier('atk');}
  get visualTier(){return Math.max(this.branchTier('prod'),this.branchTier('def'),this.branchTier('atk'));}
  syncLegacyTier(track){this.spec=track;this.tier=this.visualTier;}
  get capacity(){let c=CITY_CAP_BASE+this.size*CITY_CAP_PER_SIZE;c*=1+CITY_DEF_CAP_PER_TIER*this.branchTier('def');if(this.boosted)c*=CITY_BOOST_CAP;return c*techVal(this.owner,'cc');}
  get goldInterval(){let g=CITY_GOLD_INTERVAL;g*=Math.pow(CITY_PROD_GOLD_DECAY,this.branchTier('prod'));if(this.boosted)g*=CITY_BOOST_GOLD;return g/techMul(this.owner,'eco');}
  get goldRate(){return this.size/this.goldInterval;}
  get defMult(){return (1+CITY_DEF_MULT_PER_TIER*this.branchTier('def'))*techMul(this.owner,'def');}
  get atkMult(){return (1+CITY_ATK_MULT_PER_TIER*this.branchTier('atk'))*techMul(this.owner,'atk');}
  get speedMult(){return (1+.18*this.branchTier('atk'))*techMul(this.owner,'speed');}
  get fireRange(){const tier=this.branchTier('atk');return tier>0?(TOWER_RANGE_BASE+TOWER_RANGE_PER*tier)*techVal(this.owner,'tr'):0;}
  get fireDmg(){return (TOWER_DMG_BASE+this.branchTier('atk'))*techMul(this.owner,'atk')*techVal(this.owner,'td');}
  get trainPer(){let t=CITY_TRAIN_BASE-this.size*CITY_TRAIN_PER_SIZE;if(this.boosted)t*=CITY_BOOST_TRAIN;return t/techMul(this.owner,'prod');}
  get queued(){return this.batches.reduce((s,b)=>s+b.count,0);}

  buildMeshes(){
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
      this.pring.geometry.dispose();
      this.pring.geometry=new T3.TorusGeometry(0.7*CITY_SCALE,0.05*CITY_SCALE,8,32,Math.max(0.001,frac*Math.PI*2));
      this.pring.position.y=(this._visualY==null?this.baseY:this._visualY)+this.topY*CITY_SCALE+0.35;
    } else this.pring.visible=false;
  }
  updateLabel(){
    const v=new T3.Vector3(this._visualGX==null?this.gx:this._visualGX,(this._visualY==null?this.baseY:this._visualY)+this.topY*CITY_SCALE+0.7,this._visualGZ==null?this.gz:this._visualGZ).project(camera);
    if(v.z>1){showLab(this.lab,false);return;}
    showLab(this.lab,true);
    posLab(this.lab,(v.x*0.5+0.5)*innerWidth,(-v.y*0.5+0.5)*innerHeight);
    const q=this.queued;
    const nm=`<span class="nm">${CITY_NAMES[this.idx]}</span>`; // имя для ВСЕХ городов
    // гарнизон трясётся красным когда обороняется
    const def=this.siege?'<span style="color:#ff6a4a">🛡</span>':'';
    const occm=this.occ?`<span style="color:#${(OWNER_COL[this.occFrom]||0).toString(16).padStart(6,'0')};text-shadow:0 0 2px #000">⚑</span>`:''; // занят (флаг де-юре владельца)
    const aa=this.aa>0?`<span class="aa">🚀${this.aa}</span>`:''; // 🚀 зенитки (ПВО)
    setLabHTML(this.lab,`${occm}${def}${Math.round(this.units)}${aa}${q>0?`<span class="q">⏳${q}</span>`:''}${nm}`);
    setLabColor(this.lab,'#06121e');
  }
  // осаждающие армии видны как сферы у города, дрожат и светятся красным (как полевой бой)
  updateSiegeViz(now){
    const orbs=this.siegeOrbs;
    if(!this.siege){
      for(const o in orbs){scene.remove(orbs[o].mesh);orbs[o].lab.remove();delete orbs[o];}
      // снять тряску города
      this.buildGroup.position.set(this._visualGX==null?this.gx:this._visualGX,this._visualY==null?this.baseY:this._visualY,this._visualGZ==null?this.gz:this._visualGZ);
      return;
    }
    // удалить орбы пуллов, что уже не осаждают
    for(const o in orbs){if(!this.siege[o]){scene.remove(orbs[o].mesh);orbs[o].lab.remove();delete orbs[o];}}
    let k=0;
    for(const o of Object.keys(this.siege)){
      const pool=this.siege[o];
      let orb=orbs[o];
      if(!orb){
        const sz=0.2+Math.min(0.16,pool.units*0.004);
        const mesh=new T3.Mesh(new T3.SphereGeometry(0.24,12,10),
          new T3.MeshLambertMaterial({color:OWNER_COL[o],emissive:new T3.Color(0x6b1a12)}));
        mesh.castShadow=true; scene.add(mesh);
        const lab=document.createElement('div'); lab.className='lab';
        document.getElementById('labels').appendChild(lab);
        orb=orbs[o]={mesh,lab};
      }
      // сторона по индексу пулла, чуть за кольцом города
      const ang=k*2.1+0.6;
      const ox=this.gx+Math.cos(ang)*0.78, oz=this.gz+Math.sin(ang)*0.78;
      const j=now/70+ox*3;
      const s=0.85+Math.min(0.9,pool.units*0.012);
      orb.mesh.scale.setScalar(s);
      orb.mesh.position.set(ox+Math.sin(j*1.7)*0.08, this.baseY+0.55+Math.abs(Math.sin(j))*0.1, oz+Math.cos(j*1.3)*0.08);
      // подсветка-пульс боя
      orb.mesh.material.emissive.setHex(Math.sin(now/90+k)>0?0x8a1c10:0x3a0c06);
      const v=new T3.Vector3(orb.mesh.position.x,orb.mesh.position.y+0.4,orb.mesh.position.z).project(camera);
      if(v.z>1)showLab(orb.lab,false);
      else{showLab(orb.lab,true);
        posLab(orb.lab,(v.x*.5+.5)*innerWidth,(-v.y*.5+.5)*innerHeight);
        setLabText(orb.lab,Math.ceil(pool.units)); setLabColor(orb.lab,'#ff6a4a');}
      k++;
    }
    // город трясётся под штурмом
    const cj=now/60;
    const bx=this._visualGX==null?this.gx:this._visualGX,bz=this._visualGZ==null?this.gz:this._visualGZ,by=this._visualY==null?this.baseY:this._visualY;
    this.buildGroup.position.set(bx+Math.sin(cj*1.9)*0.04,by,bz+Math.cos(cj*1.6)*0.04);
  }
}
const CITY_NAMES = CITY_LIST.map(c => c[0]);
