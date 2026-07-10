// Entry для прод-бандла серверного Sim в браузер (esbuild bundle → IIFE).
// Заменяет рантайм-CommonJS-shim (sim-loader.js) и копию sim/ для прод-пути:
// настоящий require() резолвит esbuild на сборке, JSON инлайнится, выходит window.__WWCSim.
const { Sim } = require('../server/sim/Sim.js');
const B = require('../server/sim/balance.js');
const water = require('../server/sim/water.js');
const tech = require('../server/sim/tech.js');
const vision = require('../server/sim/vision.js');   // 🌫 туман войны: одна математика видимости на сервер/клиент
window.__WWCSim = {
  Sim,
  makeBalance: B.makeBalance, makeConstants: B.makeConstants,
  factionBal: B.factionBal, deepMerge: B.deepMerge,
  water, tech, vision,
};
