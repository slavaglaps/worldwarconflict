// Авторитетная комната: крутит чистый Sim и проецирует его в схему Colyseus.
// Клиент только рисует state и шлёт команды; вся логика и валидация — здесь.
const { Room, ServerError } = require('colyseus');
const { GameState, CityState, SquadState, ShipState, PlaneState, POS_Q } = require('./schema');
const { Sim } = require('./sim/Sim');
const { verifyToken } = require('./auth');
const db = require('./db');
const MAP = require('./sim/map-data.json');

const RECONNECT_SEC = 30;   // окно реконнекта при обрыве — фракция сохраняется

const TICK_HZ = 15;
const CMD_RATE = { refill: 12, burst: 30 };
const SPEC_ID = { prod: 1, def: 2, atk: 3 };
const TRACK = { 1: 'prod', 2: 'def', 3: 'atk', prod: 'prod', def: 'def', atk: 'atk' };
const RELN = { war: 1, ally: 2 };
const YARD_KIND = { ship: 'ship', air: 'air' };

const intOrNull = (v) => {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
};
const finiteOrNull = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const pctOrNull = (v) => {
  const n = finiteOrNull(v);
  return n > 0 && n <= 1 ? n : null;
};
const QPOS = (v) => Math.min(65535, Math.max(0, Math.round(v * POS_Q)));   // позиция → fixed-point uint16 (вдвое меньше трафика, чем float32)
const PATCH_MS = 80;   // 12.5 Гц рассылки снапшотов (сим тикает 15 Гц; клиент интерполирует) → −37% трафика vs дефолт 50мс

class GameRoom extends Room {
  onCreate(options) {
    this.sim = new Sim(GameRoom.simOptions || { map: MAP, ai: true, politStart: 80, goldStart: 200 });   // Европа + ИИ; старт-ресурсы: война (50🏛) доступна сразу
    this.maxClients = this.sim.factions;
    this.assigned = {};                              // sessionId -> faction
    this.identities = {};                            // sessionId -> {id, username, guest}
    this.cmdBuckets = {};                            // sessionId -> token bucket анти-спама команд
    this.setMetadata({ name: (options && options.name) || 'Партия', region: (options && options.region) || 'eu', players: 0, maxPlayers: this.sim.factions, over: false });
    this.setState(new GameState());
    this.state.roomName = (options && options.name) || 'Партия';

    // инициализируем схему из сима (статика + стартовая динамика)
    for (const c of this.sim.cities) {
      const cs = new CityState();
      cs.gx = c.gx; cs.gz = c.gz; cs.size = c.size; cs.country = c.country; cs.capital = c.capital ? 1 : 0;
      cs.shipyard = c.isShipyard ? 1 : 0; cs.airport = c.isAirport ? 1 : 0;
      cs.owner = c.owner; cs.units = Math.round(c.units); cs.spec = 0; cs.tier = 0; cs.occ = 0;
      this.state.cities.set(String(c.idx), cs);
    }
    // экономика (gold/manpower/politPts) НЕ в broadcast-стейте — шлётся per-client в _sendEcon()

    // регистрация команды + фидбэк об отказе (sim вернул false → шлём клиенту 'denied')
    const cmd = (type, fn) => this.onMessage(type, (cl, m) => {
      const f = this.factionOf(cl); if (f === null) return;
      if (!this._allowCommand(cl)) { cl.send('denied', { cmd: type }); return; }
      if (fn(f, m) === false) cl.send('denied', { cmd: type });
    });
    cmd('buy',      (f, m) => this.sim.cmdBuy(f, intOrNull(m.city), String(m.spec ?? m.n ?? 'max')));
    cmd('upg',      (f, m) => this.sim.cmdUpgrade(f, intOrNull(m.city), TRACK[m.track]));
    cmd('send',     (f, m) => this.sim.cmdSend(f, intOrNull(m.from), intOrNull(m.to), pctOrNull(m.pct)));
    cmd('war',      (f, m) => this.sim.cmdWar(f, intOrNull(m.tg)));
    cmd('ally',     (f, m) => this.sim.cmdAlly(f, intOrNull(m.tg)));
    cmd('break',    (f, m) => this.sim.cmdBreak(f, intOrNull(m.tg)));
    cmd('sup',      (f, m) => this.sim.cmdSupport(f, intOrNull(m.tg)));
    cmd('peace',    (f, m) => this.sim.cmdPeace(f, intOrNull(m.tg), {
      land: !!m.land,
      money: intOrNull(m.money) ?? 0,
      repar: intOrNull(m.repar) ?? 0,
    }).ok !== false);
    cmd('research', (f, m) => this.sim.cmdResearch(f, String(m.node)));
    cmd('bship',    (f, m) => this.sim.cmdBuildShip(f, intOrNull(m.city)));
    cmd('bplane',   (f, m) => this.sim.cmdBuildPlane(f, intOrNull(m.city)));
    cmd('shipmove', (f, m) => this.sim.cmdShipMove(f, intOrNull(m.id), finiteOrNull(m.x), finiteOrNull(m.z)));
    cmd('airorder', (f, m) => this.sim.cmdAirOrder(f, m.recall ? -1 : intOrNull(m.city), finiteOrNull(m.x), finiteOrNull(m.z)));
    cmd('aa',       (f, m) => this.sim.cmdBuildAA(f, intOrNull(m.city)));
    cmd('yard',     (f, m) => this.sim.cmdBuildYard(f, intOrNull(m.city), YARD_KIND[m.kind]));

    this.setSimulationInterval((dtMs) => this.tick(dtMs / 1000), 1000 / TICK_HZ);
    this.setPatchRate(PATCH_MS);   // реже шлём снапшоты (клиент интерполирует движение) → меньше трафика, сеть — главный лимит
    console.log(`[GameRoom ${this.roomId}] sim: ${this.sim.cities.length} cities, ${this.sim.factions} factions`);
  }

