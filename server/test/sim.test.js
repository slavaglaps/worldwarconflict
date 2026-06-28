// СЕРВЕРНЫЕ тесты: чистый сим (без сети/Three). Каждая реализованная механика + грани + анти-чит.
const { group, test, assert, eq, near, gt, lt, summary } = require('./harness');
const { Sim } = require('../sim/Sim');
const { City } = require('../sim/City');
const { Squad } = require('../sim/Squad');
const { Ship } = require('../sim/Ship');
const { Plane } = require('../sim/Plane');
const { recomputeTech } = require('../sim/tech');
const { isWaterAt } = require('../sim/water');
const C = require('../sim/constants');
const { sanitizeOverride, deepMerge, makeBalance } = require('../sim/balance');
const map = require('../sim/map-data.json');

const mkCity = (o) => new City(Object.assign({ idx: 0, gx: 0, gz: 0, country: 0, size: 1, owner: 0 }, o));
const learn = (s, fid, id) => { s.techDone[fid].add(id); s.techCache[fid] = recomputeTech(s.techDone[fid]); };  // изучить узел напрямую

group('Инициализация мира');
test('18 городов, 6 фракций', () => { const s = new Sim({ factions: 6, cities: 18 }); eq(s.cities.length, 18); eq(s.factions, 6); });
test('стартовая голда 60 у всех', () => { const s = new Sim(); for (let f = 0; f < s.factions; f++) eq(s.gold[f], 60); });
test('манпауэр стартует на потолке', () => { const s = new Sim(); for (let f = 0; f < s.factions; f++) near(s.manpower[f], s.manpowerCap(f)); });

group('Экономика (доход = размер города / интервал)');
test('size=2 даёт +2 голды за интервал', () => { const c = mkCity({ size: 2 }); eq(c.goldInterval, 4); eq(c.update(4.0001), 2); });
test('несколько интервалов за большой dt', () => { const c = mkCity({ size: 1 }); eq(c.update(8.5), 2); }); // пересёк 4 и 8
test('spec=prod ускоряет интервал (0.68^tier)', () => { const c = mkCity({ size: 1 }); c.spec = 'prod'; c.tier = 1; near(c.goldInterval, 4 * 0.68); });

group('Производство (FIFO-очередь найма)');
test('партия завершается через time → гарнизон растёт', () => {
  const c = mkCity({ size: 1 }); const u0 = c.units;
  c.batches.push({ count: 6, time: 6 * c.trainPer, elapsed: 0 });
  c.update(6 * c.trainPer + 0.01); eq(c.units, u0 + 6); eq(c.batches.length, 0);
});
test('гарнизон не превышает capacity', () => {
  const c = mkCity({ size: 1 }); c.units = c.capacity - 2;
  c.batches.push({ count: 10, time: 0.1, elapsed: 0 });
  c.update(0.2); eq(c.units, c.capacity);
});
test('FIFO: продвигается только первая партия', () => {
  const c = mkCity({ size: 1 }); const u0 = c.units;
  c.batches = [{ count: 3, time: 1, elapsed: 0 }, { count: 5, time: 1, elapsed: 0 }];
  c.update(0.5); eq(c.units, u0); eq(c.batches.length, 2);          // [0] ещё не готова
  c.update(0.6); eq(c.units, u0 + 3); eq(c.batches.length, 1);      // [0] готова, [1] ждёт
});

group('Манпауэр (потолок / регенерация / трата)');
test('потолок: столица size1 = (20+12)·1.6 = 51.2', () => { const s = new Sim({ factions: 2, cities: 2 }); near(s.manpowerCap(0), 51.2); });
test('регенерация к потолку', () => { const s = new Sim({ factions: 2, cities: 2 }); s.manpower[0] = 0; s.tick(1.0); near(s.manpower[0], s.manpowerRate(0) * 1.0, 1e-3); });
test('не выходит за потолок', () => { const s = new Sim({ factions: 2, cities: 2 }); s.manpower[0] = s.manpowerCap(0); s.tick(5.0); near(s.manpower[0], s.manpowerCap(0)); });

group('Покупка солдат (валидация/лимиты)');
test('buy 6: тратит голду (×4) и манпауэр', () => {
  const s = new Sim({ factions: 2, cities: 2 }); const mp0 = s.manpower[0];
  assert(s.cmdBuy(0, 0, '6')); eq(s.cities[0].batches[0].count, 6); eq(s.gold[0], 60 - 24); near(s.manpower[0], mp0 - 6);
});
test('max ограничен голдой', () => { const s = new Sim({ factions: 2, cities: 2 }); s.gold[0] = 8; s.cmdBuy(0, 0, 'max'); eq(s.cities[0].batches[0].count, 2); eq(s.gold[0], 0); });
test('max ограничен манпауэром', () => { const s = new Sim({ factions: 2, cities: 2 }); s.gold[0] = 1000; s.manpower[0] = 3; s.cmdBuy(0, 0, 'max'); eq(s.cities[0].batches[0].count, 3); });
test('max ограничен вместимостью', () => { const s = new Sim({ factions: 2, cities: 2 }); s.gold[0] = 1e9; s.manpower[0] = 1e9; const c = s.cities[0]; const space = Math.floor(c.capacity - c.units); s.cmdBuy(0, 0, 'max'); eq(c.batches[0].count, space); });
test('нельзя купить в чужом городе', () => { const s = new Sim({ factions: 2, cities: 2 }); eq(s.cmdBuy(0, 1, 'max'), false); eq(s.cities[1].batches.length, 0); });
test('нельзя купить в оккупированном', () => { const s = new Sim({ factions: 2, cities: 2 }); s.cities[0].occ = true; eq(s.cmdBuy(0, 0, 'max'), false); });
test('нельзя купить чужой фракцией (анти-чит)', () => { const s = new Sim({ factions: 2, cities: 2 }); eq(s.cmdBuy(1, 0, 'max'), false); });

group('Прокачка города');
test('prod: spec+tier, стоимость 50', () => { const s = new Sim({ factions: 2, cities: 2 }); s.gold[0] = 200; assert(s.cmdUpgrade(0, 0, 'prod')); eq(s.cities[0].spec, 'prod'); eq(s.cities[0].tier, 1); eq(s.gold[0], 150); });
test('ветки прокачиваются независимо', () => {
  const s = new Sim({ factions: 2, cities: 2 }); s.gold[0] = 500;
  assert(s.cmdUpgrade(0, 0, 'prod'));
  assert(s.cmdUpgrade(0, 0, 'def'));
  assert(s.cmdUpgrade(0, 0, 'atk'));
  eq(s.cities[0].prodTier, 1); eq(s.cities[0].defTier, 1); eq(s.cities[0].atkTier, 1);
  eq(s.cities[0].totalTier, 3); eq(s.gold[0], 350);
});
test('тиры 1→2→3 по растущей цене', () => { const s = new Sim({ factions: 2, cities: 2 }); s.gold[0] = 1000; s.cmdUpgrade(0, 0, 'prod'); s.cmdUpgrade(0, 0, 'prod'); s.cmdUpgrade(0, 0, 'prod'); eq(s.cities[0].tier, 3); eq(s.gold[0], 1000 - 50 - 100 - 150); });
test('не выше MAX_TIER', () => { const s = new Sim({ factions: 2, cities: 2 }); s.gold[0] = 1e9; for (let i = 0; i < 5; i++) s.cmdUpgrade(0, 0, 'prod'); eq(s.cities[0].tier, C.MAX_TIER); });
test('нельзя без голды', () => { const s = new Sim({ factions: 2, cities: 2 }); s.gold[0] = 10; eq(s.cmdUpgrade(0, 0, 'prod'), false); });
test('нельзя оккупированный', () => { const s = new Sim({ factions: 2, cities: 2 }); s.gold[0] = 200; s.cities[0].occ = true; eq(s.cmdUpgrade(0, 0, 'prod'), false); });
test('нельзя апгрейдить с невалидной веткой', () => { const s = new Sim({ factions: 2, cities: 2 }); s.gold[0] = 200; eq(s.cmdUpgrade(0, 0, undefined), false); eq(s.cities[0].tier, 0); eq(s.gold[0], 200); });

