/* ── Фаза 2: проектор локального серверного Sim → клиентский рендер ────────
   projectLocalSim(sim, onMsg): читает НАСТОЯЩИЙ серверный Sim (loadServerSim)
   и шлёт те же сообщения, что MP-мост (push в game.net.js): 'snap' (города +
   дипломатия) и 'ent' (отряды/корабли/самолёты). Тот же формат → тот же
   guest-рендер. econ/tech синкаются напрямую из sim (соло — без приватности).
   Координаты sim уже в мировых (грид 0..256) — QPOS-квантование не нужно (это
   делал только Colyseus ради трафика). spec-кодировка совпадает с сервером. */
var _SOLO_SPEC2ID = { prod: 1, def: 2, atk: 3 };   // = server SPEC_ID (SPEC2ID в loop.js — локальный, недоступен тут)
function projectLocalSim(sim, onMsg) {
  // 🌫 туман войны в соло: та же математика видимости, что на сервере (sim/vision.js)
  const _V = (window.__WWCSim && window.__WWCSim.vision) || null;
  // 🗼 башни из меню строительства дают обзор: постройки живут на клиенте — кладём их в sim.towers
  if (_V) {
    sim.towers = sim.towers || [];
    sim.towers.length = 0;
    if (window.MAP_BUILDINGS) for (const b of window.MAP_BUILDINGS)
      if (b && b.item && b.item.role === 'tower') sim.towers.push({ owner: b.owner, x: b.gx, z: b.gz });
  }
  const _mask = _V ? _V.visionMask(sim, PLAYER) : null;
  const _G = sim.K.GRID;
  const inVision = (x, z) => { if (!_mask) return true; const cx = Math.round(x), cz = Math.round(z);
    return cx >= 0 && cz >= 0 && cx < _G && cz < _G && _mask[cx * _G + cz] === 1; };
  // ── города (тапл как в push(): [idx,owner,units,spec,tier,occ,queued,siegeU,siegeO,prodT,prodE,shipQ,shipT,planeQ,planeT]) ──
  const c = [];
  for (const cc of sim.cities) {
    // 🌫 город вне вижена → «оболочка»: units=null (applyCity заморозит last-seen)
    if (!(cc.owner === PLAYER || sim.allied(PLAYER, cc.owner) || inVision(cc.gx, cc.gz))) {
      c.push([cc.idx, cc.owner, null, 0, 0, cc.occ ? 1 : 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        null, null, null, cc.occ && cc.occFrom != null ? cc.occFrom : 255, null]);
      continue;
    }
    const b0 = cc.batches && cc.batches[0];
    let su = 0, so = 0;
    if (cc.siege) for (const o in cc.siege) if (cc.siege[o].units > su) { su = cc.siege[o].units; so = +o; }
    const q = (cc.batches || []).slice(0, 6).map(b => [
      Math.round(b.count || 0),
      Math.round((b.time || 0) * 10),
      Math.round((b.elapsed || 0) * 10),
      b.type || cc.recruitType || 'inf',
    ]);
    c.push([cc.idx, cc.owner, Math.round(cc.units), (_SOLO_SPEC2ID[cc.spec] || 0), cc.tier, cc.occ ? 1 : 0,
      Math.round(cc.queued || 0), Math.round(su), so,
      b0 ? Math.round(b0.time * 10) : 0, b0 ? Math.round(b0.elapsed * 10) : 0,
      cc.shipQueue | 0, Math.round((cc.shipTimer || 0) * 10), cc.planeQueue | 0, Math.round((cc.planeTimer || 0) * 10),
      cc.branchTier('prod'), cc.branchTier('def'), cc.branchTier('atk'),
      cc.comp ? Math.round(cc.comp.inf) : Math.round(cc.units), cc.comp ? Math.round(cc.comp.arc) : 0, cc.comp ? Math.round(cc.comp.cav) : 0,
      cc.occ && cc.occFrom != null ? cc.occFrom : 255, q]);   // [18..20] 👥 состав, [21] occFrom, [22] queue
  }
  const rel = []; for (const k in sim.relations) rel.push([k, sim.relations[k]]);             // 'war'|'ally'
  const ws = []; for (const k in sim.warSince) if (sim.relations[k] === 'war') ws.push([k, sim.warSince[k]]);
  const owners = new Set(); for (const cc of sim.cities) owners.add(cc.owner);                // конец партии = осталась ≤1 фракция
  onMsg({ data: JSON.stringify({ t: 'snap', time: +sim.time || 0, over: owners.size <= 1 ? 1 : 0, c, rel, ws }) });

  // ── движущиеся сущности (id,kind,owner,x,y,z,count); kind 0=отряд 1=корабль 2=самолёт ──
  const gy = (x, z) => (typeof getTerrainHeight === 'function' ? getTerrainHeight(x, z) : 0);
  const WY = (typeof WATER_Y_SHIP !== 'undefined' ? WATER_Y_SHIP : -0.1);
  const PA = (typeof PLANE_ALT !== 'undefined' ? PLANE_ALT : 4.5);
  const e = [];
  const moverVisible = (o, x, z) => o === PLAYER || sim.allied(PLAYER, o) || inVision(x, z);   // 🌫 чужие видны только в вижене
  for (const s of sim.squads) {
    if (!moverVisible(s.owner, s.x, s.z)) continue;
    let x = s.x, z = s.z;                                          // прямая интерполяция ребра…
    let ea = null, eb = null, ef = 0;                              // текущее ребро + доля пути — для потока юнитов (UNIT_STREAM)
    if (typeof hexRoadPos === 'function' && s.path) {              // …но рисуем ВДОЛЬ визуальной дороги — и В БОЮ тоже (иначе прыжок с дороги при сцепке)
      const a = s.path[s.hop], b = s.path[s.hop + 1];
      if (a != null && b != null) {
        const ed = sim.edgeBetween(a, b), frac = ed && ed.len ? Math.min(1, s.prog / ed.len) : 0;
        const rp = hexRoadPos(a, b, frac);
        if (rp) { x = rp.x; z = rp.z; ea = a; eb = b; ef = frac; }
      }
    }
    e.push(['sq' + s.id, 0, s.owner, x, gy(x, z) + 0.2, z, Math.round(s.fcount), s.foe ? 1 : 0, ea, eb, ef,
      s.comp ? Math.round(s.comp.inf) : Math.round(s.fcount), s.comp ? Math.round(s.comp.arc) : 0, s.comp ? Math.round(s.comp.cav) : 0, s.mode | 0, 0, s.heading || 0]);  // [7]=fighting; [8..10]=ребро; [11..13] состав; [14]=🚢 mode; [16]=курс(рад)
    if ((s.mode | 0) === 2) e.push(['shq' + s.id, 1, s.owner, x, WY, z, 0, s.heading || 0]);   // 🚢 ОТДЕЛЬНЫЙ корабль над водой (kind-1, авторитетный курс [7]) — в визуальной позиции отряда
  }
  for (const s of sim.ships) if (moverVisible(s.owner, s.x, s.z)) e.push(['sh' + s.id, 1, s.owner, s.x, WY, s.z, 0]);
  for (const p of sim.planes) if (moverVisible(p.owner, p.x, p.z)) e.push(['pl' + p.id, 2, p.owner, p.x, PA, p.z, 0]);
  onMsg({ data: JSON.stringify({ t: 'ent', e }) });
}

