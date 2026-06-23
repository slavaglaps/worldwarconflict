// Юнит-тесты проекции Sim → Colyseus-схема (schema-project.js) — БЕЗ сети.
// Раньше эта логика жила внутри GameRoom._tick и покрывалась только e2e;
// тут проверяем кодировку напрямую (fixed-point, клампы, осада, дипломатия, удаление).
const { group, test, assert, eq, near, summary } = require('./harness');
const { Sim } = require('../sim/Sim');
const { GameState, POS_Q } = require('../schema');
const { projectState, SPEC_ID, RELN } = require('../schema-project');
const map = require('../sim/map-data.json');

group('Проекция Sim → схема (schema-project)');

test('город: owner/units(округл.)/spec/tier/occ', () => {
  const s = new Sim({ map, ai: false }), st = new GameState(), techN = [];
  const c = s.cities.find((x) => x.idx === 7); c.spec = 'atk'; c.tier = 2; c.units = 123.6; c.occ = true;
  projectState(s, st, techN);
  const cs = st.cities.get('7');
  eq(cs.owner, c.owner); eq(cs.units, 124); eq(cs.spec, SPEC_ID.atk); eq(cs.tier, 2); eq(cs.occ, 1);
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
