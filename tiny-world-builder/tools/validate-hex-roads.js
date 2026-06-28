#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const simPath = path.join(root, 'sim', 'map-data.json');
const hexPath = path.join(root, 'hex-map.json');
const sim = JSON.parse(fs.readFileSync(simPath, 'utf8'));
const hex = JSON.parse(fs.readFileSync(hexPath, 'utf8'));

const MAX_ENDPOINT_DRIFT = 22;
const MAX_INTERMEDIATE_CITY_DRIFT = 2.7;
const MIN_SHORTCUT_LEN = 16;
const MAX_SHORTCUT_RATIO = 1.8;
// KayKit road pieces are wider than a mathematical hex-center graph: curves and
// city approaches can visually occupy the adjacent tile edge. Keep the guard
// strict enough to catch true off-road shortcuts, but do not fail normal bends.
const ROAD_TILE_RADIUS = 2.5;
const ROAD_ENDPOINT_RADIUS = 2.8;
const edgeKey = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
const failures = [];
const seen = new Set();
const seenHex = new Set();
const allowedIsolatedCities = new Set(['Пальма', 'Копенгаген', 'Торсхавн', 'Ираклион']);
const degree = Array.isArray(sim.cities) ? Array(sim.cities.length).fill(0) : [];

function pointSegmentDistance(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  if (!len2) return Math.hypot(px - ax, pz - az);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

const hexMeta = hex.meta || {};
const hexBounds = hexMeta.B || {};
const hexScale = (Number(hexMeta.R) || 1) * (Number(hexMeta.HEXS) || 1);
const worldW = Number(hexMeta.worldW) || 1;
const worldH = Number(hexMeta.worldH) || 1;
const hexCells = [];
for (const t of hex.tiles || []) {
  const q = Number(t[0]), r = Number(t[1]);
  const wx = Math.sqrt(3) * hexScale * (q + (r & 1) * 0.5) - worldW / 2;
  const wz = 1.5 * hexScale * r - worldH / 2;
  hexCells.push({ q, r, wx, wz, ocean: !!t[2] && !t[5], road: !!t[7], bridge: false });
}

function nearestHexCell(wx, wz) {
  let best = null, bestD = Infinity;
  for (const cell of hexCells) {
    const d = (cell.wx - wx) ** 2 + (cell.wz - wz) ** 2;
    if (d < bestD) { bestD = d; best = cell; }
  }
  return best;
}

for (const b of hex.bridges || []) {
  const cell = nearestHexCell(Number(b[0]), Number(b[1]));
  if (cell) cell.bridge = true;
}

function nearestVisibleRoadCell(wx, wz) {
  let best = null, bestD = Infinity;
  for (const cell of hexCells) {
    if (!cell.road && !cell.bridge) continue;
    const d = (cell.wx - wx) ** 2 + (cell.wz - wz) ** 2;
    if (d < bestD) { bestD = d; best = cell; }
  }
  return { cell: best, dist: Math.sqrt(bestD) };
}

function roadCrossesOcean(points) {
  if (!Array.isArray(points) || points.length < 2) return false;
  const sampleStep = Math.max(0.25, hexScale * 0.45);
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1];
    const [bx, bz] = points[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / sampleStep));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cell = nearestHexCell(ax + (bx - ax) * t, az + (bz - az) * t);
      if (cell && cell.ocean && !cell.bridge) return true;
    }
  }
  return false;
}

function roadLeavesVisibleRoad(points) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const sampleStep = Math.max(0.2, hexScale * 0.35);
  const roadRadius = hexScale * ROAD_TILE_RADIUS;
  const endpointRadius = hexScale * ROAD_ENDPOINT_RADIUS;
  const first = points[0], last = points[points.length - 1];
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1];
    const [bx, bz] = points[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / sampleStep));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const wx = ax + (bx - ax) * t;
      const wz = az + (bz - az) * t;
      if (Math.hypot(wx - first[0], wz - first[1]) <= endpointRadius) continue;
      if (Math.hypot(wx - last[0], wz - last[1]) <= endpointRadius) continue;
      const nearest = nearestVisibleRoadCell(wx, wz);
      if (!nearest.cell || nearest.dist > roadRadius) {
        return { wx, wz, dist: nearest.dist };
      }
    }
  }
  return null;
}

function edgeLength(edge) {
  const pts = Array.isArray(edge.pts) ? edge.pts : [];
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  }
  return len || Number(edge.len) || 1;
}

function shortestWithout(edgeIndex, lengths) {
  const edge = sim.edges[edgeIndex];
  const adj = Array.from({ length: sim.cities.length }, () => []);
  for (let i = 0; i < sim.edges.length; i++) {
    if (i === edgeIndex) continue;
    const e = sim.edges[i], len = lengths[i];
    adj[e.a].push([e.b, len]); adj[e.b].push([e.a, len]);
  }
  const dist = Array(sim.cities.length).fill(Infinity), prev = Array(sim.cities.length).fill(-1), used = Array(sim.cities.length).fill(false);
  dist[edge.a] = 0;
  for (let guard = 0; guard < sim.cities.length; guard++) {
    let u = -1, best = Infinity;
    for (let i = 0; i < sim.cities.length; i++) if (!used[i] && dist[i] < best) { best = dist[i]; u = i; }
    if (u < 0 || u === edge.b) break;
    used[u] = true;
    for (const [v, w] of adj[u]) if (dist[u] + w < dist[v]) { dist[v] = dist[u] + w; prev[v] = u; }
  }
  const route = [];
  if (Number.isFinite(dist[edge.b])) for (let u = edge.b; u >= 0; u = prev[u]) route.push(u);
  route.reverse();
  return { dist: dist[edge.b], route };
}

