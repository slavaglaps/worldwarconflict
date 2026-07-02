#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────
// Пересборка графа путей СТРОГО по нарисованным дорожным тайлам hex-map.json.
//
//   node tools/rebuild-road-graph.js          # пересобрать + записать
//   node tools/rebuild-road-graph.js --dry    # только отчёт, без записи
//
// Алгоритм (Вороной по дорожной сети):
//   1. Дорожные клетки = тайлы с t[7] (roadKey) + клетки мостов. Воды в сети НЕТ
//      (паромы/морские связи не строим — их игрок добавляет вручную).
//   2. Якорь города = ближайшая дорожная клетка к городу.
//   3. Мульти-BFS от всех якорей → каждая клетка получает метку ближайшего города.
//   4. Ребро A–B там, где зоны A и B соприкасаются; полилиния — кратчайший путь
//      ПО КЛЕТКАМ ДОРОГИ (город → якорь → граница → якорь → город).
//   5. Пишем hex-map.json (roads, мировые коорд.) + sim/map-data.json и
//      server/sim/map-data.json (игровые коорд.) — оба, чтобы не было дрейфа.
// ──────────────────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const DRY = process.argv.includes('--dry');
const r3 = v => Math.round(v * 1000) / 1000;

/* ── входные данные ── */
const hexMap = JSON.parse(fs.readFileSync(path.resolve(root, 'hex-map.json'), 'utf8'));
const m = hexMap.meta, B = m.B;
const Rg = (Number(m.R) || 1) * (Number(m.HEXS) || 1);
const worldW = Number(m.worldW), worldH = Number(m.worldH);
const lngSpan = Number(m.lngSpan), latSpan = Number(m.latSpan);

// CITY_LIST из js/data.js (та же логика, что в dev-server)
function parseCityListBlock(src) {
  const mm = src.match(/const\s+CITY_LIST\s*=\s*(\[[\s\S]*?\n\]);/);
  if (!mm) return null;
  return Function('P', 'E', 'N', `return ${mm[1].replace(/,\s*\]/, ']')};`)('P', 'E', 'N');
}
const dataSrc = fs.readFileSync(path.resolve(root, 'js', 'data.js'), 'utf8');
const CITY_LIST = parseCityListBlock(dataSrc);
if (!CITY_LIST) throw new Error('CITY_LIST не найден в js/data.js');

/* ── проекции (идентичны dev-server/hex-world) ── */
const qrToWX = (q, r) => Math.sqrt(3) * Rg * (q + (r & 1) * 0.5) - worldW / 2;
const qrToWZ = (q, r) => 1.5 * Rg * r - worldH / 2;
const lonToWX = lng => ((lng - B.minX) / lngSpan) * worldW - worldW / 2;
const latToWZ = lat => ((B.maxY - lat) / latSpan) * worldH - worldH / 2;
const wxToGX = wx => ((B.minX + ((wx + worldW / 2) / worldW) * lngSpan) - (-13)) / (51 - (-13)) * 256;
const wzToGZ = wz => (70 - (B.maxY - ((wz + worldH / 2) / worldH) * latSpan)) / (70 - 34) * 256;

/* ── 1. дорожные клетки ── */
const cells = [];              // {q,r,wx,wz}
const cellIdx = new Map();     // "q,r" → index
const allCells = [];           // все land-тайлы (для привязки мостов)
for (const t of hexMap.tiles || []) {
  const q = Number(t[0]), r = Number(t[1]);
  const c = { q, r, wx: qrToWX(q, r), wz: qrToWZ(q, r) };
  allCells.push(c);
  if (t[7]) { cellIdx.set(q + ',' + r, cells.length); cells.push(c); }
}
let bridgeCells = 0;
for (const b of hexMap.bridges || []) {
  const bx = Number(b[0]), bz = Number(b[1]);
  let best = null, bd = Infinity;
  for (const c of allCells) { const d = (c.wx - bx) ** 2 + (c.wz - bz) ** 2; if (d < bd) { bd = d; best = c; } }
  if (best && !cellIdx.has(best.q + ',' + best.r)) { cellIdx.set(best.q + ',' + best.r, cells.length); cells.push(best); bridgeCells++; }
}

