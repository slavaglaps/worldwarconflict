// Состояние матча (синхронизируется Colyseus автоматически бинарными дельтами).
// Статичные поля города (gx/gz/size/country/capital) ставятся один раз → 0 трафика/тик.
// Динамика города сериализуется только при изменении.
const { Schema, MapSchema, ArraySchema, defineTypes, Encoder, view } = require('@colyseus/schema');

Encoder.BUFFER_SIZE = Number(process.env.COLYSEUS_SCHEMA_BUFFER_SIZE || 64 * 1024);

class CityState extends Schema {}
defineTypes(CityState, {
  // статика
  gx: 'uint16', gz: 'uint16', size: 'uint8', country: 'uint8', capital: 'uint8',
  shipyard: 'uint8', airport: 'uint8',
  // динамика
  owner: 'uint8',
  units: 'uint16',
  spec:  'uint8',   // 0=нет,1=prod,2=def,3=atk
  tier:  'uint8',
  prodTier: 'uint8',
  defTier:  'uint8',
  atkTier:  'uint8',
  occ:   'uint8',   // 0/1 оккупирован
  occFrom: 'uint8', // де-юре владелец до оккупации; 255 = нет/неизвестно
  aa:    'uint8',   // 🛡 число зениток
  compInf: 'uint16',
  compArc: 'uint16',
  compCav: 'uint16',
  queued: 'uint16', // ⏳ солдат в очереди производства
  recruitQueue: 'string', // до 6 партий: count,timeDs,elapsedDs,type;...
  siegeUnits: 'uint16', // осаждающая армия (сильнейший пул)
  siegeOwner: 'uint8',  // чья осада
  // ── таймеры (дс = десятые доли секунды; клиент рисует кольца/прогресс-бары) ──
  prodTime:    'uint16', // полное время текущей партии найма
  prodElapsed: 'uint16', // сколько уже прошло у партии найма
  shipQ:       'uint8',  // кораблей в очереди верфи
  shipT:       'uint16', // таймер текущего корабля
  planeQ:      'uint8',  // самолётов в очереди аэродрома
  planeT:      'uint16', // таймер текущего самолёта
});

// Позиции — fixed-point uint16 (×POS_Q): карта 0..256 → ~0.016 ед. точности, вдвое меньше трафика, чем float32.
// Клиент делит на POS_Q. Главная статья трафика — это позиции движущихся юнитов.
const POS_Q = 64;

class SquadState extends Schema {}
defineTypes(SquadState, {
  owner:    'uint8',
  count:    'uint16',
  x:        'uint16',  // ×POS_Q
  z:        'uint16',  // ×POS_Q
  fighting: 'uint8',   // 0/1 в полевом бою
  edgeA:    'uint16',  // текущая дорога: city idx или 65535 = нет ребра
  edgeB:    'uint16',
  frac:     'uint16',  // доля текущего ребра ×65535
  compInf:  'uint16',
  compArc:  'uint16',
  compCav:  'uint16',
  mode:     'uint8',   // 🚢 0 суша / 1 посадка / 2 плывёт / 3 высадка
  prog:     'uint8',   // прогресс посадки/высадки 0..255 (÷255)
  heading:  'uint8',   // курс 0..255 (×2π/256) — для корабля без дёрганья
});

class ShipState extends Schema {}
defineTypes(ShipState, { owner: 'uint8', x: 'uint16', z: 'uint16', hp: 'uint16', fighting: 'uint8' });

class PlaneState extends Schema {}
defineTypes(PlaneState, { owner: 'uint8', x: 'uint16', z: 'uint16', hp: 'uint16', fighting: 'uint8' });

class GameState extends Schema {
  constructor() {
    super();
    this.tick = 0;
    this.roomName = '';      // имя комнаты (для плашки клиента)
    this.playerCount = 0;    // живых игроков-людей в комнате
    this.cities = new MapSchema();   // idx(string) -> CityState
    this.squads = new MapSchema();   // id(string)  -> SquadState
    this.ships = new MapSchema();    // id(string)  -> ShipState
    this.planes = new MapSchema();   // id(string)  -> PlaneState
    // gold/manpower/politPts НЕ в broadcast-стейте: экономика приватна (анти-чит) — шлётся per-client
    // сообщением 'econ' только владельцу и его союзникам. См. GameRoom._sendEcon / мост game.html.
    this.relations = new MapSchema(); // "a_b" -> 1=война, 2=союз (нейтрал = нет ключа)
    this.clock = 0;                   // sim.time (сек) — отсчёт мобилизации на клиенте
    this.warStart = new MapSchema();  // "a_b" -> sim.time начала войны (для warCountdown)
    this.research = new MapSchema();  // fid -> "id:tДс;id2:tДс" активных исследований
    this.tech = new MapSchema();      // fid -> "id,id,id" завершённых техов (для разблокировок)
  }
}
defineTypes(GameState, {
  tick:        'uint32',
  roomName:    'string',
  playerCount: 'uint8',
  cities:    { map: CityState },
  squads:    { map: SquadState },
  ships:     { map: ShipState },
  planes:    { map: PlaneState },
  relations: { map: 'uint8' },
  clock:     'float32',
  warStart:  { map: 'float32' },
  research:  { map: 'string' },
  tech:      { map: 'string' },
});

// ── 🌫 туман войны: view-теги (@colyseus/schema StateView) ──────────────────
// Приватные поля города видит только клиент, у которого город в client.view
// (GameRoom._updateViews добавляет по маске видимости). Публичны: позиция,
// размер, страна, владелец, оккупация — «оболочка» города, чтобы направить войска.
const CITY_PRIVATE = ['units', 'spec', 'tier', 'prodTier', 'defTier', 'atkTier', 'aa',
  'compInf', 'compArc', 'compCav', 'queued', 'recruitQueue', 'siegeUnits', 'siegeOwner',
  'prodTime', 'prodElapsed', 'shipQ', 'shipT', 'planeQ', 'planeT', 'shipyard', 'airport'];
for (const f of CITY_PRIVATE) view()(CityState.prototype, f);
// Движущиеся сущности скрыты целиком: коллекция view-тегнута → элемент приходит
// только клиентам, добавившим его в view (свои/союзные всегда, чужие — в вижене).
view()(GameState.prototype, 'squads');
view()(GameState.prototype, 'ships');
view()(GameState.prototype, 'planes');

module.exports = { CityState, SquadState, ShipState, PlaneState, GameState, POS_Q, CITY_PRIVATE };
