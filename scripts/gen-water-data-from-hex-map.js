#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const GRID = 256;
const LON0 = -13, LON1 = 51, LAT0 = 34, LAT1 = 70;

function waterDataFromHexMap(hexMap) {
  if (!hexMap || !hexMap.meta || !Array.isArray(hexMap.tiles)) {
    throw new Error('Expected baked hex-map.json with meta and tiles');
  }
  const m = hexMap.meta;
  const B = m.B || {};
  const Rg = Number(m.R) * Number(m.HEXS);
  const worldW = Number(m.worldW), worldH = Number(m.worldH);
  const lngSpan = Number(m.lngSpan), latSpan = Number(m.latSpan);
  const minX = Number(B.minX), maxY = Number(B.maxY);
  if (![Rg, worldW, worldH, lngSpan, latSpan, minX, maxY].every(Number.isFinite)) {
    throw new Error('hex-map meta has invalid projection fields');
  }

  const ox = worldW / 2, oz = worldH / 2;
  const colStep = Math.sqrt(3) * Rg;
  const known = new Set();
  const sea = new Set();
  for (const t of hexMap.tiles) {
    if (!Array.isArray(t) || t.length < 3) continue;
    const q = Number(t[0]), r = Number(t[1]);
    if (!Number.isFinite(q) || !Number.isFinite(r)) continue;
    const key = q + ',' + r;
    known.add(key);
    if (t[2]) sea.add(key);
  }

  const bytes = Buffer.alloc((GRID * GRID + 7) >> 3);
  let waterCount = 0;
  for (let x = 0; x < GRID; x++) {
    const lng = LON0 + (x / GRID) * (LON1 - LON0);
    const wx = ((lng - minX) / lngSpan) * worldW - ox;
    for (let z = 0; z < GRID; z++) {
      const lat = LAT1 - (z / GRID) * (LAT1 - LAT0);
      const wz = ((maxY - lat) / latSpan) * worldH - oz;
      const r = Math.round((wz + oz) / (1.5 * Rg));
      const q = Math.round((wx + ox) / colStep - ((r & 1) * 0.5));
      const key = q + ',' + r;
      if (!known.has(key) || sea.has(key)) {
        const i = x * GRID + z;
        bytes[i >> 3] |= 1 << (i & 7);
        waterCount++;
      }
    }
  }

  return { GRID, waterCount, water: bytes.toString('base64') };
}

function writeWaterData(hexMapPath, outPath) {
  const hexMap = JSON.parse(fs.readFileSync(hexMapPath, 'utf8'));
  const data = waterDataFromHexMap(hexMap);
  const tmp = outPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, outPath);
  return data;
}

module.exports = { waterDataFromHexMap, writeWaterData };

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const hexMapPath = path.resolve(root, process.argv[2] || 'client/hex-map.json');
  const outPath = path.resolve(root, process.argv[3] || 'server/sim/water-data.json');
  const data = writeWaterData(hexMapPath, outPath);
  console.log(`✓ ${path.relative(root, outPath)}: ${data.waterCount} water cells`);
}
