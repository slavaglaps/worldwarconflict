#!/usr/bin/env node
// build-geo.js — zero-dep pipeline: Natural Earth 50m admin-0 → accurate polygons for the game's regions.
// Source dataset (download once to /tmp/ne50.geojson):
//   curl -sL https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson -o /tmp/ne50.geojson
// Output: tiny-world-builder/data/europe-countries.json  ({ bbox, regions:[{name, faction, polys:[[[lng,lat]...]]}] })
'use strict';
const fs = require('fs'), path = require('path');

const SRC = process.argv[2] || '/tmp/ne50.geojson';
const OUTDIR = path.join(__dirname, '..', 'data');
const OUT = path.join(OUTDIR, 'europe-countries.json');

// ── Europe clip window (lng/lat). Trims Russia's Siberia, mid-Atlantic, deep Sahara. ──
const BBOX = { minX: -11, minY: 34, maxX: 50, maxY: 71.5 };
const TOL = 0.05;        // Douglas–Peucker tolerance (degrees) — lower = more detail
const MIN_AREA = 0.04;   // deg² — drop islands smaller than this (largest ring per region always kept)

// NE "NAME" → game RU name (the 24 playable factions, minus Балканы which is merged below)
const NAME2RU = {
  'United Kingdom': 'Британия', 'France': 'Франция', 'Spain': 'Испания', 'Portugal': 'Португалия',
  'Italy': 'Италия', 'Germany': 'Германия', 'Belgium': 'Бельгия', 'Austria': 'Австрия', 'Poland': 'Польша',
  'Norway': 'Норвегия', 'Sweden': 'Швеция', 'Finland': 'Финляндия', 'Denmark': 'Дания', 'Estonia': 'Эстония',
  'Latvia': 'Латвия', 'Lithuania': 'Литва', 'Greece': 'Греция', 'Ukraine': 'Украина', 'Russia': 'Россия',
  'Turkey': 'Турция', 'Georgia': 'Грузия', 'Armenia': 'Армения', 'Azerbaijan': 'Азербайджан',
};
// Балканы = one playable region merged from these NE countries
const BALKANS = new Set(['Serbia', 'Croatia', 'Bosnia and Herz.', 'Slovenia', 'Montenegro', 'North Macedonia', 'Albania', 'Kosovo']);
// neutral terrain fill (not factions) so the continent has no holes between factions
const NEUTRAL = {
  'Switzerland': 'Швейцария', 'Netherlands': 'Нидерланды', 'Luxembourg': 'Люксембург', 'Czechia': 'Чехия',
  'Slovakia': 'Словакия', 'Hungary': 'Венгрия', 'Romania': 'Румыния', 'Bulgaria': 'Болгария',
  'Ireland': 'Ирландия', 'Belarus': 'Беларусь', 'Moldova': 'Молдова', 'Cyprus': 'Кипр',
};

// ── geometry helpers (zero-dep) ──
const area = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return Math.abs(a / 2); };

function dp(pts, tol) {                       // Douglas–Peucker
  if (pts.length < 3) return pts;
  const sq = tol * tol;
  const d2 = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
    let t = L > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0;
    t = Math.max(0, Math.min(1, t));
    const x = a[0] + t * dx, y = a[1] + t * dy;
    return (p[0] - x) ** 2 + (p[1] - y) ** 2;
  };
  const keep = [0];
  (function rec(s, e) {
    let max = 0, idx = -1;
    for (let i = s + 1; i < e; i++) { const d = d2(pts[i], pts[s], pts[e]); if (d > max) { max = d; idx = i; } }
    if (max > sq && idx > 0) { rec(s, idx); keep.push(idx); rec(idx, e); }
  })(0, pts.length - 1);
  keep.push(pts.length - 1);
  return keep.map((i) => pts[i]);
}

function clip(ring) {                          // Sutherland–Hodgman vs axis-aligned rect
  const lx = (a, b, x) => [x, a[1] + (x - a[0]) / (b[0] - a[0]) * (b[1] - a[1])];
  const ly = (a, b, y) => [a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]), y];
  const edges = [
    [(p) => p[0] >= BBOX.minX, (a, b) => lx(a, b, BBOX.minX)],
    [(p) => p[0] <= BBOX.maxX, (a, b) => lx(a, b, BBOX.maxX)],
    [(p) => p[1] >= BBOX.minY, (a, b) => ly(a, b, BBOX.minY)],
    [(p) => p[1] <= BBOX.maxY, (a, b) => ly(a, b, BBOX.maxY)],
  ];
  let out = ring;
  for (const [inside, I] of edges) {
    const inp = out; out = [];
    if (!inp.length) break;
    for (let i = 0; i < inp.length; i++) {
      const cur = inp[i], prev = inp[(i + inp.length - 1) % inp.length];
      const ci = inside(cur), pi = inside(prev);
      if (ci) { if (!pi) out.push(I(prev, cur)); out.push(cur); }
      else if (pi) out.push(I(prev, cur));
    }
  }
  return out;
}