group('Отправка армии / осада / захват / оккупация / аннексия');
test('подкрепление своего города', () => { const s = new Sim({ factions: 1, cities: 2 }); const u1 = s.cities[1].units; assert(s.cmdSend(0, 0, 1, 0.5)); gt(s.cities[1].units, u1); });
test('реальная карта: отряд идёт по полилинии дороги Галвэй → Дублин', () => {
  const byName = Object.fromEntries(map.cities.map(c => [c.name, c]));
  const from = byName['Галвэй'].idx, to = byName['Дублин'].idx, fid = byName['Галвэй'].owner;
  const s = new Sim({ map, balance: makeBalance({ factionDefault: { gold: 200, polit: 80 } }), ai: false });
  assert(s.cmdSend(fid, from, to, 0.5));
  const q = s.squads[0], edge = s.edgeBetween(from, to);
  assert(edge && Array.isArray(edge.pts) && edge.pts.length >= 2, 'у ребра есть запечённая полилиния');
  q.prog = edge.len * 0.5; q._setPos();
  const pts = edge.a === from ? edge.pts : edge.pts.slice().reverse();
  const target = edge.len * 0.5; let walked = 0, expected = pts[pts.length - 1];
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1], p1 = pts[i], seg = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    if (walked + seg >= target || i === pts.length - 1) {
      const f = seg > 0 ? Math.max(0, Math.min(1, (target - walked) / seg)) : 0;
      expected = { x: p0.x + (p1.x - p0.x) * f, z: p0.z + (p1.z - p0.z) * f };
      break;
    }
    walked += seg;
  }
  near(q.x, expected.x, 1e-6); near(q.z, expected.z, 1e-6);
});
test('реальная карта: Лимэрик → Белфаст идёт мультихопом по дорожным полилиниям', () => {
  const byName = Object.fromEntries(map.cities.map(c => [c.name, c]));
  const from = byName['Лимэрик'].idx, to = byName['Белфаст'].idx, fid = byName['Лимэрик'].owner;
  const s = new Sim({ map, balance: makeBalance({ factionDefault: { gold: 200, polit: 80 } }), ai: false });
  const path = s.findPath(from, to, fid);
  eq(path.map(i => map.cities[i].name).join(' → '), 'Лимэрик → Дублин → Белфаст');
  assert(s.cmdSend(fid, from, to, 0.5));
  const q = s.squads[0];
  for (let hop = 0; hop < q.path.length - 1; hop++) {
    q.hop = hop;
    const edge = s.edgeBetween(q.path[hop], q.path[hop + 1]);
    assert(edge && Array.isArray(edge.pts) && edge.pts.length >= 2, 'у каждого сегмента есть полилиния');
    q.prog = edge.len * 0.5; q._setPos();
    const pts = edge.a === q.path[hop] ? edge.pts : edge.pts.slice().reverse();
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1], p1 = pts[i], vx = p1.x - p0.x, vz = p1.z - p0.z;
      const wx = q.x - p0.x, wz = q.z - p0.z, l = vx * vx + vz * vz;
      const f = l ? Math.max(0, Math.min(1, (wx * vx + wz * vz) / l)) : 0;
      best = Math.min(best, Math.hypot(q.x - (p0.x + vx * f), q.z - (p0.z + vz * f)));
    }
    near(best, 0, 1e-6);
  }
});
test('реальная карта: Глазго → Эдинбург идёт по южной визуальной дороге', () => {
  const byName = Object.fromEntries(map.cities.map(c => [c.name, c]));
  const from = byName['Глазго'].idx, to = byName['Эдинбург'].idx, fid = byName['Глазго'].owner;
  const s = new Sim({ map, balance: makeBalance({ factionDefault: { gold: 200, polit: 80 } }), ai: false });
  eq(s.findPath(from, to, fid).map(i => map.cities[i].name).join(' → '), 'Глазго → Эдинбург');
  assert(s.cmdSend(fid, from, to, 0.5));
  const q = s.squads[0], edge = s.edgeBetween(from, to);
  assert(edge && Array.isArray(edge.pts) && edge.pts.length >= 5, 'у ребра есть детальная полилиния визуальной дороги');
  q.prog = edge.len * 0.5; q._setPos();
  near(q.x, 38.1, 0.08);
  near(q.z, 103, 0.08);
});
test('реальная карта: Бирмингмем → Ливерпуль идёт мультихопом по дорожным полилиниям', () => {
  const byName = Object.fromEntries(map.cities.map(c => [c.name, c]));
  const from = byName['Бирмингмем'].idx, to = byName['Ливерпуль'].idx, fid = byName['Бирмингмем'].owner;
  const s = new Sim({ map, balance: makeBalance({ factionDefault: { gold: 200, polit: 80 } }), ai: false });
  const path = s.findPath(from, to, fid);
  eq(path.map(i => map.cities[i].name).join(' → '), 'Бирмингмем → Бирмингем → Маннчестер → Ливерпуль');
  assert(s.cmdSend(fid, from, to, 0.5));
  const q = s.squads[0];
  for (let hop = 0; hop < q.path.length - 1; hop++) {
    q.hop = hop;
    const edge = s.edgeBetween(q.path[hop], q.path[hop + 1]);
    assert(edge && Array.isArray(edge.pts) && edge.pts.length >= 2, 'у каждого сегмента есть полилиния');
    q.prog = edge.len * 0.5; q._setPos();
    const pts = edge.a === q.path[hop] ? edge.pts : edge.pts.slice().reverse();
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1], p1 = pts[i], vx = p1.x - p0.x, vz = p1.z - p0.z;
      const wx = q.x - p0.x, wz = q.z - p0.z, l = vx * vx + vz * vz;
      const f = l ? Math.max(0, Math.min(1, (wx * vx + wz * vz) / l)) : 0;
      best = Math.min(best, Math.hypot(q.x - (p0.x + vx * f), q.z - (p0.z + vz * f)));
    }
    near(best, 0, 1e-6);
  }
});
test('осада чужого (в войне): создаётся пул', () => { const s = new Sim({ factions: 2, cities: 2, warPrep: 0 }); s.setWar(0, 1); const u0 = s.cities[0].units; assert(s.cmdSend(0, 0, 1, 0.5)); eq(s.cities[0].units, u0 - Math.floor(u0 * 0.5)); assert(s.cities[1].siege && s.cities[1].siege[0]); });
test('нельзя нападать без объявления войны', () => { const s = new Sim({ factions: 2, cities: 2 }); eq(s.cmdSend(0, 0, 1, 0.5), false); assert(!s.cities[1].siege); });
test('нельзя слать из чужого города', () => { const s = new Sim({ factions: 2, cities: 2 }); eq(s.cmdSend(0, 1, 0, 0.5), false); });
test('осада со временем захватывает город (owner+occ+occFrom)', () => {
  const s = new Sim({ factions: 2, cities: 4 });            // фракция 1 владеет city1 и city3 → захват city1 не уничтожает её (occ остаётся)
  s.cities[1].units = 2; s.cities[1].siege = { 0: { units: 60, atkMult: 1 } };
  for (let i = 0; i < 60 && s.cities[1].owner !== 0; i++) s.tick(0.1);
  eq(s.cities[1].owner, 0); eq(s.cities[1].occ, true); eq(s.cities[1].occFrom, 1);
});
test('возврат своего оккупированного города снимает occ', () => {
  const s = new Sim({ factions: 2, cities: 2 });
  s.cities[0].owner = 1; s.cities[0].occ = true; s.cities[0].occFrom = 0; s.cities[0].units = 2;
  s.cities[0].siege = { 0: { units: 60, atkMult: 1 } };
  for (let i = 0; i < 60 && s.cities[0].owner !== 0; i++) s.tick(0.1);
  eq(s.cities[0].owner, 0); eq(s.cities[0].occ, false);
});
test('выбывание фракции попадает в очередь eliminations (для итогов матча)', () => {
  const s = new Sim({ factions: 2, cities: 2 });
  s.cities[1].units = 2; s.cities[1].siege = { 0: { units: 60, atkMult: 1 } };
  for (let i = 0; i < 60 && !s.eliminations.length; i++) s.tick(0.1);
  gt(s.eliminations.length, 0); eq(s.eliminations[0].dead, 1); eq(s.eliminations[0].by, 0);
});
test('аннексия: у павшей фракции забирают ресурсы', () => {
  const s = new Sim({ factions: 2, cities: 2 });           // у каждого 1 город → захват = капитуляция
  s.gold[1] = 100; s.manpower[1] = 30;
  s.cities[1].units = 2; s.cities[1].siege = { 0: { units: 60, atkMult: 1 } };
  for (let i = 0; i < 60 && s.cities[1].owner !== 0; i++) s.tick(0.1);
  eq(s.cities[1].owner, 0); eq(s.gold[1], 0); eq(s.manpower[1], 0);
});
test('оборона (spec=def) замедляет падение города', () => {
  const mk = (spec) => { const s = new Sim({ factions: 3, cities: 3 }); const c = s.cities[1]; c.units = 20; if (spec) { c.spec = spec; c.tier = 3; } c.siege = { 0: { units: 30, atkMult: 1 } }; let t = 0; for (; t < 200 && c.owner !== 0; t++) s.tick(0.1); return t; };
  gt(mk('def'), mk(null));   // с обороной город держится дольше
});