const roadCoreN = cells.length;                      // клетки с флагом дороги + мосты (без клеток городов)

/* ── 2. города: клетка города — УЗЕЛ сети (дороги соединяются ЧЕРЕЗ город, даже если на его клетке нет флага дороги) ── */
const cities = CITY_LIST.map((c, idx) => ({ idx, name: String(c[0]), wx: lonToWX(Number(c[1])), wz: latToWZ(Number(c[2])) }));
let cityCellsAdded = 0;
const citySnap = new Array(cities.length).fill(-1);
for (const c of cities) {
  let best = null, bd = Infinity;
  for (const cell of allCells) { const d = (cell.wx - c.wx) ** 2 + (cell.wz - c.wz) ** 2; if (d < bd) { bd = d; best = cell; } }
  if (!best || Math.sqrt(bd) > Math.sqrt(3) * Rg * 1.3) continue;           // город вне тайлов — пропуск
  const key = best.q + ',' + best.r;
  if (!cellIdx.has(key)) { cellIdx.set(key, cells.length); cells.push(best); cityCellsAdded++; }
  citySnap[c.idx] = cellIdx.get(key);
}
const N = cells.length;

// hex-соседи (odd-r offset, как в dev-server) — ПОСЛЕ добавления клеток городов
const nbOf = (q, r) => (r & 1)
  ? [[q + 1, r], [q - 1, r], [q + 1, r - 1], [q, r - 1], [q + 1, r + 1], [q, r + 1]]
  : [[q + 1, r], [q - 1, r], [q, r - 1], [q - 1, r - 1], [q, r + 1], [q - 1, r + 1]];
const adj = cells.map(c => { const out = []; for (const [nq, nr] of nbOf(c.q, c.r)) { const j = cellIdx.get(nq + ',' + nr); if (j != null) out.push(j); } return out; });

// якорь города = его клетка (узел); фолбэк — ближайшая дорожная клетка
const anchor = new Array(cities.length).fill(-1);
const anchorWarn = [];
for (const c of cities) {
  if (citySnap[c.idx] >= 0) anchor[c.idx] = citySnap[c.idx];
  else { let bi = -1, bd = Infinity; for (let i = 0; i < roadCoreN; i++) { const d = (cells[i].wx - c.wx) ** 2 + (cells[i].wz - c.wz) ** 2; if (d < bd) { bd = d; bi = i; } } anchor[c.idx] = bi; }
  // информативно: насколько город далёк от НАРИСОВАННОЙ дороги
  let rd = Infinity; for (let i = 0; i < roadCoreN; i++) { const d = (cells[i].wx - c.wx) ** 2 + (cells[i].wz - c.wz) ** 2; if (d < rd) rd = d; }
  rd = Math.sqrt(rd);
  if (rd > Math.sqrt(3) * Rg * 1.6) anchorWarn.push({ idx: c.idx, name: c.name, dist: r3(rd) });
}

/* ── 3. мульти-BFS: метка/дистанция/родитель ── */
const label = new Int32Array(N).fill(-1);
const dist = new Int32Array(N).fill(-1);
const parent = new Int32Array(N).fill(-1);
const queue = [];
for (const c of cities) { const a = anchor[c.idx]; if (a >= 0 && label[a] === -1) { label[a] = c.idx; dist[a] = 0; queue.push(a); } }
for (let qi = 0; qi < queue.length; qi++) {
  const u = queue[qi];
  for (const v of adj[u]) if (label[v] === -1) { label[v] = label[u]; dist[v] = dist[u] + 1; parent[v] = u; queue.push(v); }
}

/* ── 4. рёбра между соприкасающимися зонами ── */
const cand = new Map(); // "a_b" → {a,b,u,v,total}
for (let u = 0; u < N; u++) {
  if (label[u] === -1) continue;
  for (const v of adj[u]) {
    if (v <= u || label[v] === -1 || label[v] === label[u]) continue;
    const a = Math.min(label[u], label[v]), b = Math.max(label[u], label[v]);
    const key = a + '_' + b, total = dist[u] + dist[v] + 1;
    const prev = cand.get(key);
    if (!prev || total < prev.total) cand.set(key, { a, b, u: label[u] === a ? u : v, v: label[u] === a ? v : u, total });
  }
}

