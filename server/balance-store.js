// Загрузчик override баланса из таблицы Supabase `balance` (через тот же pg-пул, что и аккаунты).
// Кэш в памяти + фолбэк на код-дефолты: БД недоступна → отдаём последнее известное (или {} = чистые
// дефолты из sim/balance.js). Конфиг НИКОГДА не блокирует создание комнат.
//
// Поток: сервер на старте грузит override → кэш. GameRoom.onCreate берёт current() и фиксирует
// на комнату (новые комнаты подхватывают свежий баланс; идущие матчи не меняются). Правится в
// Supabase Studio / Directus: строка balance.id='active', колонка data = JSON-override.
let cache = {};       // последний успешно загруженный override (или {})
let ok = false;       // была ли хоть одна успешная загрузка
let timer = null;

async function refresh() {
  if (!process.env.DATABASE_URL) return cache;               // dev/тесты без БД → чистые дефолты
  try {
    const pool = require('./db')._pool;                      // db.pg (DATABASE_URL задан)
    if (!pool) return cache;
    const { rows } = await pool.query("SELECT data FROM balance WHERE id = 'active'");
    const data = rows[0] && rows[0].data;
    cache = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
    if (!ok) console.log('[balance] override загружен из Supabase (' + Object.keys(cache).length + ' секций)');
    ok = true;
  } catch (e) {
    console.error('[balance] загрузка не удалась → код-дефолты:', e.message);
  }
  return cache;
}

function current() { return cache; }                          // синхронный доступ для GameRoom.onCreate
function loaded() { return ok; }

// первичная загрузка + периодическое обновление (мс). Идемпотентно.
function startAutoRefresh(ms = 60000) {
  if (timer || !process.env.DATABASE_URL) return;
  refresh().catch(() => {});
  timer = setInterval(() => refresh().catch(() => {}), ms);
  if (timer.unref) timer.unref();
}
function stop() { if (timer) { clearInterval(timer); timer = null; } }

module.exports = { refresh, current, loaded, startAutoRefresh, stop };
