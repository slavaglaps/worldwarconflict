// HTTP-эндпоинты (на том же сервере, что и WS): регистрация/вход/здоровье/лидерборд.
const auth = require('./auth');
const db = require('./db');
const { generateId } = require('colyseus');

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
function json(res, code, obj) { res.writeHead(code, { 'content-type': 'application/json', ...CORS }); res.end(JSON.stringify(obj)); }
function body(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);   // уже распарсено express.json()
  return new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); });
}
const publicUser = (u) => ({ id: u.id, username: u.username, wins: u.wins || 0, losses: u.losses || 0, rating: u.rating || 1000 });

// true → запрос обработан; false → пусть дальше (404/Colyseus)
async function handle(req, res) {
  const url = (req.url || '').split('?')[0];
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return true; }

  if (url === '/health') { json(res, 200, { ok: true, ts: Date.now() }); return true; }

  if (url === '/auth/register' && req.method === 'POST') {
    const { username, password } = await body(req);
    if (!username || !password || String(username).length < 3 || String(password).length < 4) { json(res, 400, { error: 'username≥3 и password≥4' }); return true; }
    if (await db.getUserByName(username)) { json(res, 409, { error: 'имя занято' }); return true; }
    const user = { id: generateId(), username, pass: auth.hashPassword(password), wins: 0, losses: 0, rating: 1000, created: Date.now() };
    await db.createUser(user);
    json(res, 200, { token: auth.signToken({ id: user.id, username }), user: publicUser(user) }); return true;
  }

  if (url === '/auth/login' && req.method === 'POST') {
    const { username, password } = await body(req);
    const user = await db.getUserByName(username || '');
    if (!user || !auth.verifyPassword(password || '', user.pass)) { json(res, 401, { error: 'неверный логин или пароль' }); return true; }
    json(res, 200, { token: auth.signToken({ id: user.id, username: user.username }), user: publicUser(user) }); return true;
  }

  if (url === '/leaderboard') { json(res, 200, await db.leaderboard(10)); return true; }

  return false;
}

module.exports = { handle };
