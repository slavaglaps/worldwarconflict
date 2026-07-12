// 🌫 Туман войны: маска видимости (vision.js) + view-теги схемы (анти-чит).
const { group, test, assert, eq, gt, summary } = require('./harness');
const { Sim } = require('../sim/Sim');
const { visionMask, computeVision, visibleAt, buildVoronoi } = require('../sim/vision');
const { isWaterAt } = require('../sim/water');
const { GameState, CityState, SquadState, CITY_PRIVATE } = require('../schema');
const { projectState } = require('../schema-project');
const { Encoder, Decoder, StateView } = require('@colyseus/schema');
const map = require('../sim/map-data.json');

group('FOG: маска видимости (vision.js)');

const s = new Sim({ map });               // Европа: 239 городов, 29 фракций
const GRID = s.K.GRID;
const at = (mask, x, z) => mask[Math.round(x) * GRID + Math.round(z)];
const capOf = (f) => s.cities.find(c => c.owner === f && c.capital) || s.cities.find(c => c.owner === f);

test('своя столица и её округа видимы', () => {
  const c = capOf(0);
  const m = visionMask(s, 0);
  eq(at(m, c.gx, c.gz), 1, 'хекс своей столицы');
  eq(at(m, c.gx + 2, c.gz + 2), 1, 'территория рядом со столицей');
});

test('вся своя территория видима (все свои города)', () => {
  const m = visionMask(s, 0);
  for (const c of s.cities) if (c.owner === 0) eq(at(m, c.gx, c.gz), 1, 'город ' + c.idx);
});

test('океан у островной территории скрыт и открывается только кораблём', () => {
  const x = 5, z = 110; // Атлантика западнее Британии: ближайшие города британские
  assert(isWaterAt(x, z), 'контрольная точка находится в море');
  const hidden = computeVision(s, 0);
  eq(at(hidden, x, z), 0, 'Вороной территории не раскрывает океан');

  s.ships.push({ owner: 0, x, z });
  const revealed = computeVision(s, 0);
  s.ships.pop();
  eq(at(revealed, x, z), 1, 'свой корабль раскрывает море в своём радиусе');
  eq(at(revealed, x, z + s.K.VISION_SHIP + 2), 0, 'за радиусом корабля море снова скрыто');
});

test('у своей территории видна ограниченная прибрежная полоса моря', () => {
  const m = computeVision(s, 0);
  let shore = null;
  for (let x = 1; x < GRID - 1 && !shore; x++) for (let z = 1; z < GRID - 1; z++) {
    if (!at(m, x, z) || isWaterAt(x, z)) continue;
    for (let dx = -1; dx <= 1 && !shore; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (isWaterAt(x + dx, z + dz)) { shore = { x: x + dx, z: z + dz }; break; }
    }
  }
  assert(shore, 'найден берег своей территории');
  eq(at(m, shore.x, shore.z), 1, 'вода непосредственно у берега видна');
  eq(at(m, 5, 110), 0, 'дальняя Атлантика остаётся под туманом');
});

test('дальняя вражеская столица НЕ видима', () => {
  const c0 = capOf(0);
  // фракция с самой далёкой столицей от нас
  let far = null, fd = -1;
  for (let f = 1; f < s.factions; f++) {
    const c = capOf(f); if (!c) continue;
    const dd = (c.gx - c0.gx) ** 2 + (c.gz - c0.gz) ** 2;
    if (dd > fd) { fd = dd; far = c; }
  }
  const m = visionMask(s, 0);
  eq(at(m, far.gx, far.gz), 0, 'дальняя столица врага в тумане');
});

test('свой отряд подсвечивает круг вокруг себя (разведка боем)', () => {
  const c0 = capOf(0);
  let far = null, fd = -1;
  for (const c of s.cities) { const dd = (c.gx - c0.gx) ** 2 + (c.gz - c0.gz) ** 2; if (c.owner !== 0 && dd > fd) { fd = dd; far = c; } }
  // фейковый отряд у дальнего вражеского города (computeVision читает только owner/x/z)
  s.squads.push({ owner: 0, x: far.gx, z: far.gz });
  const m = computeVision(s, 0);
  s.squads.pop();
  eq(at(m, far.gx, far.gz), 1, 'вражеский город виден, пока рядом мой отряд');
  const r = s.K.VISION_SQUAD;
  // точка за радиусом, смещённая К ЦЕНТРУ карты (не выпасть за край)
  const dx = far.gx > GRID / 2 ? -(r + 2) : (r + 2);
  const dz = far.gz > GRID / 2 ? -(r + 2) : (r + 2);
  eq(at(m, far.gx + dx, far.gz + dz), 0, 'за радиусом обзора — туман');
});

