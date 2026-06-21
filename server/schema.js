// Состояние матча (синхронизируется Colyseus автоматически бинарными дельтами).
// Статичные поля города (gx/gz/size/country/capital) ставятся один раз → 0 трафика/тик.
// Динамика (owner/units/spec/tier/occ) сериализуется только при изменении.
const { Schema, MapSchema, ArraySchema, defineTypes } = require('@colyseus/schema');

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
  occ:   'uint8',   // 0/1 оккупирован
  aa:    'uint8',   // 🛡 число зениток
  queued: 'uint16', // ⏳ солдат в очереди производства
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

class SquadState extends Schema {}
defineTypes(SquadState, {
  owner:    'uint8',
  count:    'uint16',
  x:        'float32',
  z:        'float32',
  fighting: 'uint8',   // 0/1 в полевом бою
});

class ShipState extends Schema {}
defineTypes(ShipState, { owner: 'uint8', x: 'float32', z: 'float32', hp: 'uint16', fighting: 'uint8' });

class PlaneState extends Schema {}
defineTypes(PlaneState, { owner: 'uint8', x: 'float32', z: 'float32', hp: 'uint16', fighting: 'uint8' });

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
    this.gold = new ArraySchema();   // голда по фракциям
    this.manpower = new ArraySchema();
    this.politPts = new ArraySchema();
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
  gold:      ['number'],
  manpower:  ['number'],
  politPts:  ['number'],
  relations: { map: 'uint8' },
  clock:     'float32',
  warStart:  { map: 'float32' },
  research:  { map: 'string' },
  tech:      { map: 'string' },
});

module.exports = { CityState, SquadState, ShipState, PlaneState, GameState };
