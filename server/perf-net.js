// Профиль СЕТИ/ЭНКОДА Colyseus под тяжёлой нагрузкой (то, что становится лимитом, когда CPU дешёвый).
// Меряем: размер keyframe (первичная загрузка клиента), размер дельты на патч, время энкода,
// и экстраполяцию полосы на клиента и на полную комнату. Плюс A/B с оптимизацией #7
// (позиции uint16 вместо float32, clock убран) — сколько режет трафик.
//
//   node perf-net.js                         # 20/20/20, 24 клиента
//   SHIPS=20 PLANES=20 SQUADS=20 CLIENTS=24 PATCH_HZ=20 node perf-net.js
const { Sim } = require('./sim/Sim');
const { Ship } = require('./sim/Ship');
const { Plane } = require('./sim/Plane');
const { Squad } = require('./sim/Squad');
const { isWaterAt } = require('./sim/water');
const { Schema, MapSchema, ArraySchema, defineTypes, Encoder } = require('@colyseus/schema');
const { GameState, CityState, SquadState, ShipState, PlaneState } = require('./schema');
const map = require('./sim/map-data.json');

const SHIPS_PF = +process.env.SHIPS || 20, PLANES_PF = +process.env.PLANES || 20, SQUADS_PF = +process.env.SQUADS || 20;
const TICKS = +process.env.TICKS || 600, WARMUP = 30, CLIENTS = +process.env.CLIENTS || 24, PATCH_HZ = +process.env.PATCH_HZ || 20;
const SHIP_HP = 1e9, SQUAD_HP = 400, SPEC_ID = { prod: 1, def: 2, atk: 3 };
const ms = (ns) => Number(ns) / 1e6, hr = () => process.hrtime.bigint();
let _s = 0x9e3779b9; const rnd = () => ((_s = (Math.imul(_s, 1664525) + 1013904223) >>> 0) / 0x100000000);

// ── тяжёлый мир (как в perf-stress) ──
const sim = new Sim({ map, ai: false, goldStart: 0 });
const F = sim.factions;
sim.humanFactions = new Set(Array.from({ length: F }, (_, i) => i));
for (let a = 0; a < F; a++) for (let b = a + 1; b < F; b++) { sim.setRelation(a, b, 'war'); sim.warSince[sim.relKey(a, b)] = -1000; }
const water = []; for (let x = 2; x < 254; x += 2) for (let z = 2; z < 254; z += 2) if (isWaterAt(x, z)) water.push({ x, z });
const wp = () => water[(rnd() * water.length) | 0];
const own = (f) => sim.cities.filter((c) => c.owner === f), enem = (f) => sim.cities.filter((c) => c.owner !== f);
const routes = [];
for (let f = 0; f < F; f++) {
  routes[f] = []; const mine = own(f), en = enem(f);
  const srcs = mine.length > 2 ? [mine[0], mine[(mine.length / 2) | 0], mine[mine.length - 1]] : mine;
  const cand = []; for (const s of srcs) for (const e of en) { const p = sim.findPath(s.idx, e.idx, f); if (p && p.length > 1) cand.push(p); }
  cand.sort((a, b) => b.length - a.length); for (let k = 0; k < 14 && k < cand.length; k++) routes[f].push(cand[k]);
  if (!routes[f].length && mine.length) routes[f].push([mine[0].idx]);
}
const spawnSquad = (f) => { const r = routes[f]; if (r && r.length) sim.squads.push(new Squad(f, SQUAD_HP, r[(rnd() * r.length) | 0], sim, 1)); };
for (let f = 0; f < F; f++) {
  for (let i = 0; i < SHIPS_PF; i++) { const w = wp(), s = new Ship(f, w.x, w.z, sim); s.hp = SHIP_HP; const t = wp(); s.setTarget(t.x, t.z); sim.ships.push(s); }
  for (let i = 0; i < PLANES_PF; i++) { const p = new Plane(f, (rnd() * 256) | 0, (rnd() * 256) | 0, sim); p.hp = SHIP_HP; sim.planes.push(p); }
  for (let i = 0; i < SQUADS_PF; i++) spawnSquad(f);
}
const upkeep = () => {
  for (const s of sim.ships) { const dx = s.tx - s.x, dz = s.tz - s.z; if (dx * dx + dz * dz < 1) { const t = wp(); s.setTarget(t.x, t.z); } s.hp = SHIP_HP; }
  for (const p of sim.planes) p.hp = SHIP_HP;
  for (let f = 0; f < F; f++) { let h = 0; for (const s of sim.squads) if (s.owner === f) h++; for (let i = h; i < SQUADS_PF; i++) spawnSquad(f); }
};

