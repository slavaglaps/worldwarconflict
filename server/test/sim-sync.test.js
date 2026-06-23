// GUARD: браузерная копия симулятора tiny-world-builder/sim/ обязана совпадать с
// server/sim/ (Фаза 2: соло гоняет настоящий серверный Sim). Падает, если кто-то
// поменял server/sim/ и не пересинкал копию → молчаливый дрейф логики невозможен.
const { group, test, assert, summary } = require('./harness');
const fs = require('fs');
const path = require('path');
const { DST, FILES, content } = require('../../scripts/sync-sim.js');

group('Браузерная копия симулятора (server/sim ⟷ tiny-world-builder/sim)');

for (const f of FILES) {
  test(`sim/${f} синхронен с server/sim/${f}`, () => {
    const p = path.join(DST, f);
    assert(fs.existsSync(p), `нет копии — запусти: node scripts/sync-sim.js`);
    assert(fs.readFileSync(p, 'utf8') === content(f),
      `sim/${f} устарел → запусти \`node scripts/sync-sim.js\` и закоммить tiny-world-builder/sim/`);
  });
}

summary('SIM-SYNC (browser sim copy)');
