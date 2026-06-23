// GUARD: прод-бандл tiny-world-builder/dist/ КОММИТИТСЯ и серуется статик-хостингом напрямую.
// Падает, если кто-то изменил клиент/sim/билд и не пересобрал → молчаливый деплой устаревшего
// бандла невозможен. Чинится: `node scripts/build.js` (из корня) и коммит tiny-world-builder/dist/.
const { group, test, assert, summary } = require('./harness');
const fs = require('fs');
const path = require('path');
const { buildManifest, CLIENT } = require('../../scripts/build-manifest.js');

group('Свежесть прод-сборки (dist/ ⟷ исходники)');

const DIST = path.join(CLIENT, 'dist');
const manifestPath = path.join(DIST, 'build-manifest.json');

test('dist/ собрана (бандлы + манифест на месте)', () => {
  for (const f of ['game.bundle.js', 'sim.bundle.js', 'build-manifest.json']) {
    assert(fs.existsSync(path.join(DIST, f)), `нет dist/${f} — запусти: node scripts/build.js`);
  }
});

test('бандл свежий относительно исходников (client+sim)', () => {
  if (!fs.existsSync(manifestPath)) return; // первый тест уже сообщил
  const committed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const current = buildManifest();
  assert(committed.client === current.client,
    `клиент изменился без пересборки → \`node scripts/build.js\` и коммит dist/ (было ${committed.client}, стало ${current.client})`);
  assert(committed.sim === current.sim,
    `server/sim изменился без пересборки → \`node scripts/build.js\` и коммит dist/ (было ${committed.sim}, стало ${current.sim})`);
});

summary('BUILD-FRESH (prod bundle freshness)');
