// Авторитетная комната: крутит чистый Sim и проецирует его в схему Colyseus.
// Клиент только рисует state и шлёт команды; вся логика и валидация — здесь.
const { Room, ServerError } = require('colyseus');
const { GameState, CityState, SquadState, ShipState, PlaneState } = require('./schema');
const { Sim } = require('./sim/Sim');
const { verifyToken } = require('./auth');
const db = require('./db');
const MAP = require('./sim/map-data.json');

const RECONNECT_SEC = 30;   // окно реконнекта при обрыве — фракция сохраняется

const TICK_HZ = 15;
const SPEC_ID = { prod: 1, def: 2, atk: 3 };
const TRACK = { 1: 'prod', 2: 'def', 3: 'atk', prod: 'prod', def: 'def', atk: 'atk' };
const RELN = { war: 1, ally: 2 };

class GameRoom extends Room {
  onCreate(options) {
    this.sim = new Sim(GameRoom.simOptions || { map: MAP, ai: true });   // реальная Европа (143 города, 24 страны) + ИИ незанятых
    this.maxClients = this.sim.factions;
    this.assigned = {};                              // sessionId -> faction
    this.identities = {};                            // sessionId -> {id, username, guest}
    this.setMetadata({ name: (options && options.name) || 'Партия', region: (options && options.region) || 'eu', players: 0, maxPlayers: this.sim.factions, over: false });
    this.setState(new GameState());

    // инициализируем схему из сима (статика + стартовая динамика)
    for (const c of this.sim.cities) {
      const cs = new CityState();
      cs.gx = c.gx; cs.gz = c.gz; cs.size = c.size; cs.country = c.country; cs.capital = c.capital ? 1 : 0;
      cs.shipyard = c.isShipyard ? 1 : 0; cs.airport = c.isAirport ? 1 : 0;
      cs.owner = c.owner; cs.units = Math.round(c.units); cs.spec = 0; cs.tier = 0; cs.occ = 0;
      this.state.cities.set(String(c.idx), cs);
    }
    for (let f = 0; f < this.sim.factions; f++) { this.state.gold.push(this.sim.gold[f]); this.state.manpower.push(this.sim.manpower[f]); this.state.politPts.push(this.sim.politPts[f]); }

    // команды городов
    this.onMessage('buy',  (cl, m) => { const f = this.factionOf(cl); if (f !== null) this.sim.cmdBuy(f, m.city | 0, String(m.spec ?? m.n ?? 'max')); });
    this.onMessage('upg',  (cl, m) => { const f = this.factionOf(cl); if (f !== null) this.sim.cmdUpgrade(f, m.city | 0, TRACK[m.track]); });
    this.onMessage('send', (cl, m) => { const f = this.factionOf(cl); if (f !== null) this.sim.cmdSend(f, m.from | 0, m.to | 0, m.pct ?? 0.5); });
    // дипломатия
    this.onMessage('war',   (cl, m) => { const f = this.factionOf(cl); if (f !== null) this.sim.cmdWar(f, m.tg | 0); });
    this.onMessage('ally',  (cl, m) => { const f = this.factionOf(cl); if (f !== null) this.sim.cmdAlly(f, m.tg | 0); });
    this.onMessage('break', (cl, m) => { const f = this.factionOf(cl); if (f !== null) this.sim.cmdBreak(f, m.tg | 0); });
    this.onMessage('sup',   (cl, m) => { const f = this.factionOf(cl); if (f !== null) this.sim.cmdSupport(f, m.tg | 0); });
    this.onMessage('peace', (cl, m) => { const f = this.factionOf(cl); if (f !== null) this.sim.cmdPeace(f, m.tg | 0, { land: !!m.land, money: m.money | 0, repar: m.repar | 0 }); });
    // исследования
    this.onMessage('research', (cl, m) => { const f = this.factionOf(cl); if (f !== null) this.sim.cmdResearch(f, String(m.node)); });
    // флот / авиация
    this.onMessage('bship',    (cl, m) => { const f = this.factionOf(cl); if (f !== null) this.sim.cmdBuildShip(f, m.city | 0); });
    this.onMessage('bplane',   (cl, m) => { const f = this.factionOf(cl); if (f !== null) this.sim.cmdBuildPlane(f, m.city | 0); });
    this.onMessage('shipmove', (cl, m) => { const f = this.factionOf(cl); if (f !== null) this.sim.cmdShipMove(f, m.id | 0, m.x, m.z); });
    this.onMessage('airorder', (cl, m) => { const f = this.factionOf(cl); if (f !== null) this.sim.cmdAirOrder(f, m.recall ? -1 : (m.city != null ? m.city | 0 : -1), m.x, m.z); });
    this.onMessage('aa',       (cl, m) => { const f = this.factionOf(cl); if (f !== null) this.sim.cmdBuildAA(f, m.city | 0); });
    this.onMessage('yard',     (cl, m) => { const f = this.factionOf(cl); if (f !== null) this.sim.cmdBuildYard(f, m.city | 0, m.kind); });

    this.setSimulationInterval((dtMs) => this.tick(dtMs / 1000), 1000 / TICK_HZ);
    console.log(`[GameRoom ${this.roomId}] sim: ${this.sim.cities.length} cities, ${this.sim.factions} factions`);
  }

