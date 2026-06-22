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

// схема: создаётся идемпотентно. Кешируем только УСПЕХ — при сбое сбрасываем,
// чтобы следующий запрос повторил попытку (иначе разовый сбой БД на старте = вечный кирпич).
const DDL = `
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
  CREATE TABLE IF NOT EXISTS match_players (
    id       BIGSERIAL PRIMARY KEY,
    match_id BIGINT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    won      BOOLEAN NOT NULL DEFAULT false
  );
  CREATE INDEX IF NOT EXISTS match_players_user_idx ON match_players (user_id);
  CREATE INDEX IF NOT EXISTS match_players_match_idx ON match_players (match_id);
  -- баланс игры: строка id='active'. Override разбит по СЕКЦИЯМ-полям (удобно править в Directus,
  -- у каждого своё описание/шаблон). Сервер мёржит секции в один override (legacy data — снизу, back-compat).
  CREATE TABLE IF NOT EXISTS balance (
    id         TEXT PRIMARY KEY,
    data       JSONB       NOT NULL DEFAULT '{}',
    version    INTEGER     NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ALTER TABLE balance ADD COLUMN IF NOT EXISTS politics JSONB;   -- сроки/стоимости/шансы дипломатии (+peace-формула)
  ALTER TABLE balance ADD COLUMN IF NOT EXISTS tune     JSONB;   -- юниты/экономика/бой (override sim/constants.js по имени)
  ALTER TABLE balance ADD COLUMN IF NOT EXISTS ai       JSONB;   -- поведение ботов
  ALTER TABLE balance ADD COLUMN IF NOT EXISTS factions JSONB;   -- factionDefault + пер-страновая асимметрия
  ALTER TABLE balance ADD COLUMN IF NOT EXISTS tech     JSONB;   -- {nodes:{...}} дерево технологий
  ALTER TABLE balance ADD COLUMN IF NOT EXISTS heroes   JSONB;   -- {perFaction,maxSlots,pool:{...}} герои
  INSERT INTO balance (id, data) VALUES ('active', '{}') ON CONFLICT (id) DO NOTHING;
  -- авто-ревизия: при изменении ЛЮБОЙ секции триггер инкрементит version + updated_at (видно реальную ревизию в комнате)
  CREATE OR REPLACE FUNCTION balance_bump() RETURNS trigger AS $fn$
  BEGIN
    IF ROW(NEW.data, NEW.politics, NEW.tune, NEW.ai, NEW.factions, NEW.tech, NEW.heroes)
       IS DISTINCT FROM ROW(OLD.data, OLD.politics, OLD.tune, OLD.ai, OLD.factions, OLD.tech, OLD.heroes) THEN
      NEW.version := COALESCE(OLD.version, 0) + 1; NEW.updated_at := now();
    END IF;
    RETURN NEW;
  END; $fn$ LANGUAGE plpgsql;
  DROP TRIGGER IF EXISTS balance_bump_trg ON balance;
  CREATE TRIGGER balance_bump_trg BEFORE UPDATE ON balance FOR EACH ROW EXECUTE FUNCTION balance_bump();
  -- RLS вкл. без политик: закрывает публичный REST-API (anon-ключ); наш сервер (роль postgres) RLS обходит
  ALTER TABLE users         ENABLE ROW LEVEL SECURITY;
  ALTER TABLE matches       ENABLE ROW LEVEL SECURITY;
  ALTER TABLE match_players ENABLE ROW LEVEL SECURITY;
  ALTER TABLE balance       ENABLE ROW LEVEL SECURITY;`;
let schemaP = null;
function ensureSchema() {
  if (!schemaP) schemaP = pool.query(DDL)
    .then(() => console.log('[db.pg] schema ready'))
    .catch((e) => { schemaP = null; console.error('[db.pg] schema init failed:', e.message); throw e; });
  return schemaP;
}

const rowToUser = (r) => r && { id: r.id, username: r.username, pass: r.pass, wins: r.wins, losses: r.losses, rating: r.rating, created: Number(r.created) };

module.exports = {
  async getUserByName(name) {
    await ensureSchema();
    const { rows } = await pool.query('SELECT * FROM users WHERE username_lower=$1', [String(name).toLowerCase()]);
    return rowToUser(rows[0]) || null;
  },
  async getUserById(id) {
    await ensureSchema();
    const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [id]);
    return rowToUser(rows[0]) || null;
  },
  // Атомарное создание: ON CONFLICT + RETURNING. Возвращает null, если ник уже занят
  // (закрывает гонку регистрации — вызывающий обязан проверить результат).
  async createUser(u) {
    await ensureSchema();
    const { rows } = await pool.query(
      `INSERT INTO users (id, username, username_lower, pass, wins, losses, rating, created)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (username_lower) DO NOTHING RETURNING id`,
      [u.id, u.username, u.username.toLowerCase(), u.pass, u.wins || 0, u.losses || 0, u.rating ?? 1000, u.created || Date.now()]);
    return rows[0] ? u : null;
  },
  async updateUser(u) {
    await ensureSchema();
    await pool.query('UPDATE users SET username=$2, pass=$3, wins=$4, losses=$5, rating=$6 WHERE id=$1',
      [u.id, u.username, u.pass, u.wins || 0, u.losses || 0, u.rating ?? 1000]);
    return u;
  },
  // Итог матча: запись + обновление W/L/рейтинга — В ОДНОЙ ТРАНЗАКЦИИ (атомарно, на одном
  // соединении). Креш посередине откатывается целиком. Тот же баланс, что в файловом сторе.
  async recordMatch(m) {
    await ensureSchema();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const match = await client.query('INSERT INTO matches (ts, players) VALUES ($1, $2) RETURNING id', [m.ts || Date.now(), JSON.stringify(m.players || [])]);
      const matchId = match.rows[0].id;
      for (const p of (m.players || [])) {
        await client.query('INSERT INTO match_players (match_id, user_id, won) VALUES ($1, $2, $3)', [matchId, p.id, !!p.won]);
        if (p.won) await client.query('UPDATE users SET wins=wins+1, rating=rating+20 WHERE id=$1', [p.id]);
        else await client.query('UPDATE users SET losses=losses+1, rating=GREATEST(0, rating-15) WHERE id=$1', [p.id]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    return m;
  },
  async leaderboard(n = 10) {
    await ensureSchema();
    const { rows } = await pool.query('SELECT username, wins, losses, rating FROM users ORDER BY rating DESC, username ASC LIMIT $1', [n | 0 || 10]);
    return rows.map((r) => ({ username: r.username, wins: r.wins, losses: r.losses, rating: r.rating }));
  },
  // строка активного баланса. ensureSchema() ГАРАНТИРУЕТ существование таблицы (на свежей БД
  // balance-store больше не падает с relation "balance" does not exist → дефолты).
  async getBalanceRow() {
    await ensureSchema();
    const { rows } = await pool.query("SELECT data, politics, tune, ai, factions, tech, heroes, version, updated_at FROM balance WHERE id = 'active'");
    return rows[0] || null;
  },
  async _flush() { /* в Postgres коммит синхронный — нечего сбрасывать */ },
  async close() { await pool.end(); },   // graceful shutdown
  _pool: pool,
};