// ── ТЕКУЩАЯ схема (реальная) ──
const A = new GameState();
for (const c of sim.cities) { const cs = new CityState(); cs.gx = c.gx; cs.gz = c.gz; cs.size = c.size; cs.country = c.country; A.cities.set(String(c.idx), cs); }
// экономика не в broadcast-стейте (приватна) — в замере дельты не участвует
A._techN = [];
function projectA() {
  A.tick++;
  for (const c of sim.cities) { const s = A.cities.get(String(c.idx)); s.owner = c.owner; s.units = Math.min(65535, Math.round(c.units)); s.spec = SPEC_ID[c.spec] || 0; s.tier = c.tier; s.occ = c.occ ? 1 : 0; s.shipyard = c.isShipyard ? 1 : 0; s.airport = c.isAirport ? 1 : 0; s.aa = c.aa | 0; s.queued = Math.min(65535, Math.round(c.queued)); let su = 0, so = 0; if (c.siege) for (const o in c.siege) if (c.siege[o].units > su) { su = c.siege[o].units; so = +o; } s.siegeUnits = Math.min(65535, Math.round(su)); s.siegeOwner = so; const b0 = c.batches && c.batches[0]; s.prodTime = b0 ? Math.min(65535, Math.round(b0.time * 10)) : 0; s.prodElapsed = b0 ? Math.min(65535, Math.round(b0.elapsed * 10)) : 0; s.shipQ = Math.min(255, c.shipQueue | 0); s.shipT = Math.min(65535, Math.round((c.shipTimer || 0) * 10)); s.planeQ = Math.min(255, c.planeQueue | 0); s.planeT = Math.min(65535, Math.round((c.planeTimer || 0) * 10)); }
  const sq = A.squads, live = new Set(); for (const s of sim.squads) { const k = String(s.id); live.add(k); let ss = sq.get(k); if (!ss) { ss = new SquadState(); ss.owner = s.owner; sq.set(k, ss); } ss.count = Math.round(s.fcount); ss.x = s.x; ss.z = s.z; ss.fighting = s.foe ? 1 : 0; } for (const k of [...sq.keys()]) if (!live.has(k)) sq.delete(k);
  const sh = A.ships, sl = new Set(); for (const s of sim.ships) { const k = String(s.id); sl.add(k); let ss = sh.get(k); if (!ss) { ss = new ShipState(); ss.owner = s.owner; sh.set(k, ss); } ss.x = s.x; ss.z = s.z; ss.hp = Math.min(65535, Math.max(0, Math.round(s.hp))); ss.fighting = s.foe ? 1 : 0; } for (const k of [...sh.keys()]) if (!sl.has(k)) sh.delete(k);
  const pl = A.planes, pli = new Set(); for (const p of sim.planes) { const k = String(p.id); pli.add(k); let ps = pl.get(k); if (!ps) { ps = new PlaneState(); ps.owner = p.owner; pl.set(k, ps); } ps.x = p.x; ps.z = p.z; ps.hp = Math.min(65535, Math.max(0, Math.round(p.hp))); ps.fighting = p.foe ? 1 : 0; } for (const k of [...pl.keys()]) if (!pli.has(k)) pl.delete(k);
  A.clock = sim.time;
}

