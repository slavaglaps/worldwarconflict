#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const hexPath = path.join(root, 'hex-map.json');
const simPath = path.join(root, 'sim', 'map-data.json');
const reportPath = path.join(root, 'data', 'road-audit-report.json');

const hex = JSON.parse(fs.readFileSync(hexPath, 'utf8'));
const sim = JSON.parse(fs.readFileSync(simPath, 'utf8'));

const allowedNoLandRoad = new Set(['Пальма', 'Копенгаген', 'Торсхавн', 'Ираклион']);
const edgeKey = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
const failures = [];
const warnings = [];

function edgeLength(edge) {
  const pts = Array.isArray(edge.pts) ? edge.pts : [];
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  }
  return len || Number(edge.len) || 0;
}

const meta = hex.meta || {};
const scale = (Number(meta.R) || 1) * (Number(meta.HEXS) || 1);
const worldW = Number(meta.worldW) || 1;
const worldH = Number(meta.worldH) || 1;
const hexCells = [];
for (const t of hex.tiles || []) {
  const q = Number(t[0]), r = Number(t[1]);
  const wx = Math.sqrt(3) * scale * (q + (r & 1) * 0.5) - worldW / 2;
  const wz = 1.5 * scale * r - worldH / 2;
  hexCells.push({ wx, wz, ocean: !!t[2] && !t[5], bridge: false });
}

function nearestHexCell(wx, wz) {
  let best = null, bestD = Infinity;
  for (const cell of hexCells) {
    const d = (cell.wx - wx) ** 2 + (cell.wz - wz) ** 2;
    if (d < bestD) { bestD = d; best = cell; }
  }
  return best;
}

for (const bridge of hex.bridges || []) {
  const cell = nearestHexCell(Number(bridge[0]), Number(bridge[1]));
  if (cell) cell.bridge = true;
}

function roadCrossesOcean(points) {
  if (!Array.isArray(points) || points.length < 2) return false;
  const step = Math.max(0.25, scale * 0.45);
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1];
    const [bx, bz] = points[i];
    const samples = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let s = 0; s <= samples; s++) {
      const t = s / samples;
      const cell = nearestHexCell(ax + (bx - ax) * t, az + (bz - az) * t);
      if (cell && cell.ocean && !cell.bridge) return true;
    }
  }
  return false;
}

const hexRoadKeys = new Set();
const duplicateBakedRoads = [];
const oceanBakedRoads = [];
for (const road of hex.roads || []) {
  const a = Number(road[0]), b = Number(road[1]);
  const key = edgeKey(a, b);
  if (hexRoadKeys.has(key)) duplicateBakedRoads.push(key);
  hexRoadKeys.add(key);
  if (roadCrossesOcean(road[2] || [])) oceanBakedRoads.push(key);
}

const simEdgeKeys = new Set();
const duplicateGameplayEdges = [];
const nonRoadEdges = [];
const missingBakedRoads = [];
const degree = Array(sim.cities.length).fill(0);
const adj = Array.from({ length: sim.cities.length }, () => []);

for (const edge of sim.edges || []) {
  const key = edgeKey(edge.a, edge.b);
  if (simEdgeKeys.has(key)) duplicateGameplayEdges.push(key);
  simEdgeKeys.add(key);
  if (!hexRoadKeys.has(key)) missingBakedRoads.push(key);
  if (edge.type !== 'road') nonRoadEdges.push(key);
  degree[edge.a]++; degree[edge.b]++;
  const len = edgeLength(edge);
  adj[edge.a].push({ to: edge.b, len });
  adj[edge.b].push({ to: edge.a, len });
}

const missingGameplayEdges = [...hexRoadKeys].filter(key => !simEdgeKeys.has(key));