group('Дипломатия (война / мир / союз / поддержка / политочки)');
test('объявление войны: −50🏛, ставит войну', () => { const s = new Sim({ factions: 2, cities: 2 }); s.politPts[0] = 100; assert(s.cmdWar(0, 1)); assert(s.atWar(0, 1)); eq(s.politPts[0], 50); });
test('нельзя объявить войну без политочков', () => { const s = new Sim({ factions: 2, cities: 2 }); s.politPts[0] = 10; eq(s.cmdWar(0, 1), false); assert(!s.atWar(0, 1)); });
test('война имеет мобилизацию WAR_PREP (warReady)', () => { const s = new Sim({ factions: 2, cities: 2 }); s.politPts[0] = 100; s.cmdWar(0, 1); assert(!s.warReady(0, 1)); s.time += C.WAR_PREP + 1; assert(s.warReady(0, 1)); });
test('повтор объявления уже идущей войны отклонён (нет двойного списания / сброса мобилизации)', () => {
  const s = new Sim({ factions: 2, cities: 2 }); s.politPts[0] = 100;
  assert(s.cmdWar(0, 1), 'первое объявление прошло'); const p = s.politPts[0], ws = s.warSince[s.relKey(0, 1)];
  s.time += 5;
  eq(s.cmdWar(0, 1), false, 'повтор отклонён');
  eq(s.politPts[0], p, 'политочки не списаны повторно');
  eq(s.warSince[s.relKey(0, 1)], ws, 'warSince (отсчёт мобилизации) не сброшен');
});
test('союз: при согласии −10🏛', () => { const s = new Sim({ factions: 2, cities: 2, rng: () => 0.1 }); assert(s.cmdAlly(0, 1)); assert(s.allied(0, 1)); eq(s.politPts[0], C.POLIT_START - C.POLIT_ALLY); });
test('союз отклонён (rng>0.5, нет общего врага)', () => { const s = new Sim({ factions: 2, cities: 2, rng: () => 0.9 }); eq(s.cmdAlly(0, 1), false); assert(!s.allied(0, 1)); });
test('общий враг → союз принимается всегда', () => { const s = new Sim({ factions: 3, cities: 3, rng: () => 0.99 }); s.setWar(0, 2); s.setWar(1, 2); assert(s.cmdAlly(0, 1)); });
test('разрыв союза: −20🏛', () => { const s = new Sim({ factions: 2, cities: 2, rng: () => 0.1 }); s.cmdAlly(0, 1); s.politPts[0] = 100; assert(s.cmdBreak(0, 1)); assert(!s.allied(0, 1)); });
test('поддержка: перевод голды союзнику/кому угодно', () => { const s = new Sim({ factions: 2, cities: 2 }); s.gold[0] = 100; const g1 = s.gold[1]; assert(s.cmdSupport(0, 1)); lt(s.gold[0], 100); gt(s.gold[1], g1); });
test('анти-чит: союзы НЕ транзитивны (econ-приватность не течёт через посредника A↔B↔C)', () => {
  const s = new Sim({ factions: 3, cities: 3 });
  s.relations[s.relKey(0, 1)] = 'ally'; s.relations[s.relKey(1, 2)] = 'ally';   // A↔B, B↔C
  assert(s.allied(0, 1) && s.allied(1, 2), 'прямые союзы есть');
  assert(!s.allied(0, 2), 'A и C НЕ союзники через B → C НЕ видит econ A (_sendEcon гейтит по allied)');
});
test('дипломатия отклоняет несуществующие фракции', () => {
  const s = new Sim({ factions: 2, cities: 2 }); s.politPts[0] = 500; s.gold[0] = 500;
  eq(s.cmdWar(0, 999), false); eq(s.cmdAlly(0, -1), false); eq(s.cmdBreak(0, 2), false); eq(s.cmdSupport(0, 999).ok, false); eq(s.cmdPeace(0, 999).ok, false);
  eq(s.gold.length, 2); eq(Object.keys(s.relations).length, 0);
});
test('союзники втягиваются в войну с агрессором', () => { const s = new Sim({ factions: 3, cities: 3, rng: () => 0.1 }); s.setRelation(1, 2, 'ally'); s.politPts[0] = 100; s.cmdWar(0, 1); assert(s.atWar(0, 2)); });
test('мир завершает войну + ставит перемирие', () => { const s = new Sim({ factions: 2, cities: 2, rng: () => 0.001 }); s.politPts[0] = 100; s.cmdWar(0, 1); const r = s.cmdPeace(0, 1, {}); assert(r.accepted); assert(!s.atWar(0, 1)); gt(s.truceLeft(0, 1), 0); });
test('во время перемирия нельзя снова объявить войну', () => { const s = new Sim({ factions: 2, cities: 2, rng: () => 0.001 }); s.politPts[0] = 200; s.cmdWar(0, 1); s.cmdPeace(0, 1, {}); s.politPts[0] = 200; eq(s.cmdWar(0, 1), false); });
test('мир с контрибуцией забирает голду врага', () => { const s = new Sim({ factions: 2, cities: 2, rng: () => 0.001 }); s.politPts[0] = 100; s.cmdWar(0, 1); s.gold[1] = 100; const g0 = s.gold[0]; const r = s.cmdPeace(0, 1, { money: 50 }); assert(r.accepted); gt(s.gold[0], g0); });
test('политочки копятся со временем', () => { const s = new Sim({ factions: 2, cities: 2 }); s.politPts[0] = 0; s.tick(1.0); gt(s.politPts[0], 0); });
test('репарации: побеждённый платит доход победителю', () => { const s = new Sim({ factions: 2, cities: 2 }); s.reparations.push({ from: 1, to: 0, pct: 1, until: s.time + 60 }); const g0 = s.gold[0]; s.gold[1] = 100; s.tick(2.0); gt(s.gold[0], g0); lt(s.gold[1], 100); });