test('осадный пул даёт вижен (отряд при осаде исчезает из squads)', () => {
  const c0 = capOf(0);
  let far = null, fd = -1;
  for (const c of s.cities) { const dd = (c.gx - c0.gx) ** 2 + (c.gz - c0.gz) ** 2; if (c.owner !== 0 && dd > fd) { fd = dd; far = c; } }
  const saved = far.siege;
  far.siege = { 0: { units: 12, comp: { inf: 12, arc: 0, cav: 0 } } };
  const m = computeVision(s, 0);
  far.siege = saved;
  eq(at(m, far.gx, far.gz), 1, 'осаждаемый город виден осаждающему');
});

test('🗼 башня (sim.towers) даёт обзор радиусом VISION_TOWER', () => {
  const c0 = capOf(0);
  let far = null, fd = -1;
  for (const c of s.cities) { const dd = (c.gx - c0.gx) ** 2 + (c.gz - c0.gz) ** 2; if (c.owner !== 0 && dd > fd) { fd = dd; far = c; } }
  s.towers = [{ owner: 0, x: far.gx, z: far.gz }];
  const m = computeVision(s, 0);
  s.towers = null;
  eq(at(m, far.gx, far.gz), 1, 'вокруг башни видно');
  const r = s.K.VISION_TOWER;
  const dx = far.gx > GRID / 2 ? -(r + 2) : (r + 2);
  const dz = far.gz > GRID / 2 ? -(r + 2) : (r + 2);
  eq(at(m, far.gx + dx, far.gz + dz), 0, 'за радиусом башни — туман');
});

test('союзник делится виженом', () => {
  const cap1 = capOf(1);
  const before = computeVision(s, 0);
  eq(at(before, cap1.gx, cap1.gz), 0, 'до союза столица фракции 1 в тумане');
  const saved = s.relations['0_1'];
  s.relations['0_1'] = 'ally';
  const after = computeVision(s, 0);
  if (saved === undefined) delete s.relations['0_1']; else s.relations['0_1'] = saved;
  eq(at(after, cap1.gx, cap1.gz), 1, 'после союза — территория союзника видна');
});

test('кэш: повторный вызов в окне VISION_REFRESH не пересчитывает', () => {
  const a = visionMask(s, 2), b = visionMask(s, 2);
  assert(a === b, 'та же ссылка из кэша');
  s.time += s.K.VISION_REFRESH + 0.01;
  const c = visionMask(s, 2);
  assert(a === c, 'буфер переиспользуется (тот же массив, пересчитан по месту)');
});

test('visibleAt: свой город true, за картой false', () => {
  const c = capOf(3);
  assert(visibleAt(s, 3, c.gx, c.gz), 'свой город');
  assert(!visibleAt(s, 3, -5, -5), 'вне карты');
});

test('вороной: хекс города указывает на сам город', () => {
  const vor = buildVoronoi(s.cities, GRID);
  const c = s.cities[10];
  eq(s.cities[vor[Math.round(c.gx) * GRID + Math.round(c.gz)]].idx, c.idx);
});

group('FOG: view-теги схемы (клиент без view не получает приватное)');

test('CityState: приватные поля скрыты, оболочка публична', () => {
  const st = new GameState();
  const sim2 = new Sim({ factions: 2, cities: 2 });
  sim2.cities[0].units = 42;
  projectState(sim2, st, []);
  const enc = new Encoder(st);
  const dec = new Decoder(new GameState());
  dec.decode(enc.encodeAll());                  // энкод БЕЗ view = то, что видит «слепой» клиент
  const j = dec.state.toJSON();
  const c0 = j.cities['0'];
  assert(c0, 'город-оболочка дошёл');
  eq(c0.owner, sim2.cities[0].owner, 'owner публичен');
  eq(c0.gx, Math.round(sim2.cities[0].gx), 'позиция публична');
  for (const f of CITY_PRIVATE) assert(!(f in c0), 'приватное поле скрыто: ' + f);
});

test('squads: без view коллекция пуста; с view элемент приходит', () => {
  const st = new GameState();
  const sq = new SquadState(); sq.owner = 1; sq.count = 25; sq.x = 640; sq.z = 640;
  st.squads.set('7', sq);
  const enc = new Encoder(st);
  // тот же протокол вызовов, что у colyseus SchemaSerializer.getFullState
  const buf = Buffer.alloc(64 * 1024);
  const it = { offset: 0 };
  const full = enc.encodeAll(it, buf);
  const blind = new Decoder(new GameState());
  blind.decode(full);
  eq(Object.keys(blind.state.toJSON().squads || {}).length, 0, 'слепой клиент: отрядов нет');
  // клиент с view, которому отряд добавлен
  const view = new StateView(); view.add(sq);
  const viewBuf = enc.encodeAllView(view, it.offset, { ...it }, buf);
  const seeing = new Decoder(new GameState());
  seeing.decode(viewBuf);
  const js = seeing.state.toJSON().squads;
  eq(Object.keys(js || {}).length, 1, 'зрячий клиент: отряд есть');
  eq(js['7'].count, 25, 'данные отряда дошли');
});

summary('FOG (vision + schema views)');
