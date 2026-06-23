// Хеш входов прод-сборки — БЕЗ зависимости от esbuild, чтобы guard-тест (server/test)
// мог его require без установки root-devDeps. Используется и build.js, и build-fresh.test.js.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const CLIENT = path.join(ROOT, 'tiny-world-builder');

// порядок = MODS из game.html (рантайм-лоадер) и из build.js. ДОЛЖЕН совпадать.
const MODS = [
  'js/_rules.gen.js', 'js/_tech.gen.js', 'js/_balance.gen.js',
  'js/sim-loader.js', 'js/solo-sim.js',
  'js/data.js', 'js/world.js', 'js/heroes.js', 'js/decor.js', 'js/roads.js',
  'js/city.js', 'js/units.js', 'js/logic.js', 'js/ui.js', 'js/input.js',
  'js/hud.js', 'js/loop.js', 'game.net.js',
];

const sha = (files) => { const h = crypto.createHash('sha256'); for (const p of files) h.update(fs.readFileSync(p)); return h.digest('hex').slice(0, 16); };

function buildManifest() {
  const clientFiles = MODS.map((m) => path.join(CLIENT, m)).concat(path.join(__dirname, 'build.js'), path.join(__dirname, 'build-manifest.js'));
  const simDir = path.join(ROOT, 'server', 'sim');
  const simFiles = fs.readdirSync(simDir).filter((f) => /\.(js|json)$/.test(f)).sort().map((f) => path.join(simDir, f)).concat(path.join(__dirname, 'sim-entry.js'));
  return { client: sha(clientFiles), sim: sha(simFiles) };
}

module.exports = { MODS, buildManifest, CLIENT };