// ── build ──
const gj = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const regions = {};   // name -> { name, faction, rings:[{a,pts}] }
const push = (name, faction, ring) => {
  const r = regions[name] || (regions[name] = { name, faction, rings: [] });
  r.rings.push({ a: area(ring), pts: ring });
};

for (const f of gj.features) {
  const nm = f.properties.NAME || f.properties.ADMIN;
  let name = NAME2RU[nm], faction = true;
  if (!name && BALKANS.has(nm)) name = 'Балканы';
  else if (!name && NEUTRAL[nm]) { name = NEUTRAL[nm]; faction = false; }
  if (!name) continue;
  const g = f.geometry; if (!g) continue;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  for (const poly of polys) {
    let ring = clip(poly[0]);            // outer ring only, clipped to window
    if (ring.length < 4) continue;
    ring = dp(ring, TOL);
    if (ring.length < 4) continue;
    push(name, faction, ring);
  }
}

const out = [];
for (const k in regions) {
  const r = regions[k];
  r.rings.sort((x, y) => y.a - x.a);
  const polys = r.rings
    .filter((p, i) => i === 0 || p.a >= MIN_AREA)
    .map((p) => p.pts.map((c) => [+c[0].toFixed(3), +c[1].toFixed(3)]));
  out.push({ name: r.name, faction: r.faction, polys });
}
out.sort((a, b) => (b.faction - a.faction) || a.name.localeCompare(b.name));

const result = { bbox: BBOX, source: 'Natural Earth 50m admin-0 (public domain)', regions: out };
fs.mkdirSync(OUTDIR, { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(result));

// ── stats + correctness (point-in-polygon spot checks vs real capitals) ──
const pip = (pt, polys) => {
  let inside = false;
  for (const ring of polys) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
};
const find = (pt) => { for (const r of out) if (pip(pt, r.polys)) return r.name; return '∅(вода/вне окна)'; };
const fac = out.filter((r) => r.faction), neu = out.filter((r) => !r.faction);
const pts = out.reduce((s, r) => s + r.polys.reduce((a, p) => a + p.length, 0), 0);
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`✅ ${OUT}`);
console.log(`   фракций: ${fac.length}/24   нейтральных: ${neu.length}   всего регионов: ${out.length}`);
console.log(`   полигонов: ${out.reduce((s, r) => s + r.polys.length, 0)}   точек: ${pts}   размер: ${kb} КБ`);
console.log('   фракции:', fac.map((r) => r.name).join(', '));
console.log('   нейтрал:', neu.map((r) => r.name).join(', '));
console.log('\n── PIP-проверка (столица → регион) ──');
const checks = [
  [[-0.13, 51.5], 'Британия', 'Лондон'], [[2.35, 48.85], 'Франция', 'Париж'],
  [[13.4, 52.5], 'Германия', 'Берлин'], [[-3.7, 40.4], 'Испания', 'Мадрид'],
  [[12.5, 41.9], 'Италия', 'Рим'], [[21.0, 52.23], 'Польша', 'Варшава'],
  [[30.52, 50.45], 'Украина', 'Киев'], [[37.6, 55.75], 'Россия', 'Москва'],
  [[18.07, 59.33], 'Швеция', 'Стокгольм'], [[23.73, 37.98], 'Греция', 'Афины'],
  [[32.85, 39.93], 'Турция', 'Анкара'], [[20.46, 44.82], 'Балканы', 'Белград'],
  [[44.79, 41.72], 'Грузия', 'Тбилиси'], [[49.85, 40.41], 'Азербайджан', 'Баку'],
];
let ok = 0;
for (const [pt, want, city] of checks) {
  const got = find(pt); const pass = got === want; ok += pass;
  console.log(`   ${pass ? '✅' : '❌'} ${city.padEnd(10)} → ${got}${pass ? '' : `  (ждали ${want})`}`);
}
console.log(`\n${ok}/${checks.length} проверок пройдено`);
process.exit(ok === checks.length ? 0 : 1);
