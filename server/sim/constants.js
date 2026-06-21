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
  SHIP_MP: 20, PLANE_MP: 25,

  // ⚓ флот
  SHIP_SPEED: 6, SHIP_COST: 40, SHIP_BUILD_TIME: 6, SHIP_HP: 30, SHIP_DMG: 8, SHIP_RANGE: 2.2, SHIP_ATTACK_RANGE: 16,
  // ✈ авиация
  PLANE_SPEED: 13, PLANE_COST: 55, PLANE_BUILD_TIME: 7, PLANE_HP: 22, PLANE_DMG: 11, PLANE_RANGE: 2.6, PLANE_ALT: 4.5,
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
  aaCost: (aa) => 30 + (aa || 0) * 10,

  // бой
  FIGHT_RATE: 0.30, SIEGE_ATK: 0.30, SIEGE_DEF: 0.30,
  SQUAD_SPEED: 4.0, PASS_MULT: 0.5, FERRY_MULT: 0.7, MAX_LINK: 48,
  FIELD_RANGE: 3.0,        // радиус схождения отрядов в полевом бою
  WAR_PATH_PENALTY: 60,    // штраф пути через вражеский узел (как в findPath)

  // прокачка города: 50 / 100 / 150 голды
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
