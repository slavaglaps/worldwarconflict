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

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(key, f) {
    const a = this.a; a.push({ key, f });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      const t = a[p]; a[p] = a[i]; a[i] = t; i = p;
    }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        let l = i * 2 + 1, r = l + 1, s = i;
        if (l < a.length && a[l].f < a[s].f) s = l;
        if (r < a.length && a[r].f < a[s].f) s = r;
        if (s === i) break;
        const t = a[s]; a[s] = a[i]; a[i] = t; i = s;
      }
    }
    return top && top.key;
  }
}

function waterTile(x, z) {
  return x >= 0 && z >= 0 && x < N && z < N && isWaterAt(x, z);
}

function coastPenalty(x, z) {
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    if (!dx && !dz) continue;
    if (!waterTile(x + dx, z + dz)) return 0.9;
  }
  return 0;
}

function waterClear(x0, z0, x1, z1, margin = 0) {
  const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
  const steps = Math.ceil(len * 2.5) + 1;
  let px = 0, pz = 0;
  if (len > 1e-6) { px = -dz / len * margin; pz = dx / len * margin; }
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, x = x0 + dx * t, z = z0 + dz * t;
    if (!isWaterAt(x, z)) return false;
    if (margin > 0 && (!isWaterAt(x + px, z + pz) || !isWaterAt(x - px, z - pz))) return false;
  }
  return true;
}

function smoothWaterPath(cells) {
  if (cells.length <= 2) return cells.map(c => ({ x: c.x, z: c.z }));
  const out = [{ x: cells[0].x, z: cells[0].z }];
  let i = 0;
  while (i < cells.length - 1) {
    let j = cells.length - 1;
    while (j > i + 1 && !waterClear(cells[i].x, cells[i].z, cells[j].x, cells[j].z, 0.85)) j--;
    out.push({ x: cells[j].x, z: cells[j].z });
    i = j;
  }
  return out;
}

function findWaterPath(sx, sz, tx, tz) {
  const clamp = v => Math.max(0, Math.min(N - 1, Math.round(v)));
  const start = nearestWaterPoint(clamp(sx), clamp(sz));
  const goal = nearestWaterPoint(clamp(tx), clamp(tz));
  if (!waterTile(start.x, start.z) || !waterTile(goal.x, goal.z)) return null;
  if (waterClear(sx, sz, tx, tz, 0.85)) return [{ x: tx, z: tz }];
  const sKey = start.x * N + start.z, gKey = goal.x * N + goal.z;
  if (sKey === gKey) return [{ x: tx, z: tz }];

  const open = new MinHeap(), came = new Map(), g = new Map();
  g.set(sKey, 0);
  open.push(sKey, Math.hypot(goal.x - start.x, goal.z - start.z));
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  let found = false, exp = 0;
  while (open.size && exp < 40000) {
    const cur = open.pop();
    if (cur == null) break;
    if (cur === gKey) { found = true; break; }
    exp++;
    const cx = Math.floor(cur / N), cz = cur % N, cg = g.get(cur);
    if (cg === undefined) continue;
    for (const d of dirs) {
      const nx = cx + d[0], nz = cz + d[1];
      if (!waterTile(nx, nz)) continue;
      if (d[0] && d[1] && (!waterTile(cx + d[0], cz) || !waterTile(cx, cz + d[1]))) continue;
      const nk = nx * N + nz;
      const ng = cg + (d[0] && d[1] ? 1.41421356 : 1) + coastPenalty(nx, nz);
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng); came.set(nk, cur);
        open.push(nk, ng + Math.hypot(goal.x - nx, goal.z - nz));
      }
    }
  }
  if (!found) return null;
  const cells = [];
  let cur = gKey;
  while (cur !== sKey) {
    cells.push({ x: Math.floor(cur / N), z: cur % N });
    cur = came.get(cur);
    if (cur === undefined) return null;
  }
  cells.push({ x: start.x, z: start.z });
  cells.reverse();
  const pts = smoothWaterPath(cells);
  if (pts.length > 1) pts.shift();
  pts[pts.length - 1] = { x: tx, z: tz };
  return pts;
}

module.exports = { isWaterAt, nearestWaterPoint, findWaterPath, waterClear, GRID: N };