if (duplicateBakedRoads.length) failures.push(`${duplicateBakedRoads.length} duplicate baked roads`);
if (duplicateGameplayEdges.length) failures.push(`${duplicateGameplayEdges.length} duplicate gameplay edges`);
if (missingBakedRoads.length) failures.push(`${missingBakedRoads.length} gameplay edges without baked road`);
if (missingGameplayEdges.length) failures.push(`${missingGameplayEdges.length} baked roads missing from gameplay`);
if (nonRoadEdges.length) failures.push(`${nonRoadEdges.length} non-road gameplay edges`);
if (oceanBakedRoads.length) failures.push(`${oceanBakedRoads.length} baked roads cross ocean`);

const componentByCity = Array(sim.cities.length).fill(-1);
const components = [];
for (const city of sim.cities) {
  if (componentByCity[city.idx] !== -1) continue;
  const queue = [city.idx], comp = [];
  componentByCity[city.idx] = components.length;
  for (let qi = 0; qi < queue.length; qi++) {
    const u = queue[qi];
    comp.push(u);
    for (const edge of adj[u]) {
      if (componentByCity[edge.to] !== -1) continue;
      componentByCity[edge.to] = components.length;
      queue.push(edge.to);
    }
  }
  components.push(comp);
}

const countries = new Map();
for (const city of sim.cities) {
  if (!countries.has(city.country)) {
    countries.set(city.country, {
      country: city.country,
      cities: [],
      components: new Set(),
      isolated: [],
      needsFerryOrManualRoad: [],
      deadEnds: [],
      cityCount: 0,
      edgeCount: 0,
    });
  }
  const item = countries.get(city.country);
  const cityInfo = {
    idx: city.idx,
    name: city.name,
    degree: degree[city.idx],
    component: componentByCity[city.idx],
    status: degree[city.idx] ? 'ok' : (allowedNoLandRoad.has(city.name) ? 'needs-ferry-or-manual-road' : 'missing-road'),
  };
  item.cities.push(cityInfo);
  item.components.add(componentByCity[city.idx]);
  item.cityCount++;
  if (cityInfo.degree === 0) {
    item.isolated.push(cityInfo);
    if (allowedNoLandRoad.has(city.name)) item.needsFerryOrManualRoad.push(cityInfo);
  }
  if (cityInfo.degree === 1) item.deadEnds.push(cityInfo);
}

for (const edge of sim.edges || []) {
  const a = sim.cities[edge.a], b = sim.cities[edge.b];
  if (a && b && a.country === b.country && countries.has(a.country)) countries.get(a.country).edgeCount++;
}

const countryReports = [...countries.values()]
  .sort((a, b) => a.country.localeCompare(b.country, 'ru'))
  .map(country => ({
    ...country,
    components: [...country.components].sort((a, b) => a - b),
  }));

for (const country of countryReports) {
  for (const city of country.isolated) {
    if (!allowedNoLandRoad.has(city.name)) failures.push(`${city.name} (${country.country}) has no land road edges`);
  }
}

const report = {
  ok: failures.length === 0,
  generatedAt: new Date().toISOString(),
  totals: {
    cities: sim.cities.length,
    countries: countryReports.length,
    bakedRoads: (hex.roads || []).length,
    gameplayEdges: (sim.edges || []).length,
    components: components.length,
    oceanCrossings: oceanBakedRoads.length,
    isolatedCities: sim.cities.filter(c => degree[c.idx] === 0).length,
  },
  failures,
  warnings,
  allowedNoLandRoad: [...allowedNoLandRoad],
  globalComponents: components
    .map((ids, id) => ({ id, size: ids.length, cities: ids.map(idx => sim.cities[idx].name) }))
    .sort((a, b) => b.size - a.size),
  countries: countryReports,
};

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');

if (failures.length) {
  console.error('[road-audit] failed');
  for (const failure of failures) console.error(' - ' + failure);
  console.error(`[road-audit] report: ${path.relative(root, reportPath)}`);
  process.exit(1);
}

console.log(`[road-audit] ok: ${report.totals.cities} cities, ${report.totals.countries} countries, ${report.totals.gameplayEdges} land-road edges`);
console.log(`[road-audit] components=${report.totals.components}, oceanCrossings=${report.totals.oceanCrossings}, isolated=${report.totals.isolatedCities}`);
console.log(`[road-audit] report: ${path.relative(root, reportPath)}`);
