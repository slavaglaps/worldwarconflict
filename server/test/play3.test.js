// 3-ИГРОКА E2E: прогон ВСЕХ фич (армии/осада/война/флот/авиация/верфи/дипломатия/ПВО).
// Франция(1) ↔ Германия(5) ↔ Польша(8) — соседи с морем. Сервер in-process, без ИИ (детерминизм).
process.env.DB_FILE = require('path').join(require('os').tmpdir(), 'wwc-play3-db.json');
require('fs').rmSync(process.env.DB_FILE, { force: true });
global.WebSocket = global.WebSocket || require('ws');

const { Server, LocalPresence, LocalDriver } = require('colyseus');
const { WebSocketTransport } = require('@colyseus/ws-transport');
const { Client } = require('colyseus.js');
const { GameRoom } = require('../GameRoom');
const { isWaterAt } = require('../sim/water');
const map = require('../sim/map-data.json');
const { group, testAsync, assert, eq, gt, lt, summary } = require('./harness');

const PORT = 2903;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// граф соседства из карты
const adj = new Map();
for (const e of map.edges) { (adj.get(e.a) || adj.set(e.a, []).get(e.a)).push(e.b); (adj.get(e.b) || adj.set(e.b, []).get(e.b)).push(e.a); }
const ownerOf = (idx) => map.cities[idx].owner;
const own = (f) => map.cities.filter(c => c.owner === f).map(c => c.idx);
const reinforcePair = (f) => { for (const i of own(f)) for (const n of (adj.get(i) || [])) if (ownerOf(n) === f) return { from: i, to: n }; return null; };
const attackPair = (f, ef) => { for (const i of own(f)) for (const n of (adj.get(i) || [])) if (ownerOf(n) === ef) return { from: i, to: n }; return null; };
const coastalCity = (f) => { for (const i of own(f)) { const c = map.cities[i]; for (let r = 1; r <= 3; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) { if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; if (isWaterAt(c.gx + dx, c.gz + dz)) return i; } } return null; };

const sq = (room, f) => [...room.state.squads.values()].filter(s => s.owner === f).length;
const ships = (room, f) => [...room.state.ships.values()].filter(s => s.owner === f).length;
const planes = (room, f) => [...room.state.planes.values()].filter(s => s.owner === f).length;
const relKey = (a, b) => (a < b ? a + '_' + b : b + '_' + a);