  factionOf(cl) { const f = this.assigned[cl.sessionId]; return f === undefined ? null : f; }

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
    delete this.assigned[cl.sessionId]; delete this.identities[cl.sessionId];
    this._syncMeta();
  }

  _syncMeta() {
    this.sim.humanFactions = new Set(Object.values(this.assigned));   // ИИ не управляет занятыми людьми
    this.setMetadata({ ...this.metadata, players: Object.keys(this.assigned).length });
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
    this.sim.tick(dt);
    if (this.sim.eliminations.length) this._handleEliminations();
    this.state.tick++;
    // проекция sim → схема (Colyseus сериализует только изменившиеся поля)
    const cs = this.state.cities;
    for (const c of this.sim.cities) {
      const s = cs.get(String(c.idx));
      s.owner = c.owner;
      s.units = Math.round(c.units);
      s.spec = SPEC_ID[c.spec] || 0;
      s.tier = c.tier;
      s.occ = c.occ ? 1 : 0;
      s.shipyard = c.isShipyard ? 1 : 0; s.airport = c.isAirport ? 1 : 0;   // динамические верфи/аэродромы
      s.aa = c.aa | 0;
    }
    // отряды: добавить новые, обновить движущиеся, удалить дошедшие
    const sq = this.state.squads, live = new Set();
    for (const s of this.sim.squads) {
      const key = String(s.id); live.add(key);
      let ss = sq.get(key);
      if (!ss) { ss = new SquadState(); ss.owner = s.owner; sq.set(key, ss); }
      ss.count = Math.round(s.fcount); ss.x = s.x; ss.z = s.z; ss.fighting = s.foe ? 1 : 0;
    }
    for (const k of [...sq.keys()]) if (!live.has(k)) sq.delete(k);
    // флот
    const shp = this.state.ships, slive = new Set();
    for (const s of this.sim.ships) { const k = String(s.id); slive.add(k); let ss = shp.get(k); if (!ss) { ss = new ShipState(); ss.owner = s.owner; shp.set(k, ss); } ss.x = s.x; ss.z = s.z; ss.hp = Math.max(0, Math.round(s.hp)); ss.fighting = s.foe ? 1 : 0; }
    for (const k of [...shp.keys()]) if (!slive.has(k)) shp.delete(k);
    // авиация
    const pl = this.state.planes, plive = new Set();
    for (const p of this.sim.planes) { const k = String(p.id); plive.add(k); let ps = pl.get(k); if (!ps) { ps = new PlaneState(); ps.owner = p.owner; pl.set(k, ps); } ps.x = p.x; ps.z = p.z; ps.hp = Math.max(0, Math.round(p.hp)); ps.fighting = p.foe ? 1 : 0; }
    for (const k of [...pl.keys()]) if (!plive.has(k)) pl.delete(k);
    for (let f = 0; f < this.sim.factions; f++) { this.state.gold[f] = this.sim.gold[f]; this.state.manpower[f] = this.sim.manpower[f]; this.state.politPts[f] = this.sim.politPts[f]; }
    // дипломатия: добавить/обновить активные отношения, удалить ставшие нейтральными
    const rel = this.sim.relations, sr = this.state.relations;
    for (const k in rel) { const v = RELN[rel[k]] || 0; if (v && sr.get(k) !== v) sr.set(k, v); }
    for (const k of [...sr.keys()]) if (!rel[k]) sr.delete(k);
  }
}

GameRoom.simOptions = null;   // сервер может задать конфиг сима (напр. тесты); по умолчанию 6×18
module.exports = { GameRoom };
