// Загрузчик override баланса из таблицы Supabase `balance` (через тот же pg-пул, что и аккаунты).
// Кэш в памяти + фолбэк на код-дефолты: БД недоступна → отдаём последнее известное (или {} = чистые
// дефолты из sim/balance.js). Конфиг НИКОГДА не блокирует создание комнат.
//
// Поток: сервер на старте грузит override → кэш (beforeListen ЖДЁТ первую загрузку, см. app.config).
// GameRoom.onCreate берёт current()/currentMeta() и фиксирует на комнату (новые комнаты подхватывают
// свежий баланс; идущие матчи не меняются). Правится в Supabase Studio / Directus: строка
// balance.id='active', колонка data = JSON-override, version = ревизия. JSON ВАЛИДИРУЕТСЯ перед кэшем.
const { sanitizeOverride } = require('./sim/balance');

let cache = {};                                  // последний валидный override (или {})
let meta = { version: 0, updatedAt: null };      // ревизия из БД (колонки version/updated_at)
let ok = false;                                  // была ли хоть одна успешная загрузка
let timer = null;

async function refresh() {
  if (!process.env.DATABASE_URL) return cache;               // dev/тесты без БД → чистые дефолты
  try {
    const db = require('./db');                              // db.pg (DATABASE_URL задан)
    if (typeof db.getBalanceRow !== 'function') return cache;
    const row = await db.getBalanceRow();                    // ensureSchema() ВНУТРИ → на свежей БД таблица создаётся (не «relation does not exist»)
    // override = мёрж СЕКЦИЙ-полей (politics/tune/ai/factions/tech/heroes); legacy `data` — снизу (back-compat)
    const ov = {};
    if (row) {
      if (row.data && typeof row.data === 'object' && !Array.isArray(row.data)) Object.assign(ov, row.data);
      for (const sec of ['politics', 'tune', 'ai', 'tech', 'heroes']) {
        const v = row[sec];
        if (v && typeof v === 'object' && !Array.isArray(v)) ov[sec] = v;   // секция перекрывает целиком
      }
      // секция factions = {factionDefault:{общие старты}, "<id>":{асимметрия страны}} → раскладываем по override
      const fs = row.factions;
      if (fs && typeof fs === 'object' && !Array.isArray(fs)) {
        if (fs.factionDefault && typeof fs.factionDefault === 'object') ov.factionDefault = fs.factionDefault;
        const per = {}; for (const k in fs) if (k !== 'factionDefault') per[k] = fs[k];
        if (Object.keys(per).length) ov.factions = per;
      }
    }
    cache = sanitizeOverride(ov);                            // ВАЛИДАЦИЯ: дропаем кривые типы, клампим числа (нет отрицательных цен/NaN/огромных значений)
    meta = { version: row && Number.isFinite(+row.version) ? +row.version : 0, updatedAt: row ? row.updated_at : null };
    if (!ok) console.log(`[balance] override загружен из Supabase (${Object.keys(cache).length} секций, version=${meta.version})`);
    ok = true;
  } catch (e) {
    console.error('[balance] загрузка не удалась → код-дефолты:', e.message);
  }
  return cache;
}

function current() { return cache; }                          // синхронный доступ для GameRoom.onCreate
function currentMeta() { return meta; }                       // {version, updatedAt} — ревизия для комнаты/клиента
function loaded() { return ok; }

// первичная загрузка + периодическое обновление (мс). Идемпотентно.
// ВОЗВРАЩАЕТ промис ПЕРВОЙ загрузки → beforeListen может его await'ить (иначе первая комната
// после рестарта может создаться на код-дефолтах, пока Supabase не ответил).
function startAutoRefresh(ms = 60000) {
  if (timer || !process.env.DATABASE_URL) return Promise.resolve(cache);
  const first = refresh().catch(() => cache);                 // не падаем — фолбэк на кэш
  timer = setInterval(() => refresh().catch(() => {}), ms);
  if (timer.unref) timer.unref();
  return first;
}
function stop() { if (timer) { clearInterval(timer); timer = null; } }

module.exports = { refresh, current, currentMeta, loaded, startAutoRefresh, stop };
