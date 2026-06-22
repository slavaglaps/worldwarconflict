// HTTP-эндпоинты (на том же сервере, что и WS): регистрация/вход/здоровье/лидерборд.
const auth = require('./auth');
const db = require('./db');
const metrics = require('./metrics');
const { generateId } = require('colyseus');

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
const MAX_BODY = 16 * 1024;
const AUTH_RATE = { refill: 0.25, burst: 8 };
const buckets = new Map();

function json(res, code, obj) { res.writeHead(code, { 'content-type': 'application/json', ...CORS }); res.end(JSON.stringify(obj)); }
function body(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);   // уже распарсено express.json()
  return new Promise((resolve, reject) => {
    let b = '', tooLarge = false;
    req.on('data', c => {
      b += c;
      if (b.length > MAX_BODY) {
        tooLarge = true;
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (tooLarge) return;
      try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); }
    });
    req.on('error', () => { if (!tooLarge) reject(Object.assign(new Error('bad request'), { status: 400 })); });
  });
}
const publicUser = (u) => ({ id: u.id, username: u.username, wins: u.wins || 0, losses: u.losses || 0, rating: u.rating || 1000 });

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim() || 'unknown';
}
function allowAuth(req) {
  const key = clientIp(req);
  const now = Date.now() / 1000;
  const b = buckets.get(key) || { tokens: AUTH_RATE.burst, ts: now };
  b.tokens = Math.min(AUTH_RATE.burst, b.tokens + (now - b.ts) * AUTH_RATE.refill);
  b.ts = now;
  buckets.set(key, b);
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

// true → запрос обработан; false → пусть дальше (404/Colyseus)
async function handle(req, res) {
  const url = (req.url || '').split('?')[0];
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return true; }

  // здоровье (публично, безопасная сводка) — для аптайм-мониторов/балансировщика
  if (url === '/health') { const s = metrics.snapshot(); json(res, 200, { ok: true, uptime_s: s.uptime_s, rooms: s.rooms, clients: s.clients, ts: Date.now() }); return true; }

  // метрики: JSON или Prometheus-текст (?format=prom). Стектрейсы ошибок отдаём только с METRICS_TOKEN
  // (заголовок x-metrics-token или ?token=). Без токена — счётчики/перф без recent_errors.
  if (url === '/metrics') {
    const q = new URLSearchParams((req.url || '').split('?')[1] || '');
    const tok = process.env.METRICS_TOKEN;
    if (tok && q.get('token') !== tok && req.headers['x-metrics-token'] !== tok) { json(res, 401, { error: 'metrics token required' }); return true; }
    if (q.get('format') === 'prom') { res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4', ...CORS }); res.end(metrics.prometheus()); return true; }
    const snap = metrics.snapshot();
    if (!tok) { delete snap.recent_errors; snap.note = 'set METRICS_TOKEN env to require auth + expose recent_errors'; }
    json(res, 200, snap); return true;
  }

  if (url === '/auth/register' && req.method === 'POST') {
    if (!allowAuth(req)) { json(res, 429, { error: 'слишком много попыток' }); return true; }
    const { username, password } = await body(req);
    if (!username || !password || String(username).length < 3 || String(username).length > 24 || String(password).length < 4) { json(res, 400, { error: 'username 3–24 символа, password≥4' }); return true; }
    if (await db.getUserByName(username)) { json(res, 409, { error: 'имя занято' }); return true; }   // быстрый путь
    const user = { id: generateId(), username: String(username), pass: auth.hashPassword(password), wins: 0, losses: 0, rating: 1000, created: Date.now() };
    if (!(await db.createUser(user))) { json(res, 409, { error: 'имя занято' }); return true; }        // атомарный backstop против гонки
    json(res, 200, { token: auth.signToken({ id: user.id, username: user.username }), user: publicUser(user) }); return true;
  }

  if (url === '/auth/login' && req.method === 'POST') {
    if (!allowAuth(req)) { json(res, 429, { error: 'слишком много попыток' }); return true; }
    const { username, password } = await body(req);
    const user = await db.getUserByName(username || '');
    if (!user || !auth.verifyPassword(password || '', user.pass)) { json(res, 401, { error: 'неверный логин или пароль' }); return true; }
    json(res, 200, { token: auth.signToken({ id: user.id, username: user.username }), user: publicUser(user) }); return true;
  }

  if (url === '/leaderboard') { json(res, 200, await db.leaderboard(10)); return true; }

  return false;
}

module.exports = { handle };