let _lsHeroSig = '';
let _lsTechSig = '';
let _lsPendingCmds = [];

function syncLocalHeroes(sim) {
  if (!sim || !sim.heroSlots) return;
  if (sim.heroMaxSlots != null) HERO_SLOTS_MAX = sim.heroMaxSlots;
  const src = sim.heroSlots[PLAYER] || [];
  const buffSrc = sim.heroBuffs || [];
  const sig = JSON.stringify({
    p: PLAYER,
    slots: src.map(h => [h.id, h.cd || []]),
    buffs: buffSrc.filter(b => b.fid === PLAYER).map(b => [b.key, b.add, Math.max(0, (b.until || 0) - sim.time)]),
  });
  heroBuffs = buffSrc.map(b => ({ fid: b.fid, key: b.key, add: b.add, until: gameTime + Math.max(0, (b.until || 0) - sim.time) }));
  if (sig === _lsHeroSig) return;
  _lsHeroSig = sig;
  heroSlots[PLAYER] = src.map(h => {
    const d = heroDef(h.id);
    const actives = d ? d.abilities.filter(a => a.kind === 'active') : [];
    const cd = Array.isArray(h.cd) ? h.cd.slice() : actives.map(() => 0);
    while (cd.length < actives.length) cd.push(0);
    return { id: h.id, cd };
  });
  if (typeof buildHeroBar === 'function') buildHeroBar();
  const hw = document.getElementById('heroWin');
  if (typeof buildHeroPick === 'function' && hw && hw.style.display === 'flex') buildHeroPick();
}

