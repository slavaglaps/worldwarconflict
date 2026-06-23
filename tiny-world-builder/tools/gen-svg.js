#!/usr/bin/env node
// gen-svg.js — quick visual check: render data/europe-countries.json to an SVG map.
'use strict';
const fs = require('fs'), path = require('path');
const D = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'europe-countries.json'), 'utf8'));
const B = D.bbox, MID = (B.minY + B.maxY) / 2, KX = Math.cos(MID * Math.PI / 180), S = 13;
const W = Math.round((B.maxX - B.minX) * KX * S), H = Math.round((B.maxY - B.minY) * S);
const px = (lng) => Math.round((lng - B.minX) * KX * S);
const py = (lat) => Math.round((B.maxY - lat) * S);

// distinct hue per faction; neutrals muted gray
const hue = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const fill = (r) => r.faction ? `hsl(${hue(r.name)} 55% 62%)` : '#c9cdd4';

let body = '';
for (const r of D.regions) {
  const d = r.polys.map((poly) => 'M' + poly.map((c) => `${px(c[0])},${py(c[1])}`).join('L') + 'Z').join('');
  body += `<path d="${d}" fill="${fill(r)}" stroke="#2b2f36" stroke-width="0.6" stroke-linejoin="round"/>`;
}
const svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img"><title>Точная карта Европы из Natural Earth — 24 страны-фракции + нейтральные</title><desc>Реальные границы Natural Earth 50m, отфильтрованные на регионы игры и упрощённые.</desc><rect width="${W}" height="${H}" fill="#9fc6e0"/>${body}</svg>`;
fs.writeFileSync(path.join(__dirname, '..', 'data', 'europe-preview.svg'), svg);
console.log(`SVG ${W}x${H}, ${svg.length} bytes`);
