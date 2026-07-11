// Юнит-тесты проекции Sim → Colyseus-схема (schema-project.js) — БЕЗ сети.
// Раньше эта логика жила внутри GameRoom._tick и покрывалась только e2e;
// тут проверяем кодировку напрямую (fixed-point, клампы, осада, дипломатия, удаление).
const { group, test, assert, eq, near, summary } = require('./harness');
const { Sim } = require('../sim/Sim');
const { GameState, POS_Q } = require('../schema');
const { projectState, SPEC_ID, RELN } = require('../schema-project');
const map = require('../sim/map-data.json');

group('Проекция Sim → схема (schema-project)');

test('город: owner/units(округл.)/spec/tier/occ/occFrom', () => {
  const s = new Sim({ map, ai: false }), st = new GameState(), techN = [];
  const c = s.cities.find((x) => x.idx === 7); c.spec = 'atk'; c.tier = 2; c.units = 123.6; c.occ = true; c.occFrom = 3;
  c.comp = { inf: 80.2, arc: 30.3, cav: 13.1 };
  projectState(s, st, techN);
  const cs = st.cities.get('7');
  eq(cs.owner, c.owner); eq(cs.units, 124); eq(cs.spec, SPEC_ID.atk); eq(cs.tier, 2); eq(cs.occ, 1);
  eq(cs.occFrom, 3);
  eq(cs.prodTier, 0); eq(cs.defTier, 0); eq(cs.atkTier, 2);
  eq(cs.compInf, 80); eq(cs.compArc, 30); eq(cs.compCav, 13);
});

test('город: occFrom сбрасывается в sentinel, когда оккупации нет', () => {
  const s = new Sim({ map, ai: false }), st = new GameState(), techN = [];
  const c = s.cities.find((x) => x.idx === 7); c.occ = true; c.occFrom = 2;
  projectState(s, st, techN);
  eq(st.cities.get('7').occFrom, 2);
  c.occ = false; c.occFrom = null;
  projectState(s, st, techN);
  eq(st.cities.get('7').occFrom, 255);
});

test('город: построенные верфь и аэропорт синхронизируются отдельно от legacy-типа', () => {
  const s = new Sim({ map, ai: false }), st = new GameState(), techN = [];
  const c = s.cities.find((x) => !x.isShipyard && !x.isAirport);
  c.hasShipyard = true; c.hasAirport = true;
  projectState(s, st, techN);
  const cs = st.cities.get(String(c.idx));
  eq(cs.shipyard, 0); eq(cs.airport, 0);
  eq(cs.hasShipyard, 1); eq(cs.hasAirport, 1);
});

test('осада: в схему идёт СИЛЬНЕЙШИЙ пул (units + owner)', () => {
  const s = new Sim({ map, ai: false }), st = new GameState(), techN = [];
  const c = s.cities.find((x) => x.idx === 7);
  c.siege = { 5: { units: 10, atkMult: 1 }, 9: { units: 22, atkMult: 1 } };
  projectState(s, st, techN);
  const cs = st.cities.get('7'); eq(cs.siegeUnits, 22); eq(cs.siegeOwner, 9);
});

test('fixed-point позиции отрядов: QPOS=round(x*POS_Q), обратимо в пределах кванта', () => {
  const s = new Sim({ map, ai: true }), st = new GameState(), techN = [];
  for (let i = 0; i < 700; i++) s.tick(0.1);          // дождаться отрядов (после мобилизации войны)
  projectState(s, st, techN);
  assert(s.squads.length > 0, 'к 70с ИИ навоевал — отряды есть');
  const sq = s.squads[0], ss = st.squads.get(String(sq.id));
  eq(ss.x, Math.round(sq.x * POS_Q)); eq(ss.owner, sq.owner);
  near(ss.x / POS_Q, sq.x, 1 / POS_Q);                // декод восстанавливает позицию с точностью кванта
  eq(ss.compInf, Math.round(sq.comp.inf)); eq(ss.compArc, Math.round(sq.comp.arc)); eq(ss.compCav, Math.round(sq.comp.cav));
  const a = sq.path[sq.hop], b = sq.path[sq.hop + 1], edge = s.edgeBetween(a, b);
  eq(ss.edgeA, edge ? a : 65535); eq(ss.edgeB, edge ? b : 65535);
  if (edge && edge.len) near(ss.frac / 65535, sq.prog / edge.len, 1 / 65535);
});

test('дипломатия: war=1/ally=2 в схему; конец войны/нейтрал вычищаются', () => {
  const s = new Sim({ map, ai: false }), st = new GameState(), techN = [];
  s.relations['0_1'] = 'war'; s.warSince['0_1'] = s.time; s.relations['0_2'] = 'ally';
  projectState(s, st, techN);
  eq(st.relations.get('0_1'), RELN.war); eq(st.relations.get('0_2'), RELN.ally);
  assert(st.warStart.has('0_1'), 'warStart для войны записан');
  delete s.relations['0_1']; delete s.warSince['0_1'];
  projectState(s, st, techN);
  assert(!st.relations.has('0_1') && !st.warStart.has('0_1'), 'нейтрал → удалён из схемы (и warStart)');
});

test('исчезнувшие отряды удаляются из схемы', () => {
  const s = new Sim({ map, ai: true }), st = new GameState(), techN = [];
  for (let i = 0; i < 700; i++) s.tick(0.1);
  projectState(s, st, techN); const before = st.squads.size;
  s.squads.length = 0;                                // все отряды исчезли
  projectState(s, st, techN);
  assert(before > 0, 'до этого отряды были'); eq(st.squads.size, 0);
});

summary('PROJECT (sim → схема)');
