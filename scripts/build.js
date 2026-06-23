#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// ПРОД-сборка клиента (esbuild). DEV остаётся «без сборки» (рантайм-склейка в
// game.html). Прод грузит минифицированный бандл одним обычным <script src> —
// без CSP 'unsafe-inline', с source map, в разы меньше байт.
//
//   Сборка:  node scripts/build.js   (или npm run build из корня)
//   Выход:   tiny-world-builder/dist/game.bundle.js(.map)  — клиент (глобальный scope)
//            tiny-world-builder/dist/sim.bundle.js(.map)    — серверный Sim → window.__WWCSim
//
// Клиент: модули склеиваются в ТОМ ЖЕ порядке, что и рантайм-лоадер (единый
// global scope), затем minifyWhitespace+minifySyntax. minifyIdentifiers=ВЫКЛ —
// топ-левел имена видны снаружи (window.*, инлайн-обработчики), переименовывать нельзя.
// Sim: настоящий esbuild-bundle CJS server/sim → IIFE (полная минификация безопасна).
// ─────────────────────────────────────────────────────────────────────────────
'use strict';
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const { MODS, buildManifest, CLIENT } = require('./build-manifest.js');

const DIST = path.join(CLIENT, 'dist');

async function buildClient() {
  let combined = '';
  for (const m of MODS) combined += '\n/* ===== ' + m + ' ===== */\n' + fs.readFileSync(path.join(CLIENT, m), 'utf8');
  const out = await esbuild.transform(combined, {
    loader: 'js',
    minifyWhitespace: true, minifySyntax: true, minifyIdentifiers: false,  // НЕ переименовываем глобали
    sourcemap: true, sourcefile: 'game.bundle.js',
  });
  fs.writeFileSync(path.join(DIST, 'game.bundle.js'), out.code + '\n//# sourceMappingURL=game.bundle.js.map\n');
  fs.writeFileSync(path.join(DIST, 'game.bundle.js.map'), out.map);
  return out.code.length;
}

async function buildSim() {
  const entry = path.join(__dirname, 'sim-entry.js');
  await esbuild.build({
    entryPoints: [entry], bundle: true, minify: true, sourcemap: true,
    format: 'iife', platform: 'browser', outfile: path.join(DIST, 'sim.bundle.js'),
  });
  return fs.statSync(path.join(DIST, 'sim.bundle.js')).size;
}

module.exports = { buildManifest, MODS };

if (require.main === module) (async () => {
  fs.mkdirSync(DIST, { recursive: true });
  const rawClient = MODS.reduce((s, m) => s + fs.statSync(path.join(CLIENT, m)).size, 0);
  const cBytes = await buildClient();
  const sBytes = await buildSim();
  fs.writeFileSync(path.join(DIST, 'build-manifest.json'), JSON.stringify(buildManifest(), null, 2) + '\n');
  const k = (n) => (n / 1024).toFixed(0) + 'KB';
  console.log('✓ game.bundle.js —', k(cBytes), '(из', k(rawClient), 'сырьём,', Math.round((1 - cBytes / rawClient) * 100) + '% меньше) + sourcemap');
  console.log('✓ sim.bundle.js  —', k(sBytes), '+ sourcemap');
  console.log('✓ build-manifest.json — guard свежести (server/test/build-fresh.test.js)');
})().catch((e) => { console.error('build failed:', e); process.exit(1); });
