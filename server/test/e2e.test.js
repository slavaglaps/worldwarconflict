// КЛИЕНТСКИЕ (E2E) тесты: реальный colyseus.js-клиент ↔ авторитетный сервер.
// Поднимаем сервер in-process, гоняем сетевой протокол: фракции, синк, города,
// дипломатия (война/мир/поддержка), исследования, анти-чит, осада, кросс-синк, изоляция.
global.WebSocket = global.WebSocket || require('ws');
const { Server } = require('colyseus');
const { Client } = require('colyseus.js');
const { GameRoom } = require('../GameRoom');
const { group, testAsync, assert, eq, gt, lt, summary } = require('./harness');

const PORT = 2899;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const myCity = (room, fid) => [...room.state.cities.entries()].find(([, c]) => c.owner === fid);
const enemyCityOf = (room, fid) => [...room.state.cities.entries()].find(([, c]) => c.owner !== fid && c.owner !== undefined);
const relKey = (a, b) => (a < b ? a + '_' + b : b + '_' + a);
// экономика приватна (per-client сообщение 'econ'): [gold, manpower, polit] своей фракции/союзников
const capEcon = (r) => { r.__econ = {}; r.onMessage('econ', (m) => { if (m && m.econ) Object.assign(r.__econ, m.econ); }); };
const eGold = (r, f) => (r.__econ && r.__econ[f] ? r.__econ[f][0] : 0);
const ePolit = (r, f) => (r.__econ && r.__econ[f] ? r.__econ[f][2] : 0);

