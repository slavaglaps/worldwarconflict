// ГЕРОИ E2E: каждый герой пула прогоняется через НАСТОЯЩИЙ клиент↔сервер — команда `hero`
// долетает до GameRoom, сервер применяет авторитетно, эффект/кулдаун синкаются обратно в econ/стейт.
// Дополняет sim-тесты (hero.test.js): там движок, тут весь MP-конвейер. Data-driven по пулу.
process.env.DB_FILE = require('path').join(require('os').tmpdir(), 'wwc-heroe2e-db.json');
require('fs').rmSync(process.env.DB_FILE, { force: true });
global.WebSocket = global.WebSocket || require('ws');

const { Server, LocalPresence, LocalDriver } = require('colyseus');
const { WebSocketTransport } = require('@colyseus/ws-transport');
const { Client } = require('colyseus.js');
const { GameRoom } = require('../GameRoom');
const { DEFAULTS } = require('../sim/balance');
const map = require('../sim/map-data.json');
const { group, testAsync, assert, summary } = require('./harness');

const PORT = 2911;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 5000, step = 150) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(step); } return false; };
const POOL = DEFAULTS.heroes.pool;
const FR = 1, DE = 5;                                   // Франция (играем ей) / Германия (цель airstrike)
const own = (f) => map.cities.filter((c) => c.owner === f).map((c) => c.idx);

(async () => {
  const server = new Server({ transport: new WebSocketTransport({ server: require('http').createServer() }), presence: new LocalPresence(), driver: new LocalDriver() });
  server.define('game', GameRoom);
  await server.listen(PORT);
  group('Герои E2E: каждый герой × каждый скил через настоящий сервер');

  for (const [id, def] of Object.entries(POOL)) {
    const actives = def.abilities.filter((a) => a.kind === 'active');
    await testAsync(`${id} (${def.name}): слоты в balance + ${actives.length} активки через сервер (эффект + КД в econ)`, async () => {
      // комната, где у Франции ТОЛЬКО этот герой
      GameRoom.simOptions = { map, goldStart: 4000, politStart: 300, warPrep: 0, rng: () => 0.01, balance: { factionDefault: { heroes: [] }, factions: { [FR]: { heroes: [id] } } } };
      const c = new Client(`ws://localhost:${PORT}`);
      const r = await c.create('game', { faction: FR, name: 'he2e' });
      r.__econ = {}; r.__hero = null; r.__bal = null;
      r.onMessage('econ', (m) => { if (m && m.econ) Object.assign(r.__econ, m.econ); if (m && m.hero) r.__hero = m.hero; });
      r.onMessage('balance', (m) => { r.__bal = m; });
      r.onMessage('assigned', () => {}); r.onMessage('denied', () => {});
      await sleep(700);
      const gold = () => (r.__econ[FR] ? r.__econ[FR][0] : 0);
      const mp = () => (r.__econ[FR] ? r.__econ[FR][1] : 0);
      const cdSet = (ai) => r.__hero && r.__hero.cd && r.__hero.cd[0] && r.__hero.cd[0][ai] > 0;

      assert(r.__bal && r.__bal.heroes && JSON.stringify(r.__bal.heroes.slots) === JSON.stringify([id]), `balance.heroes.slots == ["${id}"]`);

      for (let ai = 0; ai < actives.length; ai++) {
        const ab = actives[ai], fx = ab.fx;
        if (fx.type === 'gold') {
          const g0 = gold(); r.send('hero', { h: 0, ab: ai });
          assert(await until(() => gold() >= g0 + fx.amount - 5), `«${ab.name}»: +${fx.amount} голды в econ`);
        } else if (fx.type === 'manpower') {
          r.send('buy', { city: own(FR)[0], spec: '40' }); await sleep(600);     // потратить манпауэр
          const m0 = mp(); r.send('hero', { h: 0, ab: ai });
          assert(await until(() => mp() > m0 + 3), `«${ab.name}»: манпауэр подскочил к потолку`);
        } else if (fx.type === 'garrison') {
          const k = own(FR)[0], u0 = r.state.cities.get(String(k)).units;
          r.send('hero', { h: 0, ab: ai });
          assert(await until(() => r.state.cities.get(String(k)).units > u0), `«${ab.name}»: +гарнизон в стейте`);
        } else if (fx.type === 'buff') {
          r.send('hero', { h: 0, ab: ai });
          assert(await until(() => r.__hero && r.__hero.buffs && r.__hero.buffs.some((b) => b.key === fx.key)), `«${ab.name}»: бафф ${fx.key} в econ`);
        } else if (fx.type === 'airstrike') {
          r.send('war', { tg: DE }); await sleep(500);
          const de = own(DE), before = de.reduce((s, k) => s + r.state.cities.get(String(k)).units, 0);
          r.send('hero', { h: 0, ab: ai });
          assert(await until(() => de.reduce((s, k) => s + r.state.cities.get(String(k)).units, 0) < before), `«${ab.name}»: гарнизон врага упал`);
        } else assert(false, `неизвестный fx.type: ${fx.type}`);
        assert(await until(() => cdSet(ai), 2500), `«${ab.name}»: кулдаун прилетел в econ`);
      }
      await r.leave();
    });
  }

  await server.gracefullyShutdown(false);
  summary('HERO E2E (каждый герой через сервер)');
})();