// Экономика/техи/герои соло: напрямую из sim в клиентские массивы (без приватности — это игра игрока).
function syncLocalEcon(sim) {
  for (let f = 0; f < sim.factions; f++) { gold[f] = sim.gold[f]; manpower[f] = sim.manpower[f]; politPts[f] = sim.politPts[f]; }
  if (typeof techDone !== 'undefined' && sim.techDone) for (let f = 0; f < sim.factions; f++) {
    if (sim.techDone[f]) { techDone[f] = new Set(sim.techDone[f]); try { recomputeTech(f); } catch (e) {} }
  }
  if (typeof techRes !== 'undefined' && sim.techRes && sim.techRes[PLAYER]) techRes[PLAYER] = sim.techRes[PLAYER].map(r => ({ id: r.id, t: r.t }));
  if (typeof buildTechWindow === 'function' && typeof techWinOpen !== 'undefined') {
    const doneSig = (sim.techDone || []).map(s => Array.from(s || []).sort().join(',')).join('|');
    const resSig = (sim.techRes && sim.techRes[PLAYER] ? sim.techRes[PLAYER] : []).map(r => r.id).join(',');
    const sig = doneSig + '//' + PLAYER + ':' + resSig;
    if (sig !== _lsTechSig) {
      _lsTechSig = sig;
      if (techWinOpen) buildTechWindow();
    }
  }
  syncLocalHeroes(sim);
}

// ── Фаза 2.2: соло на НАСТОЯЩЕМ серверном Sim (opt-in ?ls=1) ──────────────────
// Соло становится «гостем собственного локального Sim»: тикаем Sim в браузере,
// проектируем в guest-рендер (MP._onMsg), команды игрока шлём в sim.cmd*.
let LOCALSIM = null, _lsApi = null, _lsMap = null, _lsReady = false, _lsPendingStart = false;

async function initLocalSim() {
  MP.cmd = localSimCmd;                                  // команды игрока → локальный сим (сразу; no-op пока LOCALSIM=null)
  try {
    _lsApi = await loadServerSim();                      // настоящий server/sim/ в браузере
    _lsMap = await (await fetch('sim/map-data.json')).json();
    if (typeof ensureHexRoadSamplesForMap === 'function') ensureHexRoadSamplesForMap(_lsMap);
    _lsReady = true;
    const _prev = window.selectCountry;                  // создавать/пересоздавать сим при выборе страны
    window.selectCountry = function (c) { _prev(c); startLocalSim(); };
    if (_lsPendingStart) { _lsPendingStart = false; startLocalSim(); }
    console.log('[ls] локальный серверный Sim готов');
  } catch (e) { console.error('[ls] не удалось поднять локальный сим:', e); }
}

// map-data.json держит страны РАЗДЕЛЬНО (Испания/Португалия/сканд.), а клиент их СЛИВАЕТ
// (COUNTRY_ALIASES → Иберия / Северная империя). Приводим карту сима к клиентскому списку фракций
// (тот же порядок и id, что FACTIONS), иначе PLAYER-индекс попадает в другую страну (Россия→Болгария).
function simMapForClient(raw) {
  if (typeof FACTIONS === 'undefined' || !Array.isArray(FACTIONS) || !FACTIONS.length || typeof canonicalCountry !== 'function') return raw;
  const factions = FACTIONS.map(f => ({ id: f.id, country: f.country, color: f.color }));
  const nameToId = {}; factions.forEach(f => { nameToId[f.country] = f.id; });
  const oldToNew = {};                                    // старый id фракции (32) → новый канонический (29)
  raw.factions.forEach(f => { const canon = canonicalCountry(f.country); oldToNew[f.id] = nameToId[canon] != null ? nameToId[canon] : 0; });
  const cities = raw.cities.map(c => {
    const canon = canonicalCountry(c.country);
    return Object.assign({}, c, { country: canon, owner: oldToNew[c.owner] != null ? oldToNew[c.owner] : (nameToId[canon] != null ? nameToId[canon] : 0) });
  });
  return Object.assign({}, raw, { factions, cities });    // edges ссылаются на idx городов → без изменений
}
function startLocalSim() {
  if (!_lsReady) { _lsPendingStart = true; return; }     // страну выбрали раньше загрузки — стартуем, как загрузится
  const balance = _lsApi.makeBalance({ factionDefault: { gold: 200, polit: 80, heroes: [] } });   // прод-старты как на сервере; героев игрок призывает сам
  LOCALSIM = new _lsApi.Sim({ map: simMapForClient(_lsMap), balance, ai: true });
  LOCALSIM.humanFactions = new Set([PLAYER]);            // ИИ не управляет игроком
  LOCALSIM._clientTowerDmg = true;                        // соло: урон башен по юнитам наносит КЛИЕНТ в момент попадания трассера (сим только выбирает цель)
  if (typeof LOCALSIM.clearFactionHeroes === 'function') LOCALSIM.clearFactionHeroes(PLAYER);
  _lsHeroSig = '';
  _lsTechSig = '';
  gameOver = false;
  projectLocalSim(LOCALSIM, MP._onMsg); syncLocalEcon(LOCALSIM);   // первый кадр — сразу состояние
  const pending = _lsPendingCmds.splice(0);
  for (const cmd of pending) localSimCmd(cmd);
}

