// Бутстрап сервера: WS (Colyseus) + HTTP-API (auth) на одном порту,
// матчмейкинг через LobbyRoom, горизонтальное масштабирование через Redis (env-gated).
const http = require('http');
const { Server, LobbyRoom, RedisPresence, RedisDriver, LocalPresence, LocalDriver } = require('colyseus');
const { WebSocketTransport } = require('@colyseus/ws-transport');
const { GameRoom } = require('./GameRoom');
const api = require('./http-api');

const PORT = Number(process.argv[2] || process.env.PORT || 2567);
const REDIS_URL = process.env.REDIS_URL;   // напр. redis://localhost:6379 → масштаб на N процессов

// общий HTTP-сервер: сначала наши роуты (/auth, /health, /leaderboard), иначе 404; WS — на нём же
const httpServer = http.createServer(async (req, res) => {
  try { if (await api.handle(req, res)) return; } catch (e) { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"error":"server"}'); return; }
  res.writeHead(404, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end('{"error":"not found"}');
});

// presence + driver: Redis для нескольких процессов за балансировщиком, иначе локально (1 процесс)
const presence = REDIS_URL ? new RedisPresence(REDIS_URL) : new LocalPresence();
const driver = REDIS_URL ? new RedisDriver(REDIS_URL) : new LocalDriver();

const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer }), presence, driver });
gameServer.define('game', GameRoom).enableRealtimeListing();   // комнаты видны в лобби в реальном времени
gameServer.define('lobby', LobbyRoom);                         // матчмейкинг: список/фильтр открытых игр

gameServer.listen(PORT)
  .then(() => console.log(`Colyseus on :${PORT} | HTTP-API on same port | scaling: ${REDIS_URL ? 'Redis ' + REDIS_URL + ' (multi-process)' : 'Local (single-process)'}`))
  .catch((e) => { console.error('listen failed:', e); process.exit(1); });
