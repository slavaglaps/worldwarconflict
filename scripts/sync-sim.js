#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────
// Копирует серверный симулятор server/sim/ → tiny-world-builder/sim/ (для браузера).
// Единый источник правды — server/sim/. Клиент получает идентичную копию (Фаза 2:
// соло гоняет НАСТОЯЩИЙ серверный Sim в браузере, без дубля логики).
//
//   Синк:    node scripts/sync-sim.js
//   Guard:   server/test/sim-sync.test.js падает, если копия устарела.
//
// Копируем только то, что нужно симу в браузере (без тестов). water.js уже
// среда-агностичен (Buffer в Node / atob в браузере).
// ──────────────────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'server', 'sim');
const DST = path.join(__dirname, '..', 'tiny-world-builder', 'sim');

// файлы, нужные браузерному симу (граф require + опц. map). Тесты/прочее — НЕ копируем.
const FILES = [
  'constants.js', 'tech-data.js', 'tech.js', 'balance.js',
  'SpatialGrid.js', 'Squad.js', 'Ship.js', 'Plane.js', 'City.js', 'Sim.js',
  'water.js', 'water-data.json', 'map-data.json',
];

const HEADER = '/* СКОПИРОВАНО из server/sim/ скриптом scripts/sync-sim.js — НЕ РЕДАКТИРОВАТЬ. Источник: server/sim/%F */\n';

// содержимое файла-копии (как уедет в клиент): .js c шапкой-маркером, .json как есть
function content(file) {
  const raw = fs.readFileSync(path.join(SRC, file), 'utf8');
  return file.endsWith('.json') ? raw : HEADER.replace('%F', file) + raw;
}

module.exports = { SRC, DST, FILES, content };

if (require.main === module) {
  fs.mkdirSync(DST, { recursive: true });
  for (const f of FILES) fs.writeFileSync(path.join(DST, f), content(f));
  console.log('✓ synced', FILES.length, 'файлов → tiny-world-builder/sim/');
}
