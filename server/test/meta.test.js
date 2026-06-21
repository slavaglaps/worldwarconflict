// ФАЗА 4 (мета): аккаунты/авторизация (HTTP+JWT), авторизованный вход в игру (WS),
// матчмейкинг (листинг/метаданные/joinById), реконнект, персист статистики.
process.env.DB_FILE = require('path').join(require('os').tmpdir(), 'voxel-meta-test-db.json');
require('fs').rmSync(process.env.DB_FILE, { force: true });
global.WebSocket = global.WebSocket || require('ws');

const http = require('http');
const { Server, LobbyRoom, LocalPresence, LocalDriver, matchMaker } = require('colyseus');
const { WebSocketTransport } = require('@colyseus/ws-transport');
const { Client } = require('colyseus.js');
const { GameRoom } = require('../GameRoom');
const api = require('../http-api');
const db = require('../db');
const { group, testAsync, assert, eq, gt, summary } = require('./harness');

const PORT = 2901;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function post(path, b) {
  return new Promise((resolve) => {
    const data = JSON.stringify(b);
    const req = http.request({ host: 'localhost', port: PORT, path, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } },
      res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d || '{}') })); });
    req.write(data); req.end();
  });
}
const get = (path) => new Promise(resolve => http.get(`http://localhost:${PORT}${path}`, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d || '{}') })); }));

(async () => {
  GameRoom.simOptions = { factions: 4, cities: 4, goldStart: 100, politStart: 200 };
  const httpServer = http.createServer(async (req, res) => { if (await api.handle(req, res)) return; res.writeHead(404); res.end('{}'); });
  const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer }), presence: new LocalPresence(), driver: new LocalDriver() });
  gameServer.define('game', GameRoom).enableRealtimeListing();
  gameServer.define('lobby', LobbyRoom);
  await gameServer.listen(PORT);

  group('META: аккаунты / авторизация (HTTP + JWT)');
  let token = null;
  await testAsync('регистрация → токен + профиль (rating 1000)', async () => {
    const r = await post('/auth/register', { username: 'alice', password: 'secret' });
    eq(r.status, 200); assert(r.body.token, 'есть токен'); eq(r.body.user.username, 'alice'); eq(r.body.user.rating, 1000);
    token = r.body.token;
  });
  await testAsync('короткий пароль → 400', async () => { eq((await post('/auth/register', { username: 'bob', password: 'x' })).status, 400); });
  await testAsync('повторная регистрация → 409', async () => { eq((await post('/auth/register', { username: 'alice', password: 'other' })).status, 409); });
  await testAsync('createUser на занятый ник → null, аккаунт не перезаписан (гонка)', async () => {
    eq(await db.createUser({ id: 'racer', username: 'alice', pass: 'evil', wins: 0, losses: 0, rating: 1, created: Date.now() }), null);
    assert((await db.getUserByName('alice')).pass !== 'evil', 'оригинальная alice цела');
  });
  await testAsync('вход с верным паролем → токен', async () => { const r = await post('/auth/login', { username: 'alice', password: 'secret' }); eq(r.status, 200); assert(r.body.token); });
  await testAsync('вход с неверным паролем → 401', async () => { eq((await post('/auth/login', { username: 'alice', password: 'wrong' })).status, 401); });

  group('META: авторизованный вход в игру (WS onAuth)');
  await testAsync('join с токеном → identity (не гость)', async () => {
    const c = new Client(`ws://localhost:${PORT}`);
    const room = await c.joinOrCreate('game', { token });
    let you = null; room.onMessage('assigned', m => you = m.you);
    await sleep(400);
    assert(you, 'получил assigned'); eq(you.username, 'alice'); eq(you.guest, false);
    await room.leave();
  });
  await testAsync('join без токена → гость', async () => {
    const c = new Client(`ws://localhost:${PORT}`);
    const room = await c.create('game', { name: 'GuestGame' });
    let you = null; room.onMessage('assigned', m => you = m.you);
    await sleep(400);
    assert(you && you.guest === true, 'гость');
    await room.leave();
  });
  await testAsync('битый токен → отказ во входе', async () => {
    const c = new Client(`ws://localhost:${PORT}`);
    let rejected = false;
    try { await c.joinOrCreate('game', { token: 'garbage.token.here' }); } catch (e) { rejected = true; }
    assert(rejected, 'сервер отклонил битый токен');
  });

  group('META: матчмейкинг (листинг / метаданные / joinById)');
  await testAsync('созданная игра видна в списке с метаданными', async () => {
    const c = new Client(`ws://localhost:${PORT}`);
    const room = await c.create('game', { name: 'MyBattle', region: 'eu' });
    await sleep(300);
    const rooms = await matchMaker.query({ name: 'game' });
    const found = rooms.find(r => r.roomId === room.roomId);
    assert(found, 'комната в листинге'); eq(found.metadata.name, 'MyBattle'); eq(found.metadata.maxPlayers, 4);
    await room.leave();
  });
  await testAsync('joinById подключает к той же комнате', async () => {
    const c1 = new Client(`ws://localhost:${PORT}`); const r1 = await c1.create('game', { name: 'JoinMe' });
    const c2 = new Client(`ws://localhost:${PORT}`); const r2 = await c2.joinById(r1.roomId);
    await sleep(300);
    eq(r2.roomId, r1.roomId);
    await r1.leave(); await r2.leave();
  });
  await testAsync('лобби-комната доступна для матчмейкинга', async () => {
    const c = new Client(`ws://localhost:${PORT}`);
    const lobby = await c.joinOrCreate('lobby');
    await sleep(300); assert(lobby.roomId, 'лобби подключилось');
    await lobby.leave();
  });

  group('META: реконнект');
  await testAsync('обрыв → реконнект сохраняет сессию/фракцию', async () => {
    const c = new Client(`ws://localhost:${PORT}`);
    const room = await c.create('game', { name: 'Recon' });
    await sleep(400);
    const rtoken = room.reconnectionToken;
    await room.leave(false);                       // неконсентный выход → сервер ждёт реконнект
    await sleep(300);
    const room2 = await c.reconnect(rtoken);
    await sleep(300);
    eq(room2.sessionId, room.sessionId);
    await room2.leave();
  });

  group('META: персист статистики');
  await testAsync('итог матча обновляет W/L + рейтинг', async () => {
    const u = await db.getUserByName('alice');
    await db.recordMatch({ ts: Date.now(), players: [{ id: u.id, won: true }] });
    const r = await post('/auth/login', { username: 'alice', password: 'secret' });
    eq(r.body.user.wins, 1); gt(r.body.user.rating, 1000);
  });
  await testAsync('лидерборд отдаёт игроков', async () => { const r = await get('/leaderboard'); eq(r.status, 200); assert(Array.isArray(r.body) && r.body.length >= 1, 'есть игроки'); });

  await gameServer.gracefullyShutdown(false);
  summary('META (phase 4)');
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('META ERROR', e); process.exit(1); });
