// Загрузчик override баланса из таблицы Supabase `balance` (через тот же pg-пул, что и аккаунты).
// Кэш в памяти + фолбэк на код-дефолты: БД недоступна → отдаём последнее известное (или {} = чистые
// дефолты из sim/balance.js). Конфиг НИКОГДА не блокирует создание комнат.
//
// Поток: сервер на старте грузит override → кэш (beforeListen ЖДЁТ первую загрузку, см. app.config).
// GameRoom.onCreate берёт current()/currentMeta() и фиксирует на комнату (новые комнаты подхватывают
// свежий баланс; идущие матчи не меняются). Правится в Supabase Studio / Directus: строка
// balance.id='active', колонка data = JSON-override, version = ревизия. JSON ВАЛИДИРУЕТСЯ перед кэшем.
const { sanitizeOverride, deepMerge } = require('./sim/balance');
const F = require('./balance-fields');   // плоские параметры politics/tune/ai (отдельные колонки формы Directus) → секции

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
      // politics/tune/ai/faction/heroMeta — из ПЛОСКИХ колонок формы Directus (числовые поля/слайдеры)
      const flat = F.buildSections(row);
      if (Object.keys(flat.politics).length) ov.politics = flat.politics;
      if (Object.keys(flat.tune).length) ov.tune = flat.tune;
      if (Object.keys(flat.ai).length) ov.ai = flat.ai;
      // factionDefault: плоские колонки формы (старты + mods atk/def/speed/eco/prod) — БАЗА; JSONB factions.factionDefault — поверх (advanced)
      let fd = Object.keys(flat.factionDefault).length ? flat.factionDefault : null;
      // tech — JSONB-секция (вложенное дерево); heroes — JSONB pool (определения) поверх плоских perFaction/maxSlots
      if (row.tech && typeof row.tech === 'object' && !Array.isArray(row.tech)) ov.tech = row.tech;
      const heroesJson = (row.heroes && typeof row.heroes === 'object' && !Array.isArray(row.heroes)) ? row.heroes : null;
      if (Object.keys(flat.heroMeta).length || heroesJson) ov.heroes = deepMerge(flat.heroMeta || {}, heroesJson || {});
      // секция factions = {factionDefault:{общие старты}, "<id>":{асимметрия страны}} → раскладываем по override
      const fs = row.factions;
      if (fs && typeof fs === 'object' && !Array.isArray(fs)) {
        if (fs.factionDefault && typeof fs.factionDefault === 'object') fd = fd ? deepMerge(fd, fs.factionDefault) : fs.factionDefault;
        const per = {}; for (const k in fs) if (k !== 'factionDefault') per[k] = fs[k];
        if (Object.keys(per).length) ov.factions = per;
      }
      if (fd) ov.factionDefault = fd;
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
