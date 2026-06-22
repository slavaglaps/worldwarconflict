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

  // ── ГЕРОИ — пул определений (унифиц.); назначение на фракцию — в factionDefault/factions[id].heroes.
  // Каждый герой: passive[]/active абилки. Сервер применяет авторитетно: пассивки → бонус к бою,
  // активки → команда с кулдауном (buff/garrison/gold/manpower/airstrike). См. Sim.heroAdd/cmdHeroAbility.
  heroes: {
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

  // ── ЮНИТЫ / ЭКОНОМИКА / БОЙ — плоский override игровых констант ПО ИМЕНИ (источник дефолтов: sim/constants.js).
  // Дефолты = код-константы 1:1; override правит точечно, напр. {tune:{SHIP_COST:50, SOLDIER_PRICE:5, MP_RATE_BASE:0.5}}.
  // Тюнятся: SOLDIER_PRICE · MP_BASE/MP_PER_SIZE/MP_PER_TIER/MP_RATE_BASE/MP_RATE_PER_SIZE/MP_RATE_PER_TIER/MP_CAPITAL ·
  //   SHIP_* (COST/BUILD_TIME/HP/DMG/SPEED/RANGE/ATTACK_RANGE/MP/MISSILE_DMG/FIRE_CD) · PLANE_* (то же + BOMB_*) ·
  //   AA_* (COST_BASE/COST_STEP/DMG/RANGE/CD/MAX/MP) · SHIPYARD_BUILD_COST/AIRPORT_BUILD_COST ·
  //   UPGRADE_COST_BASE/UPGRADE_COST_STEP · FIGHT_RATE/SIEGE_ATK/SIEGE_DEF/SQUAD_SPEED/FIELD_RANGE ·
  //   TOWER_FIRE_CD/TOWER_DMG_BASE/TOWER_RANGE_BASE/TOWER_RANGE_PER · MAX_SHIPS/MAX_PLANES/MAX_SQUADS.
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
  ov = ov || {};
  if (Array.isArray(base)) return Array.isArray(ov) ? ov.slice() : base.slice();   // массив: override заменяет целиком, иначе клон
  const out = {};
  for (const k in base) out[k] = isObj(base[k]) ? deepMerge(base[k], ov[k]) : (k in ov ? ov[k] : base[k]);
  for (const k in ov) if (!(k in base)) out[k] = ov[k];                            // новые ключи из override
  return out;
}

// ── ВАЛИДАЦИЯ override из Directus/Supabase (защита от кривого JSON) ──────────
// Проходим override и сверяем типы с DEFAULTS; чисел требуем КОНЕЧНЫХ и неотрицательных
// (нет «отрицательных цен»), клампим в разумный диапазон (моды — множители [0..100]).
// Что не того типа (строка вместо числа, NaN/Infinity, null, функция) — ДРОПАЕМ → фолбэк на дефолт.
// Динамические секции (factions[id], свои узлы/герои) валидируются как числа/строки обобщённо.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function sanitizeNode(node, def, parentKey) {
  if (Array.isArray(node)) return node.slice();                          // массивы (abilities, ids) — как есть
  const out = {};
  for (const k in node) {
    const v = node[k];
    const d = (def && typeof def === 'object' && !Array.isArray(def)) ? def[k] : undefined;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) continue;                                 // NaN/Infinity → дроп
      if (d !== undefined && typeof d !== 'number') continue;            // в дефолте тут НЕ число → тип не тот, дроп
      out[k] = parentKey === 'mods' ? clamp(v, 0, 100) : clamp(v, 0, 1e7);
    } else if (typeof v === 'string') {
      if (d !== undefined && typeof d !== 'string') continue;            // ждали число/объект, пришла строка → дроп
      out[k] = v;
    } else if (typeof v === 'boolean') {
      out[k] = v;
    } else if (v && typeof v === 'object') {
      out[k] = sanitizeNode(v, k === 'tune' ? C : d, k);                 // tune валидируем против констант (там всё числа → строки дропаются); прочее против DEFAULTS
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
