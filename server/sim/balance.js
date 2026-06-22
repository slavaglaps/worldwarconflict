// ────────────────────────────────────────────────────────────────────────────
// Единый источник игрового баланса. Дефолты — здесь, в коде (фолбэк, всегда рабочий).
// Фаза 2: поверх дефолтов мёржится override из таблицы Supabase (кэш + фолбэк),
// фиксируется на комнату в GameRoom.onCreate, синкается клиенту. Directus/Studio
// правят те же поля. Структура растёт по мере миграции.
//
//   LIVE сейчас:  politics (унифиц.) · factions (старты + асимметричные моды по странам).
//   PENDING:      units/combat, economy/city-формулы, tech-узлы, ГЕРОИ.
//   ⚠ Герои сейчас клиентские, глобальные и в MP не работают — их вынос требует
//     сперва серверного пер-фракционного геройского движка (отдельная под-фаза).
// ────────────────────────────────────────────────────────────────────────────
const C = require('./constants');
const { NODE } = require('./tech-data');   // дерево технологий (узлы по id) — дефолт баланса техов

// Дефолты подобраны 1:1 под текущее поведение (старый goldStart по умолчанию был 60,
// politStart = C.POLIT_START, стартовый гарнизон города = 8 + size*4). GameRoom/тесты,
// передающие goldStart/politStart/warPrep, переопределяют их (см. back-compat в Sim).
const DEFAULTS = {
  version: 1,

  // ── ПОЛИТИКА — едина для всех стран ──
  politics: {
    warPrep: C.WAR_PREP,                                   // сек мобилизации перед атакой
    truceTime: C.TRUCE_TIME, peaceCd: C.PEACE_CD, reparationTime: C.REPARATION_TIME,
    start: C.POLIT_START, max: C.POLIT_MAX,
    rateBase: C.POLIT_RATE_BASE, perCity: C.POLIT_PER_CITY, perTier: C.POLIT_PER_TIER, rateMax: C.POLIT_RATE_MAX,
    costWar: C.POLIT_WAR, costBreak: C.POLIT_BREAK, costAlly: C.POLIT_ALLY, costPeace: C.POLIT_PEACE,
  },

  // ── ТЕХНОЛОГИИ — едины для всех стран. nodes[id] = {g:цена, t:время, a/d/e/p/s:эффекты, v:{tr,td,..}, req, u, slot}.
  // Override правит конкретные узлы (напр. {tech:{nodes:{m1:{g:120}}}}), не трогая остальные.
  tech: { nodes: NODE },

  // ── СТАРТ + АСИММЕТРИЯ по фракциям ──
  // factionDefault применяется ко всем странам; factions[id] переопределяет конкретную.
  factionDefault: {
    gold: 60, polit: C.POLIT_START,                        // стартовые ресурсы
    garrisonBase: 8, garrisonPerSize: 4,                   // стартовый гарнизон города = base + size*perSize
    mods: { atk: 1, def: 1, speed: 1, eco: 1, prod: 1 },   // фракционные множители (×1 = симметрия)
  },
  factions: {
    // пример уникального баланса страны:
    // 1: { gold: 250, garrisonBase: 10, mods: { atk: 1.1, speed: 1.05 } },
  },
};

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
// ГЛУБОКИЙ мёрж-клон: out полностью независим от base (иначе мутация this.B портит глобальный DEFAULTS).
function deepMerge(base, ov) {
  ov = ov || {};
  if (Array.isArray(base)) return Array.isArray(ov) ? ov.slice() : base.slice();   // массив: override заменяет целиком, иначе клон
  const out = {};
  for (const k in base) out[k] = isObj(base[k]) ? deepMerge(base[k], ov[k]) : (k in ov ? ov[k] : base[k]);
  for (const k in ov) if (!(k in base)) out[k] = ov[k];                            // новые ключи из override
  return out;
}

// активный баланс комнаты: дефолты ⊕ override (из Supabase/тестов)
function makeBalance(override) { return deepMerge(DEFAULTS, override || {}); }
// баланс конкретной фракции: factionDefault ⊕ factions[id]
function factionBal(B, fid) { return deepMerge(B.factionDefault, (B.factions && B.factions[fid]) || {}); }

module.exports = { DEFAULTS, makeBalance, factionBal, deepMerge };
