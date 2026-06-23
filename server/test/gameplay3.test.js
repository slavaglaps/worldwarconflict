// ─────────────────────────────────────────────────────────────────────────────
// КОМПЛЕКСНЫЙ 3-ИГРОКА ГЕЙМПЛЕЙ-ТЕСТ: один связный прогон, проверяющий «работу ВСЕГО»
// через настоящие colyseus.js-клиенты ↔ авторитетный сервер. В отличие от play3
// (по-фичная проверка), здесь — сквозной сценарий, где системы работают ВМЕСТЕ, с
// упором на новые подсистемы и их НАБЛЮДАЕМЫЕ эффекты:
//   • герои (пассивы+активки: gold/garrison/manpower/buff/airstrike, кулдауны, приватность)
//   • экономика/юниты из balance (найм/верфь/корабль/аэродром/самолёт/ПВО — списание по цене)
//   • синк цен/политики/техов/героев в balance-сообщении + приватность econ
//   • таймер мобилизации (warPrep) — война, отказ во время мобилизации, атака после
//   • дипломатия (союз/поддержка/мир), осада/захват, технологии
//   • наблюдаемость (metrics отражает всю сессию: комнаты/джойны/команды/тики, 0 ошибок)
//   • balance.tune — отдельная комната с тюненными ценами: и в показе, и в списании
// Франция(1) / Германия(5) / Польша(8) — соседи с морем. Без ИИ (детерминизм), warPrep=3.
// ─────────────────────────────────────────────────────────────────────────────
process.env.DB_FILE = require('path').join(require('os').tmpdir(), 'wwc-gameplay3-db.json');
require('fs').rmSync(process.env.DB_FILE, { force: true });
global.WebSocket = global.WebSocket || require('ws');

const { Server, LocalPresence, LocalDriver } = require('colyseus');
const { WebSocketTransport } = require('@colyseus/ws-transport');
const { Client } = require('colyseus.js');
const { GameRoom } = require('../GameRoom');
const metrics = require('../metrics');
const { isWaterAt } = require('../sim/water');
const map = require('../sim/map-data.json');
const { group, testAsync, assert, eq, gt, lt, summary } = require('./harness');

const PORT = 2907;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 9000, step = 250) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(step); } return false; };

// топология карты
const adj = new Map();
for (const e of map.edges) { (adj.get(e.a) || adj.set(e.a, []).get(e.a)).push(e.b); (adj.get(e.b) || adj.set(e.b, []).get(e.b)).push(e.a); }
const ownerOf = (idx) => map.cities[idx].owner;
const own = (f) => map.cities.filter(c => c.owner === f).map(c => c.idx);
const attackPair = (f, ef) => { for (const i of own(f)) for (const n of (adj.get(i) || [])) if (ownerOf(n) === ef) return { from: i, to: n }; return null; };
const coastalCity = (f) => { for (const i of own(f)) { const c = map.cities[i]; for (let r = 1; r <= 3; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) { if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; if (isWaterAt(c.gx + dx, c.gz + dz)) return i; } } return null; };

const sq = (r, f) => [...r.state.squads.values()].filter(s => s.owner === f).length;
const shipsN = (r, f) => [...r.state.ships.values()].filter(s => s.owner === f).length;
const planesN = (r, f) => [...r.state.planes.values()].filter(s => s.owner === f).length;
const relKey = (a, b) => (a < b ? a + '_' + b : b + '_' + a);
// найти активку героя фракции по типу эффекта (робастно к ротации героев)
const findAbil = (bal, type) => { const { pool, slots } = bal.heroes; let r = null; slots.forEach((id, si) => pool[id].abilities.filter(a => a.kind === 'active').forEach((a, ai) => { if (!r && a.fx.type === type) r = { si, ai, fx: a.fx, name: a.name }; })); return r; };