(async () => {
  // сервер задаёт конфиг сима: хватает голды/политочков на войну/исследования; rng детерминирован
  GameRoom.simOptions = { factions: 6, cities: 18, politStart: 200, goldStart: 500, warPrep: 0, rng: () => 0.01 };   // warPrep:0 → осаду тестим сразу (мобилизацию проверяет sim.test)
  const server = new Server();
  server.define('game', GameRoom);
  await server.listen(PORT);
  group('CLIENT E2E (colyseus.js ↔ сервер)');

  const c1 = new Client(`ws://localhost:${PORT}`);
  const r1 = await c1.create('game');
  let f1 = null; r1.onMessage('assigned', m => f1 = m.faction); capEcon(r1);
  let bal1 = null; r1.onMessage('balance', m => bal1 = m);
  const c2 = new Client(`ws://localhost:${PORT}`);
  const r2 = await c2.joinById(r1.roomId);
  let f2 = null; r2.onMessage('assigned', m => f2 = m.faction); capEcon(r2); r2.onMessage('balance', () => {});
  await sleep(500);

  await testAsync('два клиента → разные фракции', async () => {
    assert(f1 != null && f2 != null, 'оба получили assigned'); assert(f1 !== f2, `f1=${f1} f2=${f2}`);
  });
  await testAsync('стейт синкается (18 городов) + приватная экономика своей фракции (econ)', async () => {
    eq(r1.state.cities.size, 18); assert(r1.__econ[f1], 'econ своей фракции получен'); assert(r1.__econ[f1].length === 3, '[gold,manpower,polit]');
  });
  await testAsync('анти-чит: экономика ЧУЖОЙ фракции клиенту не видна', async () => {
    assert(r1.__econ[f2] === undefined, `f1 НЕ видит экономику f2 (${JSON.stringify(r1.__econ[f2])})`);
  });
  await testAsync('баланс комнаты синкается клиенту (политика + техи + своя фракция)', async () => {
    assert(bal1, 'клиент получил сообщение balance');
    assert(bal1.politics && bal1.tech && bal1.tech.nodes && bal1.faction, 'есть политика/техи/своя фракция');
    eq(bal1.politics.warPrep, 0, 'warPrep из simOptions виден клиенту');
    assert(bal1.tech.nodes.m1 && bal1.tech.nodes.m1.g > 0, 'узел m1 дерева с ценой пришёл');
  });

  await testAsync('ветки upg через сеть применяются независимо', async () => {
    const [k] = myCity(r1, f1);
    r1.send('upg', { city: Number(k), track: 'prod' });
    await sleep(250);
    r1.send('upg', { city: Number(k), track: 'def' });
    await sleep(250);
    r1.send('upg', { city: Number(k), track: 'atk' });
    await sleep(500);
    const c = r1.state.cities.get(k);
    eq(c.prodTier, 1); eq(c.defTier, 1); eq(c.atkTier, 1);
  });

  await testAsync('buy через сеть → производство → гарнизон растёт', async () => {
    const [k] = myCity(r1, f1);
    const before = r1.state.cities.get(k).units, g0 = eGold(r1, f1);
    r1.send('buy', { city: Number(k), spec: '6' });
    await sleep(3200);                                  // 6 × trainPer(~0.43) ≈ 2.6с производства
    gt(r1.state.cities.get(k).units, before); lt(eGold(r1, f1), g0);
  });

  await testAsync('анти-чит: buy в чужом городе игнорируется', async () => {
    const [ek] = enemyCityOf(r1, f1);
    const eb = r1.state.cities.get(ek).units;
    r1.send('buy', { city: Number(ek), spec: '1000' });
    await sleep(400);
    eq(r1.state.cities.get(ek).units, eb);
  });

  // выбираем вражескую фракцию (владельца первого чужого города)
  const [enemyKey, enemyCityState] = enemyCityOf(r1, f1);
  const enemyFid = enemyCityState.owner;

  await testAsync('война через сеть: −политочки + relations синкается клиенту', async () => {
    const p0 = ePolit(r1, f1);
    r1.send('war', { tg: enemyFid });
    await sleep(400);
    eq(r1.state.relations.get(relKey(f1, enemyFid)), 1);   // 1 = война, видна клиенту
    lt(ePolit(r1, f1), p0);
  });

  await testAsync('осада через сеть (в войне): гарнизон врага падает + виден ОБОИМ клиентам', async () => {
    const [ck] = myCity(r1, f1);
    const e0 = r1.state.cities.get(enemyKey).units;
    r1.send('send', { from: Number(ck), to: Number(enemyKey), pct: 0.9 });
    await sleep(1500);
    lt(r1.state.cities.get(enemyKey).units, e0);
    eq(r2.state.cities.get(enemyKey).units, r1.state.cities.get(enemyKey).units);  // кросс-клиентский синк
  });

  await testAsync('мир через сеть: relations → нейтрал (ключ снят)', async () => {
    r1.send('peace', { tg: enemyFid });
    await sleep(400);
    assert(r1.state.relations.get(relKey(f1, enemyFid)) === undefined, 'отношение снято');
  });

  await testAsync('поддержка через сеть: голда списывается у дарителя (экономика получателя скрыта)', async () => {
    const g0 = eGold(r1, f1);
    r1.send('sup', { tg: enemyFid });
    await sleep(400);
    lt(eGold(r1, f1), g0);   // даритель заплатил; экономику получателя-неприятеля клиент НЕ видит — это и есть приватность
  });

  await testAsync('исследование через сеть: тратит голду (m1 = 100💰)', async () => {
    const g0 = eGold(r1, f1);
    r1.send('research', { node: 'm1' });
    await sleep(400);
    lt(eGold(r1, f1), g0 - 90);   // потрачено ~100
  });

  await testAsync('изоляция: второй клиент тратит СВОЮ голду, не чужую', async () => {
    const [k] = myCity(r2, f2);
    const g2 = eGold(r2, f2), g1 = eGold(r1, f1);
    r2.send('buy', { city: Number(k), spec: 'max' });
    await sleep(500);
    lt(eGold(r2, f2), g2);
    assert(eGold(r1, f1) >= g1 - 1, 'голда f1 не задета покупкой f2');
  });

  // ── фаза 2: реальная карта Европы + движение отрядов + флот/авиация ──
  GameRoom.simOptions = { map: require('../sim/map-data.json'), goldStart: 500, politStart: 300, rng: () => 0.01, grantNavyTech: true };
  const c3 = new Client(`ws://localhost:${PORT}`);
  const r3 = await c3.create('game'); r3.onMessage('econ', () => {}); r3.onMessage('balance', () => {});
  let f3 = null; r3.onMessage('assigned', m => f3 = m.faction);
  const c4 = new Client(`ws://localhost:${PORT}`);
  const r4 = await c4.joinById(r3.roomId); r4.onMessage('econ', () => {}); r4.onMessage('balance', () => {});
  let f4 = null; r4.onMessage('assigned', m => f4 = m.faction);
  await sleep(500);

  await testAsync('реальная карта: 143 города синкаются клиенту', async () => {
    eq(r3.state.cities.size, 143);
  });
  await testAsync('отправка отряда: squad появляется в стейте и движется по карте', async () => {
    const mine = [...r3.state.cities.entries()].filter(([, c]) => c.owner === f3).map(([k]) => Number(k));
    const from = mine[0], to = mine[mine.length - 1];          // дальний свой город → многоходовый путь
    r3.send('send', { from, to, pct: 0.5 });
    await sleep(300);
    assert(r3.state.squads.size > 0, 'отряд появился в синкнутом стейте');
    const sq = [...r3.state.squads.values()][0];
    const x0 = sq.x, z0 = sq.z;
    await sleep(900);
    const arr = [...r3.state.squads.values()];
    assert(arr.length === 0 || arr[0].x !== x0 || arr[0].z !== z0, 'отряд сдвинулся или дошёл');
  });
  await testAsync('постройка флота+авиации: корабль и самолёт появляются в стейте', async () => {
    const yard = [...r4.state.cities.entries()].find(([, c]) => c.shipyard && c.owner === f4);
    const air = [...r4.state.cities.entries()].find(([, c]) => c.airport && c.owner === f4);
    assert(yard && air, `Франция владеет верфью+аэропортом (f4=${f4})`);
    r4.send('bship', { city: Number(yard[0]) });
    r4.send('bplane', { city: Number(air[0]) });
    await sleep(7600);                                          // время постройки 6/7с
    gt(r4.state.ships.size, 0); gt(r4.state.planes.size, 0);
  });
  r3.leave(); r4.leave();

  r1.leave(); r2.leave();
  await server.gracefullyShutdown(false);
  summary('CLIENT (e2e)');
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('E2E ERROR', e); process.exit(1); });