  factionOf(cl) { const f = this.assigned[cl.sessionId]; return f === undefined ? null : f; }

  // экономика приватна: каждый клиент получает голду/манпауэр/политочки ТОЛЬКО своей фракции и союзников
  // (анти-чит — нельзя подсмотреть экономику врага через стейт). Враги в econ не попадают.
  _sendEcon() {
    const sim = this.sim, snap = (o) => [Math.round(sim.gold[o] || 0), Math.round(sim.manpower[o] || 0), Math.round(sim.politPts[o] || 0)];
    for (const cl of this.clients) {
      const f = this.factionOf(cl); if (f === null) continue;
      const econ = { [f]: snap(f) };
      for (let o = 0; o < sim.factions; o++) if (o !== f && sim.allied(f, o)) econ[o] = snap(o);
      cl.send('econ', { econ });
    }
  }

  _allowCommand(cl) {
    const now = Date.now() / 1000;
    const b = this.cmdBuckets[cl.sessionId] || (this.cmdBuckets[cl.sessionId] = { tokens: CMD_RATE.burst, ts: now });
    b.tokens = Math.min(CMD_RATE.burst, b.tokens + (now - b.ts) * CMD_RATE.refill);
    b.ts = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  // авторизация: JWT → identity; без токена → гость
  async onAuth(client, options) {
    if (options && options.token) {
      const claims = verifyToken(options.token);
      if (!claims) throw new ServerError(401, 'invalid or expired token');
      return { id: claims.id, username: claims.username, guest: false };
    }
    return { id: 'guest-' + client.sessionId.slice(0, 8), username: (options && options.name) || 'Гость', guest: true };
  }

  onJoin(cl, options) {
    const taken = new Set(Object.values(this.assigned));
    const req = options && Number.isInteger(options.faction) ? options.faction : -1;
    let f;
    if (req >= 0 && req < this.sim.factions && !taken.has(req)) f = req;   // запрошенная страна свободна → отдаём её
    else { f = 0; while (f < this.sim.factions && taken.has(f)) f++; if (f >= this.sim.factions) f = 0; }
    this.assigned[cl.sessionId] = f;
    this.identities[cl.sessionId] = cl.auth || { guest: true, username: 'Гость' };
    cl.send('assigned', { faction: f, you: this.identities[cl.sessionId] });
    this._syncMeta();
  }

  // обрыв связи → ждём реконнекта RECONNECT_SEC секунд (фракция сохраняется)
  async onLeave(cl, consented) {
    if (!consented) { try { await this.allowReconnection(cl, RECONNECT_SEC); return; } catch (e) { /* не вернулся */ } }
    delete this.assigned[cl.sessionId]; delete this.identities[cl.sessionId]; delete this.cmdBuckets[cl.sessionId];
    this._syncMeta();
  }

  _syncMeta() {
    this.sim.humanFactions = new Set(Object.values(this.assigned));   // ИИ не управляет занятыми людьми
    const n = Object.keys(this.assigned).length;
    if (this.state) this.state.playerCount = n;
    this.setMetadata({ ...this.metadata, players: n });
  }

  // итоги матча: W/L при выбывании/победе (только зарегистрированным игрокам)
  _handleEliminations() {
    const idByFaction = {};
    for (const sid in this.assigned) idByFaction[this.assigned[sid]] = this.identities[sid];
    for (const e of this.sim.eliminations.splice(0)) {
      const dead = idByFaction[e.dead];
      if (dead && !dead.guest) db.recordMatch({ ts: Date.now(), players: [{ id: dead.id, won: false }] }).catch(() => {});
      const alive = new Set(this.sim.cities.map(c => c.owner));
      if (alive.size === 1) {
        const win = idByFaction[[...alive][0]];
        if (win && !win.guest) db.recordMatch({ ts: Date.now(), players: [{ id: win.id, won: true }] }).catch(() => {});
        this.setMetadata({ ...this.metadata, over: true });
      }
    }
  }

  tick(dt) {
    // error-boundary: один битый тик логируется (с троттлингом), а не вешает комнату
    try { this._tick(dt); }
    catch (e) { if (((this._tickErrs = (this._tickErrs || 0) + 1) % 60) === 1) console.error(`[GameRoom ${this.roomId}] tick error:`, (e && e.stack) || e); }
  }
  _tick(dt) {
    this.sim.tick(dt);
    if (this.sim.eliminations.length) this._handleEliminations();
    this.state.tick++;
    // проекция sim → схема (Colyseus сериализует только изменившиеся поля)
    const cs = this.state.cities;
    for (const c of this.sim.cities) {
      const s = cs.get(String(c.idx));
      s.owner = c.owner;
      s.units = Math.min(65535, Math.round(c.units));
      s.spec = SPEC_ID[c.spec] || 0;
      s.tier = c.tier;
      s.occ = c.occ ? 1 : 0;
      s.shipyard = c.isShipyard ? 1 : 0; s.airport = c.isAirport ? 1 : 0;   // динамические верфи/аэродромы
      s.aa = c.aa | 0;
      s.queued = Math.min(65535, Math.round(c.queued));                     // ⏳ производство
      let su = 0, so = 0;                                                    // сильнейший осаждающий пул
      if (c.siege) for (const o in c.siege) if (c.siege[o].units > su) { su = c.siege[o].units; so = +o; }
      s.siegeUnits = Math.min(65535, Math.round(su)); s.siegeOwner = so;
      // ── таймеры (в десятых долях секунды) ──
      const b0 = c.batches && c.batches[0];                                  // ⏳ найм: текущая партия
      s.prodTime    = b0 ? Math.min(65535, Math.round(b0.time * 10)) : 0;
      s.prodElapsed = b0 ? Math.min(65535, Math.round(b0.elapsed * 10)) : 0;
      s.shipQ  = Math.min(255, c.shipQueue | 0);                             // ⚓ верфь
      s.shipT  = Math.min(65535, Math.round((c.shipTimer || 0) * 10));
      s.planeQ = Math.min(255, c.planeQueue | 0);                           // ✈ аэродром
      s.planeT = Math.min(65535, Math.round((c.planeTimer || 0) * 10));
    }
    // отряды: добавить новые, обновить движущиеся, удалить дошедшие
    const sq = this.state.squads, live = new Set();
    for (const s of this.sim.squads) {
      const key = String(s.id); live.add(key);
      let ss = sq.get(key);
      if (!ss) { ss = new SquadState(); ss.owner = s.owner; sq.set(key, ss); }
      ss.count = Math.round(s.fcount); ss.x = QPOS(s.x); ss.z = QPOS(s.z); ss.fighting = s.foe ? 1 : 0;
    }
    for (const k of [...sq.keys()]) if (!live.has(k)) sq.delete(k);
    // флот
    const shp = this.state.ships, slive = new Set();
    for (const s of this.sim.ships) { const k = String(s.id); slive.add(k); let ss = shp.get(k); if (!ss) { ss = new ShipState(); ss.owner = s.owner; shp.set(k, ss); } ss.x = QPOS(s.x); ss.z = QPOS(s.z); ss.hp = Math.max(0, Math.round(s.hp)); ss.fighting = s.foe ? 1 : 0; }
    for (const k of [...shp.keys()]) if (!slive.has(k)) shp.delete(k);
    // авиация
    const pl = this.state.planes, plive = new Set();
    for (const p of this.sim.planes) { const k = String(p.id); plive.add(k); let ps = pl.get(k); if (!ps) { ps = new PlaneState(); ps.owner = p.owner; pl.set(k, ps); } ps.x = QPOS(p.x); ps.z = QPOS(p.z); ps.hp = Math.max(0, Math.round(p.hp)); ps.fighting = p.foe ? 1 : 0; }
    for (const k of [...pl.keys()]) if (!plive.has(k)) pl.delete(k);
    if ((this.state.tick & 1) === 0) this._sendEcon();   // экономика per-client (own+allies) ~7.5 Гц — без утечки чужой голды
    // дипломатия: добавить/обновить активные отношения, удалить ставшие нейтральными
    const rel = this.sim.relations, sr = this.state.relations;
    for (const k in rel) { const v = RELN[rel[k]] || 0; if (v && sr.get(k) !== v) sr.set(k, v); }
    for (const k of [...sr.keys()]) if (!rel[k]) sr.delete(k);
    // часы сима (для отсчёта мобилизации) + время начала каждой войны
    this.state.clock = this.sim.time;
    const ws = this.state.warStart, since = this.sim.warSince;
    for (const k in since) if (rel[k] === 'war') { if (ws.get(k) !== since[k]) ws.set(k, since[k]); }
    for (const k of [...ws.keys()]) if (rel[k] !== 'war') ws.delete(k);
    // технологии: активные исследования (id:tДс) + завершённые (id,id) — на фракцию
    const research = this.state.research, tech = this.state.tech;
    this._techN = this._techN || [];
    for (let f = 0; f < this.sim.factions; f++) {
      const fk = String(f), arr = this.sim.techRes[f];
      const rstr = (arr && arr.length) ? arr.map(r => r.id + ':' + Math.round(r.t * 10)).join(';') : '';
      if (rstr) { if (research.get(fk) !== rstr) research.set(fk, rstr); } else if (research.has(fk)) research.delete(fk);
      const done = this.sim.techDone[f], n = done ? done.size : 0;   // techDone только растёт → size = «версия», строку пересобираем лишь при изменении
      if (this._techN[f] !== n) { this._techN[f] = n; tech.set(fk, [...(done || [])].join(',')); }
    }
  }
}

GameRoom.simOptions = null;   // сервер может задать конфиг сима (напр. тесты); по умолчанию 6×18
module.exports = { GameRoom };
