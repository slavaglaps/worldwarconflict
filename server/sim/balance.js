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
    allyAcceptProb: 0.5,                                   // шанс принять союз (без общего врага)
    supportMin: 20, supportMax: 100,                       // мин/макс перевода голды союзнику
    // шанс принять мир: base + (силаОтн−1)·strengthWeight + оккупации·occBonus − земли·landPenalty − деньги·moneyWeight − репар·reparWeight, кламп [min,max]
    peace: { base: 0.18, strengthWeight: 0.45, occBonus: 0.10, landPenalty: 0.13, moneyWeight: 0.45, reparWeight: 0.55, min: 0.02, max: 0.97 },
  },

  // ── ТЕХНОЛОГИИ — едины для всех стран. nodes[id] = {g:цена, t:время, a/d/e/p/s:эффекты, v:{tr,td,..}, req, u, slot}.
  // Override правит конкретные узлы (напр. {tech:{nodes:{m1:{g:120}}}}), не трогая остальные.
  tech: { nodes: NODE },

  // ── ГЕРОИ — пул определений (унифиц.); назначение на фракцию — в factionDefault/factions[id].heroes.
  // Каждый герой: passive[]/active абилки. Сервер применяет авторитетно: пассивки → бонус к бою,
  // активки → команда с кулдауном (buff/garrison/gold/manpower/airstrike). См. Sim.heroAdd/cmdHeroAbility.
  heroes: {
    perFaction: 2,                          // сколько героев у фракции по умолчанию (авто-ротация из пула по fid)
    maxSlots: 3,                            // максимум слотов героев на фракцию
    pool: {
      sterling: { name: 'Маршал Стерлинг', face: '🪖', col: '#3c6e3c', abilities: [
        { kind: 'passive', icon: '🛡', name: 'Несокрушимость', desc: '+20% обороне всех городов', pass: [{ key: 'def', add: 0.20 }] },
        { kind: 'active', icon: '🧱', name: 'Стальная стена', desc: '+120% обороне на 18с', cd: 50, fx: { type: 'buff', key: 'def', add: 1.2, dur: 18 } },
        { kind: 'active', icon: '🎖', name: 'Окопаться', desc: '+18 гарнизона всем городам', cd: 40, fx: { type: 'garrison', amount: 18 } } ] },
      hans: { name: 'Генерал Ханс', face: '🎗', col: '#5a6b7a', abilities: [
        { kind: 'passive', icon: '⚔', name: 'Бронекулак', desc: '+20% атаке армии', pass: [{ key: 'atk', add: 0.20 }] },
        { kind: 'active', icon: '⚡', name: 'Блицкриг', desc: '+70% атаке на 16с', cd: 55, fx: { type: 'buff', key: 'atk', add: 0.7, dur: 16 } },
        { kind: 'active', icon: '🛞', name: 'Танковый клин', desc: '+70% скорости на 14с', cd: 45, fx: { type: 'buff', key: 'speed', add: 0.7, dur: 14 } } ] },
      vance: { name: 'Генерал Вэнс', face: '🪖', col: '#9a8a4a', abilities: [
        { kind: 'passive', icon: '🏃', name: 'Молниеносность', desc: '+25% скорости армии', pass: [{ key: 'speed', add: 0.25 }] },
        { kind: 'active', icon: '👟', name: 'Форсированный марш', desc: '+90% скорости на 16с', cd: 45, fx: { type: 'buff', key: 'speed', add: 0.9, dur: 16 } },
        { kind: 'active', icon: '📣', name: 'Боевой клич', desc: '+50% атаке на 18с', cd: 50, fx: { type: 'buff', key: 'atk', add: 0.5, dur: 18 } } ] },
      gold: { name: 'Канцлер Гольд', face: '💼', col: '#caa24a', abilities: [
        { kind: 'passive', icon: '💰', name: 'Золотой век', desc: '+25% дохода голды', pass: [{ key: 'eco', add: 0.25 }] },
        { kind: 'active', icon: '🪙', name: 'Золотой дождь', desc: '+400 голды', cd: 40, fx: { type: 'gold', amount: 400 } },
        { kind: 'active', icon: '📈', name: 'Военные облигации', desc: '+120% дохода на 25с', cd: 60, fx: { type: 'buff', key: 'eco', add: 1.2, dur: 25 } } ] },
      volk: { name: 'Комиссар Вольк', face: '🎖', col: '#8a3f3f', abilities: [
        { kind: 'passive', icon: '👥', name: 'Народная армия', desc: '+25% манпауэра', pass: [{ key: 'prod', add: 0.25 }] },
        { kind: 'active', icon: '📢', name: 'Тотальная мобилизация', desc: 'манпауэр до максимума', cd: 50, fx: { type: 'manpower' } },
        { kind: 'active', icon: '🎖', name: 'Призыв резерва', desc: '+12 гарнизона всем городам', cd: 45, fx: { type: 'garrison', amount: 12 } } ] },
      storm: { name: 'Маршал Шторм', face: '✈', col: '#3a6fa0', abilities: [
        { kind: 'passive', icon: '✈', name: 'Господство в воздухе', desc: '+25% урона бомб, +20% прочности самолётов', pass: [{ key: 'bd', add: 0.25 }, { key: 'ph', add: 0.20 }] },
        { kind: 'active', icon: '💥', name: 'Ковровая бомбардировка', desc: '−40 гарнизона вражескому городу', cd: 80, fx: { type: 'airstrike', amount: 40 } },
        { kind: 'active', icon: '🛡', name: 'Воздушный щит', desc: '+50% прочности самолётов на 20с', cd: 60, fx: { type: 'buff', key: 'ph', add: 0.5, dur: 20 } } ] },
    },
  },

  // ── ЮНИТЫ / ЭКОНОМИКА / БОЙ — плоский override игровых констант ПО ИМЕНИ (ПОЛНЫЙ список дефолтов: sim/constants.js).
  // Дефолты = код-константы 1:1; override правит точечно, напр. {tune:{SHIP_COST:50, SOLDIER_PRICE:5, CITY_BOOST_GOLD:1}}.
  // Категории: найм/манпауэр (SOLDIER_PRICE/SOLDIER_MP, MP_*) · флот SHIP_* · авиация PLANE_* (+ TURN/AIM) ·
  //   ПВО AA_* (+ INTERCEPT/KILL_CHANCE — перехват/подавление) · стройка SHIPYARD/AIRPORT · апгрейд UPGRADE_COST_* ·
  //   город CITY_* (CAP/GOLD_INTERVAL/GOLD_YIELD/TRAIN/спец-тир DEF_CAP/DEF_MULT/ATK_MULT/PROD_GOLD_DECAY/буст BOOST_*/OCCUPY_INCOME) ·
  //   бой FIGHT_RATE/SIEGE_*/SQUAD_SPEED/FIELD_RANGE/TOWER_*/UNIT_MIN/SIEGE_POOL_MIN/CITY_CAPTURE_MIN/GARRISON_FLOOR/SEND_DEFAULT_PCT ·
  //   прочее FACTION_STR_CITY_BASE/ANNEX_LOOT · хард-капы MAX_SHIPS/PLANES/SQUADS.
  // (ИИ — в секции `ai`; формулы дипломатии — в `politics`; герои — в `heroes`.)
  tune: {},

  // ── ИИ — поведение незанятых фракций (тайминги/пороги/вероятности/веса). Меняет «характер» ботов.
  ai: {
    thinkInterval: 4.5,                          // как часто бот «думает» (с)
    losingRatio: 0.4,                            // «проигрываю», если сила < врага × этого
    exhaustWindow: 90, exhaustDivisor: 300,      // усталость войны: (возраст войны − window)/divisor
    peaceLosingProb: 0.3, peaceExhaustMult: 0.18, // шанс замириться (проигрывая / от усталости×mult)
    warProb: 0.6, warStrengthRatio: 0.7,         // шанс начать войну / нужный перевес силы для атаки
    allyCap: 2, allyProb: 0.05,                  // лимит союзов / шанс искать союз
    researchProb: 0.5, researchEarlyExit: 0.5,   // шанс исследовать / завершить ход после
    techPrioSlot: 3, techPrioUnlock: 2,          // веса приоритета техов (слот-узлы / анлоки)
    aaProb: 0.25, aaGoldBuffer: 10,              // шанс ставить ПВО / запас голды сверх цены
    squadCap: 6,                                 // не набирает армию, если отрядов больше
    upgradeProb: 0.4, upgradeGoldBuffer: 20, nearRadius2: 30, // шанс/запас апгрейда / радиус² «враг рядом»
    minArmy: 14,                                 // минимум юнитов в городе для атаки
    targetTimeWeight: 2.2, targetDefWeight: 1.5, // веса выбора цели (дальность / оборона)
    sendFraction: 0.6,                           // доля армии сильнейшего города в атаку
    attackOverkill: 1.3, attackBuffer: 4, ongoingSiegeMin: 6, // порог «хватит сил» / минимум для добивания осады
  },

  // ── СТАРТ + АСИММЕТРИЯ по фракциям ──
  // factionDefault применяется ко всем странам; factions[id] переопределяет конкретную.
  factionDefault: {
    gold: 60, polit: C.POLIT_START,                        // стартовые ресурсы
    garrisonBase: 8, garrisonPerSize: 4,                   // стартовый гарнизон города = base + size*perSize
    mods: { atk: 1, def: 1, speed: 1, eco: 1, prod: 1 },   // фракционные множители (×1 = симметрия)
    heroes: null,                                          // null → авто-ротация из пула по fid (уникально на страну); задать массив id (напр. ['hans','gold']) чтобы зафиксировать
  },
  factions: {
    // пример уникального баланса страны:
    // 1: { gold: 250, garrisonBase: 10, mods: { atk: 1.1, speed: 1.05 } },
  },
};

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
// ГЛУБОКИЙ мёрж-клон: out полностью независим от base (иначе мутация this.B портит глобальный DEFAULTS).
function deepMerge(base, ov) {
  if (Array.isArray(base)) return Array.isArray(ov) ? ov.slice() : base.slice();   // массив: override заменяет целиком, иначе клон
  if (!isObj(ov)) ov = {};                                                          // мисматч типов (примитив/массив/null где ждали объект) → игнор override, берём base (без падения на `in`)
  const out = {};
  for (const k in base) out[k] = isObj(base[k]) ? deepMerge(base[k], ov[k]) : (k in ov ? ov[k] : base[k]);
  for (const k in ov) if (!(k in base)) out[k] = ov[k];                            // новые ключи из override
  return out;
}

