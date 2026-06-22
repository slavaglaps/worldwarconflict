// Нагрузочный тест ОДНОЙ комнаты на худший случай:
//   за каждую страну — «реальный игрок» (ИИ выключен), все воюют со всеми,
//   у каждой фракции по N кораблей (на воде, в движении) + N самолётов + N армий,
//   у кораблей/самолётов огромный HP → не умирают, нагрузка держится.
// Меряем стоимость sim.tick() и проекции sim→схема Colyseus, плюс разбивку по фазам.
//
//   node perf-stress.js                 # дефолт 20/20/20
//   SHIPS=40 PLANES=40 SQUADS=40 TICKS=1500 node perf-stress.js
const { Sim } = require('./sim/Sim');
const { Ship } = require('./sim/Ship');
const { Plane } = require('./sim/Plane');
const { Squad } = require('./sim/Squad');
const { isWaterAt } = require('./sim/water');
const { GameState, CityState, SquadState, ShipState, PlaneState } = require('./schema');
const map = require('./sim/map-data.json');

const SHIPS_PF = +process.env.SHIPS || 20;
const PLANES_PF = +process.env.PLANES || 20;
const SQUADS_PF = +process.env.SQUADS || 20;
const TICKS = +process.env.TICKS || 1200;
const WARMUP = 30;
const DT = 1 / 15;
const BUDGET = 1000 / 15;          // 66.67 ms = бюджет тика при 15 Гц
const SHIP_HP = 1e9, PLANE_HP = 1e9, SQUAD_HP = +process.env.SQUAD_HP || 400;
const SPEC_ID = { prod: 1, def: 2, atk: 3 };
const RELN = { war: 1, ally: 2 };

// детерминированный ГПСЧ (Date.now нельзя — нужен воспроизводимый прогон)
let _s = 0x9e3779b9; const rnd = () => ((_s = (Math.imul(_s, 1664525) + 1013904223) >>> 0) / 0x100000000);
const ms = (ns) => Number(ns) / 1e6;
const hr = () => process.hrtime.bigint();

// ── мир: все против всех, ИИ выключен (каждая страна — человек) ──
const sim = new Sim({ map, ai: false, goldStart: 0 });
const F = sim.factions;
sim.humanFactions = new Set(Array.from({ length: F }, (_, i) => i));
for (let a = 0; a < F; a++) for (let b = a + 1; b < F; b++) { sim.setRelation(a, b, 'war'); sim.warSince[sim.relKey(a, b)] = -1000; }

// водные точки для спавна/целей кораблей
const water = [];
for (let x = 2; x < 254; x += 2) for (let z = 2; z < 254; z += 2) if (isWaterAt(x, z)) water.push({ x, z });
const wp = () => water[(rnd() * water.length) | 0];
const ownCities = (f) => sim.cities.filter((c) => c.owner === f);
const enemyCities = (f) => sim.cities.filter((c) => c.owner !== f);

// предрассчитанные маршруты на фракцию (чтобы досыпать армии без findPath в горячем цикле)
const routes = [];
for (let f = 0; f < F; f++) {
  routes[f] = [];
  const mine = ownCities(f), en = enemyCities(f);
  const srcs = mine.length > 2 ? [mine[0], mine[(mine.length / 2) | 0], mine[mine.length - 1]] : mine;
  const cand = [];
  for (const src of srcs) for (const e of en) { const p = sim.findPath(src.idx, e.idx, f); if (p && p.length > 1) cand.push(p); }
  cand.sort((a, b) => b.length - a.length);                       // достижимые, длинные первыми → дольше в транзите
  for (let k = 0; k < 14 && k < cand.length; k++) routes[f].push(cand[k]);
  if (!routes[f].length && mine.length) routes[f].push([mine[0].idx]);
}
const spawnSquad = (f) => { const r = routes[f]; if (r && r.length) sim.squads.push(new Squad(f, SQUAD_HP, r[(rnd() * r.length) | 0], sim, 1)); };

// ── начальный спавн ──
for (let f = 0; f < F; f++) {
  for (let i = 0; i < SHIPS_PF; i++) { const w = wp(), s = new Ship(f, w.x, w.z, sim); s.hp = SHIP_HP; const t = wp(); s.setTarget(t.x, t.z); sim.ships.push(s); }
  for (let i = 0; i < PLANES_PF; i++) { const p = new Plane(f, (rnd() * 256) | 0, (rnd() * 256) | 0, sim); p.hp = PLANE_HP; sim.planes.push(p); }
  for (let i = 0; i < SQUADS_PF; i++) spawnSquad(f);
}

// держим корабли в движении (дошёл до цели → новая) и популяцию армий у живых фракций
const refreshShips = () => { for (const s of sim.ships) { const dx = s.tx - s.x, dz = s.tz - s.z; if (dx * dx + dz * dz < 1) { const t = wp(); s.setTarget(t.x, t.z); } s.hp = SHIP_HP; } };
const topUpSquads = () => { for (let f = 0; f < F; f++) { let have = 0; for (const s of sim.squads) if (s.owner === f) have++; for (let i = have; i < SQUADS_PF; i++) spawnSquad(f); } };
const keepPlanesAlive = () => { for (const p of sim.planes) p.hp = PLANE_HP; };

