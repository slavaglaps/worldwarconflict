// Логика древа технологий (чистая). Данные узлов — в tech-data.js (извлечены из game.html).
// recomputeTech агрегирует изученные узлы в кэш бонусов; Sim читает его через techMul/techVal/techFlag.
const { NODES, NODE } = require('./tech-data');

// Σ эффектов изученных узлов → {add(множители), flags(анлоки), slots}
// nodeMap — узлы конкретной комнаты (из баланса); по умолчанию глобальные дефолты (клиент/тесты).
function recomputeTech(doneSet, nodeMap) {
  const NM = nodeMap || NODE;
  const add = { atk: 0, def: 0, eco: 0, speed: 0, prod: 0, tr: 0, td: 0, sh: 0, ph: 0, sr: 0, bd: 0, cc: 0 };
  const flags = new Set(); let slots = 1;
  for (const id of doneSet) {
    const n = NM[id]; if (!n) continue;
    if (n.a) add.atk += n.a; if (n.d) add.def += n.d; if (n.e) add.eco += n.e;
    if (n.s) add.speed += n.s; if (n.p) add.prod += n.p;
    if (n.v) for (const k in n.v) add[k] = (add[k] || 0) + n.v[k];
    if (n.u) flags.add(n.u);
    if (n.slot) slots += n.slot;
  }
  return { add, flags, slots };
}

const nodeReady = (doneSet, n) => n.req.every((r) => doneSet.has(r));

module.exports = { NODES, NODE, recomputeTech, nodeReady };
