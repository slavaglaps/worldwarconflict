// Структура под Colyseus Cloud (@colyseus/tools). Cloud впрыскивает транспорт/presence/driver
// и масштабирование; локально — дефолты (LocalDriver/Presence). Комнаты и HTTP-роуты — здесь.
const config = require('@colyseus/tools').default;
const { LobbyRoom } = require('colyseus');
const { GameRoom } = require('./GameRoom');
const api = require('./http-api');

module.exports = config({
  initializeGameServer: (gameServer) => {
    gameServer.define('game', GameRoom).enableRealtimeListing();   // реальная Европа + ИИ
    gameServer.define('lobby', LobbyRoom);                         // матчмейкинг/листинг
  },

  initializeExpress: (app) => {
    // наши HTTP-роуты (auth/health/leaderboard) поверх express-приложения Colyseus
    app.use((req, res, next) => {
      api.handle(req, res)
        .then((handled) => { if (!handled) next(); })
        .catch((e) => {
          const code = e && e.status ? e.status : 500;
          res.writeHead(code, { 'content-type': 'application/json' });
          res.end(code === 413 ? '{"error":"body too large"}' : '{"error":"server"}');
        });
    });
  },

  beforeListen: () => {
    // graceful shutdown: закрыть пул БД (без exit — выход делает сам Colyseus)
    const db = require('./db');
    const closeDb = () => { Promise.resolve(db.close && db.close()).catch(() => {}); };
    process.once('SIGTERM', closeDb);
    process.once('SIGINT', closeDb);
  },
});
