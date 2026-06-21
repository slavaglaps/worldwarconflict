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
        .catch(() => { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"error":"server"}'); });
    });
  },

  beforeListen: () => { /* миграции БД и т.п. — сюда */ },
});