// ── БАЗОВАЯ схема ДО #7 (float32-позиции + clock) — для сравнения, сколько сэкономили ──
const q = (v) => v;
class SquadO extends Schema {} defineTypes(SquadO, { owner: 'uint8', count: 'uint16', x: 'float32', z: 'float32', fighting: 'uint8' });
class ShipO extends Schema {} defineTypes(ShipO, { owner: 'uint8', x: 'float32', z: 'float32', hp: 'uint16', fighting: 'uint8' });
class PlaneO extends Schema {} defineTypes(PlaneO, { owner: 'uint8', x: 'float32', z: 'float32', hp: 'uint16', fighting: 'uint8' });
class GameO extends Schema { constructor() { super(); this.tick = 0; this.cities = new MapSchema(); this.squads = new MapSchema(); this.ships = new MapSchema(); this.planes = new MapSchema(); this.gold = new ArraySchema(); this.manpower = new ArraySchema(); this.politPts = new ArraySchema(); } }
defineTypes(GameO, { tick: 'uint32', cities: { map: CityState }, squads: { map: SquadO }, ships: { map: ShipO }, planes: { map: PlaneO }, gold: ['number'], manpower: ['number'], politPts: ['number'] });
const B = new GameO();
for (const c of sim.cities) { const cs = new CityState(); cs.gx = c.gx; cs.gz = c.gz; cs.size = c.size; cs.country = c.country; B.cities.set(String(c.idx), cs); }
for (let f = 0; f < F; f++) { B.gold.push(0); B.manpower.push(0); B.politPts.push(0); }
function projectB() {
  B.tick++;
  for (const c of sim.cities) { const s = B.cities.get(String(c.idx)); s.owner = c.owner; s.units = Math.min(65535, Math.round(c.units)); s.spec = SPEC_ID[c.spec] || 0; s.tier = c.tier; s.occ = c.occ ? 1 : 0; s.shipyard = c.isShipyard ? 1 : 0; s.airport = c.isAirport ? 1 : 0; s.aa = c.aa | 0; s.queued = Math.min(65535, Math.round(c.queued)); let su = 0, so = 0; if (c.siege) for (const o in c.siege) if (c.siege[o].units > su) { su = c.siege[o].units; so = +o; } s.siegeUnits = Math.min(65535, Math.round(su)); s.siegeOwner = so; const b0 = c.batches && c.batches[0]; s.prodTime = b0 ? Math.min(65535, Math.round(b0.time * 10)) : 0; s.prodElapsed = b0 ? Math.min(65535, Math.round(b0.elapsed * 10)) : 0; s.shipQ = Math.min(255, c.shipQueue | 0); s.shipT = Math.min(65535, Math.round((c.shipTimer || 0) * 10)); s.planeQ = Math.min(255, c.planeQueue | 0); s.planeT = Math.min(65535, Math.round((c.planeTimer || 0) * 10)); }
  const sq = B.squads, live = new Set(); for (const s of sim.squads) { const k = String(s.id); live.add(k); let ss = sq.get(k); if (!ss) { ss = new SquadO(); ss.owner = s.owner; sq.set(k, ss); } ss.count = Math.round(s.fcount); ss.x = q(s.x); ss.z = q(s.z); ss.fighting = s.foe ? 1 : 0; } for (const k of [...sq.keys()]) if (!live.has(k)) sq.delete(k);
  const sh = B.ships, sl = new Set(); for (const s of sim.ships) { const k = String(s.id); sl.add(k); let ss = sh.get(k); if (!ss) { ss = new ShipO(); ss.owner = s.owner; sh.set(k, ss); } ss.x = q(s.x); ss.z = q(s.z); ss.hp = Math.min(65535, Math.max(0, Math.round(s.hp))); ss.fighting = s.foe ? 1 : 0; } for (const k of [...sh.keys()]) if (!sl.has(k)) sh.delete(k);
  const pl = B.planes, pli = new Set(); for (const p of sim.planes) { const k = String(p.id); pli.add(k); let ps = pl.get(k); if (!ps) { ps = new PlaneO(); ps.owner = p.owner; pl.set(k, ps); } ps.x = q(p.x); ps.z = q(p.z); ps.hp = Math.min(65535, Math.max(0, Math.round(p.hp))); ps.fighting = p.foe ? 1 : 0; } for (const k of [...pl.keys()]) if (!pli.has(k)) pl.delete(k);
}

// ── энкодеры ──
const encA = new Encoder(A), encB = new Encoder(B);
projectA(); projectB();
const kfA = encA.encodeAll().byteLength, kfB = encB.encodeAll().byteLength;
encA.discardChanges(); encB.discardChanges();
for (let i = 0; i < WARMUP; i++) { upkeep(); sim.tick(DT()); projectA(); projectB(); encA.encode(); encB.encode(); encA.discardChanges(); encB.discardChanges(); }
function DT() { return 1 / 15; }

