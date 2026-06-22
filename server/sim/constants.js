// Чистые игровые константы (без Three/DOM). Портировано 1:1 из game.html.
module.exports = {
  GRID: 256,
  MAX_TIER: 3,
  SOLDIER_PRICE: 4,

  // хард-капы сущностей на фракцию (анти-абуз/DoS; в обычной игре недостижимо)
  MAX_SQUADS: 50, MAX_SHIPS: 60, MAX_PLANES: 60,

  // 👥 манпауэр (лимит армии от городов)
  MP_BASE: 20, MP_PER_SIZE: 12, MP_PER_TIER: 12,        // потолок на город
  MP_RATE_BASE: 0.4, MP_RATE_PER_SIZE: 0.15, MP_RATE_PER_TIER: 0.2, // регенерация/с
  MP_CAPITAL: 1.6,                                       // столица — больше населения
  SHIP_MP: 20, PLANE_MP: 25, SOLDIER_MP: 1,             // манпауэр за единицу (солдат = 1)

  // ⚓ флот
  SHIP_SPEED: 6, SHIP_COST: 40, SHIP_BUILD_TIME: 6, SHIP_HP: 30, SHIP_DMG: 8, SHIP_RANGE: 2.2, SHIP_ATTACK_RANGE: 16,
  SHIP_ARRIVE: 0.1,                                      // порог «прибыл» к точке
  // ✈ авиация
  PLANE_SPEED: 13, PLANE_COST: 55, PLANE_BUILD_TIME: 7, PLANE_HP: 22, PLANE_DMG: 11, PLANE_RANGE: 2.6, PLANE_ALT: 4.5,
  PLANE_TURN: 1.35, PLANE_AIM: 10,                       // скорость разворота (рад/с) + дальность прицеливания при патруле
  // 🏗 постройка верфи/аэродрома (любая фракция)
  SHIPYARD_BUILD_COST: 120, AIRPORT_BUILD_COST: 150,
  // 🚀 обстрел берега кораблями (нужен tech shipMissile)
  SHIP_MISSILE_DMG: 5, SHIP_FIRE_CD: 1.8,
  // 💣 бомбёжка городов авиацией (нужен tech planeBomb)
  PLANE_BOMB_DMG: 4, PLANE_BOMB_CD: 0.7, PLANE_BOMB_RANGE: 6,
  // ⚔ башни atk-городов
  TOWER_FIRE_CD: 1.1, TOWER_DMG_BASE: 3, TOWER_RANGE_BASE: 8, TOWER_RANGE_PER: 4,
  // 🛡 ПВО городов
  AA_RANGE: 15, AA_CD: 0.9, AA_DMG: 3, AA_MAX: 8, AA_COST_BASE: 30, AA_COST_STEP: 10, AA_MP: 4,
  AA_INTERCEPT: 0.18,      // шанс ОДНОГО ствола сбить входящую бомбу/ракету (суммарно по числу зениток)
  AA_KILL_CHANCE: 0.5,     // шанс попадания бомбы/ракеты по городу выбить 1 зенитку
  aaCost: (aa) => 30 + (aa || 0) * 10,

  // 🏙 город: вместимость = CAP_BASE + size*CAP_PER_SIZE; голда каждые GOLD_INTERVAL/eco сек (×size×GOLD_YIELD);
  //    время найма бойца = (TRAIN_BASE − size*TRAIN_PER_SIZE)/prod. Тюнятся через balance.tune.
  CITY_CAP_BASE: 32, CITY_CAP_PER_SIZE: 24,
  CITY_GOLD_INTERVAL: 4, CITY_GOLD_YIELD: 1, CITY_TRAIN_BASE: 0.5, CITY_TRAIN_PER_SIZE: 0.07,
  // спец/тир коэффициенты: +cap/def/atk за тир у соответствующего спеца; prod-город — pow(GOLD_DECAY,tier) к интервалу
  CITY_DEF_CAP_PER_TIER: 0.22, CITY_DEF_MULT_PER_TIER: 0.32, CITY_ATK_MULT_PER_TIER: 0.28, CITY_PROD_GOLD_DECAY: 0.68,
  // буст «контроля страны» (вся страна у одной фракции): ×cap, ×gold-интервал, ×train
  CITY_BOOST_CAP: 1.25, CITY_BOOST_GOLD: 0.75, CITY_BOOST_TRAIN: 0.8,
  OCCUPY_INCOME: 1.0,      // множитель золотого дохода оккупированного города (1 = без штрафа)

  // бой
  FIGHT_RATE: 0.30, SIEGE_ATK: 0.30, SIEGE_DEF: 0.30,
  SQUAD_SPEED: 4.0, PASS_MULT: 0.5, FERRY_MULT: 0.7, MAX_LINK: 48,
  FIELD_RANGE: 3.0,        // радиус схождения отрядов в полевом бою
  WAR_PATH_PENALTY: 60,    // штраф пути через вражеский узел (как в findPath)
  UNIT_MIN: 0.5,           // отряд «жив»/бьёт при fcount ≥ этого (полевой бой/осада)
  SIEGE_POOL_MIN: 0.4,     // пул осады распускается ниже
  CITY_CAPTURE_MIN: 0.4,   // город переходит владельцу при гарнизоне ≤ этого
  GARRISON_FLOOR: 1,       // минимум гарнизона при не-захватном уроне (башня/ракета/бомба)
  SEND_DEFAULT_PCT: 0.5,   // доля гарнизона по умолчанию при отправке отряда
  FACTION_STR_CITY_BASE: 10, // «база силы» города (для оценок ИИ и шанса мира)
  ANNEX_LOOT: 1.0,         // доля казны/политы/манпауэра выбывшего → победителю (1 = всё)

  // прокачка города: base + tier*step (50 / 100 / 150 голды). Коэффициенты тюнятся через balance.tune.
  UPGRADE_COST_BASE: 50, UPGRADE_COST_STEP: 50,
  upgradeCost: (t) => 50 + t * 50,

  // 🏛 дипломатия / политические очки
  WAR_PREP: 60,            // секунд мобилизации перед атакой
  TRUCE_TIME: 75,          // перемирие после мира
  PEACE_CD: 18,            // кулдаун предложений мира
  REPARATION_TIME: 60,     // длительность репараций
  POLIT_RATE_BASE: 0.2, POLIT_PER_CITY: 0.045, POLIT_PER_TIER: 0.04, POLIT_RATE_MAX: 2.5,
  POLIT_START: 20, POLIT_MAX: 120,
  POLIT_WAR: 50, POLIT_BREAK: 20, POLIT_ALLY: 10, POLIT_PEACE: 20,
};
