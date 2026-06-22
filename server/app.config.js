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

  beforeListen: async () => {
    const metrics = require('./metrics');
    metrics.startHeartbeat();                        // строка [health] в логи раз в минуту
    metrics.installProcessHandlers();                // unhandledRejection/uncaughtException → метрики + лог
    // ДОЖДАТЬСЯ первой загрузки override баланса из Supabase (с таймаутом 5с, чтобы не висеть, если БД молчит) —
    // иначе первая комната после рестарта могла бы стартовать на код-дефолтах, не дождавшись Directus.
    const withTimeout = (p, ms) => new Promise((res) => { const t = setTimeout(res, ms); if (t.unref) t.unref(); Promise.resolve(p).then(res, res); });
    await withTimeout(require('./balance-store').startAutoRefresh(), 5000);
    // graceful shutdown: закрыть пул БД (без exit — выход делает сам Colyseus)
    const db = require('./db');
    const closeDb = () => { Promise.resolve(db.close && db.close()).catch(() => {}); };
    process.once('SIGTERM', closeDb);
    process.once('SIGINT', closeDb);
  },
});