group('Технологии (древо, эффекты, исследование)');
test('старт: множители = 1, 1 слот', () => { const s = new Sim({ factions: 2, cities: 2, balance: { factionDefault: { heroes: [] } } }); eq(s.techMul(0, 'atk'), 1); eq(s.techVal(0, 'cc'), 1); eq(s.slotCount(0), 1); });
test('исследование m1: −100💰, в очереди', () => { const s = new Sim({ factions: 2, cities: 2 }); s.gold[0] = 200; assert(s.cmdResearch(0, 'm1')); eq(s.techRes[0].length, 1); eq(s.gold[0], 100); });
test('завершение m1 даёт atk +10%', () => { const s = new Sim({ factions: 2, cities: 2, balance: { factionDefault: { heroes: [] } } }); s.gold[0] = 200; s.cmdResearch(0, 'm1'); for (let i = 0; i < 30 && !s.techHas(0, 'm1'); i++) s.tick(1.0); assert(s.techHas(0, 'm1')); near(s.techMul(0, 'atk'), 1.10); });
test('нельзя без пререквизитов (m2 требует m1)', () => { const s = new Sim({ factions: 2, cities: 2 }); s.gold[0] = 1000; eq(s.cmdResearch(0, 'm2'), false); });
test('лимит слотов (1 активное за раз)', () => { const s = new Sim({ factions: 2, cities: 2 }); s.gold[0] = 1000; s.cmdResearch(0, 'm1'); eq(s.cmdResearch(0, 'p1'), false); });
test('нельзя без голды', () => { const s = new Sim({ factions: 2, cities: 2 }); s.gold[0] = 10; eq(s.cmdResearch(0, 'm1'), false); });
test('unlock ships (узел i1)', () => { const s = new Sim({ factions: 2, cities: 2 }); learn(s, 0, 'i1'); assert(s.techFlag(0, 'ships')); });
test('eco-узел p1 ускоряет доход города', () => { const s = new Sim({ factions: 2, cities: 2 }); const gi0 = s.cities[0].goldInterval; learn(s, 0, 'p1'); lt(s.cities[0].goldInterval, gi0); });
test('лаборатория k4 даёт +1 слот', () => { const s = new Sim({ factions: 2, cities: 2 }); eq(s.slotCount(0), 1); learn(s, 0, 'k4'); eq(s.slotCount(0), 2); });
test('prod-узел повышает потолок манпауэра', () => { const s = new Sim({ factions: 2, cities: 2 }); const cap0 = s.manpowerCap(0); learn(s, 0, 'p2'); gt(s.manpowerCap(0), cap0); });

group('Реальная карта Европы + движение отрядов');
test('карта грузится: 143 города, 24 фракции, граф рёбер', () => { const s = new Sim({ map }); eq(s.cities.length, 143); eq(s.factions, 24); gt(s.edgeKey.size, 100); });
test('столицы/верфь/аэропорт на месте', () => { const s = new Sim({ map }); eq(s.cities.filter(c => c.capital).length, 24); assert(s.cities.some(c => c.isShipyard)); assert(s.cities.some(c => c.isAirport)); });
test('поиск пути между своими городами (мультихоп)', () => { const s = new Sim({ map }); const p = s.findPath(0, 6, 0); assert(p && p.length >= 2, 'путь найден'); eq(p[0], 0); eq(p[p.length - 1], 6); });
test('cmdSend создаёт движущийся отряд + тратит гарнизон', () => { const s = new Sim({ map }); const own = s.cities.filter(c => c.owner === 0).map(c => c.idx); const u0 = s.cities[own[0]].units; assert(s.cmdSend(0, own[0], own[1], 0.5)); eq(s.squads.length, 1); lt(s.cities[own[0]].units, u0); });
test('cmdSend отклоняет невалидный pct', () => {
  const s = new Sim({ map }); const own = s.cities.filter(c => c.owner === 0).map(c => c.idx); const u0 = s.cities[own[0]].units;
  eq(s.cmdSend(0, own[0], own[1], 2), false); eq(s.cmdSend(0, own[0], own[1], Infinity), false); eq(s.cmdSend(0, own[0], own[1], -0.5), false);
  eq(s.cities[own[0]].units, u0); eq(s.squads.length, 0);
});
test('отряд доходит и подкрепляет свой город', () => { const s = new Sim({ map }); const own = s.cities.filter(c => c.owner === 0).map(c => c.idx); const tgt = own[1]; const before = s.cities[tgt].units; s.cmdSend(0, own[0], tgt, 0.5); for (let i = 0; i < 400 && s.squads.length; i++) s.tick(0.1); eq(s.squads.length, 0); gt(s.cities[tgt].units, before); });
test('отряд осаждает вражеский город (в войне)', () => { const s = new Sim({ map, warPrep: 0 }); const eo = s.cities[7].owner; assert(eo !== 0, 'город 7 вражеский'); s.setWar(0, eo); assert(s.cmdSend(0, 0, 7, 0.9)); for (let i = 0; i < 600 && s.squads.length; i++) s.tick(0.1); assert((s.cities[7].siege && s.cities[7].siege[0]) || s.cities[7].owner === 0, 'осада началась или город взят'); });
test('нет пути через чужую территорию без войны/союза → отказ', () => { const s = new Sim({ map }); const far = s.cities.findIndex(c => c.owner !== 0 && !(s.adj.get(c.idx) || []).some(n => s.cities[n.to].owner === 0)); assert(far >= 0, 'найден удалённый город'); eq(s.findPath(0, far, 0), null); });
test('полевой бой: вражеские отряды истощают друг друга', () => { const s = new Sim({ map }); s.setWar(0, 1); const a = new Squad(0, 30, [0, 2], s, 1), b = new Squad(1, 30, [0, 2], s, 1); a.x = b.x = 100; a.z = b.z = 100; s.squads.push(a, b); s.fieldBattles(0.5); lt(a.fcount, 30); lt(b.fcount, 30); });

