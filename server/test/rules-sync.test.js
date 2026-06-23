// GUARD: клиентские _rules.gen.js / _tech.gen.js обязаны быть синхронны с
// server/sim/{constants,tech-data}.js. Падает, если кто-то поменял серверные
// правила и не перегенерил клиентские файлы — делает молчаливый дрейф баланса
// (соло-клиент vs авторитетный сервер) невозможным.
const { group, test, assert, eq, summary } = require('./harness');
const fs = require('fs');
const G = require('../../scripts/gen-client-rules.js');

group('Single-source игровых правил (codegen guard)');

const checkSync = (out, gen, label) => {
  test(`${label} существует`, () => assert(fs.existsSync(out), 'нет файла — запусти: node scripts/gen-client-rules.js'));
  test(`${label} синхронен с сервером`, () => {
    const committed = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
    assert(committed === gen(),
      `${label} устарел → запусти \`node scripts/gen-client-rules.js\` и закоммить tiny-world-builder/js/*.gen.js`);
  });
};

checkSync(G.OUT_RULES, G.generateConstants, '_rules.gen.js (константы)');
checkSync(G.OUT_TECH, G.generateTech, '_tech.gen.js (тех-дерево)');
checkSync(G.OUT_BAL, G.generateBalance, '_balance.gen.js (politics+ai)');

test('эмитятся все числовые константы и все узлы теха', () => {
  eq((G.generateConstants().match(/^var /gm) || []).length, G.constCount() + 0);  // N var-строк констант
  eq((G.generateTech().match(/^  \{/gm) || []).length, G.nodeCount());            // N узлов-объектов
});

summary('RULES-SYNC (codegen guard)');
