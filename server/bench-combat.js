// Доказательство масштаба: воздушный бой naive O(n²) vs spatial-grid O(n).
// Меряем чистую стоимость таргетинга+урона на масштабе пользователя (480 / 1200 самолётов),
// и проверяем корректность (сетка находит ту же ближайшую цель, что и перебор).
const C = require('./sim/constants');
const { SpatialGrid } = require('./sim/SpatialGrid');

const N_OWNERS = 24;
const atWar = (a, b) => a !== b;                 // как в стресс-тесте: все против всех

// area=256 — равномерно по карте (реалистично); area мал — «свалка» (худший случай)
function makePlanes(n, area = 256) {
  const p = [];
  for (let i = 0; i < n; i++) p.push({
    owner: i % N_OWNERS, hp: 1e9, foe: null,
    pos: { x: (i * 37.2) % area, z: (i * 53.7) % area },
    heading: (i * 0.137) % (Math.PI * 2),
  });
  return p;
}

function moveAll(planes, dt) {
  for (const p of planes) {
    if (p.foe) continue;
    p.pos.x += Math.cos(p.heading) * C.PLANE_SPEED * dt;
    p.pos.z += Math.sin(p.heading) * C.PLANE_SPEED * dt;
    if (p.pos.x < 0) { p.pos.x = 0; p.heading = Math.PI - p.heading; }
    if (p.pos.x > 255) { p.pos.x = 255; p.heading = Math.PI - p.heading; }
    if (p.pos.z < 0) { p.pos.z = 0; p.heading = -p.heading; }
    if (p.pos.z > 255) { p.pos.z = 255; p.heading = -p.heading; }
  }
}

// ── naive O(n²) (1:1 как airBattles в game.html) ──
function airNaive(planes, dt, mutual = true) {
  const R2 = C.PLANE_RANGE * C.PLANE_RANGE;
  for (const s of planes) {
    if (s.foe && s.foe.hp <= 0) s.foe = null;
    if (s.foe) continue;
    let best = null, bd = R2;
    for (const o of planes) {
      if (o === s || o.hp <= 0 || !atWar(s.owner, o.owner)) continue;
      const dx = s.pos.x - o.pos.x, dz = s.pos.z - o.pos.z, dd = dx * dx + dz * dz;
      if (dd < bd) { bd = dd; best = o; }
    }
    if (best) { s.foe = best; if (mutual && !best.foe) best.foe = s; }
  }
  for (const s of planes) if (s.foe && s.foe.hp > 0) s.foe.hp -= C.PLANE_DMG * dt;
}

// ── spatial-grid O(n) ──
const grid = new SpatialGrid(C.PLANE_RANGE);
function airGrid(planes, dt, mutual = true) {
  grid.clear();
  for (const p of planes) if (p.hp > 0) grid.insert(p, p.pos.x, p.pos.z);
  const R2 = C.PLANE_RANGE * C.PLANE_RANGE;
  for (const s of planes) {
    if (s.foe && s.foe.hp <= 0) s.foe = null;
    if (s.foe) continue;
    let best = null, bd = R2;
    grid.queryWithin(s.pos.x, s.pos.z, C.PLANE_RANGE, (o) => {
      if (o === s || o.hp <= 0 || !atWar(s.owner, o.owner)) return;
      const dx = s.pos.x - o.pos.x, dz = s.pos.z - o.pos.z, dd = dx * dx + dz * dz;
      if (dd < bd) { bd = dd; best = o; }
    });
    if (best) { s.foe = best; if (mutual && !best.foe) best.foe = s; }
  }
  for (const s of planes) if (s.foe && s.foe.hp > 0) s.foe.hp -= C.PLANE_DMG * dt;
}

function bench(fn, n, ticks, dt, area = 256, move = true) {
  const planes = makePlanes(n, area);
  for (let i = 0; i < 3; i++) { if (move) moveAll(planes, dt); fn(planes, dt); }   // прогрев
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < ticks; i++) { if (move) moveAll(planes, dt); fn(planes, dt); }
  return Number(process.hrtime.bigint() - t0) / 1e6 / ticks;
}

// корректность: без взаимного назначения сравниваем дистанцию до выбранной цели
function correctness(n) {
  const A = makePlanes(n), B = makePlanes(n);
  airNaive(A, 0, false); airGrid(B, 0, false);
  const d2 = (p) => p.foe ? (p.pos.x - p.foe.pos.x) ** 2 + (p.pos.z - p.foe.pos.z) ** 2 : -1;
  let mism = 0;
  for (let i = 0; i < n; i++) {
    const a = A[i].foe ? 1 : 0, b = B[i].foe ? 1 : 0;
    if (a !== b) { mism++; continue; }
    if (a && Math.abs(d2(A[i]) - d2(B[i])) > 1e-6) mism++;
  }
  return mism;
}

console.log('воздушный бой: naive O(n²) vs spatial-grid O(n), dt=0.066 (15 Гц)\n');
console.log('— РАВНОМЕРНО по карте (реалистично) —');
for (const n of [480, 1200]) {
  const mism = correctness(n);
  const naive = bench(airNaive, n, 30, 0.066);
  const grid_ = bench(airGrid, n, 30, 0.066);
  console.log(`n=${String(n).padStart(4)}  naive=${naive.toFixed(2).padStart(6)}мс  grid=${grid_.toFixed(2).padStart(5)}мс  ` +
    `speedup=${(naive / grid_).toFixed(1).padStart(5)}×  foe-mismatch=${mism}`);
}
console.log('\n— «СВАЛКА»: все в зоне 40×40, без движения (вырожденный худший случай) —');
for (const n of [480, 1200]) {
  const naive = bench(airNaive, n, 20, 0.066, 40, false);
  const grid_ = bench(airGrid, n, 20, 0.066, 40, false);
  console.log(`n=${String(n).padStart(4)}  naive=${naive.toFixed(2).padStart(6)}мс  grid=${grid_.toFixed(2).padStart(5)}мс  ` +
    `speedup=${(naive / grid_).toFixed(1).padStart(5)}×`);
}