group('Флот + авиация (постройка, движение, spatial-grid бой)');
test('верфь строит корабль (с tech ships)', () => { const s = new Sim({ map, goldStart: 1000 }); const y = s.cities.find(c => c.isShipyard); learn(s, y.owner, 'i1'); assert(s.cmdBuildShip(y.owner, y.idx)); for (let i = 0; i < 70 && !s.ships.length; i++) s.tick(0.1); eq(s.ships.length, 1); });
test('аэропорт строит самолёт (с tech planes)', () => { const s = new Sim({ map, goldStart: 1000 }); const p = s.cities.find(c => c.isAirport); learn(s, p.owner, 'i8'); assert(s.cmdBuildPlane(p.owner, p.idx)); for (let i = 0; i < 80 && !s.planes.length; i++) s.tick(0.1); eq(s.planes.length, 1); });
test('без tech нельзя строить корабль', () => { const s = new Sim({ map, goldStart: 1000 }); const y = s.cities.find(c => c.isShipyard); eq(s.cmdBuildShip(y.owner, y.idx), false); });
test('нельзя строить корабль в не-верфи', () => { const s = new Sim({ map, goldStart: 1000 }); const c = s.cities.find(x => !x.isShipyard && x.owner === 0); learn(s, 0, 'i1'); eq(s.cmdBuildShip(0, c.idx), false); });
test('корабль спавнится на воде', () => { const s = new Sim({ map, goldStart: 1000 }); const y = s.cities.find(c => c.isShipyard); learn(s, y.owner, 'i1'); s.cmdBuildShip(y.owner, y.idx); for (let i = 0; i < 70 && !s.ships.length; i++) s.tick(0.1); assert(s.ships.length); assert(isWaterAt(s.ships[0].x, s.ships[0].z), 'корабль на воде'); });
test('cmdShipMove двигает корабль по воде', () => { const s = new Sim({ map, goldStart: 1000 }); const y = s.cities.find(c => c.isShipyard); learn(s, y.owner, 'i1'); s.cmdBuildShip(y.owner, y.idx); for (let i = 0; i < 70 && !s.ships.length; i++) s.tick(0.1); const sh = s.ships[0], x0 = sh.x; assert(s.cmdShipMove(y.owner, sh.id, sh.x - 15, sh.z)); for (let i = 0; i < 20; i++) s.tick(0.1); lt(sh.x, x0); });
test('морской бой (грид): вражеские корабли топят друг друга', () => { const s = new Sim({ map }); s.setWar(0, 1); s.ships.push(new Ship(0, 100, 100, s), new Ship(1, 100.5, 100, s)); for (let i = 0; i < 200 && s.ships.length === 2; i++) s.tick(0.1); lt(s.ships.length, 2); });
test('воздушный бой (грид): вражеские самолёты сбивают друг друга', () => { const s = new Sim({ map, rng: () => 0.01 }); s.setWar(0, 1); s.planes.push(new Plane(0, 100, 100, s), new Plane(1, 100.5, 100, s)); for (let i = 0; i < 200 && s.planes.length === 2; i++) s.tick(0.1); lt(s.planes.length, 2); });
test('союзные корабли не воюют', () => { const s = new Sim({ map }); s.setRelation(0, 1, 'ally'); s.ships.push(new Ship(0, 100, 100, s), new Ship(1, 100.5, 100, s)); for (let i = 0; i < 50; i++) s.tick(0.1); eq(s.ships.length, 2); });
test('buildYard: верфь — ОТДЕЛЬНЫЙ город рядом + умение строить корабли', () => { const s = new Sim({ map, goldStart: 500 }); const c = s.cities.find(x => x.owner === 0 && !x.isShipyard && s._isCoastal(x)); assert(c, 'есть прибрежный город'); const n0 = s.cities.length; assert(s.cmdBuildYard(0, c.idx, 'ship')); eq(s.cities.length, n0 + 1, 'верфь — отдельный город'); const y = s.cities[s.cities.length - 1]; assert(y.isShipyard && y.parent === c.idx && !c.isShipyard, 'верфь отдельная, родитель остался обычным'); assert(s.techFlag(0, 'ships')); assert(s.cmdBuildShip(0, y.idx)); });
test('buildYard: аэродром — ОТДЕЛЬНЫЙ город рядом + умение строить самолёты', () => { const s = new Sim({ map, goldStart: 500 }); const c = s.cities.find(x => x.owner === 0 && !x.isAirport && x.parent == null); const n0 = s.cities.length; assert(s.cmdBuildYard(0, c.idx, 'air')); eq(s.cities.length, n0 + 1); const y = s.cities[s.cities.length - 1]; assert(y.isAirport && y.parent === c.idx && !c.isAirport); assert(s.techFlag(0, 'planes')); assert(s.cmdBuildPlane(0, y.idx)); });
test('buildYard: верфь нельзя в неприбрежном городе', () => { const s = new Sim({ map, goldStart: 500 }); const inland = s.cities.find(x => !s._isCoastal(x) && !x.isShipyard); assert(inland, 'есть внутренний город'); eq(s.cmdBuildYard(inland.owner, inland.idx, 'ship'), false); });
test('хард-кап флота: строит ровно до MAX_SHIPS, дальше отказ', () => {
  const s = new Sim({ map, goldStart: 1e6 });
  const c = s.cities.find(x => x.owner === 0 && !x.isShipyard && s._isCoastal(x)); assert(c, 'есть прибрежный город');
  assert(s.cmdBuildYard(0, c.idx, 'ship'));
  const y = s.cities[s.cities.length - 1];   // верфь — отдельный город-сущность
  let ok = 0;
  for (let i = 0; i < C.MAX_SHIPS + 5; i++) { s.gold[0] += 1000; s.manpower[0] += 1000; if (s.cmdBuildShip(0, y.idx)) ok++; }
  eq(ok, C.MAX_SHIPS, 'построено ровно до капа');
  s.gold[0] += 1000; s.manpower[0] += 1000;
  eq(s.cmdBuildShip(0, y.idx), false, 'сверх капа — отказ');
});

