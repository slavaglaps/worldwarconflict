// Дымовой тест Postgres-бэкенда (db.pg.js) против РЕАЛЬНОГО Postgres.
// Не входит в `npm test` (тот гоняет файловый стор без БД). Запуск вручную:
//   DATABASE_URL=postgres://postgres:test@localhost:55432/wwc PGSSL=disable node test/db.pg.smoke.js
if (!process.env.DATABASE_URL) { console.error('SKIP: задайте DATABASE_URL для дымового теста Postgres'); process.exit(2); }
const assert = require('assert');
const db = require('../db');            // селектор → db.pg (DATABASE_URL задан)

(async () => {
  const pool = db._pool;
  await db.getUserByName('warmup');     // дождаться авто-миграции схемы
  await pool.query('TRUNCATE match_players, matches, users RESTART IDENTITY');   // чистый старт

  // 1. createUser + регистронезависимый поиск
  const alice = { id: 'u_alice', username: 'Alice', pass: 'salt:hash', wins: 0, losses: 0, rating: 1000, created: Date.now() };
  const bob = { id: 'u_bob', username: 'Bob', pass: 'salt:hash2', wins: 0, losses: 0, rating: 10, created: Date.now() };
  await db.createUser(alice); await db.createUser(bob);
  assert((await db.getUserByName('ALICE')).id === 'u_alice', 'регистронезависимый поиск по нику');
  assert((await db.getUserById('u_bob')).username === 'Bob', 'поиск по id');

  // 2. ON CONFLICT: дубликат ника → createUser возвращает null, второй записи нет (гонка регистрации закрыта)
  const dupRet = await db.createUser({ id: 'u_alice2', username: 'alice', pass: 'x', wins: 0, losses: 0, rating: 1, created: Date.now() });
  assert(dupRet === null, 'createUser на занятый ник возвращает null');
  const dup = (await pool.query("SELECT count(*)::int n FROM users WHERE username_lower='alice'")).rows[0].n;
  assert(dup === 1, 'дубликат ника отклонён (ON CONFLICT)');
  assert((await db.getUserById('u_alice')).pass === 'salt:hash', 'оригинальный аккаунт НЕ перезаписан');

  // 3. updateUser
  alice.rating = 1234; await db.updateUser(alice);
  assert((await db.getUserById('u_alice')).rating === 1234, 'updateUser обновляет рейтинг');

  // 4. recordMatch: победитель +20/+win, проигравший -15/+loss, пол GREATEST(0,...)
  await db.recordMatch({ ts: Date.now(), players: [{ id: 'u_alice', won: true }, { id: 'u_bob', won: false }] });
  const a2 = await db.getUserById('u_alice'), b2 = await db.getUserById('u_bob');
  assert(a2.wins === 1 && a2.rating === 1254, `победитель: wins=${a2.wins} rating=${a2.rating}`);
  assert(b2.losses === 1 && b2.rating === 0, `проигравший с полом 0: losses=${b2.losses} rating=${b2.rating}`);  // 10-15 → max(0,-5)=0
  const matchN = (await pool.query('SELECT count(*)::int n FROM matches')).rows[0].n;
  assert(matchN === 1, 'матч записан (JSONB players)');
  const mpN = (await pool.query('SELECT count(*)::int n FROM match_players')).rows[0].n;
  assert(mpN === 2, 'участники матча записаны в match_players');

  // 5. leaderboard: сортировка по рейтингу
  const lb = await db.leaderboard(10);
  assert(lb[0].username === 'Alice' && lb[0].rating === 1254, 'лидерборд: Alice первая');
  assert(lb[1].username === 'Bob', 'лидерборд: Bob второй');

  console.log('✓ db.pg смоук: все проверки прошли (createUser/поиск/ON CONFLICT/update/recordMatch/GREATEST/leaderboard)');
  await pool.end();
  process.exit(0);
})().catch((e) => { console.error('✗ db.pg смоук УПАЛ:', e.message); process.exit(1); });
