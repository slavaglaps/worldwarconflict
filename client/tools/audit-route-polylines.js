#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const hexPath = path.join(root, 'hex-map.json');
const simPath = path.join(root, 'sim', 'map-data.json');
const hex = JSON.parse(fs.readFileSync(hexPath, 'utf8'));
const sim = JSON.parse(fs.readFileSync(simPath, 'utf8'));

const meta = hex.meta || {};
const bounds = meta.B || {};
const scale = (Number(meta.R) || 1) * (Number(meta.HEXS) || 1);
const worldW = Number(meta.worldW) || 1;
const worldH = Number(meta.worldH) || 1;
const ox = worldW / 2;
const oz = worldH / 2;
const SQ3 = Math.sqrt(3);
const failures = [];

const edgeKey = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
const cellKey = (q, r) => `${q},${r}`;
const NB_EVEN = [[1, 0], [-1, 0], [0, 1], [-1, 1], [0, -1], [-1, -1]];
const NB_ODD = [[1, 0], [-1, 0], [1, 1], [0, 1], [1, -1], [0, -1]];

function qrToWX(q, r) {
  return SQ3 * scale * (q + (r & 1) * 0.5) - ox;
}

function qrToWZ(_q, r) {
  return 1.5 * scale * r - oz;
}

function wxToGX(wx) {
  const lng = bounds.minX + ((wx + ox) / worldW) * Number(meta.lngSpan || 1);
  return (lng - (-13)) / (51 - (-13)) * 256;
}

function wzToGZ(wz) {
  const lat = bounds.maxY - ((wz + oz) / worldH) * Number(meta.latSpan || 1);
  return (70 - lat) / (70 - 34) * 256;
}

const cells = [];
const cellByKey = new Map();
for (const t of hex.tiles || []) {
  const q = Number(t[0]);
  const r = Number(t[1]);
  const cell = {
    q,
    r,
    wx: qrToWX(q, r),
    wz: qrToWZ(q, r),
    road: !!t[7],
    bridge: false,
  };
  cells.push(cell);
  cellByKey.set(cellKey(q, r), cell);
}

function nearestCell(wx, wz) {
  let best = null;
  let bestD = Infinity;
  for (const cell of cells) {
    const d = (cell.wx - wx) ** 2 + (cell.wz - wz) ** 2;
    if (d < bestD) {
      bestD = d;
      best = cell;
    }
  }
  return best;
}

for (const bridge of hex.bridges || []) {
  const cell = nearestCell(Number(bridge[0]), Number(bridge[1]));
  if (cell) cell.bridge = true;
}

function isRoadCell(cell) {
  return !!(cell && (cell.road || cell.bridge));
}

function neighbors(cell) {
  return (cell.r & 1 ? NB_ODD : NB_EVEN)
    .map(([dq, dr]) => cellByKey.get(cellKey(cell.q + dq, cell.r + dr)))
    .filter(Boolean);
}

function areNeighbors(a, b) {
  if (!a || !b) return false;
  if (a.q === b.q && a.r === b.r) return true;
  return neighbors(a).some(n => n.q === b.q && n.r === b.r);
}

function offsetDistance(a, b) {
  if (!a || !b) return Infinity;
  const queue = [{ cell: a, d: 0 }];
  const seen = new Set([cellKey(a.q, a.r)]);
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    if (cur.cell.q === b.q && cur.cell.r === b.r) return cur.d;
    if (cur.d >= 4) continue;
    for (const n of neighbors(cur.cell)) {
      const key = cellKey(n.q, n.r);
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({ cell: n, d: cur.d + 1 });
    }
  }
  return Infinity;
}

function edgeLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  }
  return len;
}

const simEdges = new Map();
for (const edge of sim.edges || []) simEdges.set(edgeKey(edge.a, edge.b), edge);

const seenHex = new Set();
for (const road of hex.roads || []) {
  const a = Number(road[0]);
  const b = Number(road[1]);
  const key = edgeKey(a, b);
  if (seenHex.has(key)) failures.push(`duplicate baked road ${key}`);
  seenHex.add(key);

  const raw = Array.isArray(road[2]) ? road[2] : [];
  if (!Number.isInteger(a) || !Number.isInteger(b) || a === b) {
    failures.push(`invalid baked road endpoints ${JSON.stringify([road[0], road[1]])}`);
    continue;
  }
  if (raw.length < 2) {
    failures.push(`baked road ${key} has no usable polyline`);
    continue;
  }

  const cellsOnPath = raw.map(p => nearestCell(Number(p[0]), Number(p[1])));
  for (let i = 1; i < cellsOnPath.length; i++) {
    const cityConnector = i === 1 || i === cellsOnPath.length - 1;
    const allowedCityConnector = cityConnector && offsetDistance(cellsOnPath[i - 1], cellsOnPath[i]) <= 4;
    if (!areNeighbors(cellsOnPath[i - 1], cellsOnPath[i]) && !allowedCityConnector) {
      failures.push(`baked road ${key} jumps from ${cellKey(cellsOnPath[i - 1].q, cellsOnPath[i - 1].r)} to ${cellKey(cellsOnPath[i].q, cellsOnPath[i].r)}`);
      break;
    }
  }

  for (let i = 1; i < cellsOnPath.length - 1; i++) {
    if (!isRoadCell(cellsOnPath[i])) {
      failures.push(`baked road ${key} uses non-road internal cell ${cellKey(cellsOnPath[i].q, cellsOnPath[i].r)}`);
      break;
    }
  }

  const simEdge = simEdges.get(key);
  if (!simEdge) {
    failures.push(`baked road ${key} missing from gameplay graph`);
    continue;
  }
  const converted = raw.map(p => ({
    x: Math.round(wxToGX(Number(p[0])) * 10) / 10,
    z: Math.round(wzToGZ(Number(p[1])) * 10) / 10,
  }));
  if (!Array.isArray(simEdge.pts) || simEdge.pts.length !== converted.length) {
    failures.push(`edge ${key} sim polyline length mismatch`);
    continue;
  }
  for (let i = 0; i < converted.length; i++) {
    if (Math.abs((simEdge.pts[i].x || 0) - converted[i].x) > 0.051 || Math.abs((simEdge.pts[i].z || 0) - converted[i].z) > 0.051) {
      failures.push(`edge ${key} sim polyline point ${i} is not synced`);
      break;
    }
  }
  const len = Math.round(edgeLength(converted) * 100) / 100;
  if (Math.abs((simEdge.len || 0) - len) > 0.011) failures.push(`edge ${key} sim length mismatch: ${simEdge.len} vs ${len}`);
}

for (const key of simEdges.keys()) {
  if (!seenHex.has(key)) failures.push(`gameplay edge ${key} missing from baked roads`);
}

if (failures.length) {
  console.error('[route-polylines] failed');
  for (const failure of failures) console.error(' - ' + failure);
  process.exit(1);
}

console.log(`[route-polylines] ok: ${(hex.roads || []).length} baked routes match visible road-grid polylines`);
