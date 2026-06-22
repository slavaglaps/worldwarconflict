// Наблюдаемость: модуль metrics (счётчики/перф/кольцо ошибок) + HTTP-роуты
// (/health, /metrics через прямой вызов handle() с мок-req/res) + интеграция GameRoom→metrics.
global.WebSocket = global.WebSocket || require('ws');
const { Server } = require('colyseus');
const { Client } = require('colyseus.js');
const { GameRoom } = require('../GameRoom');
const metrics = require('../metrics');
const api = require('../http-api');
const { group, test, testAsync, assert, eq, gt, summary } = require('./harness');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// прямой вызов роутера без сети: handle(req,res) и собранный ответ
function callApi(url, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = { url, method, headers, on: () => {}, socket: {} };
    let code = 0, body = '';
    const res = { writeHead: (c) => { code = c; }, end: (b) => { body = b || ''; resolve({ code, body }); } };
    api.handle(req, res).then((handled) => { if (!handled) resolve({ code: 404, body: '' }); }).catch(reject);
  });
}

(async () => {
  group('Наблюдаемость: модуль metrics');
  test('активные комнаты/клиенты считаются через дельты', () => {
    const a = metrics.snapshot();
    metrics.roomCreated(); metrics.join(); metrics.join();
    const b = metrics.snapshot();
    eq(b.rooms, a.rooms + 1, '+1 активная комната');
    eq(b.clients, a.clients + 2, '+2 клиента');
    metrics.leave(); metrics.roomDisposed();
    const c = metrics.snapshot();
    eq(c.rooms, a.rooms, 'комната закрыта → откат');
    eq(c.clients, a.clients + 1, 'один клиент ушёл');
  });
  test('команды/отказы/ошибки/перф тика', () => {
    const a = metrics.snapshot();
    metrics.command(false); metrics.command(true);
    metrics.tick(1.5); metrics.tick(3.5);
    metrics.error('unit-test', new Error('boom'));
    const b = metrics.snapshot();
    eq(b.commands, a.commands + 2, '+2 команды');
    eq(b.denials, a.denials + 1, '+1 отказ');
    eq(b.errors, a.errors + 1, '+1 ошибка');
    gt(b.tick_max_ms, 0, 'tick_max>0');
    assert(b.recent_errors.some(e => e.where === 'unit-test' && /boom/.test(e.msg)), 'ошибка попала в кольцо');
  });
  test('prometheus-текст содержит gauges и TYPE', () => {
    const p = metrics.prometheus();
    assert(p.includes('wwc_rooms_active'), 'gauge rooms_active');
    assert(p.includes('# TYPE wwc_tick_avg_ms gauge'), 'TYPE-строка');
  });

  group('Наблюдаемость: HTTP-роуты');
  await testAsync('/health — публичная безопасная сводка', async () => {
    const r = await callApi('/health'); eq(r.code, 200);
    const j = JSON.parse(r.body);
    assert(j.ok === true && typeof j.rooms === 'number' && typeof j.uptime_s === 'number', 'ok+rooms+uptime');
  });
  await testAsync('/metrics без токена — счётчики, но без recent_errors', async () => {
    delete process.env.METRICS_TOKEN;
    const r = await callApi('/metrics'); eq(r.code, 200);
    const j = JSON.parse(r.body);
    assert(typeof j.commands === 'number', 'счётчики есть');
    assert(!('recent_errors' in j), 'стектрейсы скрыты без токена');
  });
  await testAsync('/metrics?format=prom — Prometheus-текст', async () => {
    const r = await callApi('/metrics?format=prom'); eq(r.code, 200);
    assert(r.body.includes('wwc_uptime_seconds'), 'prom-текст');
  });
  await testAsync('/metrics с METRICS_TOKEN требует токен', async () => {
    process.env.METRICS_TOKEN = 'secret123';
    eq((await callApi('/metrics')).code, 401, 'без токена → 401');
    const ok = await callApi('/metrics?token=secret123'); eq(ok.code, 200, 'с токеном → 200');
    assert('recent_errors' in JSON.parse(ok.body), 'с токеном видны recent_errors');
    delete process.env.METRICS_TOKEN;
  });

  group('Наблюдаемость: интеграция GameRoom → metrics');
  await testAsync('join + команда + тики отражаются в snapshot', async () => {
    GameRoom.simOptions = { factions: 4, cities: 12, warPrep: 0, goldStart: 500, politStart: 200, rng: () => 0.01 };
    const PORT = 2913;
    const server = new Server(); server.define('game', GameRoom); await server.listen(PORT);
    const before = metrics.snapshot();
    const c = new Client(`ws://localhost:${PORT}`);
    const r = await c.create('game', { faction: 0 });
    ['econ', 'balance', 'assigned', 'denied'].forEach(t => r.onMessage(t, () => {}));
    await sleep(400);
    const ck = [...r.state.cities.entries()].find(([, cc]) => cc.owner === 0);
    if (ck) r.send('buy', { city: Number(ck[0]), spec: '5' });
    await sleep(600);
    const after = metrics.snapshot();
    gt(after.rooms_created, before.rooms_created, 'комната создана');
    gt(after.joins, before.joins, 'джойн посчитан');
    gt(after.commands, before.commands, 'команда посчитана');
    gt(after.tick_count, before.tick_count, 'тики идут');
    await r.leave(); await server.gracefullyShutdown(false);
  });

  summary('METRICS (observability)');
})();