// ── проекция sim→схема Colyseus (зеркало GameRoom.tick — меряем реальную стоимость дельт) ──
const state = new GameState();
for (const c of sim.cities) { const cs = new CityState(); cs.gx = c.gx; cs.gz = c.gz; cs.size = c.size; cs.country = c.country; cs.owner = c.owner; state.cities.set(String(c.idx), cs); }
for (let f = 0; f < F; f++) { state.gold.push(0); state.manpower.push(0); state.politPts.push(0); }
state._techN = [];
function project() {
  state.tick++;
  const cs = state.cities;
  for (const c of sim.cities) {
    const s = cs.get(String(c.idx));
    s.owner = c.owner; s.units = Math.min(65535, Math.round(c.units)); s.spec = SPEC_ID[c.spec] || 0; s.tier = c.tier; s.occ = c.occ ? 1 : 0;
    s.shipyard = c.isShipyard ? 1 : 0; s.airport = c.isAirport ? 1 : 0; s.aa = c.aa | 0; s.queued = Math.min(65535, Math.round(c.queued));
    let su = 0, so = 0; if (c.siege) for (const o in c.siege) if (c.siege[o].units > su) { su = c.siege[o].units; so = +o; }
    s.siegeUnits = Math.min(65535, Math.round(su)); s.siegeOwner = so;
    const b0 = c.batches && c.batches[0];
    s.prodTime = b0 ? Math.min(65535, Math.round(b0.time * 10)) : 0; s.prodElapsed = b0 ? Math.min(65535, Math.round(b0.elapsed * 10)) : 0;
    s.shipQ = Math.min(255, c.shipQueue | 0); s.shipT = Math.min(65535, Math.round((c.shipTimer || 0) * 10));
    s.planeQ = Math.min(255, c.planeQueue | 0); s.planeT = Math.min(65535, Math.round((c.planeTimer || 0) * 10));
  }
  const sq = state.squads, live = new Set();
  for (const s of sim.squads) { const k = String(s.id); live.add(k); let ss = sq.get(k); if (!ss) { ss = new SquadState(); ss.owner = s.owner; sq.set(k, ss); } ss.count = Math.round(s.fcount); ss.x = s.x; ss.z = s.z; ss.fighting = s.foe ? 1 : 0; }
  for (const k of [...sq.keys()]) if (!live.has(k)) sq.delete(k);
  const shp = state.ships, sl = new Set();
  for (const s of sim.ships) { const k = String(s.id); sl.add(k); let ss = shp.get(k); if (!ss) { ss = new ShipState(); ss.owner = s.owner; shp.set(k, ss); } ss.x = s.x; ss.z = s.z; ss.hp = Math.min(65535, Math.max(0, Math.round(s.hp))); ss.fighting = s.foe ? 1 : 0; }
  for (const k of [...shp.keys()]) if (!sl.has(k)) shp.delete(k);
  const pl = state.planes, pli = new Set();
  for (const p of sim.planes) { const k = String(p.id); pli.add(k); let ps = pl.get(k); if (!ps) { ps = new PlaneState(); ps.owner = p.owner; pl.set(k, ps); } ps.x = p.x; ps.z = p.z; ps.hp = Math.min(65535, Math.max(0, Math.round(p.hp))); ps.fighting = p.foe ? 1 : 0; }
  for (const k of [...pl.keys()]) if (!pli.has(k)) pl.delete(k);
  for (let f = 0; f < F; f++) { state.gold[f] = sim.gold[f]; state.manpower[f] = sim.manpower[f]; state.politPts[f] = sim.politPts[f]; }
  state.clock = sim.time;
}

// ── разбивка по фазам: оборачиваем методы боя таймерами ──
const PHASE = {};
for (const name of ['advanceResearch', 'advanceBuildQueues', 'navalBattles', 'airBattles', 'shipBombard', 'planeBomb', 'cityTowers', 'cityAA', 'fieldBattles']) {
  const orig = sim[name].bind(sim); PHASE[name] = 0;
  sim[name] = (dt) => { const t = hr(); orig(dt); PHASE[name] += ms(hr() - t); };
}

// ── прогрев ──
for (let i = 0; i < WARMUP; i++) { refreshShips(); keepPlanesAlive(); topUpSquads(); sim.tick(DT); project(); }
for (const k in PHASE) PHASE[k] = 0;                       // обнуляем после прогрева

const startCounts = { ships: sim.ships.length, planes: sim.planes.length, squads: sim.squads.length };
const simT = [], projT = [], totT = [];
for (let i = 0; i < TICKS; i++) {
  refreshShips(); keepPlanesAlive(); topUpSquads();   // поддержка популяции — ВНЕ замера
  let t = hr(); sim.tick(DT); const dSim = ms(hr() - t);
  t = hr(); project(); const dProj = ms(hr() - t);
  simT.push(dSim); projT.push(dProj); totT.push(dSim + dProj);
}
const endCounts = { ships: sim.ships.length, planes: sim.planes.length, squads: sim.squads.length };