group('Бой: башни / ПВО / обстрел берега / бомбёжка');
test('башня atk-города бьёт осаждающих', () => { const s = new Sim({ map }); s.setWar(0, 1); const c = s.cities.find(x => x.owner === 0); c.spec = 'atk'; c.tier = 3; c.siege = { 1: { units: 40, atkMult: 1 } }; const b0 = c.siege[1].units; for (let i = 0; i < 30; i++) s.cityTowers(0.1); assert(!c.siege || c.siege[1].units < b0, 'осаждающие потеряли бойцов'); });
test('башня бьёт вражеский отряд в радиусе', () => { const s = new Sim({ map }); s.setWar(0, 1); const c = s.cities.find(x => x.owner === 0); c.spec = 'atk'; c.tier = 3; const sq = new Squad(1, 30, [c.idx], s, 1); sq.x = c.gx + 3; sq.z = c.gz + 3; s.squads.push(sq); const f0 = sq.fcount; for (let i = 0; i < 20; i++) s.cityTowers(0.1); lt(sq.fcount, f0); });
test('ПВО сбивает вражеский самолёт', () => { const s = new Sim({ map }); s.setWar(0, 1); const c = s.cities.find(x => x.owner === 0); c.aa = 3; const p = new Plane(1, c.gx + 5, c.gz + 5, s); const h0 = p.hp; s.planes.push(p); for (let i = 0; i < 30; i++) s.cityAA(0.1); lt(p.hp, h0); });
test('cmdBuildAA: ставит зенитку за голду+манпауэр', () => { const s = new Sim({ map, goldStart: 500 }); const c = s.cities.find(x => x.owner === 0); assert(s.cmdBuildAA(0, c.idx)); eq(c.aa, 1); });
test('обстрел берега: корабль с tech бьёт вражеский город', () => { const s = new Sim({ map }); s.setWar(0, 1); learn(s, 0, 'i6'); const ec = s.cities.find(x => x.owner === 1); const sh = new Ship(0, ec.gx + 5, ec.gz + 5, s); s.ships.push(sh); const u0 = ec.units; for (let i = 0; i < 40; i++) s.shipBombard(0.1); lt(ec.units, u0); });
test('обстрел без tech shipMissile не работает', () => { const s = new Sim({ map }); s.setWar(0, 1); const ec = s.cities.find(x => x.owner === 1); const sh = new Ship(0, ec.gx + 5, ec.gz + 5, s); s.ships.push(sh); const u0 = ec.units; for (let i = 0; i < 40; i++) s.shipBombard(0.1); eq(ec.units, u0); });
test('бомбёжка: самолёт по приказу бьёт город (tech planeBomb)', () => { const s = new Sim({ map }); s.setWar(0, 1); learn(s, 0, 'i10'); const bc = s.cities.find(x => x.owner === 1); assert(s.cmdAirOrder(0, bc.idx)); const p = new Plane(0, bc.gx + 2, bc.gz + 2, s); s.planes.push(p); const u0 = bc.units; for (let i = 0; i < 40; i++) s.planeBomb(0.1); lt(bc.units, u0); });
test('cmdAirOrder: нельзя бомбить не-врага', () => { const s = new Sim({ map }); const own = s.cities.find(x => x.owner === 0); eq(s.cmdAirOrder(0, own.idx), false); });

group('ИИ-оппоненты (порт aiActFaction)');
test('ИИ выключен по умолчанию (ai:false → никто не воюет)', () => { const s = new Sim({ map }); for (let i = 0; i < 200; i++) s.tick(0.1); eq(Object.values(s.relations).filter(v => v === 'war').length, 0); });
test('ИИ объявляет войны', () => { const s = new Sim({ map, ai: true, goldStart: 200 }); s.humanFactions = new Set([19]); for (let i = 0; i < 800; i++) s.tick(0.1); gt(Object.values(s.relations).filter(v => v === 'war').length, 0); });
test('ИИ исследует технологии', () => { const s = new Sim({ map, ai: true, goldStart: 300 }); for (let i = 0; i < 600; i++) s.tick(0.1); gt(s.techDone.filter(t => t.size > 0).length, 0); });
test('ИИ строит и двигает армии (захваты идут)', () => { const s = new Sim({ map, ai: true, goldStart: 250 }); for (let i = 0; i < 1000; i++) s.tick(0.1); gt(s.cities.filter(c => c.occ).length, 0); });
test('ИИ НЕ управляет фракциями людей', () => { const s = new Sim({ map, ai: true, goldStart: 300 }); s.humanFactions = new Set([5]); for (let i = 0; i < 400; i++) s.tick(0.1); eq(s.squads.filter(sq => sq.owner === 5).length, 0); eq(s.techDone[5].size, 0); eq(s.techRes[5].length, 0); });

group('Мобилизация: атака только после WAR_PREP');
// сосед-враг для фракции 0 (по графу симуляции)
const enemyPair = (s) => { for (const c of s.cities) { if (c.owner !== 0) continue; for (const { to } of (s.adj.get(c.idx) || [])) { const n = s.cities[to]; if (n.owner !== 0) return { a: c, b: n }; } } return {}; };
test('cmdSend на врага отклонён во время мобилизации, разрешён после', () => {
  const s = new Sim({ map, goldStart: 4000, politStart: 200, warPrep: 60, rng: () => 0.01 });
  const { a, b } = enemyPair(s); assert(a && b, 'есть граница фракции 0 с врагом'); a.units = 200;
  assert(s.cmdWar(0, b.owner), 'война объявлена');
  eq(s.warReady(0, b.owner), false, 'идёт мобилизация');
  eq(s.cmdSend(0, a.idx, b.idx, 0.5), false, 'атака во время мобилизации отклонена');
  for (let i = 0; i < 320 && !s.warReady(0, b.owner); i++) s.tick(0.2);     // промотать > WAR_PREP
  eq(s.warReady(0, b.owner), true, 'мобилизация завершена');
  const sq0 = s.squads.length; assert(s.cmdSend(0, a.idx, b.idx, 0.5), 'атака после мобилизации проходит'); gt(s.squads.length, sq0, 'отряд создан');
});
test('warPrep:0 → атака сразу после объявления войны', () => {
  const s = new Sim({ map, goldStart: 4000, politStart: 200, warPrep: 0, rng: () => 0.01 });
  const { a, b } = enemyPair(s); a.units = 200; assert(s.cmdWar(0, b.owner));
  eq(s.warReady(0, b.owner), true, 'без мобилизации готов сразу');
  assert(s.cmdSend(0, a.idx, b.idx, 0.5), 'атака проходит сразу');
});

group('Баланс: инъекция + пер-фракционная асимметрия');
test('override баланса: политика + пер-фракционные старты/гарнизон/моды', () => {
  const s = new Sim({ map, balance: {
    politics: { warPrep: 0, costWar: 10 },
    factionDefault: { gold: 100, heroes: [] },
    factions: { 0: { gold: 999, garrisonBase: 20, mods: { atk: 2 } } },
  } });
  eq(s.warPrep, 0, 'warPrep из баланса');
  eq(s.B.politics.costWar, 10, 'стоимость войны из баланса');
  eq(s.gold[0], 999, 'фракция 0: свой стартовый голд');
  eq(s.gold[1], 100, 'фракция 1: factionDefault голд');
  const c0 = s.cities.find(c => c.owner === 0); assert(c0, 'у фракции 0 есть город');
  eq(Math.round(c0.units), 20 + c0.size * 4, 'фракция 0: стартовый гарнизон по своему base');
  near(s.techMul(0, 'atk'), 2, 0.001, 'фракция 0: атака ×2 (фракционный мод)');
  near(s.techMul(1, 'atk'), 1, 0.001, 'фракция 1: атака ×1 (симметрия)');
});
test('дефолты баланса не мутируются между симами (deep-merge)', () => {
  new Sim({ map, balance: { politics: { warPrep: 0 } } });   // если бы мутировал DEFAULTS — следующий сим сломался бы
  eq(new Sim({ map }).warPrep, C.WAR_PREP, 'дефолтный warPrep цел');
});
test('override техов: цена узла из баланса, прочие узлы не тронуты', () => {
  const s = new Sim({ map, goldStart: 150, balance: { tech: { nodes: { m1: { g: 500 } } } } });
  eq(s.techNode.m1.g, 500, 'm1 цена переопределена');
  eq(s.techNode.p1.g, 100, 'p1 цена дефолтная (не тронута)');
  eq(s.cmdResearch(0, 'm1'), false, '500 > 150 → исследование отклонено');
  assert(s.cmdResearch(0, 'p1'), '100 ≤ 150 → дешёвый узел исследуется');
});