function localSimStep(gdt) {                              // вызывается из loop() каждый кадр в режиме ?ls
  if (!LOCALSIM || gameOver || gdt <= 0) return;
  LOCALSIM.tick(gdt);
  projectLocalSim(LOCALSIM, MP._onMsg);                  // → applySnap (города/дипломатия/gameTime) + reconcile (призраки)
  syncLocalEcon(LOCALSIM);                               // голда/манпауэр/политочки/техи
}

var _LS_TRACK = { 1: 'prod', 2: 'def', 3: 'atk', prod: 'prod', def: 'def', atk: 'atk' };
var _LS_I = (v) => (v == null ? null : v | 0);
function localSimCmd(o) {                                 // MP.cmd в режиме ?ls → методы серверного Sim (как GameRoom)
  const s = LOCALSIM, f = PLAYER; if (!s) { _lsPendingCmds.push({ ...o }); if (_lsPendingCmds.length > 40) _lsPendingCmds.shift(); return; }
  try {
    switch (o.cmd) {
      case 'buy':      s.cmdBuy(f, _LS_I(o.c), String(o.spec), o.unit ? String(o.unit) : undefined); break;   // 👥 unit = тип найма
      case 'upg':      s.cmdUpgrade(f, _LS_I(o.c), _LS_TRACK[o.track]); break;
      case 'army':     s.cmdSend(f, _LS_I(o.a), _LS_I(o.b), (o.pct || 50) / 100); break;
      case 'war':      s.cmdWar(f, _LS_I(o.tg)); break;
      case 'ally':     s.cmdAlly(f, _LS_I(o.tg)); break;
      case 'break':    s.cmdBreak(f, _LS_I(o.tg)); break;
      case 'sup':      s.cmdSupport(f, _LS_I(o.tg)); break;
      case 'peace':    s.cmdPeace(f, _LS_I(o.tg), { land: !!o.land, money: o.money | 0, repar: o.repar | 0 }); break;
      case 'research': s.cmdResearch(f, String(o.node)); break;
      case 'bship':    s.cmdBuildShip(f, _LS_I(o.c)); break;
      case 'bplane':   s.cmdBuildPlane(f, _LS_I(o.c)); break;
      case 'shipmove': (o.ids || []).forEach((id) => s.cmdShipMove(f, parseInt(String(id).replace(/\D/g, '')) || 0, o.x, o.z)); break;
      case 'planemove': (o.ids || []).forEach((id) => s.cmdPlaneMove(f, parseInt(String(id).replace(/\D/g, '')) || 0, o.x, o.z)); break;
      case 'yard':     s.cmdBuildYard(f, _LS_I(o.c), o.kind); break;
      case 'airorder': s.cmdAirOrder(f, o.recall ? -1 : _LS_I(o.cityIdx), o.x, o.z); break;
      case 'aa':       break;
      case 'hero':     s.cmdHeroAbility(f, _LS_I(o.h), _LS_I(o.ab)); break;
      case 'summon':   s.cmdSummonHero(f, String(o.id)); break;
    }
    projectLocalSim(s, MP._onMsg);
    syncLocalEcon(s);
  } catch (e) { console.warn('[ls] cmd', o.cmd, e); }
}
