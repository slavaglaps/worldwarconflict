#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────
// Генератор клиентских данных правил ИЗ серверного канона.
// Единый источник правды: server/sim/{constants,tech-data}.js. Клиент (соло и
// MP-рендер) и сервер (авторитет) берут ОДНИ И ТЕ ЖЕ числа/узлы — конец дрейфу.
//
//   Регенерация:  node scripts/gen-client-rules.js
//   Защита:       server/test/rules-sync.test.js падает, если файлы устарели.
//
// Эмитим:
//   tiny-world-builder/js/_rules.gen.js  — числовые константы (var X = n)
//   tiny-world-builder/js/_tech.gen.js   — древо технологий (var NODES/NODE)
// Всё как браузерные глобали (var → перезаписываемы balance-синком в MP).
// Функции (aaCost/upgradeCost/recomputeTech) НЕ эмитим — у клиента свои реализации.
// ──────────────────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const path = require('path');
const C = require('../server/sim/constants.js');
const { NODES } = require('../server/sim/tech-data.js');
const { DEFAULTS } = require('../server/sim/balance.js');

const JS = path.join(__dirname, '..', 'tiny-world-builder', 'js');
const OUT_RULES = path.join(JS, '_rules.gen.js');
const OUT_TECH = path.join(JS, '_tech.gen.js');
const OUT_BAL = path.join(JS, '_balance.gen.js');

const banner = (src) => [
  '/* ╔═══════════════════════════════════════════════════════════════════╗',
  '   ║  АВТОГЕНЕРАЦИЯ — НЕ РЕДАКТИРОВАТЬ РУКАМИ.                          ║',
  '   ║  Источник правды:  ' + src.padEnd(46) + '║',
  '   ║  Регенерация:      node scripts/gen-client-rules.js               ║',
  '   ║  Guard от дрейфа:  server/test/rules-sync.test.js                 ║',
  '   ╚═══════════════════════════════════════════════════════════════════╝ */',
].join('\n');

function generateConstants() {
  const nums = Object.keys(C).filter((k) => typeof C[k] === 'number');
  return [
    banner('server/sim/constants.js'),
    '// Числовые игровые константы как глобали (var → перезаписываемы balance-синком в MP).',
    nums.map((k) => `var ${k} = ${JSON.stringify(C[k])};`).join('\n'),
    '',
  ].join('\n');
}

function generateBalance() {
  // politics (формулы дипломатии/мира) + ai (поведение ботов) дефолты как объекты-конфиги.
  // Это то, что сервер читает из B.politics / B.ai; клиентский СОЛО раньше хардкодил эти числа.
  return [
    banner('server/sim/balance.js (politics + ai)'),
    '// Дефолты дипломатии и ИИ как глобали-конфиги (var → перезаписываемы balance-синком в MP).',
    '// Соло читает их вместо хардкода → формулы мира/поддержки/союзов и ИИ совпадают с сервером.',
    'var POLITICS = ' + JSON.stringify(DEFAULTS.politics, null, 2) + ';',
    'var AI = ' + JSON.stringify(DEFAULTS.ai, null, 2) + ';',
    '// Фракционные множители (factionDefault.mods) — сервер умножает techMul на mods[branch].',
    '// Соло симметрично (все ×1); применяется в techMul (data.js), чтобы совпадать с сервером.',
    'var FACTION_MODS = ' + JSON.stringify(DEFAULTS.factionDefault.mods) + ';',
    '',
  ].join('\n');
}

function generateTech() {
  return [
    banner('server/sim/tech-data.js'),
    '// Древо технологий (узлы: gameplay + display поля) как глобали. NODE — индекс по id.',
    'var NODES = [',
    NODES.map((n) => '  ' + JSON.stringify(n) + ',').join('\n'),
    '];',
    'var NODE = Object.fromEntries(NODES.map(function (n) { return [n.id, n]; }));',
    '',
  ].join('\n');
}

module.exports = {
  OUT_RULES, OUT_TECH, OUT_BAL,
  generateConstants, generateTech, generateBalance,
  constCount: () => Object.keys(C).filter((k) => typeof C[k] === 'number').length,
  nodeCount: () => NODES.length,
};

if (require.main === module) {
  fs.writeFileSync(OUT_RULES, generateConstants());
  fs.writeFileSync(OUT_TECH, generateTech());
  fs.writeFileSync(OUT_BAL, generateBalance());
  const rel = (p) => path.relative(path.join(__dirname, '..'), p);
  console.log('✓ wrote', rel(OUT_RULES), '—', module.exports.constCount(), 'констант');
  console.log('✓ wrote', rel(OUT_TECH), '—', module.exports.nodeCount(), 'узлов теха');
  console.log('✓ wrote', rel(OUT_BAL), '— politics + ai дефолты');
}
