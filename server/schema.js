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
});

module.exports = { CityState, SquadState, ShipState, PlaneState, GameState };
