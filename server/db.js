// Персистентность аккаунтов и матчей. Файловый стор за асинхронным интерфейсом —
// в проде меняется на Postgres/Mongo без правок вызывающего кода.
const fs = require('fs'), path = require('path');
const FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'db.json');

let data = { users: {}, matches: [] };
try { data = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* пустой стор */ }

let timer = null;
function flush() { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(data)); }
function save() { if (timer) return; timer = setTimeout(() => { timer = null; flush(); }, 40); }   // батчим записи

module.exports = {
  async getUserByName(name) { return data.users[String(name).toLowerCase()] || null; },
  async getUserById(id) { for (const k in data.users) if (data.users[k].id === id) return data.users[k]; return null; },
  async createUser(u) { data.users[u.username.toLowerCase()] = u; save(); return u; },
  async updateUser(u) { data.users[u.username.toLowerCase()] = u; save(); return u; },
  // итог матча: обновляем W/L/рейтинг участников
  async recordMatch(m) {
    data.matches.push(m); if (data.matches.length > 5000) data.matches.shift();
    for (const p of (m.players || [])) {
      const u = await this.getUserById(p.id); if (!u) continue;
      if (p.won) { u.wins = (u.wins || 0) + 1; u.rating = (u.rating || 1000) + 20; }
      else { u.losses = (u.losses || 0) + 1; u.rating = Math.max(0, (u.rating || 1000) - 15); }
      await this.updateUser(u);
    }
    save(); return m;
  },
  async leaderboard(n = 10) {
    return Object.values(data.users).sort((a, b) => (b.rating || 0) - (a.rating || 0)).slice(0, n)
      .map(u => ({ username: u.username, wins: u.wins || 0, losses: u.losses || 0, rating: u.rating || 1000 }));
  },
  _flush: flush,
};
