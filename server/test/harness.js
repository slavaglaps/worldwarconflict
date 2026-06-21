// Минимальный тест-харнес (без зависимостей): группы, assert'ы, счётчик, CI-exit-код.
let passed = 0, failed = 0;
const fails = [];

function group(name) { console.log('\n\x1b[1m' + name + '\x1b[0m'); }

function test(name, fn) {
  try { fn(); passed++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  catch (e) { failed++; fails.push([name, e.message]); console.log('  \x1b[31m✗ ' + name + '\x1b[0m — ' + e.message); }
}
async function testAsync(name, fn) {
  try { await fn(); passed++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  catch (e) { failed++; fails.push([name, e.message]); console.log('  \x1b[31m✗ ' + name + '\x1b[0m — ' + e.message); }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'eq') + `: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function near(a, b, eps, msg) { if (Math.abs(a - b) > (eps ?? 1e-6)) throw new Error((msg || 'near') + `: ${a} vs ${b} (eps ${eps ?? 1e-6})`); }
function gt(a, b, msg) { if (!(a > b)) throw new Error((msg || 'gt') + `: ${a} !> ${b}`); }
function lt(a, b, msg) { if (!(a < b)) throw new Error((msg || 'lt') + `: ${a} !< ${b}`); }

function summary(label) {
  console.log(`\n\x1b[1m${label || 'TOTAL'}: ${passed} passed, ${failed} failed\x1b[0m`);
  if (failed) { console.log('failures:'); for (const [n, m] of fails) console.log('  - ' + n + ': ' + m); process.exitCode = 1; }
  return failed === 0;
}

module.exports = { group, test, testAsync, assert, eq, near, gt, lt, summary };
