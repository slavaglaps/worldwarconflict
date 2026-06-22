// Дымовой тест Фазы 2: сервер читает override баланса из таблицы Supabase `balance` (кэш + фолбэк).
// Не в `npm test` (нужна БД). Запуск:
//   DATABASE_URL=postgres://... node test/balance.pg.smoke.js
if (!process.env.DATABASE_URL) { console.error('SKIP: задайте DATABASE_URL для дымового теста баланса'); process.exit(2); }
const assert = require('assert');
const balanceStore = require('../balance-store');
const { Sim } = require('../sim/Sim');
const C = require('../sim/constants');
const map = require('../sim/map-data.json');
const pool = require('../db')._pool;

(async () => {
  await pool.query("CREATE TABLE IF NOT EXISTS balance (id TEXT PRIMARY KEY, data JSONB NOT NULL DEFAULT '{}', version INTEGER NOT NULL DEFAULT 1, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())");

  // 1. override из таблицы применяется к симу
  await pool.query("INSERT INTO balance (id, data) VALUES ('active', $1) ON CONFLICT (id) DO UPDATE SET data=$1",
    ['{"politics":{"warPrep":45},"tech":{"nodes":{"m1":{"g":777}}},"factions":{"1":{"gold":250,"mods":{"atk":1.2}}}}']);
  await balanceStore.refresh();
  const s = new Sim({ map, balance: balanceStore.current() });
  assert.strictEqual(s.warPrep, 45, 'политика из таблицы');
  assert.strictEqual(s.gold[1], 250, 'кастом старт-голд фракции 1');
  assert.strictEqual(s.gold[2], 60, 'дефолт старт-голд прочих');
  assert.strictEqual(s.techNode.m1.g, 777, 'кастом цена тех-узла');
  assert.ok(Math.abs(s.techMul(1, 'atk') - 1.2) < 1e-6, 'кастом мод атаки фракции 1');

  // 2. фолбэк: пустой override → чистые код-дефолты
  await pool.query("UPDATE balance SET data='{}' WHERE id='active'");
  await balanceStore.refresh();
  const d = new Sim({ map, balance: balanceStore.current() });
  assert.strictEqual(d.warPrep, C.WAR_PREP, 'пустой override → дефолтный warPrep');
  assert.strictEqual(d.gold[1], 60, 'пустой override → дефолтный голд');

  console.log('✓ balance Фаза 2 смоук: сервер читает override из Supabase (политика/техи/фракции), фолбэк на дефолты');
  await pool.end();
  process.exit(0);
})().catch((e) => { console.error('✗ balance смоук УПАЛ:', e.message); process.exit(1); });