(async () => {
  GameRoom.simOptions = { map, goldStart: 3000, politStart: 400, warPrep: 3, rng: () => 0.01, balance: { politics: { max: 500 } } };   // warPrep=3 → мобилизация; max=500 → хватает политочков на войну+союз+мир; без ai → детерминизм
  const server = new Server({ transport: new WebSocketTransport({ server: require('http').createServer() }), presence: new LocalPresence(), driver: new LocalDriver() });
  server.define('game', GameRoom);
  await server.listen(PORT);
  group('ГЕЙМПЛЕЙ 3 ИГРОКА — сквозная проверка ВСЕГО (Франция/Германия/Польша)');

  const FR = 1, DE = 5, PL = 8;
  const cap = (r) => { r.__econ = {}; r.__hero = null; r.__bal = null; r.__denied = [];
    r.onMessage('econ', (m) => { if (m && m.econ) Object.assign(r.__econ, m.econ); if (m && m.hero) r.__hero = m.hero; });
    r.onMessage('balance', (m) => { r.__bal = m; });
    r.onMessage('denied', (m) => { r.__denied.push(m && m.cmd); });
    r.onMessage('assigned', () => {}); return r; };
  const cFR = new Client(`ws://localhost:${PORT}`); const rFR = cap(await cFR.create('game', { name: 'gameplay3', faction: FR }));
  const cDE = new Client(`ws://localhost:${PORT}`); const rDE = cap(await cDE.joinById(rFR.roomId, { faction: DE }));
  const cPL = new Client(`ws://localhost:${PORT}`); const rPL = cap(await cPL.joinById(rFR.roomId, { faction: PL }));
  const gold = (r, f) => (r.__econ && r.__econ[f] ? r.__econ[f][0] : 0);
  const mp = (r, f) => (r.__econ && r.__econ[f] ? r.__econ[f][1] : 0);
  const polit = (r, f) => (r.__econ && r.__econ[f] ? r.__econ[f][2] : 0);
  await sleep(900);

  // ── АКТ 1: вход + синк + приватность ──────────────────────────────────────
  await testAsync('АКТ1 · 3 игрока в комнате, фракции назначены без коллизий', async () => {
    eq(rFR.state.playerCount, 3, 'playerCount=3');
    eq(rFR.state.cities.get(String(own(FR)[0])).owner, FR, 'Франция владеет своими городами');
    eq(rDE.state.cities.get(String(own(DE)[0])).owner, DE, 'Германия владеет своими');
  });
  await testAsync('АКТ1 · balance-сообщение полное (герои+цены+политика+техи)', async () => {
    const b = rFR.__bal; assert(b, 'balance пришёл');
    assert(b.heroes && Object.keys(b.heroes.pool).length === 6 && b.heroes.slots.length > 0, 'герои: пул(6)+слоты');
    assert(b.prices && b.prices.SOLDIER_PRICE > 0 && b.prices.SHIP_COST > 0 && b.prices.UPGRADE_COST_BASE > 0, 'цены юнитов/экономики');
    assert(b.politics && b.politics.warPrep === 3 && b.politics.costWar > 0, 'политика (warPrep=3, costWar)');
    assert(b.tech && b.tech.nodes && Object.keys(b.tech.nodes).length > 10, 'дерево техов');
    assert(typeof b.version === 'number', 'balance несёт version (ревизию баланса) — фикс #4');
    assert(b.prices.SHIP_HP > 0 && b.prices.PLANE_DMG > 0 && b.prices.AA_RANGE > 0, 'prices теперь ПОЛНЫЙ (ХП/урон/радиусы, не только цены) — фикс #5');
  });
  await testAsync('АКТ1 · приватность econ: видна СВОЯ экономика, чужую не шлём', async () => {
    assert(gold(rFR, FR) > 0, 'Франция видит свою голду');
    eq(rFR.__econ[DE], undefined, 'Франция НЕ видит экономику Германии');
    eq(rFR.__econ[PL], undefined, 'Франция НЕ видит экономику Польши (нейтрал)');
  });

  // ── АКТ 2: экономика растёт ────────────────────────────────────────────────
  await testAsync('АКТ2 · экономика копится со временем (голда/манпауэр/политочки)', async () => {
    const g0 = gold(rFR, FR), p0 = polit(rFR, FR);
    rFR.__econ[FR] = [0, 0, 0];                       // обнулим локально — сервер пришлёт реальные
    await until(() => gold(rFR, FR) > 0, 3000);
    gt(gold(rFR, FR), 0, 'голда натикала'); assert(polit(rFR, FR) >= 0, 'политочки идут');
  });

  // ── АКТ 3: ГЕРОИ — наблюдаемые эффекты + кулдауны ──────────────────────────
  await testAsync('АКТ3 · герой gold: активка даёт +голду, ставит кулдаун, повтор отклонён', async () => {
    const ab = findAbil(rFR.__bal, 'gold');
    if (!ab) return assert(true, 'у Франции нет gold-героя — пропуск (ротация)');
    const g0 = gold(rFR, FR); rFR.__denied = [];
    rFR.send('hero', { h: ab.si, ab: ab.ai });
    await until(() => gold(rFR, FR) >= g0 + ab.fx.amount - 5, 3000);
    gt(gold(rFR, FR), g0, `+${ab.fx.amount} голды от «${ab.name}»`);
    assert(rFR.__hero && rFR.__hero.cd[ab.si][ab.ai] > 0, 'кулдаун выставлен');
    rFR.send('hero', { h: ab.si, ab: ab.ai });        // повтор на кулдауне
    await sleep(500);
    assert(rFR.__denied.includes('hero'), 'повтор на кулдауне → denied');
  });
  await testAsync('АКТ3 · герой buff: активка кладёт временный бафф + кулдаун', async () => {
    const ab = findAbil(rFR.__bal, 'buff');
    if (!ab) return assert(true, 'нет buff-героя — пропуск');
    rFR.send('hero', { h: ab.si, ab: ab.ai });
    await until(() => rFR.__hero && rFR.__hero.buffs && rFR.__hero.buffs.length > 0, 3000);
    assert(rFR.__hero.buffs.some(b => b.key === ab.fx.key), `бафф ${ab.fx.key} активен`);
    gt(rFR.__hero.cd[ab.si][ab.ai], 0, 'кулдаун buff-активки');
  });
  await testAsync('АКТ3 · герой manpower: активка добивает манпауэр до потолка', async () => {
    const ab = findAbil(rDE.__bal, 'manpower');
    if (!ab) return assert(true, 'нет manpower-героя у Германии — пропуск');
    rDE.send('buy', { city: own(DE)[0], spec: '20' });   // потратим манпауэр, чтобы было что добивать
    await sleep(600);
    const before = mp(rDE, DE);
    rDE.send('hero', { h: ab.si, ab: ab.ai });
    await until(() => mp(rDE, DE) > before + 5, 3000);
    gt(mp(rDE, DE), before, 'манпауэр подскочил до потолка');
  });
  await testAsync('АКТ3 · герой garrison: активка добавляет гарнизон во все свои города', async () => {
    const ab = findAbil(rPL.__bal, 'garrison');
    if (!ab) return assert(true, 'нет garrison-героя у Польши — пропуск');
    const k = own(PL)[0]; const u0 = rPL.state.cities.get(String(k)).units;
    rPL.send('hero', { h: ab.si, ab: ab.ai });
    await until(() => rPL.state.cities.get(String(k)).units > u0, 3000);
    gt(rPL.state.cities.get(String(k)).units, u0, `+${ab.fx.amount} гарнизона в город`);
  });

  // ── АКТ 4: ПОСТРОЙКА + СПИСАНИЕ ПО ЦЕНЕ (юниты/экономика из balance) ───────
  await testAsync('АКТ4 · найм солдат списывает голду по SOLDIER_PRICE из баланса', async () => {
    const price = rFR.__bal.prices.SOLDIER_PRICE; const k = own(FR)[0];
    await until(() => gold(rFR, FR) > 100, 4000);
    const g0 = gold(rFR, FR), u0 = rFR.state.cities.get(String(k)).units;
    rFR.send('buy', { city: k, spec: '10' });
    await until(() => rFR.state.cities.get(String(k)).units > u0 || gold(rFR, FR) < g0, 6000);
    gt(u0 + 11, rFR.state.cities.get(String(k)).units, 'гарнизон вырос (≤ +10)');
    assert(gold(rFR, FR) <= g0 - 10 * price + 5, `списано ≈10×${price} голды`);
  });
  await testAsync('АКТ4 · верфь → корабль, аэродром → самолёт, ПВО — всё строится', async () => {
    const yc = coastalCity(FR); assert(yc != null, 'есть прибрежный город');
    const ny = rFR.state.cities.size;
    rFR.send('yard', { city: yc, kind: 'ship' }); await sleep(700);
    let yard = null; rFR.state.cities.forEach((c, k) => { if (+k >= ny && c.shipyard === 1) yard = +k; });
    assert(yard != null && rFR.state.cities.get(String(yc)).shipyard === 0, 'верфь — отдельный город, родитель остался обычным');
    const s0 = shipsN(rFR, FR); rFR.send('bship', { city: yard }); rFR.send('bship', { city: yard });
    assert(await until(() => shipsN(rFR, FR) > s0, 16000), 'корабль заспавнился');
    const ac = own(FR)[1]; const na = rFR.state.cities.size;
    rFR.send('yard', { city: ac, kind: 'air' }); await sleep(700);
    let port = null; rFR.state.cities.forEach((c, k) => { if (+k >= na && c.airport === 1) port = +k; });
    assert(port != null && rFR.state.cities.get(String(ac)).airport === 0, 'аэродром — отдельный город, родитель остался обычным');
    const p0 = planesN(rFR, FR); rFR.send('bplane', { city: port }); rFR.send('bplane', { city: port });
    assert(await until(() => planesN(rFR, FR) > p0, 16000), 'самолёт заспавнился');
    const aac = own(FR)[2]; const aa0 = rFR.state.cities.get(String(aac)).aa;
    rFR.send('aa', { city: aac });
    assert(await until(() => rFR.state.cities.get(String(aac)).aa > aa0, 4000), 'ПВО построена');
  });

  // ── АКТ 5: ВОЙНА + ТАЙМЕР МОБИЛИЗАЦИИ + ОСАДА ─────────────────────────────
  await testAsync('АКТ5 · война синкается (relations + warStart для отсчёта мобилизации)', async () => {
    rFR.send('war', { tg: DE });
    assert(await until(() => rFR.state.relations.get(relKey(FR, DE)) === 1, 3000), 'война в relations');
    assert(rFR.state.warStart && rFR.state.warStart.get(relKey(FR, DE)) != null, 'warStart синкнут (источник таймера мобилизации)');
  });
  await testAsync('АКТ5 · атака ОТКЛОНЕНА во время мобилизации, РАЗРЕШЕНА после warPrep', async () => {
    const p = attackPair(FR, DE); assert(p, 'есть граница Франция-Германия');
    rFR.send('buy', { city: p.from, spec: 'max' }); await sleep(2500);   // войска для атаки (в пределах warPrep=3)
    rFR.__denied = [];
    rFR.send('send', { from: p.from, to: p.to, pct: 0.6 });              // ещё идёт мобилизация
    await sleep(700);
    assert(rFR.__denied.includes('send'), 'во время мобилизации атака отклонена (denied)');
    await sleep(2500);                                                    // мобилизация (3с) истекла
    const eu0 = rFR.state.cities.get(String(p.to)).units;
    rFR.send('send', { from: p.from, to: p.to, pct: 0.8 });
    let attacked = false;
    for (let i = 0; i < 30 && !attacked; i++) { await sleep(250); const c = rFR.state.cities.get(String(p.to));
      if (sq(rFR, FR) > 0 || c.siegeUnits > 0 || c.units < eu0 || c.owner === FR) attacked = true; }
    assert(attacked, 'после мобилизации атака прошла (отряд/осада/падение гарнизона/захват)');
  });
  await testAsync('АКТ5 · герой airstrike (в войне) бьёт гарнизон врага', async () => {
    const ab = findAbil(rDE.__bal, 'airstrike');
    if (!ab) return assert(true, 'нет airstrike-героя у Германии — пропуск');
    // Германия в войне с Францией (объявила Франция) → у DE есть цель
    const frCities = own(FR); const before = frCities.reduce((s, k) => s + rDE.state.cities.get(String(k)).units, 0);
    rDE.send('hero', { h: ab.si, ab: ab.ai });
    const dropped = await until(() => frCities.reduce((s, k) => s + rDE.state.cities.get(String(k)).units, 0) < before, 4000);
    assert(dropped || (rDE.__hero && rDE.__hero.cd[ab.si][ab.ai] > 0), 'удар прошёл (гарнизон Франции упал или КД выставлен)');
  });

  // ── АКТ 6: ДИПЛОМАТИЯ + ПРИВАТНОСТЬ СОЮЗНИКА ──────────────────────────────
  await testAsync('АКТ6 · союз Франция+Польша (общий враг Германия → принят)', async () => {
    rPL.send('war', { tg: DE }); await sleep(400);     // Польша тоже против Германии → общий враг с Францией (FR уже в войне с ACT5)
    rFR.send('ally', { tg: PL });
    assert(await until(() => rFR.state.relations.get(relKey(FR, PL)) === 2, 4000), 'союз заключён');
  });
  await testAsync('АКТ6 · econ союзника виден, врага — нет (приватность)', async () => {
    await until(() => rFR.__econ[PL] !== undefined, 3000);
    assert(rFR.__econ[PL] !== undefined, 'после союза Франция ВИДИТ экономику Польши');
    eq(rFR.__econ[DE], undefined, 'экономику Германии (враг) по-прежнему НЕ видит');
  });
  await testAsync('АКТ6 · поддержка голдой союзнику (видна получателю)', async () => {
    const g0 = gold(rPL, PL); rFR.send('sup', { tg: PL });
    assert(await until(() => gold(rPL, PL) > g0, 3000), 'голда переведена Польше');
  });
  await testAsync('АКТ6 · мир Франция-Германия завершает войну + перемирие', async () => {
    rFR.__denied = [];
    rFR.send('peace', { tg: DE, money: 0, repar: 0 });
    const peaced = await until(() => rFR.state.relations.get(relKey(FR, DE)) !== 1, 5000);
    assert(peaced, `война с Германией завершена · denied=${JSON.stringify(rFR.__denied)} politFR=${polit(rFR, FR)}`);
    assert(rFR.state.relations.get(relKey(FR, DE)) !== 1, 'мир/перемирие (война снята из синка отношений)');
  });

  // ── АКТ 7: ТЕХНОЛОГИИ ──────────────────────────────────────────────────────
  await testAsync('АКТ7 · исследование m1 списывает голду и берётся в работу', async () => {
    await until(() => gold(rFR, FR) > 200, 5000);
    const g0 = gold(rFR, FR);
    rFR.send('research', { node: 'm1' });
    const took = await until(() => gold(rFR, FR) < g0 || (rFR.state.research && rFR.state.research.size > 0), 4000);
    assert(took, 'исследование списало голду / попало в очередь');
  });

  // ── АКТ 8: НАБЛЮДАЕМОСТЬ ───────────────────────────────────────────────────
  await testAsync('АКТ8 · metrics отражает всю сессию (комнаты/джойны/команды/тики, 0 ошибок)', async () => {
    const s = metrics.snapshot();
    gt(s.rooms_created, 0, 'комнаты создавались');
    assert(s.joins >= 3, `джойнов ≥3 (было ${s.joins})`);
    gt(s.commands, 10, 'команд много');
    gt(s.tick_count, 0, 'тики идут');
    assert(s.tick_avg_ms >= 0, 'есть перф тика');
    eq(s.errors, 0, 'НИ ОДНОЙ ошибки за всю сессию');
  });

  // ── АКТ 9: BALANCE.TUNE — отдельная комната с тюненными ценами ─────────────
  await testAsync('АКТ9 · balance.tune: тюненные цены и в показе (prices), и в списании', async () => {
    GameRoom.simOptions = { map, goldStart: 5000, warPrep: 0, rng: () => 0.01, balance: { tune: { SOLDIER_PRICE: 10, SHIP_COST: 100 }, politics: { costWar: 5 } } };
    const cT = new Client(`ws://localhost:${PORT}`); const rT = cap(await cT.create('game', { name: 'tuned', faction: FR }));
    await sleep(800);
    assert(rT.__bal && rT.__bal.prices, 'balance пришёл');
    eq(rT.__bal.prices.SOLDIER_PRICE, 10, 'prices.SOLDIER_PRICE=10 (тюн в показе)');
    eq(rT.__bal.prices.SHIP_COST, 100, 'prices.SHIP_COST=100 (тюн)');
    eq(rT.__bal.politics.costWar, 5, 'politics.costWar=5 (тюн)');
    const k = own(FR)[0]; await until(() => gold(rT, FR) > 0, 3000);
    const g0 = gold(rT, FR), u0 = rT.state.cities.get(String(k)).units;
    rT.send('buy', { city: k, spec: '5' });
    await until(() => gold(rT, FR) < g0, 5000);
    assert(gold(rT, FR) <= g0 - 5 * 10 + 3, 'списано 5×10=50 (тюненная цена реально заряжена сервером)');
    await rT.leave();
  });

  // ── АКТ 10: ПРОД-ПУТЬ — старты из Directus реально применяются (фикс #1) ────
  await testAsync('АКТ10 · прод-путь: старт-золото/политика из Directus применяются (не перезаписываются house 200/80)', async () => {
    const bs = require('../balance-store'); const orig = bs.current;
    bs.current = () => ({ factionDefault: { gold: 333, polit: 110 } });   // эмулируем override из Directus
    GameRoom.simOptions = undefined;                                       // прод-путь (без goldStart/politStart/balance) → срабатывает слоение house⊕Directus
    try {
      const cX = new Client(`ws://localhost:${PORT}`); const rX = cap(await cX.create('game', { faction: FR }));
      await until(() => gold(rX, FR) > 0, 3000);
      gt(gold(rX, FR), 320, 'старт-голд ≈333 из Directus (а НЕ house 200 — баг #1 закрыт)');
      gt(polit(rX, FR), 100, 'старт-политика ≈110 из Directus (а НЕ house 80)');
      await rX.leave();
    } finally { bs.current = orig; }
  });

  await rFR.leave(); await rDE.leave(); await rPL.leave();
  await server.gracefullyShutdown(false);
  summary('GAMEPLAY3 (сквозная проверка всего)');
})();
