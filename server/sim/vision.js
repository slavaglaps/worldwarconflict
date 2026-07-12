// ── Туман войны: маска видимости фракции ────────────────────────────────────
// Видимость fid = вся территория своя + союзная (Вороной по ближайшему городу —
// та же логика, что политическая раскраска assignRegions на клиенте)
// + круги вокруг своих/союзных отрядов, кораблей и самолётов («разведка боем»).
//
// Чистый модуль (без Three/DOM) — синкается в client/sim/ и используется:
//   • сервером (GameRoom) для per-client фильтрации снапшотов (анти-чит),
//   • клиентом для отрисовки тёмного тумана (одна математика — ноль дрейфа).
'use strict';

const { isWaterAt } = require('./water');

// Вороной: для каждого хекса — индекс ближайшего города. Считается один раз
// (города не двигаются; динамические верфи/аэродромы рядом с родителем того же
// владельца — сдвигом ячеек пренебрегаем). 65535 = городов нет.
function buildVoronoi(cities, GRID) {
  const out = new Uint16Array(GRID * GRID).fill(65535);
  if (!cities.length) return out;
  for (let x = 0; x < GRID; x++) {
    for (let z = 0; z < GRID; z++) {
      let best = 65535, bd = Infinity;
      for (let i = 0; i < cities.length; i++) {
        const c = cities[i];
        const dd = (x - c.gx) * (x - c.gx) + (z - c.gz) * (z - c.gz);
        if (dd < bd) { bd = dd; best = i; }
      }
      out[x * GRID + z] = best;
    }
  }
  return out;
}

// Кэш круговых оффсетов: radius → Int32Array плоских смещений [dx*GRID+dz, ...]
const _discCache = new Map();
function discOffsets(radius, GRID) {
  const key = radius + '_' + GRID;
  let d = _discCache.get(key);
  if (d) return d;
  const r = Math.max(0, Math.round(radius)), arr = [];
  for (let dx = -r; dx <= r; dx++)
    for (let dz = -r; dz <= r; dz++)
      if (dx * dx + dz * dz <= r * r) arr.push(dx * GRID + dz);
  d = { offs: Int32Array.from(arr), r };
  _discCache.set(key, d);
  return d;
}

// Штамп круга в маску (с клампом по краям карты).
function stampDisc(mask, GRID, x, z, radius) {
  const cx = Math.round(x), cz = Math.round(z);
  if (!(cx >= 0 && cz >= 0 && cx < GRID && cz < GRID)) return;
  const { offs, r } = discOffsets(radius, GRID);
  // быстрый путь: круг целиком внутри карты → без покоординатных проверок
  if (cx >= r && cz >= r && cx < GRID - r && cz < GRID - r) {
    const base = cx * GRID + cz;
    for (let i = 0; i < offs.length; i++) mask[base + offs[i]] = 1;
    return;
  }
  for (let dx = -r; dx <= r; dx++) {
    const px = cx + dx; if (px < 0 || px >= GRID) continue;
    for (let dz = -r; dz <= r; dz++) {
      const pz = cz + dz; if (pz < 0 || pz >= GRID) continue;
      if (dx * dx + dz * dz <= r * r) mask[px * GRID + pz] = 1;
    }
  }
}

// Раскрывает только воду вокруг видимого берега. Это даёт естественную
// прибрежную полосу обзора, не возвращая бесконечный океан от Вороного.
function stampWaterDisc(mask, GRID, x, z, radius) {
  const cx = Math.round(x), cz = Math.round(z), r = Math.max(0, Math.round(radius));
  for (let dx = -r; dx <= r; dx++) {
    const px = cx + dx; if (px < 0 || px >= GRID) continue;
    for (let dz = -r; dz <= r; dz++) {
      const pz = cz + dz; if (pz < 0 || pz >= GRID || dx * dx + dz * dz > r * r) continue;
      if (isWaterAt(px, pz)) mask[px * GRID + pz] = 1;
    }
  }
}

function hasWaterNear(GRID, x, z, radius) {
  const r = Math.max(1, Math.round(radius));
  for (let dx = -r; dx <= r; dx++) {
    const px = x + dx; if (px < 0 || px >= GRID) continue;
    for (let dz = -r; dz <= r; dz++) {
      const pz = z + dz; if (pz < 0 || pz >= GRID || dx * dx + dz * dz > r * r) continue;
      if (isWaterAt(px, pz)) return true;
    }
  }
  return false;
}

