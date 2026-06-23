(function colyseusBridge(){
  const params = new URLSearchParams(location.search);
  const roomParam = params.get('mp') || params.get('room') || (params.has('cs') ? 'Игра' : '');
  if(!roomParam && !params.get('rid')) return;                    // без online-параметров — одиночная игра
  if(typeof MP==='undefined' || !MP.guest){ console.warn('[cs] online bootstrap не готов'); return; }
  const onMsg = MP._onMsg;                                       // guest-пайплайн (applySnap/reconcile), отдан из connect()
  if(!onMsg){ console.warn('[cs] нет onMsg'); return; }
  // сетевой транспорт полностью живёт в Colyseus bridge

  // эндпоинт: ?cs=wss://... → явный; иначе localhost → локальный :2567, прочее → прод (Colyseus Cloud)
  const PROD_ENDPOINT = 'wss://de-fra-fe578df7.colyseus.cloud';
  const csVal = params.get('cs');
  const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const ENDPOINT = (csVal && /^wss?:\/\//.test(csVal)) ? csVal
                 : isLocal ? ('ws://' + location.hostname + ':2567')
                 : PROD_ENDPOINT;
  const gy = (x,z)=> (typeof getTerrainHeight==='function'? getTerrainHeight(x,z) : 0);
  const WY = (typeof WATER_Y_SHIP!=='undefined'? WATER_Y_SHIP : -0.1);
  const PA = (typeof PLANE_ALT!=='undefined'? PLANE_ALT : 4.5);
  let client=null, room=null;

  // действия гостя (MP.cmd) → команды Colyseus
  MP.cmd = (o)=>{ if(!room) return;
    try{ switch(o.cmd){
      case 'buy':    room.send('buy',   {city:o.c, spec:String(o.spec)}); break;
      case 'upg':    room.send('upg',   {city:o.c, track:o.track}); break;
      case 'army':   room.send('send',  {from:o.a, to:o.b, pct:(o.pct||50)/100}); break;
      case 'war': case 'ally': case 'break': case 'sup':
                     room.send(o.cmd,   {tg:o.tg}); break;
      case 'peace': room.send('peace',  {tg:o.tg, land:!!o.land, money:o.money|0, repar:o.repar|0}); break;
      case 'bship':  room.send('bship', {city:o.c}); break;
      case 'bplane': room.send('bplane',{city:o.c}); break;
      case 'shipmove': (o.ids||[]).forEach(id=> room.send('shipmove',{id: parseInt(String(id).replace(/\D/g,''))||0, x:o.x, z:o.z})); break;
      case 'yard':   room.send('yard',  {city:o.c, kind:o.kind}); break;
      case 'airorder': room.send('airorder', {city:o.cityIdx, x:o.x, z:o.z, recall:o.recall}); break;
      case 'aa':     room.send('aa',    {city:o.c}); break;
      case 'research': room.send('research',{node:o.node}); break;
      case 'hero':   room.send('hero',  {h:o.h, ab:o.ab}); break;   // активка героя
      case 'summon': room.send('summon',{id:o.id}); break;          // 🎖 призыв героя за манпауэр
    } }catch(e){}
  };
  MP.send = ()=>{};                                              // joinInfo и пр. не нужны (фракция в join options)

  // выбор страны → join Colyseus за эту фракцию
  const prevSelect = window.selectCountry;
  window.selectCountry = function(c){ prevSelect(c);
    const fid = (typeof FACT_BY_COUNTRY!=='undefined' && FACT_BY_COUNTRY[c]!=null) ? FACT_BY_COUNTRY[c] : (typeof PLAYER!=='undefined'?PLAYER:0);
    joinColyseus(fid);
  };
  if(typeof window.researchNode==='function'){ const _rn=window.researchNode;
    window.researchNode=function(id){ if(room){ try{room.send('research',{node:id});}catch(e){} return; } _rn(id); }; }

  async function joinColyseus(fid){
    let t=0; while(typeof Colyseus==='undefined' && t++<120) await new Promise(r=>setTimeout(r,50));
    if(typeof Colyseus==='undefined'){ console.warn('[cs] colyseus.js не готов'); return; }
    if(!client) client = new Colyseus.Client(ENDPOINT);
    if(room){ try{ await room.leave(); }catch(e){} room=null; }
    const rid = params.get('rid');
    try{
      if(rid) room = await client.joinById(rid, { faction: fid });                                   // войти в конкретную комнату из лобби
      else if(params.has('create')) room = await client.create('game', { faction: fid, name: roomParam || 'Игра' }); // создать новую
      else room = await client.joinOrCreate('game', { faction: fid });                               // прямая ссылка
    }
    catch(e){ console.warn('[cs] join failed', e); alert('Не удалось подключиться к комнате: '+e.message); return; }
    MP.on = true;
    room.onMessage('assigned', (m)=>{
      const assignedFid = Number.isInteger(m&&m.faction) ? m.faction : fid;
      if(FACTIONS[assignedFid]){
        PLAYER=assignedFid; OWNER.PLAYER=assignedFid; PLAYER_COUNTRY=FACTIONS[assignedFid].country;
        FACTIONS.forEach(f=>f.isPlayer=f.id===assignedFid);
        MP._synced=false; MP._sawRunning=false;
        try{ toast(`${flagOf(PLAYER_COUNTRY)} Сервер назначил: ${PLAYER_COUNTRY}`); }catch(e){}
      }
    });
    const DENY = { war:'⚔ Война: не хватает политочков (нужно 50🏛) или перемирие', ally:'🤝 Союз отклонён или мало политочков', break:'💔 Разрыв: мало политочков', peace:'🕊 Мир: мало политочков или кулдаун', buy:'Найм: мало голды/манпауэра/места', upg:'Прокачка недоступна (голда/тир/оккупация)', research:'🔬 Мало голды или нет пререквизитов', bship:'⚓ Нужна верфь + tech + голда/манпауэр', bplane:'✈ Нужен аэродром + tech + голда/манпауэр', yard:'🏗 Верфь — в прибрежном городе; нужна голда', aa:'🛡 Мало голды/манпауэра', send:'⏳ Нет пути, война не объявлена, или идёт мобилизация (до 60с)', hero:'🎖 Способность на перезарядке или нет цели для удара', sup:'💰 Поддержка: нужно ≥20 голды в казне' };
    room.onMessage('denied', (m)=>{ try{ if(typeof toast==='function') toast(DENY[m&&m.cmd] || '⛔ Действие недоступно'); }catch(e){} });
    // 💰 поддержка принята сервером: показываем точную сумму и получателя (refreshDiplo подтянет новую голду из econ)
    room.onMessage('supDone', (m)=>{ try{ if(!m)return; const f=FACTIONS[m.to]; toast(`💰 Поддержка ${m.amt|0}💰 → ${f?f.country:''}`); if(typeof refreshDiplo==='function')refreshDiplo(); if(typeof buildPolWindow==='function'&&polWinOpen)buildPolWindow(); }catch(e){} });
    // приватная экономика: сервер шлёт голду/манпауэр/политочки только нашей фракции и союзников (врагов не видим)
    room.onMessage('econ', (m)=>{ try{ if(m&&m.econ) for(const fid in m.econ){ const e=m.econ[fid], i=+fid; gold[i]=e[0]; manpower[i]=e[1]; politPts[i]=e[2]; }
      if(m&&m.hero){ const H=m.hero, hs=heroSlots[PLAYER]||[];
        if(H.cd) H.cd.forEach((cd,i)=>{ if(hs[i]) hs[i].cd=cd.slice(); });   // авторитетные кулдауны активок
        heroBuffs = heroBuffs.filter(b=>b.fid!==PLAYER).concat((H.buffs||[]).map(b=>({fid:PLAYER,key:b.key,add:b.add,until:gameTime+b.t})));  // активные баффы (для heroAdd/дисплея)
        if(typeof refreshHeroBar==='function')refreshHeroBar();
      }
    }catch(e){} });
    // активный баланс комнаты с сервера: синкаем цены/эффекты узлов дерева на клиентские NODES (дерево покажет серверные числа)
    room.onMessage('balance', (m)=>{ try{ if(!m)return; MP._balance=m;
      try{ console.log('[cs] balance v'+(m.version!=null?m.version:'?')+(m.updatedAt?(' @'+m.updatedAt):'')); }catch(e){}
      if(m.tech&&m.tech.nodes&&typeof NODE!=='undefined'){
        for(const id in m.tech.nodes){ const sn=m.tech.nodes[id], cn=NODE[id]; if(cn) for(const k of ['g','t','a','d','e','p','s','slot','u','v']) if(sn[k]!==undefined) cn[k]=sn[k]; }
        if(typeof buildTechWindow==='function')buildTechWindow();
      }
      if(m.heroes){ const P=m.heroes.pool||{};
        for(const id in P){ const sd=P[id]; let cd=HEROES.find(h=>h.id===id);   // синк пула с сервера в HEROES (Directus может править абилки/КД/эффекты)
          if(!cd){ cd={id, cost:0}; HEROES.push(cd); }
          cd.name=sd.name; cd.face=sd.face; cd.col=sd.col; cd.abilities=sd.abilities; }
        if(m.heroes.maxSlots!=null)HERO_SLOTS_MAX=m.heroes.maxSlots;             // потолок слотов с сервера
        if(Array.isArray(m.heroes.slots))                                       // герои нашей страны: авто-набор + призванные за манпауэр
          heroSlots[PLAYER]=m.heroes.slots.map(id=>{ const d=HEROES.find(h=>h.id===id); return {id, cd:(d?d.abilities.filter(a=>a.kind==='active'):[]).map(()=>0)}; });
        if(typeof buildHeroBar==='function')buildHeroBar();
        const hw=document.getElementById('heroWin'); if(typeof buildHeroPick==='function'&&hw&&hw.style.display==='flex')buildHeroPick();   // окно призыва открыто → обновить (отметить призванного)
      }
      if(m.politics){ const P=m.politics;   // полный синк политики из баланса (кнопки войны/союза/мира, мобилизация, rate/перемирие/кд мира)
        if(P.warPrep!=null)WAR_PREP=P.warPrep;
        if(P.costWar!=null)POLIT_WAR=P.costWar; if(P.costAlly!=null)POLIT_ALLY=P.costAlly;
        if(P.costBreak!=null)POLIT_BREAK=P.costBreak; if(P.costPeace!=null)POLIT_PEACE=P.costPeace;
        if(P.start!=null)POLIT_START=P.start; if(P.max!=null)POLIT_MAX=P.max;
        if(P.rateBase!=null)POLIT_RATE_BASE=P.rateBase; if(P.perCity!=null)POLIT_PER_CITY=P.perCity;
        if(P.perTier!=null)POLIT_PER_TIER=P.perTier; if(P.rateMax!=null)POLIT_RATE_MAX=P.rateMax;
        if(P.truceTime!=null)TRUCE_TIME=P.truceTime; if(P.peaceCd!=null)PEACE_CD=P.peaceCd;
      }
      if(m.prices){ const K=m.prices;        // показ цен юнитов/экономики из баланса (найм/корабли/самолёты/ПВО/верфь/прокачка)
        if(K.SOLDIER_PRICE!=null)SOLDIER_PRICE=K.SOLDIER_PRICE;
        if(K.HERO_SUMMON_MP!=null)HERO_SUMMON_MP=K.HERO_SUMMON_MP;   // 🎖 манпауэр за призыв героя
        if(K.SHIP_COST!=null)SHIP_COST=K.SHIP_COST; if(K.SHIP_MP!=null)SHIP_MP=K.SHIP_MP;
        if(K.PLANE_COST!=null)PLANE_COST=K.PLANE_COST; if(K.PLANE_MP!=null)PLANE_MP=K.PLANE_MP;
        if(K.AA_COST_BASE!=null)AA_COST_BASE=K.AA_COST_BASE; if(K.AA_COST_STEP!=null)AA_COST_STEP=K.AA_COST_STEP; if(K.AA_MP!=null)AA_MP=K.AA_MP;
        if(K.SHIPYARD_BUILD_COST!=null)SHIPYARD_BUILD_COST=K.SHIPYARD_BUILD_COST; if(K.AIRPORT_BUILD_COST!=null)AIRPORT_BUILD_COST=K.AIRPORT_BUILD_COST;
        if(K.UPGRADE_COST_BASE!=null)UPGRADE_COST_BASE=K.UPGRADE_COST_BASE; if(K.UPGRADE_COST_STEP!=null)UPGRADE_COST_STEP=K.UPGRADE_COST_STEP;
        // юнит-статы + манпауэр-формула + бой/ПВО/башни — для локального показа/оценок (на сервере авторитетно; движение/координатно-зависимые конст. не синкаем)
        if(K.SHIP_HP!=null)SHIP_HP=K.SHIP_HP; if(K.SHIP_DMG!=null)SHIP_DMG=K.SHIP_DMG;
        if(K.PLANE_HP!=null)PLANE_HP=K.PLANE_HP; if(K.PLANE_DMG!=null)PLANE_DMG=K.PLANE_DMG; if(K.PLANE_BOMB_DMG!=null)PLANE_BOMB_DMG=K.PLANE_BOMB_DMG; if(K.PLANE_BOMB_CD!=null)PLANE_BOMB_CD=K.PLANE_BOMB_CD;
        if(K.MP_BASE!=null)MP_BASE=K.MP_BASE; if(K.MP_PER_SIZE!=null)MP_PER_SIZE=K.MP_PER_SIZE; if(K.MP_PER_TIER!=null)MP_PER_TIER=K.MP_PER_TIER;
        if(K.MP_RATE_BASE!=null)MP_RATE_BASE=K.MP_RATE_BASE; if(K.MP_RATE_PER_SIZE!=null)MP_RATE_PER_SIZE=K.MP_RATE_PER_SIZE; if(K.MP_RATE_PER_TIER!=null)MP_RATE_PER_TIER=K.MP_RATE_PER_TIER; if(K.MP_CAPITAL!=null)MP_CAPITAL=K.MP_CAPITAL;
        if(K.TOWER_FIRE_CD!=null)TOWER_FIRE_CD=K.TOWER_FIRE_CD; if(K.TOWER_DMG_BASE!=null)TOWER_DMG_BASE=K.TOWER_DMG_BASE; if(K.TOWER_RANGE_BASE!=null)TOWER_RANGE_BASE=K.TOWER_RANGE_BASE; if(K.TOWER_RANGE_PER!=null)TOWER_RANGE_PER=K.TOWER_RANGE_PER; if(K.CITY_BOMBARD_RANGE!=null)CITY_BOMBARD_RANGE=K.CITY_BOMBARD_RANGE;
        if(K.AA_RANGE!=null)AA_RANGE=K.AA_RANGE; if(K.AA_CD!=null)AA_CD=K.AA_CD; if(K.AA_DMG!=null)AA_DMG=K.AA_DMG; if(K.AA_MAX!=null)AA_MAX=K.AA_MAX;
        if(K.FIGHT_RATE!=null)FIGHT_RATE=K.FIGHT_RATE; if(K.SIEGE_ATK!=null)SIEGE_ATK=K.SIEGE_ATK; if(K.SIEGE_DEF!=null)SIEGE_DEF=K.SIEGE_DEF;
      }
      // перерисовать UI, где показаны эти числа (дипломатия/политика/панель/кнопка мира)
      try{ const pp=document.getElementById('peacePropose'); if(pp)pp.textContent=`Предложить мир (${POLIT_PEACE}🏛)`;
        if(typeof updatePanel==='function')updatePanel();
        if(typeof refreshPol==='function')refreshPol();
        if(typeof diploTarget!=='undefined'&&diploTarget!=null&&typeof refreshDiplo==='function')refreshDiplo();
      }catch(e){}
    }catch(e){} });
    room.onStateChange((state)=> push(state));
    console.log('[cs] joined room', room.roomId, 'as faction', fid);
  }

  function push(state){
    // 🆕 динамические верфи/аэродромы: сервер прислал НОВЫЙ город (idx за пределами карты) → создаём локально ДО снапшота
    push._by=push._by||{};
    state.cities.forEach((cc,key)=>{ const idx=Number(key);
      if(idx>=CITY_DATA.length && !push._by[idx] && !cities.some(c2=>c2.idx===idx)){
        const ship=!!cc.shipyard, gx=cc.gx, gz=cc.gz;
        let par=null,bd=1e18; for(const c2 of cities){ const dd=(c2.gx-gx)**2+(c2.gz-gz)**2; if(dd<bd){bd=dd;par=c2;} }   // родитель — ближайший город
        CITY_NAMES[idx]=(ship?'Верфь ':'Аэропорт ')+(par?CITY_NAMES[par.idx]:''); (ship?SHIPYARD_NAMES:AIRPORT_NAMES).add(CITY_NAMES[idx]);
        const yc=new City(gx,gz,par?par.country:0,1,cc.owner,idx); cities.push(yc); push._by[idx]=yc; push._n=cities.length;
        if(par&&typeof addEdgeRuntime==='function'){try{addEdgeRuntime(idx,par.idx);}catch(e){}}
      }
    });
    const c=[]; state.cities.forEach((cc,key)=> c.push([Number(key), cc.owner, cc.units, cc.spec, cc.tier, cc.occ, cc.queued|0, cc.siegeUnits|0, cc.siegeOwner|0, cc.prodTime|0, cc.prodElapsed|0, cc.shipQ|0, cc.shipT|0, cc.planeQ|0, cc.planeT|0]));
    const rel=[]; state.relations.forEach((v,k)=> rel.push([k, v===1?'war':'ally']));
    const ws=[]; if(state.warStart) state.warStart.forEach((v,k)=> ws.push([k, v]));   // время начала каждой войны → отсчёт мобилизации (60с)
    onMsg({ data: JSON.stringify({ t:'snap', time:+state.clock||0, over:0, c, rel, ws }) });   // экономика идёт отдельным сообщением 'econ' (приватно)
    // 🔬 технологии: активные исследования игрока (прогресс таймера) + завершённые техи всех фракций (разблокировки)
    if(typeof techRes!=='undefined' && state.research){
      const mine = state.research.get(String(PLAYER)); const arr=[];
      if(mine) for(const part of mine.split(';')){ const [id,td]=part.split(':'); if(id) arr.push({ id, t:(+td||0)/10 }); }
      techRes[PLAYER]=arr;
    }
    if(typeof techDone!=='undefined' && state.tech){ push._techSig=push._techSig||{};
      state.tech.forEach((ids,k)=>{ const fid=+k; if(push._techSig[fid]!==ids){ push._techSig[fid]=ids;
        techDone[fid]=new Set(ids?ids.split(','):[]); try{recomputeTech(fid);}catch(e){}
        if(fid===PLAYER&&typeof buildTechWindow==='function'){try{buildTechWindow();}catch(e){}} } });
    }
    // синк динамических верфей/аэродромов на локальные города (чтобы появился UI постройки)
    if(!push._by || push._n!==cities.length){ push._by={}; for(const cc of cities)push._by[cc.idx]=cc; push._n=cities.length; }
    state.cities.forEach((cc,key)=>{ const lc=push._by[Number(key)]; if(lc){ lc.isShipyard=!!cc.shipyard; lc.isAirport=!!cc.airport; lc.aa=cc.aa|0; } });
    const e=[], DQ=1/64;   // позиции пришли как fixed-point uint16 (×64 на сервере) — делим обратно
    state.squads.forEach((s,id)=>{ const x=s.x*DQ, z=s.z*DQ; e.push(['sq'+id, 0, s.owner, x, gy(x,z)+0.2, z, s.count]); });
    state.ships .forEach((s,id)=> e.push(['sh'+id, 1, s.owner, s.x*DQ, WY, s.z*DQ, 0]));
    state.planes.forEach((s,id)=> e.push(['pl'+id, 2, s.owner, s.x*DQ, PA, s.z*DQ, 0]));
    onMsg({ data: JSON.stringify({ t:'ent', e }) });
    // плашка статуса: реальное имя комнаты + страна + число игроков (с сервера, без путающего «ГОСТЬ»)
    if(MP._pill){
      const ctry = (typeof FACTIONS!=='undefined' && FACTIONS[PLAYER]) ? FACTIONS[PLAYER].country : '';
      MP._pill.textContent = `🌐 ${state.roomName||'Игра'} · ${ctry} · 👥 ${state.playerCount||1}`;
    }
  }

  const sc=document.createElement('script'); sc.src='vendor/colyseus.js';
  sc.onerror=()=>console.warn('[cs] colyseus.js не загрузился');
  document.head.appendChild(sc);
  console.log('[cs] мост активен — выберите страну для входа на Colyseus');
})();