// ── ВАЛИДАЦИЯ override из Directus/Supabase (защита от кривого JSON) ──────────
// Проходим override и сверяем типы со СХЕМОЙ; чисел требуем КОНЕЧНЫХ и неотрицательных
// (нет «отрицательных цен»), клампим (моды — множители [0..100]). Не того типа (строка
// вместо числа, NaN/Infinity, null, функция) — ДРОПАЕМ → фолбэк на дефолт.
// Динамические секции валидируются по РЕПРЕЗЕНТАТИВНОЙ схеме (иначе строка в factions[id].mods.atk
// или heroes.pool[*].abilities проскакивала и давала NaN в бою):
//   tune → константы C · factions[id] → factionDefault · tech.nodes[*] → дефолт-узел/репрезентативный
//   · heroes.pool[*] → дефолт-герой/репрезентативный.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const REP_NODE = Object.values(DEFAULTS.tech.nodes)[0] || {};          // репрезентативный узел дерева (для кастомных узлов)
const REP_HERO = Object.values(DEFAULTS.heroes.pool)[0] || {};         // репрезентативный герой (для кастомных героев)
// схема для дочернего объекта по контексту (parentKey — ключ контейнера, k — ключ ребёнка)
function childSchema(k, parentKey, d) {
  if (k === 'tune') return C;                                          // tune ⇒ против sim/constants.js (всё числа)
  if (parentKey === 'factions') return DEFAULTS.factionDefault;        // factions[id] ⇒ как factionDefault (mods/gold/… числовые)
  if (parentKey === 'nodes') return (d && typeof d === 'object') ? d : REP_NODE;   // узел ⇒ свой дефолт или репрезентативный
  if (parentKey === 'pool') return (d && typeof d === 'object') ? d : REP_HERO;     // герой ⇒ свой дефолт или репрезентативный
  return d;
}
function sanitizeNode(node, def, parentKey) {
  if (Array.isArray(node)) return node.slice();                          // массивы (abilities, ids) — как есть
  const out = {};
  for (const k in node) {
    const v = node[k];
    const d = (def && typeof def === 'object' && !Array.isArray(def)) ? def[k] : undefined;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) continue;                                 // NaN/Infinity → дроп
      if (d !== undefined && typeof d !== 'number') continue;            // в схеме тут НЕ число → тип не тот, дроп
      out[k] = parentKey === 'mods' ? clamp(v, 0, 100) : clamp(v, 0, 1e7);
    } else if (typeof v === 'string') {
      if (parentKey === 'mods') continue;                               // моды — только числа
      if (d !== undefined && typeof d !== 'string') continue;            // в схеме тут НЕ строка → дроп
      out[k] = v;
    } else if (typeof v === 'boolean') {
      out[k] = v;
    } else if (v && typeof v === 'object') {
      out[k] = sanitizeNode(v, childSchema(k, parentKey, d), k);         // дочерний объект — по схеме контекста
    }
    // null / undefined / функции → дроп
  }
  return out;
}
function sanitizeOverride(ov) {
  if (!ov || typeof ov !== 'object' || Array.isArray(ov)) return {};
  return sanitizeNode(ov, DEFAULTS, '');
}

// активный баланс комнаты: дефолты ⊕ override (из Supabase/тестов)
function makeBalance(override) { return deepMerge(DEFAULTS, override || {}); }
// игровые константы комнаты: код-дефолты (constants.js) ⊕ плоский override B.tune (по имени).
// Возвращает НОВЫЙ объект (мутация this.K не трогает глобальный C). Функции C (aaCost/upgradeCost) переносятся как есть.
function makeConstants(B) { return Object.assign({}, C, (B && B.tune) || {}); }
// баланс конкретной фракции: factionDefault ⊕ factions[id]
function factionBal(B, fid) { return deepMerge(B.factionDefault, (B.factions && B.factions[fid]) || {}); }

module.exports = { DEFAULTS, makeBalance, makeConstants, factionBal, deepMerge, sanitizeOverride };