group('Баланс: тюнинг юнитов/экономики (balance.tune)');
test('tune прокидывается в sim.K (юниты/экономика), прочее — дефолт', () => {
  const s = new Sim({ factions: 2, cities: 2, balance: { tune: { SHIP_COST: 123, PLANE_HP: 7, MAX_SHIPS: 3 } } });
  eq(s.K.SHIP_COST, 123); eq(s.K.PLANE_HP, 7); eq(s.K.MAX_SHIPS, 3);
  eq(s.K.SOLDIER_PRICE, 4, 'не тронутое — дефолт');
});
test('SOLDIER_PRICE из tune → стоимость найма', () => {
  const s = new Sim({ factions: 2, cities: 2, balance: { tune: { SOLDIER_PRICE: 10 }, factionDefault: { heroes: [] } } });
  s.gold[0] = 100; s.manpower[0] = 100; s.cmdBuy(0, 0, '5');
  eq(s.gold[0], 50, '5×10 списано');
});
test('UPGRADE_COST_* из tune → цена прокачки', () => {
  const s = new Sim({ factions: 2, cities: 2, balance: { tune: { UPGRADE_COST_BASE: 100, UPGRADE_COST_STEP: 0 } } });
  s.gold[0] = 200; assert(s.cmdUpgrade(0, 0, 'prod')); eq(s.gold[0], 100, '100 за тир1');
});
test('CITY_GOLD_INTERVAL из tune → интервал дохода города', () => {
  // CITY_BOOST_GOLD:1 нейтрализует бонус контроля страны (город сейчас boosted, т.к. вся страна у одной фракции) — изолируем интервал
  const s = new Sim({ factions: 2, cities: 2, balance: { tune: { CITY_GOLD_INTERVAL: 2, CITY_BOOST_GOLD: 1 }, factionDefault: { heroes: [] } } });
  near(s.cities[0].goldInterval, 2, 1e-9, 'интервал = 2 (eco×1, буст нейтрализован)');
});
test('tune доходит до сущностей: Ship читает sim.K', () => {
  const s = new Sim({ factions: 2, cities: 2, balance: { tune: { SHIP_HP: 99 } } });
  const sh = new Ship(0, 0, 0, s); near(sh.hp, 99 * s.techVal(0, 'sh'), 1e-6, 'hp от tuned SHIP_HP');
});
test('tune изолирован между симами и не мутирует код-дефолты', () => {
  new Sim({ factions: 2, cities: 2, balance: { tune: { SOLDIER_PRICE: 99 } } });
  eq(new Sim({ factions: 2, cities: 2 }).K.SOLDIER_PRICE, 4, 'другой сим — дефолт');
  eq(C.SOLDIER_PRICE, 4, 'глобальный C цел');
});

group('Баланс: валидация Directus-override + приоритет стартов (фиксы аудита)');
test('sanitize: отрицательные/NaN/Infinity/строки-вместо-чисел дропаются или клампятся', () => {
  const s = sanitizeOverride({
    tune: { SHIP_COST: -40, SOLDIER_PRICE: NaN, PLANE_HP: 'abc', AA_DMG: Infinity, MP_BASE: 30, SHIPYARD_BUILD_COST: 1e12 },
    politics: { warPrep: -5, costWar: 9e9 },
  });
  eq(s.tune.SHIP_COST, 0, 'отрицательная цена → 0');
  assert(!('SOLDIER_PRICE' in s.tune), 'NaN дропнут');
  assert(!('PLANE_HP' in s.tune), 'строка вместо числа дропнута');
  assert(!('AA_DMG' in s.tune), 'Infinity дропнут');
  eq(s.tune.MP_BASE, 30, 'валидное число прошло');
  eq(s.tune.SHIPYARD_BUILD_COST, 1e7, 'огромное значение склампано к 1e7');
  eq(s.politics.warPrep, 0, 'отриц. warPrep → 0');
  eq(s.politics.costWar, 1e7, 'огромная стоимость склампана');
});
test('sanitize: моды клампятся в [0..100], валидный мод проходит', () => {
  const s = sanitizeOverride({ factions: { 1: { mods: { atk: 1e6, def: -2, speed: 1.2 } } } });
  eq(s.factions['1'].mods.atk, 100, 'мод >100 → 100');
  eq(s.factions['1'].mods.def, 0, 'отриц. мод → 0');
  eq(s.factions['1'].mods.speed, 1.2, 'валидный мод 1.2 прошёл');
});
test('sanitize: не-объект → {}, массивы id героев сохраняются', () => {
  eq(JSON.stringify(sanitizeOverride(null)), '{}', 'null → {}');
  eq(JSON.stringify(sanitizeOverride([1, 2])), '{}', 'массив верхнего уровня → {}');
  const s = sanitizeOverride({ factions: { 1: { heroes: ['hans', 'gold'] } } });
  assert(Array.isArray(s.factions['1'].heroes) && s.factions['1'].heroes.length === 2, 'массив id героев сохранён');
});
test('sanitize: динамические секции (factions[id]/mods/heroes.pool) валидируются ПО СХЕМЕ (нет строк-в-числа → нет NaN)', () => {
  const s = sanitizeOverride({ factions: { 1: { mods: { atk: 'bad', def: 2, speed: 1e9 }, gold: 'x' } }, heroes: { pool: { custom: { name: 42, col: '#fff', abilities: 'bad' } } } });
  assert(!('atk' in s.factions['1'].mods), 'строка factions.mods.atk дропнута (раньше проскакивала → NaN)');
  eq(s.factions['1'].mods.def, 2, 'валидный мод сохранён');
  eq(s.factions['1'].mods.speed, 100, 'огромный мод склампан к 100');
  assert(!('gold' in s.factions['1']), 'строка factions.gold дропнута (схема factionDefault: число)');
  assert(!('abilities' in s.heroes.pool.custom), 'строка вместо массива abilities дропнута');
  assert(!('name' in s.heroes.pool.custom), 'число вместо строки-имени дропнуто');
  eq(s.heroes.pool.custom.col, '#fff', 'валидная строка (цвет) сохранена');
});
test('deepMerge/makeBalance устойчивы к мисматчу типов (примитив где ждали объект — без падения)', () => {
  eq(makeBalance({ politics: 5 }).politics.warPrep, C.WAR_PREP, 'politics-примитив проигнорирован → дефолт (раньше падало на in-операторе)');
  const b = makeBalance({ tune: 'x', factions: 7, ai: null });
  assert(b && b.politics && b.ai && b.tech, 'куча мисматчей — секции на месте, без краша');
  eq(deepMerge({ a: { b: 1 } }, { a: 9 }).a.b, 1, 'вложенный примитив-мисматч → берём base');
});
test('старты: Directus-override ПОВЕРХ прод-дефолтов (gold из Directus бьёт house 200), и реально применяется в Sim', () => {
  const layered = deepMerge({ factionDefault: { gold: 200, polit: 80 } }, { factionDefault: { gold: 500 } });
  eq(layered.factionDefault.gold, 500, 'Directus gold 500 победил house 200');
  eq(layered.factionDefault.polit, 80, 'polit без override → house 80');
  const s = new Sim({ map, balance: deepMerge({ factionDefault: { gold: 200, polit: 80 } }, { factionDefault: { gold: 777 } }) });
  eq(s.gold[0], 777, 'Sim стартует на Directus-голде 777 (а не на 200) — баг #1 закрыт');
});
test('balance-store: startAutoRefresh возвращает await-able промис (фикс #2)', () => {
  const p = require('../balance-store').startAutoRefresh();
  assert(p && typeof p.then === 'function', 'вернулся промис первой загрузки');
});

