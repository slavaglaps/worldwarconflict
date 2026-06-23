// ── Плоские скалярные параметры баланса как ОТДЕЛЬНЫЕ поля (колонки) ──
// Один источник правды для (1) генератора полей Directus (числа/слайдеры/группы) и
// (2) сервера, который собирает из колонок секции override (politics/tune/ai).
// Дефолты берём из кода: sim/balance.js (politics, ai) + sim/constants.js (tune).
// factions/tech/heroes — НЕ здесь: они вложенные/динамические, остаются JSON.
'use strict';
const { DEFAULTS } = require('./sim/balance');
const C = require('./sim/constants');
const DESC = require('./balance-desc');   // key → человеческое описание (note поля)

// рекурсивно вытащить числовые листья: peace.base → {key:'peace.base', path:['peace','base']}
function flatten(obj, prefix = []) {
  const out = [];
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...flatten(v, [...prefix, k]));
    else if (typeof v === 'number') out.push({ path: [...prefix, k], def: v });
  }
  return out;
}

// группа для tune-константы по префиксу имени
function tuneGroup(name) {
  if (/^SOLDIER_|^MP_/.test(name)) return 'Найм / манпауэр';
  if (/^SHIP/.test(name)) return 'Флот';
  if (/^PLANE/.test(name)) return 'Авиация';
  if (/^AA_/.test(name)) return 'ПВО';
  if (/^TOWER_|CITY_BOMBARD/.test(name)) return 'Башни atk-городов';
  if (/^CITY_/.test(name)) return 'Город (экономика/ёмкость)';
  if (/^SIEGE_|^FIGHT_|^FIELD_|UNIT_MIN|GARRISON_|ANNEX_|CITY_CAPTURE/.test(name)) return 'Бой / осада';
  if (/BUILD_COST|^UPGRADE_/.test(name)) return 'Стройка / прокачка';
  if (/^MAX_/.test(name)) return 'Лимиты';
  if (/^HERO_/.test(name)) return 'Найм / манпауэр';   // HERO_SUMMON_MP — манпауэр-стоимость (НЕ группа 'heroes': коллизия с JSON-секцией пула героев)
  return 'Карта / прочее';
}

// интерфейс Directus по значению: вероятности/доли (0..1) — слайдер; целые — число; иначе — число с дробью
function iface(def) {
  if (def > 0 && def <= 1) return { interface: 'slider', type: 'float', options: { minValue: 0, maxValue: 1, stepInterval: 0.01 } };
  if (Number.isInteger(def)) return { interface: 'input', type: 'integer', options: { min: 0 } };
  return { interface: 'input', type: 'float', options: { step: 0.05 } };
}

// camelCase / UPPER_SNAKE → чистый snake_case (Directus отрисует "War Prob", "Ship Cost")
const toSnake = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2').replace(/_+/g, '_').toLowerCase();
// собрать список полей одной секции
function fields(section, groupOf, list) {
  return list.map(({ path, def }, i) => {
    const key = path.join('.');
    const col = path.map(toSnake).join('_');             // warProb→war_prob, SHIP_COST→ship_cost, peace.base→peace_base
    const f = iface(def);
    return { section, key, path, col, def, group: groupOf(key), sort: i, note: DESC[key] || key, ...f };
  });
}

const POLITICS = fields('pol', () => 'Дипломатия', flatten(DEFAULTS.politics));
const AI = fields('ai', () => 'Поведение ИИ', flatten(DEFAULTS.ai));
// мёртвые/зарезервированные константы — НЕ выносим в форму (дубли politics-дипломатии или RESERVED)
const TUNE_SKIP = new Set([
  'WAR_PREP', 'TRUCE_TIME', 'PEACE_CD', 'REPARATION_TIME',                                      // дубли politics-дипломатии
  'POLIT_RATE_BASE', 'POLIT_PER_CITY', 'POLIT_PER_TIER', 'POLIT_RATE_MAX', 'POLIT_START',       // POLIT_* — мёртвые дубли politics (сервер их не читает)
  'POLIT_MAX', 'POLIT_WAR', 'POLIT_BREAK', 'POLIT_ALLY', 'POLIT_PEACE',
  'PASS_MULT', 'FERRY_MULT', 'MAX_LINK', 'WAR_PATH_PENALTY',                                    // RESERVED / неиспользуемые
]);
const TUNE = fields('tune', (k) => tuneGroup(k), Object.keys(C).filter(k => typeof C[k] === 'number' && !TUNE_SKIP.has(k)).map(k => ({ path: [k], def: C[k] })));
const ALL = [...POLITICS, ...AI, ...TUNE];

// набор групп (для генератора Directus): порядок секций → подгруппы
const GROUPS = [];
{ const seen = new Set();
  for (const f of ALL) if (!seen.has(f.group)) { seen.add(f.group); GROUPS.push(f.group); } }

// разложить значение колонки обратно в секцию: setPath(politics, ['peace','base'], v)
function setPath(obj, path, v) { let o = obj; for (let i = 0; i < path.length - 1; i++) o = (o[path[i]] = o[path[i]] || {}); o[path[path.length - 1]] = v; }

// собрать секции override из плоской строки БД (только не-null значения). Возвращает {politics, tune, ai}.
function buildSections(row) {
  const politics = {}, tune = {}, ai = {};
  for (const f of POLITICS) if (row[f.col] != null) setPath(politics, f.path, +row[f.col]);
  for (const f of AI) if (row[f.col] != null) setPath(ai, f.path, +row[f.col]);
  for (const f of TUNE) if (row[f.col] != null) tune[f.key] = +row[f.col];
  return { politics, tune, ai };
}

module.exports = { POLITICS, AI, TUNE, ALL, GROUPS, buildSections };