if (!Array.isArray(hex.roads) || !hex.roads.length) {
  failures.push('hex-map.json has no baked roads');
}

if (!Array.isArray(sim.cities) || !Array.isArray(sim.edges)) {
  failures.push('sim/map-data.json must contain cities[] and edges[]');
}

const allSimEdgeKeys = new Set((sim.edges || []).map(e => edgeKey(e.a, e.b)));

for (const rd of hex.roads || []) {
  const a = Number(rd[0]);
  const b = Number(rd[1]);
  const key = edgeKey(a, b);
  if (!Number.isInteger(a) || !Number.isInteger(b) || a === b) {
    failures.push(`invalid baked road endpoint ${JSON.stringify([rd[0], rd[1]])}`);
    continue;
  }
  if (seenHex.has(key)) failures.push(`duplicate baked road ${key}`);
  seenHex.add(key);
  if (!Array.isArray(rd[2]) || rd[2].length < 2) failures.push(`baked road ${key} has no usable polyline`);
  if (roadCrossesOcean(rd[2])) failures.push(`baked road ${key} crosses ocean`);
  const offRoad = roadLeavesVisibleRoad(rd[2]);
  if (offRoad) failures.push(`baked road ${key} leaves visible road tiles near ${offRoad.wx.toFixed(1)},${offRoad.wz.toFixed(1)} (dist ${offRoad.dist.toFixed(1)})`);
}

for (const e of sim.edges || []) {
  const key = edgeKey(e.a, e.b);
  if (seen.has(key)) failures.push(`duplicate edge ${key}`);
  seen.add(key);
  if (degree[e.a] != null) degree[e.a]++;
  if (degree[e.b] != null) degree[e.b]++;
  if (!seenHex.has(key)) failures.push(`gameplay edge ${key} is not backed by a baked road`);
  if (e.type !== 'road') failures.push(`edge ${key} must be a road, got ${e.type}`);

  const a = sim.cities[e.a];
  const b = sim.cities[e.b];
  const pts = Array.isArray(e.pts) ? e.pts : [];
  const first = pts[0];
  const last = pts[pts.length - 1];

  if (!a || !b) {
    failures.push(`edge ${key} references missing city`);
    continue;
  }
  if (a.idx === b.idx) failures.push(`edge ${key} loops to the same city`);
  if (pts.length < 2 || !first || !last) {
    failures.push(`edge ${key} has no usable polyline`);
    continue;
  }

  const driftA = Math.min(
    Math.hypot(a.gx - first.x, a.gz - first.z),
    Math.hypot(a.gx - last.x, a.gz - last.z),
  );
  const driftB = Math.min(
    Math.hypot(b.gx - first.x, b.gz - first.z),
    Math.hypot(b.gx - last.x, b.gz - last.z),
  );
  if (driftA > MAX_ENDPOINT_DRIFT || driftB > MAX_ENDPOINT_DRIFT) {
    failures.push(`edge ${key} endpoint drift too large: ${driftA.toFixed(1)} / ${driftB.toFixed(1)}`);
  }

  for (const city of sim.cities || []) {
    if (!city || city.idx === e.a || city.idx === e.b) continue;
    let minDist = Infinity;
    for (let i = 1; i < pts.length; i++) {
      minDist = Math.min(minDist, pointSegmentDistance(city.gx, city.gz, pts[i - 1].x, pts[i - 1].z, pts[i].x, pts[i].z));
    }
    const canRouteThroughCity = allSimEdgeKeys.has(edgeKey(e.a, city.idx)) && allSimEdgeKeys.has(edgeKey(city.idx, e.b));
    if (canRouteThroughCity && minDist < MAX_INTERMEDIATE_CITY_DRIFT) {
      failures.push(`edge ${key} jumps over intermediate city ${city.name} (${minDist.toFixed(1)})`);
    }
  }
}

for (const key of seenHex) {
  if (!seen.has(key)) failures.push(`baked road ${key} is missing from gameplay graph`);
}

for (const city of sim.cities || []) {
  if (!allowedIsolatedCities.has(city.name) && degree[city.idx] === 0) {
    failures.push(`${city.name} has no gameplay road edges`);
  }
}

for (const name of ['Бирмингмем', 'Малый Лондон', 'Дублин', 'Белфаст', 'Галвэй', 'Лимэрик']) {
  const city = sim.cities.find(c => c.name === name);
  if (!city) {
    failures.push(`${name} is missing from sim cities`);
    continue;
  }
  const degree = sim.edges.filter(e => e.a === city.idx || e.b === city.idx).length;
  if (!degree) failures.push(`${name} has no gameplay road edges`);
}

const edgeLengths = (sim.edges || []).map(edgeLength);
for (let i = 0; i < (sim.edges || []).length; i++) {
  const e = sim.edges[i], len = edgeLengths[i];
  if (len <= MIN_SHORTCUT_LEN) continue;
  const alt = shortestWithout(i, edgeLengths);
  if (!Number.isFinite(alt.dist) || alt.dist > len * MAX_SHORTCUT_RATIO) continue;
  const ca = sim.cities[e.a]?.country, cb = sim.cities[e.b]?.country;
  if (ca && ca === cb && !alt.route.every(idx => sim.cities[idx]?.country === ca)) continue;
  failures.push(`edge ${edgeKey(e.a, e.b)} is a redundant shortcut: ${len.toFixed(1)} vs ${alt.dist.toFixed(1)}`);
}

if (failures.length) {
  console.error('[hex-roads] validation failed');
  for (const failure of failures) console.error(' - ' + failure);
  process.exit(1);
}

console.log(`[hex-roads] ok: ${sim.cities.length} cities, ${sim.edges.length} gameplay edges, ${hex.roads.length} baked roads`);
