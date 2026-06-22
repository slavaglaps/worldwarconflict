// Дымовой тест баланса (нужна БД): сервер сам создаёт схему (#1), мёржит СЕКЦИИ-поля
// (politics/tune/ai/factions/tech/heroes) в один override, version-триггер бампается при смене
// любой секции (#4), legacy `data` всё ещё работает (back-compat). Запуск:
//   DATABASE_URL=postgres://... node test/balance.pg.smoke.js
if (!process.env.DATABASE_URL) { console.error('SKIP: задайте DATABASE_URL для дымового теста баланса'); process.exit(2); }
const assert = require('assert');
const balanceStore = require('../balance-store');
const db = require('../db');
const { Sim } = require('../sim/Sim');
const C = require('../sim/constants');
const map = require('../sim/map-data.json');
const pool = db._pool;
const reset = () => pool.query("UPDATE balance SET data='{}', politics=NULL, tune=NULL, ai=NULL, factions=NULL, tech=NULL, heroes=NULL WHERE id='active'");

(async () => {
  // #1: balance-store САМ создаёт схему (getBalanceRow → ensureSchema). Таблицу руками НЕ создаём.
  await balanceStore.refresh();
  assert.ok(await db.getBalanceRow(), 'getBalanceRow вернул строку (авто-схема, #1)');
  await reset();

  // 1. СЕКЦИИ-поля мёржатся в override и применяются к симу
  await pool.query("UPDATE balance SET politics=$1, tech=$2, factions=$3 WHERE id='active'",
    ['{"warPrep":45}', '{"nodes":{"m1":{"g":777}}}', '{"factionDefault":{"gold":200},"1":{"gold":250,"mods":{"atk":1.2}}}']);
  await balanceStore.refresh();
  const s = new Sim({ map, balance: balanceStore.current() });
  assert.strictEqual(s.warPrep, 45, 'секция politics применилась');
  assert.strictEqual(s.gold[1], 250, 'секция factions: кастом старт-голд страны 1');
  assert.strictEqual(s.gold[2], 200, 'секция factions.factionDefault: общий старт-голд (раскладка factionDefault)');
  assert.strictEqual(s.techNode.m1.g, 777, 'секция tech: цена узла');
  assert.ok(Math.abs(s.techMul(1, 'atk') - 1.2) < 1e-6, 'секция factions: мод атаки страны 1');

  // 2. version-триггер бампается при смене ЛЮБОЙ секции (не только data)
  const v1 = (await db.getBalanceRow()).version;
  await pool.query("UPDATE balance SET tune=$1 WHERE id='active'", ['{"SHIP_COST":99}']);
  const v2 = (await db.getBalanceRow()).version;
  assert.ok(v2 > v1, `version вырос при смене секции tune (${v1}→${v2}, #4)`);
  await balanceStore.refresh();
  assert.strictEqual(new Sim({ map, balance: balanceStore.current() }).K.SHIP_COST, 99, 'секция tune: SHIP_COST');

  // 3. legacy `data` (back-compat) тоже мёржится (снизу)
  await reset();
  await pool.query("UPDATE balance SET data=$1 WHERE id='active'", ['{"politics":{"warPrep":33}}']);
  await balanceStore.refresh();
  assert.strictEqual(new Sim({ map, balance: balanceStore.current() }).warPrep, 33, 'legacy data всё ещё применяется');

  // 4. фолбэк: всё пусто → чистые код-дефолты
  await reset();
  await balanceStore.refresh();
  const d = new Sim({ map, balance: balanceStore.current() });
  assert.strictEqual(d.warPrep, C.WAR_PREP, 'пусто → дефолтный warPrep');
  assert.strictEqual(d.gold[1], 60, 'пусто → дефолтный голд');

  console.log('✓ balance смоук: секции-поля мёржатся в override + version-триггер на секции + legacy data + фолбэк');
  await pool.end();
  process.exit(0);
})().catch((e) => { console.error('✗ balance смоук УПАЛ:', e.message); process.exit(1); });
