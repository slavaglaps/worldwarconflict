// Проекция чистого Sim → Colyseus-схема (города/движущиеся/дипломатия/техи/часы).
// Вынесено из GameRoom._tick, чтобы тестировать БЕЗ сети (см. test/project.test.js).
// Colyseus сериализует только изменившиеся поля → пишем по месту в state.
'use strict';
const { CityState, SquadState, ShipState, PlaneState, POS_Q } = require('./schema');

const SPEC_ID = { prod: 1, def: 2, atk: 3 };                                  // спец города → uint8
const RELN = { war: 1, ally: 2 };                                            // отношение → uint8
const QPOS = (v) => Math.min(65535, Math.max(0, Math.round(v * POS_Q)));     // позиция → fixed-point uint16 (вдвое меньше трафика, чем float32)

// techN — внешний счётчик «версий» завершённых техов на фракцию (живёт в комнате; techDone только растёт).
function projectState(sim, state, techN) {
  // ── города ──
  const cs = state.cities;
  for (const c of sim.cities) {
    let s = cs.get(String(c.idx));
    if (!s) {   // 🆕 динамическая верфь/аэродром — добавляем в схему (статика ставится один раз)
      s = new CityState();
      s.gx = Math.round(c.gx); s.gz = Math.round(c.gz); s.size = c.size; s.country = c.country; s.capital = c.capital ? 1 : 0;
      cs.set(String(c.idx), s);
    }
    s.owner = c.owner;
    s.units = Math.min(65535, Math.round(c.units));
    s.spec = SPEC_ID[c.spec] || 0;
    s.tier = c.tier;
    s.occ = c.occ ? 1 : 0;
    s.shipyard = c.isShipyard ? 1 : 0; s.airport = c.isAirport ? 1 : 0;
    s.aa = c.aa | 0;
    s.queued = Math.min(65535, Math.round(c.queued));
    let su = 0, so = 0;                                                       // сильнейший осаждающий пул
    if (c.siege) for (const o in c.siege) if (c.siege[o].units > su) { su = c.siege[o].units; so = +o; }
    s.siegeUnits = Math.min(65535, Math.round(su)); s.siegeOwner = so;
    const b0 = c.batches && c.batches[0];                                     // таймеры — в десятых долях секунды
    s.prodTime = b0 ? Math.min(65535, Math.round(b0.time * 10)) : 0;
    s.prodElapsed = b0 ? Math.min(65535, Math.round(b0.elapsed * 10)) : 0;
    s.shipQ = Math.min(255, c.shipQueue | 0);
    s.shipT = Math.min(65535, Math.round((c.shipTimer || 0) * 10));
    s.planeQ = Math.min(255, c.planeQueue | 0);
    s.planeT = Math.min(65535, Math.round((c.planeTimer || 0) * 10));
  }
  // ── движущиеся: добавить новые, обновить, удалить дошедшие ──
  const sq = state.squads, live = new Set();
  for (const s of sim.squads) { const k = String(s.id); live.add(k); let ss = sq.get(k); if (!ss) { ss = new SquadState(); ss.owner = s.owner; sq.set(k, ss); } ss.count = Math.round(s.fcount); ss.x = QPOS(s.x); ss.z = QPOS(s.z); ss.fighting = s.foe ? 1 : 0; }
  for (const k of [...sq.keys()]) if (!live.has(k)) sq.delete(k);
  const shp = state.ships, slive = new Set();
  for (const s of sim.ships) { const k = String(s.id); slive.add(k); let ss = shp.get(k); if (!ss) { ss = new ShipState(); ss.owner = s.owner; shp.set(k, ss); } ss.x = QPOS(s.x); ss.z = QPOS(s.z); ss.hp = Math.max(0, Math.round(s.hp)); ss.fighting = s.foe ? 1 : 0; }
  for (const k of [...shp.keys()]) if (!slive.has(k)) shp.delete(k);
  const pl = state.planes, plive = new Set();
  for (const p of sim.planes) { const k = String(p.id); plive.add(k); let ps = pl.get(k); if (!ps) { ps = new PlaneState(); ps.owner = p.owner; pl.set(k, ps); } ps.x = QPOS(p.x); ps.z = QPOS(p.z); ps.hp = Math.max(0, Math.round(p.hp)); ps.fighting = p.foe ? 1 : 0; }
  for (const k of [...pl.keys()]) if (!plive.has(k)) pl.delete(k);
  // ── дипломатия + часы ──
  const rel = sim.relations, sr = state.relations;
  for (const k in rel) { const v = RELN[rel[k]] || 0; if (v && sr.get(k) !== v) sr.set(k, v); }
  for (const k of [...sr.keys()]) if (!rel[k]) sr.delete(k);
  state.clock = sim.time;
  const ws = state.warStart, since = sim.warSince;
  for (const k in since) if (rel[k] === 'war') { if (ws.get(k) !== since[k]) ws.set(k, since[k]); }
  for (const k of [...ws.keys()]) if (rel[k] !== 'war') ws.delete(k);
  // ── технологии: активные исследования + завершённые (на фракцию) ──
  const research = state.research, tech = state.tech;
  for (let f = 0; f < sim.factions; f++) {
    const fk = String(f), arr = sim.techRes[f];
    const rstr = (arr && arr.length) ? arr.map(r => r.id + ':' + Math.round(r.t * 10)).join(';') : '';
    if (rstr) { if (research.get(fk) !== rstr) research.set(fk, rstr); } else if (research.has(fk)) research.delete(fk);
    const done = sim.techDone[f], n = done ? done.size : 0;                   // techDone только растёт → size = «версия»
    if (techN[f] !== n) { techN[f] = n; tech.set(fk, [...(done || [])].join(',')); }
  }
}

module.exports = { projectState, SPEC_ID, RELN, QPOS };
