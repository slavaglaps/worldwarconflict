// Postgres-стор (прод, Supabase/Neon). Тот же async-интерфейс, что и db.file.js.
// Включается, когда задан DATABASE_URL. Таблицы создаются автоматически при старте.
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // managed-Postgres (Supabase/Neon) требует SSL; их цепочка серверу не известна → не валидируем CA
  ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
});
pool.on('error', (e) => console.error('[db.pg] pool error', e.message));

// схема: создаётся идемпотентно при первом обращении (один раз на процесс)
const ready = pool.query(`
  CREATE TABLE IF NOT EXISTS users (
    id             TEXT PRIMARY KEY,
    username       TEXT NOT NULL,
    username_lower TEXT UNIQUE NOT NULL,
    pass           TEXT NOT NULL,
    wins           INTEGER NOT NULL DEFAULT 0,
    losses         INTEGER NOT NULL DEFAULT 0,
    rating         INTEGER NOT NULL DEFAULT 1000,
    created        BIGINT  NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS users_rating_idx ON users (rating DESC);
  CREATE TABLE IF NOT EXISTS matches (
    id      BIGSERIAL PRIMARY KEY,
    ts      BIGINT NOT NULL,
    players JSONB  NOT NULL DEFAULT '[]'
  );
`).then(() => console.log('[db.pg] schema ready'))
  .catch((e) => { console.error('[db.pg] schema init failed:', e.message); throw e; });

const rowToUser = (r) => r && { id: r.id, username: r.username, pass: r.pass, wins: r.wins, losses: r.losses, rating: r.rating, created: Number(r.created) };

module.exports = {
  async getUserByName(name) {
    await ready;
    const { rows } = await pool.query('SELECT * FROM users WHERE username_lower=$1', [String(name).toLowerCase()]);
    return rowToUser(rows[0]) || null;
  },
  async getUserById(id) {
    await ready;
    const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [id]);
    return rowToUser(rows[0]) || null;
  },
  async createUser(u) {
    await ready;
    await pool.query(
      `INSERT INTO users (id, username, username_lower, pass, wins, losses, rating, created)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (username_lower) DO NOTHING`,
      [u.id, u.username, u.username.toLowerCase(), u.pass, u.wins || 0, u.losses || 0, u.rating ?? 1000, u.created || Date.now()]);
    return u;
  },
  async updateUser(u) {
    await ready;
    await pool.query('UPDATE users SET username=$2, pass=$3, wins=$4, losses=$5, rating=$6 WHERE id=$1',
      [u.id, u.username, u.pass, u.wins || 0, u.losses || 0, u.rating ?? 1000]);
    return u;
  },
  // итог матча: запись + атомарное обновление W/L/рейтинга участников (тот же баланс, что в файловом сторе)
  async recordMatch(m) {
    await ready;
    await pool.query('INSERT INTO matches (ts, players) VALUES ($1, $2)', [m.ts || Date.now(), JSON.stringify(m.players || [])]);
    for (const p of (m.players || [])) {
      if (p.won) await pool.query('UPDATE users SET wins=wins+1, rating=rating+20 WHERE id=$1', [p.id]);
      else await pool.query('UPDATE users SET losses=losses+1, rating=GREATEST(0, rating-15) WHERE id=$1', [p.id]);
    }
    return m;
  },
  async leaderboard(n = 10) {
    await ready;
    const { rows } = await pool.query('SELECT username, wins, losses, rating FROM users ORDER BY rating DESC, username ASC LIMIT $1', [n | 0 || 10]);
    return rows.map((r) => ({ username: r.username, wins: r.wins, losses: r.losses, rating: r.rating }));
  },
  async _flush() { /* в Postgres коммит синхронный — нечего сбрасывать */ },
  _pool: pool,
};
