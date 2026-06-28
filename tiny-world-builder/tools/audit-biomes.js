#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const json = (file) => JSON.parse(read(file));

const editor = read('hex-europe.html');
const world = read('js/hex-world.js');
const preload = read('js/hex-preload.js');
const map = json('hex-map.json');
const manual = json('data/hex-europe-manual-edits.json');

const errors = [];
const warnings = [];
const fail = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

function grabConstBlock(src, name, openChar) {
  const start = src.indexOf(`const ${name} = ${openChar}`);
  if (start < 0) return '';
  const closeChar = openChar === '{' ? '}' : ']';
  const blockStart = src.indexOf(openChar, start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = blockStart; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === openChar) depth++;
    else if (ch === closeChar && --depth === 0) return src.slice(blockStart, i + 1);
  }
  return '';
}

function objectKeys(src, name) {
  const block = grabConstBlock(src, name, '{');
  const out = [];
  const re = /(?:^|[,\n]\s*)(?:['"]([^'"]+)['"]|([A-Za-z_$][\w$]*))\s*:/g;
  let match;
  while ((match = re.exec(block))) out.push(match[1] || match[2]);
  return [...new Set(out)];
}

function colorMap(src, name) {
  const block = grabConstBlock(src, name, '{');
  const out = {};
  const re = /(?:^|[,\n]\s*)(?:['"]([^'"]+)['"]|([A-Za-z_$][\w$]*))\s*:\s*new\s+(?:THREE|T)\.Color\(0x([0-9a-fA-F]+)\)/g;
  let match;
  while ((match = re.exec(block))) out[match[1] || match[2]] = parseInt(match[3], 16);
  return out;
}

function countryBiomeMap() {
  const block = grabConstBlock(editor, 'COUNTRY_BIOME', '{');
  const out = {};
  const re = /['"]([^'"]+)['"]\s*:\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = re.exec(block))) out[match[1]] = match[2];
  return out;
}

function biomeOptions() {
  const block = grabConstBlock(editor, 'BIOME_OPTIONS', '[');
  const out = [];
  const re = /\[\s*['"]([^'"]+)['"]\s*,\s*['"][^'"]+['"]\s*\]/g;
  let match;
  while ((match = re.exec(block))) out.push(match[1]);
  return [...new Set(out)];
}

function compareColorMaps(a, b, label) {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  for (const key of keys) {
    if (a[key] !== b[key]) {
      fail(`${label}: ${key} differs (${hex(a[key])} vs ${hex(b[key])})`);
    }
  }
}

function hex(value) {
  return typeof value === 'number' ? `0x${value.toString(16).padStart(6, '0')}` : 'missing';
}

function isLandEditAsset(asset) {
  return asset === 'countryLand'
    || asset === 'grass'
    || asset === 'grassBottom'
    || asset === 'grassSlopeHigh'
    || asset === 'grassSlopeLow'
    || String(asset || '').startsWith('coast')
    || String(asset || '').startsWith('road');
}

const editorTint = colorMap(editor, 'BIOME_TINT');
const worldTint = colorMap(world, 'BIOME_TINT');
const preloadTint = colorMap(preload, 'BIOME_TINT');
const editorRoadTint = colorMap(editor, 'BIOME_ROAD_TINT');
const worldRoadTint = colorMap(world, 'BIOME_ROAD_TINT');
const fallbackKeys = objectKeys(editor, 'BIOME_COUNTRY_FALLBACK');
const optionKeys = biomeOptions();
const countryBiome = countryBiomeMap();
const oldCountries = new Set(['Австрия', 'Венгрия', 'Балканы']);

compareColorMaps(editorTint, worldTint, 'BIOME_TINT editor/js');
compareColorMaps(editorTint, preloadTint, 'BIOME_TINT editor/preload');
compareColorMaps(editorRoadTint, worldRoadTint, 'BIOME_ROAD_TINT editor/js');

const usedBiomes = new Set(Object.values(countryBiome));
for (const tile of map.tiles || []) if (tile[11]) usedBiomes.add(tile[11]);
for (const decor of map.decor || []) if (decor[6]) usedBiomes.add(decor[6]);
for (const edit of Object.values(manual.edits || {})) if (edit.biome) usedBiomes.add(edit.biome);
usedBiomes.delete('default');