group('Герои: пер-фракционный движок (пассивы/активки/кулдауны/баффы)');
const HB = (ids) => ({ balance: { factionDefault: { heroes: [] }, factions: { 0: { heroes: ids } } } });
test('авто-ротация: у каждой страны есть герои по умолчанию, разные', () => {
  const s = new Sim({ factions: 4, cities: 8 });
  for (let f = 0; f < 4; f++) assert(s.heroSlots[f].length > 0, `у фракции ${f} есть герои`);
  assert(s.heroSlots[0][0].id !== s.heroSlots[1][0].id, 'разные страны → разные герои');
});
test('пассив: hans даёт +20% атаки своей фракции, не чужой', () => {
  const s = new Sim({ factions: 2, cities: 2, ...HB(['hans']) });
  near(s.techMul(0, 'atk'), 1.2, 1e-6, 'hans +0.2 atk');
  near(s.techMul(1, 'atk'), 1.0, 1e-6, 'без героев — без бонуса');
});
test('активка gold (+400) тратит кулдаун', () => {
  const s = new Sim({ factions: 2, cities: 2, ...HB(['gold']) });
  const g0 = s.gold[0]; assert(s.cmdHeroAbility(0, 0, 0), 'Золотой дождь');   // gold active[0]
  eq(s.gold[0], g0 + 400, '+400 голды');
  eq(s.cmdHeroAbility(0, 0, 0), false, 'на кулдауне → отказ');
});
test('кулдаун истекает → активка снова доступна', () => {
  const s = new Sim({ factions: 2, cities: 2, ...HB(['gold']) });
  s.cmdHeroAbility(0, 0, 0); for (let t = 0; t < 41; t++) s.tick(1.0);   // cd 40с
  assert(s.cmdHeroAbility(0, 0, 0), 'после КД снова можно');
});
test('активка garrison: +18 во все свои города', () => {
  const s = new Sim({ factions: 2, cities: 4, ...HB(['sterling']) });
  const own = s.cities.filter(c => c.owner === 0); const before = own.map(c => c.units);
  assert(s.cmdHeroAbility(0, 0, 1), 'Окопаться');   // sterling active[1]
  own.forEach((c, i) => gt(c.units, before[i]));
});
test('активка buff: +0.7 atk на время, истекает', () => {
  const s = new Sim({ factions: 2, cities: 2, ...HB(['hans']) });
  assert(s.cmdHeroAbility(0, 0, 0));   // Блицкриг +0.7/16с
  near(s.techMul(0, 'atk'), 1.9, 1e-6, 'пассив 0.2 + бафф 0.7');
  for (let t = 0; t < 17; t++) s.tick(1.0);
  near(s.techMul(0, 'atk'), 1.2, 1e-6, 'бафф истёк → остался пассив');
});
test('активка manpower: до потолка', () => {
  const s = new Sim({ factions: 2, cities: 2, ...HB(['volk']) });
  s.manpower[0] = 0; assert(s.cmdHeroAbility(0, 0, 0));   // Тотальная мобилизация
  near(s.manpower[0], s.manpowerCap(0), 1e-6);
});
test('airstrike без войны → отказ (КД не тратится)', () => {
  const s = new Sim({ factions: 2, cities: 2, ...HB(['storm']) });
  eq(s.cmdHeroAbility(0, 0, 0), false, 'нет цели → false');
  assert(s.heroSlots[0][0].cd[0] === 0, 'КД не потрачен');
});
test('airstrike в войне → −гарнизон ближайшего врага', () => {
  const s = new Sim({ factions: 2, cities: 2, warPrep: 0, ...HB(['storm']) });
  s.setWar(0, 1); const c1 = s.cities.find(c => c.owner === 1); const u = c1.units;
  assert(s.cmdHeroAbility(0, 0, 0), 'удар прошёл'); lt(c1.units, u, 'гарнизон врага упал');
});
test('невалидные аргументы → false', () => {
  const s = new Sim({ factions: 2, cities: 2, balance: { factionDefault: { heroes: ['gold'] } } });
  eq(s.cmdHeroAbility(9, 0, 0), false, 'невалидная фракция');
  eq(s.cmdHeroAbility(0, 9, 0), false, 'нет слота героя');
  eq(s.cmdHeroAbility(0, 0, 9), false, 'нет такой активки');
});

group('MP-паритет: порт механик из клиента (ПВО-перехват/подавление + контроль страны)');
test('ПВО перехватывает бомбу/ракету (раньше в MP не работало); шанс растёт с числом зениток', () => {
  const s = new Sim({ factions: 2, cities: 2 }); s.setWar(0, 1);
  const enemy = s.cities.find(c => c.owner === 1); enemy.aa = 2;
  s.rng = () => 0;   assert(s._aaIntercepts(enemy, 0), 'rng=0 < шанс → перехват');
  s.rng = () => 0.999; eq(s._aaIntercepts(enemy, 0), false, 'rng≈1 → нет перехвата');
  enemy.aa = 0; s.rng = () => 0; eq(s._aaIntercepts(enemy, 0), false, 'без ПВО → нет перехвата');
  enemy.aa = 5; eq(s._aaIntercepts(s.cities.find(c => c.owner === 0), 0), false, 'свой город не перехватывает свои снаряды');
});
test('бомбёжка/обстрел может выбить зенитку (подавление ПВО)', () => {
  const s = new Sim({ factions: 2, cities: 2 }); const c = s.cities[0]; c.aa = 3;
  s.rng = () => 0;   s._suppressAA(c); eq(c.aa, 2, 'rng<шанс → −1 зенитка');
  s.rng = () => 0.9; s._suppressAA(c); eq(c.aa, 2, 'rng>шанс → зенитка цела');
});
test('бонус контроля страны: вся страна у фракции → boosted; фрагментация → нет', () => {
  const s = new Sim({ factions: 2, cities: 4 });
  const c0 = s.cities.filter(c => c.country === 0);
  assert(c0.length >= 2 && c0.every(c => c.boosted), 'вся страна у одной фракции → все её города boosted');
  c0[1].owner = (c0[1].owner + 1) % 2; s._updateCountryBoost();
  assert(c0.some(c => !c.boosted), 'фрагментированная страна → буст снят');
});

summary('SERVER (sim)');