const walkToAnchor = i => { const out = []; for (let k = i; k !== -1; k = parent[k]) out.push(k); return out; }; // клетка → якорь
const dropCollinear = pts => pts.filter((p, i) => {
  if (i === 0 || i === pts.length - 1) return true;
  const a = pts[i - 1], b = pts[i + 1];
  return Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) > 1e-6;
});

const roads = [];
for (const e of cand.values()) {
  const pathA = walkToAnchor(e.u).reverse();       // якорь A … u
  const pathB = walkToAnchor(e.v);                 // v … якорь B
  const cellPath = pathA.concat(pathB);
  const ca = cities[e.a], cb = cities[e.b];
  let pts = cellPath.map(i => [cells[i].wx, cells[i].wz]);
  // город → якорь (если здание не на дороге, первый/последний сегмент — «подъезд»)
  const first = pts[0], last = pts[pts.length - 1];
  if (Math.hypot(ca.wx - first[0], ca.wz - first[1]) > 0.01) pts.unshift([ca.wx, ca.wz]);
  if (Math.hypot(cb.wx - last[0], cb.wz - last[1]) > 0.01) pts.push([cb.wx, cb.wz]);
  pts = dropCollinear(pts).map(p => [r3(p[0]), r3(p[1])]);
  if (pts.length < 2) continue;
  roads.push([e.a, e.b, pts]);
}
roads.sort((x, y) => (x[0] - y[0]) || (x[1] - y[1]));

/* ── 5. отчёт ── */
const compOf = new Int32Array(N).fill(-1); let comps = 0;
for (let s = 0; s < N; s++) {
  if (compOf[s] !== -1) continue;
  const q2 = [s]; compOf[s] = comps;
  for (let qi = 0; qi < q2.length; qi++) for (const v of adj[q2[qi]]) if (compOf[v] === -1) { compOf[v] = comps; q2.push(v); }
  comps++;
}
const compCities = new Map();
for (const c of cities) { const cc = compOf[anchor[c.idx]]; compCities.set(cc, (compCities.get(cc) || 0) + 1); }
const degree = new Map();
for (const rd of roads) { degree.set(rd[0], (degree.get(rd[0]) || 0) + 1); degree.set(rd[1], (degree.get(rd[1]) || 0) + 1); }
const isolated = cities.filter(c => !degree.has(c.idx));

console.log(`дорожных клеток: ${N} (тайлов ${roadCoreN - bridgeCells} + мостов ${bridgeCells} + клеток городов ${cityCellsAdded})`);
console.log(`компонент дорожной сети: ${comps}; городов по компонентам:`, [...compCities.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => v).join(', '));
console.log(`рёбер построено: ${roads.length} (было ${hexMap.roads ? hexMap.roads.length : 0})`);
if (anchorWarn.length) { console.log(`⚠ города далеко от дороги (>1.5 клетки):`); for (const w of anchorWarn) console.log(`   [${w.idx}] ${w.name} — ${w.dist}`); }
if (isolated.length) { console.log(`⚠ города БЕЗ рёбер (${isolated.length}):`); for (const c of isolated) console.log(`   [${c.idx}] ${c.name}`); }

