/* ── Фаза 2: проектор локального серверного Sim → клиентский рендер ────────
   projectLocalSim(sim, onMsg): читает НАСТОЯЩИЙ серверный Sim (loadServerSim)
   и шлёт те же сообщения, что MP-мост (push в game.net.js): 'snap' (города +
   дипломатия) и 'ent' (отряды/корабли/самолёты). Тот же формат → тот же
   guest-рендер. econ/tech синкаются напрямую из sim (соло — без приватности).
   Координаты sim уже в мировых (грид 0..256) — QPOS-квантование не нужно (это
   делал только Colyseus ради трафика). spec-кодировка совпадает с сервером. */
var _SOLO_SPEC2ID = { prod: 1, def: 2, atk: 3 };   // = server SPEC_ID (SPEC2ID в loop.js — локальный, недоступен тут)
function projectLocalSim(sim, onMsg) {
  // ── города (тапл как в push(): [idx,owner,units,spec,tier,occ,queued,siegeU,siegeO,prodT,prodE,shipQ,shipT,planeQ,planeT]) ──
  const c = [];
  for (const cc of sim.cities) {
    const b0 = cc.batches && cc.batches[0];
    let su = 0, so = 0;
    if (cc.siege) for (const o in cc.siege) if (cc.siege[o].units > su) { su = cc.siege[o].units; so = +o; }
    c.push([cc.idx, cc.owner, Math.round(cc.units), (_SOLO_SPEC2ID[cc.spec] || 0), cc.tier, cc.occ ? 1 : 0,
      Math.round(cc.queued || 0), Math.round(su), so,
      b0 ? Math.round(b0.time * 10) : 0, b0 ? Math.round(b0.elapsed * 10) : 0,
      cc.shipQueue | 0, Math.round((cc.shipTimer || 0) * 10), cc.planeQueue | 0, Math.round((cc.planeTimer || 0) * 10)]);
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
  for (const s of sim.squads) e.push(['sq' + s.id, 0, s.owner, s.x, gy(s.x, s.z) + 0.2, s.z, Math.round(s.fcount)]);
  for (const s of sim.ships) e.push(['sh' + s.id, 1, s.owner, s.x, WY, s.z, 0]);
  for (const p of sim.planes) e.push(['pl' + p.id, 2, p.owner, p.x, PA, p.z, 0]);
  onMsg({ data: JSON.stringify({ t: 'ent', e }) });
}

// Экономика/техи соло: напрямую из sim в клиентские массивы (без приватности — это игра игрока).
function syncLocalEcon(sim) {
  for (let f = 0; f < sim.factions; f++) { gold[f] = sim.gold[f]; manpower[f] = sim.manpower[f]; politPts[f] = sim.politPts[f]; }
  if (typeof techDone !== 'undefined' && sim.techDone) for (let f = 0; f < sim.factions; f++) {
    if (sim.techDone[f]) { techDone[f] = new Set(sim.techDone[f]); try { recomputeTech(f); } catch (e) {} }
  }
  if (typeof techRes !== 'undefined' && sim.techRes && sim.techRes[PLAYER]) techRes[PLAYER] = sim.techRes[PLAYER].map(r => ({ id: r.id, t: r.t }));
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
    _lsReady = true;
    const _prev = window.selectCountry;                  // создавать/пересоздавать сим при выборе страны
    window.selectCountry = function (c) { _prev(c); startLocalSim(); };
    if (_lsPendingStart) { _lsPendingStart = false; startLocalSim(); }
    console.log('[ls] локальный серверный Sim готов');
  } catch (e) { console.error('[ls] не удалось поднять локальный сим:', e); }
}

function startLocalSim() {
  if (!_lsReady) { _lsPendingStart = true; return; }     // страну выбрали раньше загрузки — стартуем, как загрузится
  const balance = _lsApi.makeBalance({ factionDefault: { gold: 200, polit: 80 } });   // прод-старты как на сервере
  LOCALSIM = new _lsApi.Sim({ map: _lsMap, balance, ai: true });
  LOCALSIM.humanFactions = new Set([PLAYER]);            // ИИ не управляет игроком
  gameOver = false;
  projectLocalSim(LOCALSIM, MP._onMsg); syncLocalEcon(LOCALSIM);   // первый кадр — сразу состояние
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
  const s = LOCALSIM, f = PLAYER; if (!s) return;
  try {
    switch (o.cmd) {
      case 'buy':      s.cmdBuy(f, _LS_I(o.c), String(o.spec)); break;
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
      case 'yard':     s.cmdBuildYard(f, _LS_I(o.c), o.kind); break;
      case 'airorder': s.cmdAirOrder(f, o.recall ? -1 : _LS_I(o.cityIdx), o.x, o.z); break;
      case 'aa':       s.cmdBuildAA(f, _LS_I(o.c)); break;
      case 'hero':     s.cmdHeroAbility(f, _LS_I(o.h), _LS_I(o.ab)); break;
      case 'summon':   s.cmdSummonHero(f, String(o.id)); break;
    }
  } catch (e) { console.warn('[ls] cmd', o.cmd, e); }
}
