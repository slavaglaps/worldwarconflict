/* СКОПИРОВАНО из server/sim/ скриптом scripts/sync-sim.js — НЕ РЕДАКТИРОВАТЬ. Источник: server/sim/vision.js */
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
function stampWaterDisc(mask, GRID, x, z, radius, water) {
  const cx = Math.round(x), cz = Math.round(z), r = Math.max(0, Math.round(radius));
  for (let dx = -r; dx <= r; dx++) {
    const px = cx + dx; if (px < 0 || px >= GRID) continue;
    for (let dz = -r; dz <= r; dz++) {
      const pz = cz + dz; if (pz < 0 || pz >= GRID || dx * dx + dz * dz > r * r) continue;
      const i = px * GRID + pz;
      if (water ? water[i] : isWaterAt(px, pz)) mask[i] = 1;
    }
  }
}

function staticVisionKey(sim, fid, friendly) {
  let h = 2166136261 >>> 0;
  const mix = (v) => { h ^= v | 0; h = Math.imul(h, 16777619) >>> 0; };
  mix(fid); mix(sim.K.GRID); mix(sim.K.VISION_COAST || 0); mix(sim.K.VISION_COAST_SEARCH || 1);
  for (let i = 0; i < friendly.length; i++) mix(friendly[i]);
  for (const c of sim.cities) { mix(c.owner); mix(Math.round(c.gx * 4)); mix(Math.round(c.gz * 4)); }
  return h;
}

// Вода и потенциальные береговые клетки не зависят от фракции. Считаем их
// один раз на матч вместо тысяч повторных вызовов isWaterAt на каждый клиент.
function worldVisionCache(sim, GRID, coastSearch) {
  let posHash = 2166136261 >>> 0;
  for (const c of sim.cities) {
    posHash ^= Math.round(c.gx * 4); posHash = Math.imul(posHash, 16777619) >>> 0;
    posHash ^= Math.round(c.gz * 4); posHash = Math.imul(posHash, 16777619) >>> 0;
  }
  const key = GRID + ':' + coastSearch + ':' + sim.cities.length + ':' + posHash;
  if (sim._visionWorld && sim._visionWorld.key === key) return sim._visionWorld;
  const N = GRID * GRID, water = new Uint8Array(N), coast = [];
  for (let x = 0; x < GRID; x++) for (let z = 0; z < GRID; z++) {
    const i = x * GRID + z;
    if (isWaterAt(x, z)) water[i] = 1;
  }
  const r = Math.max(1, Math.round(coastSearch));
  for (let x = 0; x < GRID; x++) for (let z = 0; z < GRID; z++) {
    const i = x * GRID + z; if (water[i]) continue;
    let near = false;
    for (let dx = -r; dx <= r && !near; dx++) {
      const px = x + dx; if (px < 0 || px >= GRID) continue;
      for (let dz = -r; dz <= r; dz++) {
        const pz = z + dz;
        if (pz >= 0 && pz < GRID && dx * dx + dz * dz <= r * r && water[px * GRID + pz]) { near = true; break; }
      }
    }
    if (near) coast.push(i);
  }
  sim._visionWorld = { key, water, coast: Uint32Array.from(coast) };
  sim._visionStaticCache = [];
  return sim._visionWorld;
}

function staticVisionBase(sim, fid, friendly) {
  const GRID = sim.K.GRID, N = GRID * GRID, cities = sim.cities;
  if (!sim._voronoi || sim._voronoiN !== cities.length) {
    sim._voronoi = buildVoronoi(cities, GRID);
    sim._voronoiN = cities.length;
    sim._visionStaticCache = [];
  }
  const coastSearch = sim.K.VISION_COAST_SEARCH || 1;
  const world = worldVisionCache(sim, GRID, coastSearch);
  const key = staticVisionKey(sim, fid, friendly);
  const cache = sim._visionStaticCache || (sim._visionStaticCache = []);
  if (cache[fid] && cache[fid].key === key) return cache[fid].mask;

  const mask = new Uint8Array(N), cityOwn = new Uint8Array(cities.length), vor = sim._voronoi;
  for (let i = 0; i < cities.length; i++) cityOwn[i] = friendly[cities[i].owner] || 0;
  for (let i = 0; i < N; i++) {
    const ci = vor[i];
    if (ci !== 65535 && cityOwn[ci] && !world.water[i]) mask[i] = 1;
  }
  const coastRadius = sim.K.VISION_COAST || 0;
  if (coastRadius > 0) for (let i = 0; i < world.coast.length; i++) {
    const cell = world.coast[i];
    if (mask[cell]) stampWaterDisc(mask, GRID, Math.floor(cell / GRID), cell % GRID, coastRadius, world.water);
  }
  cache[fid] = { key, mask };
  return mask;
}

// Полная маска видимости фракции. sim — Sim; out — переиспользуемый Uint8Array (опц.).
function computeVision(sim, fid, out) {
  const GRID = sim.K.GRID;
  const K = sim.K;
  const N = GRID * GRID;
  const mask = (out && out.length === N) ? out : new Uint8Array(N);
  // «свой» = сам + союзники (общий вижен)
  const friendly = new Uint8Array(sim.factions);
  for (let o = 0; o < sim.factions; o++) friendly[o] = (o === fid || sim.allied(fid, o)) ? 1 : 0;

  // 1) Статическая территория + побережье пересобираются только при захвате
  // города или смене союза. В обычном тике это один memcpy на 64 КБ.
  const cities = sim.cities;
  mask.set(staticVisionBase(sim, fid, friendly));

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