// Полная маска видимости фракции. sim — Sim; out — переиспользуемый Uint8Array (опц.).
function computeVision(sim, fid, out) {
  const GRID = sim.K.GRID;
  const K = sim.K;
  const N = GRID * GRID;
  const mask = (out && out.length === N) ? out.fill(0) : new Uint8Array(N);
  // «свой» = сам + союзники (общий вижен)
  const friendly = new Uint8Array(sim.factions);
  for (let o = 0; o < sim.factions; o++) friendly[o] = (o === fid || sim.allied(fid, o)) ? 1 : 0;

  // 1) территория: сухопутный хекс виден, если его ближайший город принадлежит своим.
  // Океан нельзя открывать Вороной: на островах ближайший дружественный город иначе
  // подсвечивает море до следующей страны. Воду раскрывают только источники ниже.
  if (!sim._voronoi || sim._voronoiN !== sim.cities.length) {
    sim._voronoi = buildVoronoi(sim.cities, GRID);
    sim._voronoiN = sim.cities.length;
  }
  const vor = sim._voronoi, cities = sim.cities;
  const cityOwn = new Uint8Array(cities.length);
  for (let i = 0; i < cities.length; i++) cityOwn[i] = friendly[cities[i].owner] || 0;
  for (let x = 0; x < GRID; x++) for (let z = 0; z < GRID; z++) {
    const i = x * GRID + z, ci = vor[i];
    if (ci !== 65535 && cityOwn[ci] && !isWaterAt(x, z)) mask[i] = 1;
  }

  // Полоса моря вдоль своей/союзной территории. На hex-карте береговая вода
  // не всегда лежит прямо в 8 соседях растра, поэтому ищем воду в малом радиусе,
  // но всё ещё штампуем только от уже видимой суши, чтобы не открыть океан Вороного.
  const coastRadius = K.VISION_COAST || 0;
  const coastSearch = K.VISION_COAST_SEARCH || 1;
  if (coastRadius > 0) for (let x = 0; x < GRID; x++) for (let z = 0; z < GRID; z++) {
    const i = x * GRID + z;
    if (!mask[i] || isWaterAt(x, z)) continue;
    if (hasWaterNear(GRID, x, z, coastSearch)) stampWaterDisc(mask, GRID, x, z, coastRadius);
  }

  // 2) свои отряды/корабли/самолёты — «фонарики» (разведка боем)
  const rSquad = K.VISION_SQUAD, rShip = K.VISION_SHIP, rPlane = K.VISION_PLANE;
  for (const s of sim.squads) if (friendly[s.owner]) stampDisc(mask, GRID, s.x, s.z, rSquad);
  for (const s of sim.ships) if (friendly[s.owner]) stampDisc(mask, GRID, s.x, s.z, rShip);
  for (const p of sim.planes) if (friendly[p.owner]) stampDisc(mask, GRID, p.x, p.z, rPlane);
  // 🗼 сторожевые вышки/башни (опционально: массив {owner,x,z} кладётся снаружи —
  //    в соло/на клиенте из MAP_BUILDINGS; серверный сим построек пока не знает)
  if (sim.towers) for (const t of sim.towers) if (friendly[t.owner]) stampDisc(mask, GRID, t.x, t.z, K.VISION_TOWER);
  // 3) свои осадные пулы: отряд при осаде исчезает из squads и живёт в city.siege —
  //    осаждающий продолжает видеть город и округу (иначе вижен гаснет в момент боя)
  for (const c of cities) {
    if (!c.siege) continue;
    for (const o in c.siege) if (friendly[o] && c.siege[o].units > 0) { stampDisc(mask, GRID, c.gx, c.gz, rSquad); break; }
  }
  return mask;
}

// Кэширующая обёртка: пересчёт не чаще VISION_REFRESH сек (кладётся на sim).
function visionMask(sim, fid) {
  const cache = sim._visionCache || (sim._visionCache = []);
  const e = cache[fid];
  const maxAge = sim.K.VISION_REFRESH;
  if (e && sim.time - e.t < maxAge && e.t <= sim.time) return e.mask;
  const mask = computeVision(sim, fid, e && e.mask);
  cache[fid] = { t: sim.time, mask };
  return mask;
}

// Видна ли точка мира (x,z) фракции fid.
function visibleAt(sim, fid, x, z) {
  const GRID = sim.K.GRID;
  const cx = Math.round(x), cz = Math.round(z);
  if (!(cx >= 0 && cz >= 0 && cx < GRID && cz < GRID)) return false;
  return visionMask(sim, fid)[cx * GRID + cz] === 1;
}

module.exports = { buildVoronoi, computeVision, visionMask, visibleAt, discOffsets };
