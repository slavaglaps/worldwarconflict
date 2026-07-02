/* СКОПИРОВАНО из server/sim/ скриптом scripts/sync-sim.js — НЕ РЕДАКТИРОВАТЬ. Источник: server/sim/water.js */
// Водный грид (256×256, упакован битами) — извлечён из game.html. Для движения кораблей.
const data = require('./water-data.json');
const N = data.GRID;
// base64 → байты: Node (Buffer) ИЛИ браузер (atob → Uint8Array). Оба индексируются buf[i].
const buf = (typeof Buffer !== 'undefined')
  ? Buffer.from(data.water, 'base64')
  : (() => { const bin = atob(data.water), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; })();

function isWaterAt(x, z) {
  const xi = Math.round(x), zi = Math.round(z);
  if (xi < 0 || zi < 0 || xi >= N || zi >= N) return true;   // за картой — открытое море
  const i = xi * N + zi;
  return !!(buf[i >> 3] & (1 << (i & 7)));
}

// ближайшая вода к (x,z) (для спавна корабля у верфи)
function nearestWaterPoint(x, z) {
  if (isWaterAt(x, z)) return { x, z };
  for (let r = 1; r <= 8; r++)
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (isWaterAt(x + dx, z + dz)) return { x: x + dx, z: z + dz };
      }
  return { x, z };
}

module.exports = { isWaterAt, nearestWaterPoint, GRID: N };