const aBytes = [], bBytes = [], aTime = [];
for (let i = 0; i < TICKS; i++) {
  upkeep(); sim.tick(DT());
  projectA(); let t = hr(); const da = encA.encode(); aTime.push(ms(hr() - t)); aBytes.push(da.byteLength); encA.discardChanges();
  projectB(); const db = encB.encode(); bBytes.push(db.byteLength); encB.discardChanges();
}
const ents = { ships: sim.ships.length, planes: sim.planes.length, squads: sim.squads.length };

const stat = (a) => { const s = [...a].sort((x, y) => x - y), sum = s.reduce((p, c) => p + c, 0), p = (q) => s[Math.min(s.length - 1, Math.floor(q / 100 * s.length))]; return { mean: sum / s.length, p50: p(50), p95: p(95), max: s[s.length - 1] }; };
const kb = (b) => (b / 1024).toFixed(1), mb = (b) => (b / 1048576).toFixed(2);
const a = stat(aBytes), b = stat(bBytes), at = stat(aTime);

console.log('\n=== WWC network/encode profile (одна комната, тяжёлая нагрузка) ===');
console.log(`Сущности: ${ents.ships} кораблей · ${ents.planes} самолётов · ${ents.squads} армий (все двигаются). Клиентов в комнате: ${CLIENTS}. Патч-рейт: ${PATCH_HZ} Гц.`);
console.log(`\nKeyframe (первичная загрузка на клиента при входе):`);
console.log(`  float32 baseline (до #7): ${kb(kfB)} КБ`);
console.log(`  текущая (uint16, #7):     ${kb(kfA)} КБ   (−${(100 - kfA / kfB * 100).toFixed(0)}%)`);
console.log(`\nДельта на патч (среднее изменение состояния за тик):    mean      p95      max`);
console.log(`  float32 baseline (до #7): ${kb(b.mean).padStart(7)} ${kb(b.p95).padStart(7)} ${kb(b.max).padStart(7)} КБ`);
console.log(`  текущая (uint16, #7):     ${kb(a.mean).padStart(7)} ${kb(a.p95).padStart(7)} ${kb(a.max).padStart(7)} КБ   (−${(100 - a.mean / b.mean * 100).toFixed(0)}%)`);
console.log(`\nВремя энкода патча (текущая схема): mean ${at.mean.toFixed(3)} мс · p95 ${at.p95.toFixed(3)} · max ${at.max.toFixed(3)} мс  → не лимит (CPU дёшев).`);

const bwA = a.mean * PATCH_HZ, bwB = b.mean * PATCH_HZ;       // байт/с на клиента (A=текущая uint16, B=float32 baseline)
console.log(`\nПолоса (broadcast: один и тот же патч каждому клиенту):`);
console.log(`  на 1 клиента:   float32 ${kb(bwB)} КБ/с   →   текущая (uint16) ${kb(bwA)} КБ/с`);
console.log(`  комната ×${CLIENTS}:  float32 ${mb(bwB * CLIENTS)} МБ/с   →   текущая ${mb(bwA * CLIENTS)} МБ/с  (uplink сервера)`);
const LINE_MBIT = 100, lineBps = LINE_MBIT * 1e6 / 8;
console.log(`\nЁмкость по uplink (${LINE_MBIT} Мбит/с ≈ ${mb(lineBps)} МБ/с на инстанс):`);
console.log(`  float32 baseline: ~${Math.floor(lineBps / (bwB * CLIENTS))} полных комнат на инстанс`);
console.log(`  текущая (uint16): ~${Math.floor(lineBps / (bwA * CLIENTS))} полных комнат  (×${(bwB / bwA).toFixed(1)})`);
console.log('\nЧувствительность к патч-рейту (текущая схема — самый дешёвый рычаг, клиент уже интерполирует):');
for (const hz of [20, 15, 12, 10]) console.log(`  ${String(hz).padStart(2)} Гц → ${kb(a.mean * hz).padStart(6)} КБ/с на клиента · комната ×${CLIENTS} = ${mb(a.mean * hz * CLIENTS)} МБ/с → ~${Math.floor(lineBps / (a.mean * hz * CLIENTS))} комнат/инстанс`);
console.log('\nNB: реальная сеть зависит от TCP/WS-оверхеда и сжатия (permessage-deflate). Это нижняя оценка по полезной нагрузке.');
console.log('NB: главный множитель — broadcast ×клиентов. Per-client StateView (#1) дал бы ещё больше выгоды, фильтруя чужое.\n');
process.exit(0);