/* ── детектор разрывов: компоненты, почти касающиеся друг друга (≤3 клеток) — вероятно, недорисованная дорога ── */
{
  const byComp = new Map();
  for (let i = 0; i < N; i++) { let a = byComp.get(compOf[i]); if (!a) byComp.set(compOf[i], a = []); a.push(i); }
  const hexStep = Math.sqrt(3) * Rg, GAP = hexStep * 3.05;
  const nearCity = (wx, wz) => { let bn = '?', bd = Infinity; for (const c of cities) { const d = (c.wx - wx) ** 2 + (c.wz - wz) ** 2; if (d < bd) { bd = d; bn = c.name; } } return bn; };
  const gaps = [];
  const compIds = [...byComp.keys()];
  for (let x = 0; x < compIds.length; x++) for (let y = x + 1; y < compIds.length; y++) {
    const A = byComp.get(compIds[x]), Bc = byComp.get(compIds[y]);
    let bd = Infinity, bu = -1, bv = -1;
    for (const u of A) for (const v of Bc) { const d = (cells[u].wx - cells[v].wx) ** 2 + (cells[u].wz - cells[v].wz) ** 2; if (d < bd) { bd = d; bu = u; bv = v; } }
    const d = Math.sqrt(bd);
    if (d <= GAP) gaps.push({ d: r3(d), cellsGap: Math.round(d / hexStep * 10) / 10, u: bu, v: bv });
  }
  gaps.sort((a, b) => a.d - b.d);
  if (gaps.length) {
    console.log(`⚠ РАЗРЫВЫ сети (компоненты в ≤3 клетках — вероятно, дорога недорисована): ${gaps.length}`);
    for (const g of gaps) {
      const u = cells[g.u], v = cells[g.v];
      console.log(`   ~${g.cellsGap} клетки · q,r ${u.q},${u.r} ↔ ${v.q},${v.r} · рядом: ${nearCity(u.wx, u.wz)}`);
    }
  }
}

if (DRY) { console.log('--dry: ничего не записано'); process.exit(0); }

/* ── 6. запись hex-map.json ── */
hexMap.roads = roads;
const hexOut = path.resolve(root, 'hex-map.json');
fs.writeFileSync(hexOut + '.tmp', JSON.stringify(hexMap));
fs.renameSync(hexOut + '.tmp', hexOut);

/* ── 7. map-data.json (клиент + сервер) — как cityListToSimMap в dev-server ── */
const colorsBlock = dataSrc.match(/const\s+FACTION_COLOR\s*=\s*(\{[\s\S]*?\n\});/);
const colorExpr = colorsBlock[1].replace(/([,{]\s*)'([^']+)'\s*:/g, '$1"$2":').replace(/0x[0-9a-fA-F]+/g, x => String(Number(x)));
const FACTION_COLOR = Function(`return ${colorExpr};`)();
const aliasesBlock = dataSrc.match(/const\s+COUNTRY_ALIASES\s*=\s*(\{[\s\S]*?\n\});/);
const COUNTRY_ALIASES = aliasesBlock ? Function(`return ${aliasesBlock[1]};`)() : {};
const canon = c => COUNTRY_ALIASES[c] || c;
const countries = [...new Set(CITY_LIST.map(c => canon(c[5])))];
const factByCountry = {};
const factions = countries.map((country, id) => { factByCountry[country] = id; return { id, country, color: FACTION_COLOR[country] || 0x9aa6b2 }; });
const capitals = new Set();
const simCities = CITY_LIST.map((c, idx) => {
  const country = canon(c[5]);
  const capital = !capitals.has(country); capitals.add(country);
  const name = String(c[0] || 'Новый город');
  return {
    idx, name,
    gx: Math.round(((c[1] - (-13)) / (51 - (-13))) * 256),
    gz: Math.round(((70 - c[2]) / (70 - 34)) * 256),
    size: Math.max(1, Math.min(3, Math.round(Number(c[3]) || 1))),
    country, owner: factByCountry[country] ?? 0, capital,
    shipyard: /^Верфь /.test(name), airport: /^Аэропорт /.test(name),
  };
});
const simEdges = roads.map(rd => {
  const pts = rd[2].map(p => ({ x: Math.round(wxToGX(p[0]) * 10) / 10, z: Math.round(wzToGZ(p[1]) * 10) / 10 }));
  let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  return { a: rd[0], b: rd[1], type: 'road', len: Math.round(len * 100) / 100 || 1, mult: 1, pts };
});
const simMap = { meta: { GRID: 256, LON0: -13, LON1: 51, LAT0: 34, LAT1: 70 }, factions, cities: simCities, edges: simEdges };
for (const out of [path.resolve(root, 'sim', 'map-data.json'), path.resolve(root, '..', 'server', 'sim', 'map-data.json')]) {
  fs.writeFileSync(out + '.tmp', JSON.stringify(simMap));
  fs.renameSync(out + '.tmp', out);
  console.log('✓', path.relative(path.resolve(root, '..'), out), `(${simEdges.length} рёбер)`);
}
console.log('✓ hex-map.json обновлён (' + roads.length + ' дорог)');