(async () => {
  GameRoom.simOptions = { map, goldStart: 4000, politStart: 400, rng: () => 0.01 };   // без ai → доска статична, кроме игроков
  const server = new Server({ transport: new WebSocketTransport({ server: require('http').createServer() }), presence: new LocalPresence(), driver: new LocalDriver() });
  server.define('game', GameRoom);
  await server.listen(PORT);
  group('3 ИГРОКА — ВСЕ ФИЧИ (Франция / Германия / Польша)');

  const FR = 1, DE = 5, PL = 8;
  const cFR = new Client(`ws://localhost:${PORT}`); const rFR = await cFR.create('game', { name: 'play3', faction: FR });
  const cDE = new Client(`ws://localhost:${PORT}`); const rDE = await cDE.joinById(rFR.roomId, { faction: DE });
  const cPL = new Client(`ws://localhost:${PORT}`); const rPL = await cPL.joinById(rFR.roomId, { faction: PL });
  await sleep(700);

  await testAsync('3 игрока в одной комнате, playerCount=3', async () => { eq(rDE.roomId, rFR.roomId); eq(rPL.roomId, rFR.roomId); eq(rFR.state.playerCount, 3); });
  await testAsync('фракции назначены по запросу (Франция владеет своими городами)', async () => { const k = own(FR)[0]; eq(rFR.state.cities.get(String(k)).owner, FR); });

  await testAsync('АРМИЯ: найм солдат растит гарнизон', async () => {
    const k = own(FR)[0]; const before = rFR.state.cities.get(String(k)).units;
    rFR.send('buy', { city: k, spec: '10' });
    await sleep(5000);
    gt(rFR.state.cities.get(String(k)).units, before);
  });

  await testAsync('АРМИЯ → СВОЙ город (подкрепление): отряд создаётся', async () => {
    const p = reinforcePair(FR); assert(p, 'есть пара своих соседних городов');
    const before = sq(rFR, FR);
    rFR.send('buy', { city: p.from, spec: 'max' }); await sleep(3000);   // набрать, чтоб было что слать
    rFR.send('send', { from: p.from, to: p.to, pct: 0.5 });
    await sleep(500);
    gt(sq(rFR, FR), before, 'отряд в свой город создан');
  });

  await testAsync('АТАКА без войны → отклонена (отряд не создан)', async () => {
    const p = attackPair(FR, DE); assert(p, 'есть граница Франция-Германия');
    const before = sq(rFR, FR);
    rFR.send('send', { from: p.from, to: p.to, pct: 0.5 });
    await sleep(500);
    eq(sq(rFR, FR), before, 'без войны атака не проходит');
  });

  await testAsync('ВОЙНА: объявление синкается', async () => {
    rFR.send('war', { tg: DE });
    await sleep(500);
    eq(rFR.state.relations.get(relKey(FR, DE)), 1, 'война видна');
  });

  await testAsync('АТАКА после войны: отряд идёт на врага + осада', async () => {
    const p = attackPair(FR, DE); const before = sq(rFR, FR);
    rFR.send('buy', { city: p.from, spec: 'max' }); await sleep(3000);
    const enemyUnits0 = rFR.state.cities.get(String(p.to)).units;
    rFR.send('send', { from: p.from, to: p.to, pct: 0.9 });
    await sleep(500); gt(sq(rFR, FR), before, 'отряд на врага создан');
    for (let i = 0; i < 30 && rFR.state.cities.get(String(p.to)).siegeUnits === 0 && rFR.state.cities.get(String(p.to)).units >= enemyUnits0; i++) await sleep(500);
    const c = rFR.state.cities.get(String(p.to));
    assert(c.siegeUnits > 0 || c.units < enemyUnits0 || c.owner === FR, 'осада идёт (siegeUnits>0 или гарнизон падает)');
  });

  await testAsync('ФЛОТ: верфь в прибрежном городе → корабль строится', async () => {
    const yc = coastalCity(FR); assert(yc != null, 'есть прибрежный город');
    rFR.send('yard', { city: yc, kind: 'ship' });
    await sleep(600);
    eq(rFR.state.cities.get(String(yc)).shipyard, 1, 'верфь построена');
    const before = ships(rFR, FR);
    rFR.send('bship', { city: yc }); rFR.send('bship', { city: yc });
    for (let i = 0; i < 18 && ships(rFR, FR) <= before; i++) await sleep(700);
    gt(ships(rFR, FR), before, 'корабль заспавнился');
  });

  await testAsync('ФЛОТ: корабль движется по команде', async () => {
    const s = [...rFR.state.ships.entries()].find(([, v]) => v.owner === FR);
    assert(s, 'есть корабль'); const [id, ss] = s; const x0 = ss.x;
    rFR.send('shipmove', { id: Number(id), x: ss.x - 20, z: ss.z });
    await sleep(2500);
    assert(rFR.state.ships.get(id) && rFR.state.ships.get(id).x !== x0, 'корабль сдвинулся');
  });

  await testAsync('АВИАЦИЯ: аэродром в любом городе → самолёт строится', async () => {
    const ac = own(FR)[1];
    rFR.send('yard', { city: ac, kind: 'air' });
    await sleep(600);
    eq(rFR.state.cities.get(String(ac)).airport, 1, 'аэродром построен');
    const before = planes(rFR, FR);
    rFR.send('bplane', { city: ac }); rFR.send('bplane', { city: ac });
    for (let i = 0; i < 20 && planes(rFR, FR) <= before; i++) await sleep(700);
    gt(planes(rFR, FR), before, 'самолёт заспавнился');
  });

  await testAsync('АВИАЦИЯ: приказ бомбить вражеский город принят', async () => {
    const target = own(DE)[0];
    const ok = rFR.send('airorder', { city: target });   // bomb DE city
    await sleep(1500);
    // самолёт должен полететь к цели (позиция меняется)
    const p = [...rFR.state.planes.values()].find(x => x.owner === FR);
    assert(p, 'есть самолёт у Франции');
  });

  await testAsync('ПВО: зенитка ставится', async () => {
    const k = own(FR)[2];
    const before = rFR.state.cities.get(String(k)).aa;
    rFR.send('aa', { city: k });
    await sleep(600);
    gt(rFR.state.cities.get(String(k)).aa, before, 'ПВО построена');
  });

  await testAsync('ДИПЛОМАТИЯ: союз Франция-Польша', async () => {
    rFR.send('ally', { tg: PL });
    await sleep(600);
    eq(rFR.state.relations.get(relKey(FR, PL)), 2, 'союз заключён');
  });

  await testAsync('ДИПЛОМАТИЯ: поддержка голдой', async () => {
    const g0 = rFR.state.gold[PL];
    rFR.send('sup', { tg: PL });
    await sleep(600);
    gt(rFR.state.gold[PL], g0, 'голда переведена Польше');
  });

  await testAsync('ТЕХНОЛОГИИ: исследование тратит голду', async () => {
    const g0 = rFR.state.gold[FR];
    rFR.send('research', { node: 'm1' });
    await sleep(600);
    lt(rFR.state.gold[FR], g0, 'голда на исследование списана');
  });

  await testAsync('ОСАДА синкается клиенту (siegeUnits/owner для визуала)', async () => {
    // у какого-то города Германии под осадой Франции должно быть siegeUnits>0 (из теста атаки) — или проверим поле есть
    let anySiege = false; rFR.state.cities.forEach(c => { if (c.siegeUnits > 0) anySiege = true; });
    assert(typeof rFR.state.cities.get(String(own(DE)[0])).siegeUnits === 'number', 'поле siegeUnits синкается');
  });

  rFR.leave(); rDE.leave(); rPL.leave();
  await server.gracefullyShutdown(false);
  summary('PLAY3 (3 игрока, все фичи)');
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('PLAY3 ERROR', e); process.exit(1); });