for (const biome of [...usedBiomes].sort()) {
  if (!editorTint[biome]) fail(`missing BIOME_TINT for ${biome}`);
  if (!worldTint[biome]) fail(`missing js BIOME_TINT for ${biome}`);
  if (!preloadTint[biome]) fail(`missing preload BIOME_TINT for ${biome}`);
  if (!optionKeys.includes(biome)) fail(`missing BIOME_OPTIONS entry for ${biome}`);
  if (!fallbackKeys.includes(biome)) fail(`missing BIOME_COUNTRY_FALLBACK entry for ${biome}`);
  if (!editorRoadTint[biome]) warn(`road tint for ${biome} falls back to tile tint`);
}

let land = 0;
let roads = 0;
let decorCount = 0;
for (const tile of map.tiles || []) {
  const [q, r, water, , col, , , roadKey, , , , biome] = tile;
  if (water) continue;
  land++;
  if (!biome || biome === 'default') fail(`map tile ${q},${r} has no biome`);
  if (typeof col !== 'number' || col < 0) fail(`map tile ${q},${r} has bad color`);
  if (biome && editorTint[biome] != null && col !== editorTint[biome]) {
    fail(`map tile ${q},${r} color ${hex(col)} does not match ${biome} ${hex(editorTint[biome])}`);
  }
  if (roadKey) {
    roads++;
    if (!biome || biome === 'default') fail(`road tile ${q},${r} has no biome`);
  }
}
for (const decor of map.decor || []) {
  const [asset, wx, wz, , , , biome] = decor;
  decorCount++;
  if (!biome || biome === 'default') fail(`decor ${asset} at ${wx},${wz} has no biome`);
}

let manualLand = 0;
for (const edit of Object.values(manual.edits || {})) {
  const asset = edit.asset || '';
  if (oldCountries.has(edit.country)) fail(`manual edit ${edit.q},${edit.r} uses old country ${edit.country}`);
  if (!isLandEditAsset(asset)) continue;
  manualLand++;
  if (!edit.country) fail(`manual land edit ${edit.q},${edit.r} has no country`);
  if (!edit.biome || edit.biome === 'default') fail(`manual land edit ${edit.q},${edit.r} has no biome`);
  if (typeof edit.col !== 'number' || edit.col < 0) fail(`manual land edit ${edit.q},${edit.r} has bad color`);
  const expectedBiome = countryBiome[edit.country];
  if (expectedBiome && edit.biome !== expectedBiome) {
    fail(`manual land edit ${edit.q},${edit.r} has ${edit.country}/${edit.biome}, expected ${expectedBiome}`);
  }
  if (editorTint[edit.biome] != null && edit.col !== editorTint[edit.biome]) {
    fail(`manual land edit ${edit.q},${edit.r} color ${hex(edit.col)} does not match ${edit.biome} ${hex(editorTint[edit.biome])}`);
  }
}

const paintIdx = editor.indexOf('paintCityBiomeAuras();');
const bakedIdx = editor.indexOf('applyBakedRoadTileBiomes();');
const buildIdx = editor.indexOf('const landMeshes = buildLandTiles();');
if (!(paintIdx >= 0 && bakedIdx > paintIdx && buildIdx > bakedIdx)) {
  fail('editor build order must be paintCityBiomeAuras -> applyBakedRoadTileBiomes -> buildLandTiles');
}
if (!world.includes('colHex >= 0 ? new T.Color().setHex(colHex)')) {
  fail('hex-world must respect baked colHex before BIOME_TINT fallback');
}

if (errors.length) {
  console.error('[hex-biomes] failed');
  for (const error of errors) console.error(' - ' + error);
  if (warnings.length) {
    console.error('[hex-biomes] warnings');
    for (const item of warnings) console.error(' - ' + item);
  }
  process.exit(1);
}

console.log(`[hex-biomes] ok: ${usedBiomes.size} biomes, ${land} land tiles, ${roads} road tiles, ${decorCount} decor, ${manualLand} manual land edits`);
if (warnings.length) {
  console.log('[hex-biomes] warnings:');
  for (const item of warnings) console.log(' - ' + item);
}