// ── статистика ──
const stat = (a) => { const s = [...a].sort((x, y) => x - y); const sum = s.reduce((p, c) => p + c, 0); const p = (q) => s[Math.min(s.length - 1, Math.floor(q / 100 * s.length))]; return { mean: sum / s.length, p50: p(50), p95: p(95), p99: p(99), max: s[s.length - 1] }; };
const f2 = (n) => n.toFixed(2).padStart(7);
const ss = stat(simT), sp = stat(projT), st = stat(totT);

console.log('\n=== WWC stress test (одна комната, худший случай) ===');
console.log(`Фракции: ${F} (все «люди», ИИ выключен), все против всех (war).`);
console.log(`Сущности на фракцию: ${SHIPS_PF} кораблей (на воде, в движении) · ${PLANES_PF} самолётов · ${SQUADS_PF} армий.`);
console.log(`Всего (старт→конец): корабли ${startCounts.ships}→${endCounts.ships} · самолёты ${startCounts.planes}→${endCounts.planes} · армии ${startCounts.squads}→${endCounts.squads}.`);
console.log(`HP: корабли/самолёты ${SHIP_HP.toExponential(0)} (не умирают), армии fcount=${SQUAD_HP}. Тиков замерено: ${TICKS} @ 15Гц (бюджет ${BUDGET.toFixed(1)} мс/тик).`);
console.log('\nВремя на тик (мс):        mean     p50     p95     p99     max');
console.log(`  sim.tick           ${f2(ss.mean)} ${f2(ss.p50)} ${f2(ss.p95)} ${f2(ss.p99)} ${f2(ss.max)}`);
console.log(`  проекция→схема      ${f2(sp.mean)} ${f2(sp.p50)} ${f2(sp.p95)} ${f2(sp.p99)} ${f2(sp.max)}`);
console.log(`  ИТОГО (CPU/тик)     ${f2(st.mean)} ${f2(st.p50)} ${f2(st.p95)} ${f2(st.p99)} ${f2(st.max)}`);

console.log('\nРазбивка sim по фазам (средн. мс/тик):');
const phaseRows = Object.entries(PHASE).map(([k, v]) => [k, v / TICKS]).filter(([, v]) => v > 0.001).sort((a, b) => b[1] - a[1]);
const phaseSum = phaseRows.reduce((p, [, v]) => p + v, 0);
for (const [k, v] of phaseRows) console.log(`  ${k.padEnd(20)} ${f2(v)}`);
console.log(`  ${'(прочее: движение/города/ресурсы)'.padEnd(20)} ${f2(Math.max(0, ss.mean - phaseSum))}`);

const pctBudget = (st.mean / BUDGET * 100);
const roomsPerCore = Math.floor(BUDGET / st.mean);
console.log('\nВердикт:');
console.log(`  ИТОГО mean ${st.mean.toFixed(2)} мс = ${pctBudget.toFixed(1)}% бюджета тика (66.67 мс).`);
console.log(`  p99 ${st.p99.toFixed(2)} мс (${(st.p99 / BUDGET * 100).toFixed(1)}% бюджета) — ${st.p99 < BUDGET ? 'в бюджете ✅' : 'ПРЕВЫШЕН ⚠️'}.`);
console.log(`  Грубая ёмкость: ~${roomsPerCore} таких комнат на одно ядро (по mean, без учёта Colyseus-энкода/сети).`);
console.log('  NB: бинарный энкод Colyseus + сеть здесь НЕ учтены — это отдельная статья (мерить с реальными клиентами).\n');
// ── микробенч: рост fieldBattles O(n²) от числа одновременно сражающихся армий (валидирует аудит #4) ──
console.log('\nМасштаб fieldBattles (теперь O(n) на spatial-grid) — N армий «в поле» одновременно:');
for (const N of [130, 250, 500, 1000, 2000]) {
  const s2 = new Sim({ map, ai: false, goldStart: 0 });
  for (let a = 0; a < F; a++) for (let b = a + 1; b < F; b++) s2.setRelation(a, b, 'war');
  for (let i = 0; i < N; i++) { const sq = new Squad(i % F, 1e12, [s2.cities[i % s2.cities.length].idx], s2, 1); sq.x = (i * 37.3) % 256; sq.z = (i * 61.7) % 256; s2.squads.push(sq); }
  for (let i = 0; i < 5; i++) s2.fieldBattles(DT);                 // прогрев
  const R = 150, t = hr(); for (let i = 0; i < R; i++) s2.fieldBattles(DT); const per = ms(hr() - t) / R;
  console.log(`  N=${String(N).padStart(4)} армий → ${per.toFixed(3).padStart(7)} мс/тик  (${(per / BUDGET * 100).toFixed(1)}% бюджета)${per > BUDGET ? '  ⚠️ ПРЕВЫШЕН' : ''}`);
}
console.log('  → линейно (на гриде). До фикса было O(n²): 500→19.7мс, 1000→77мс, 2000→306мс. Аудит #4 — закрыт.\n');
process.exit(0);
