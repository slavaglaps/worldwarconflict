// Авторитетная комната: крутит чистый Sim и проецирует его в схему Colyseus.
// Клиент только рисует state и шлёт команды; вся логика и валидация — здесь.
const { Room, ServerError } = require('colyseus');
const { GameState, CityState, SquadState, ShipState, PlaneState, POS_Q } = require('./schema');
const { projectState } = require('./schema-project');   // проекция Sim → схема (тестируется отдельно)
const { Sim } = require('./sim/Sim');
const { deepMerge } = require('./sim/balance');
const { verifyToken } = require('./auth');
const db = require('./db');
const metrics = require('./metrics');
const { performance } = require('perf_hooks');
const MAP = require('./sim/map-data.json');

const RECONNECT_SEC = 30;   // окно реконнекта при обрыве — фракция сохраняется

const TICK_HZ = 15;
const CMD_RATE = { refill: 12, burst: 30 };
const TRACK = { 1: 'prod', 2: 'def', 3: 'atk', prod: 'prod', def: 'def', atk: 'atk' };
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
const PATCH_MS = 80;   // 12.5 Гц рассылки снапшотов (сим тикает 15 Гц; клиент интерполирует) → −37% трафика vs дефолт 50мс

class GameRoom extends Room {
  onCreate(options) {
    const simOpts = { ...(GameRoom.simOptions || { map: MAP, ai: true }) };   // Европа + ИИ
    if (!simOpts.balance) {
      // прод-старты (gold 200/polit 80 — война 50🏛 доступна сразу) — НИЖНИЙ слой; Directus-override ПОВЕРХ.
      // (Раньше передавались как goldStart/politStart, и Sim перезаписывал ими баланс → правки стартов из Directus игнорировались. Баг #1.)
      simOpts.balance = deepMerge({ factionDefault: { gold: 200, polit: 80 } }, require('./balance-store').current());
    }
    this.bmeta = require('./balance-store').currentMeta();   // ревизия баланса (version) — фиксируем на комнату, шлём клиенту
    this.sim = new Sim(simOpts);
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
      cs.owner = c.owner; cs.units = Math.round(c.units); cs.spec = 0; cs.tier = 0;
      cs.prodTier = 0; cs.defTier = 0; cs.atkTier = 0; cs.occ = 0;
      this.state.cities.set(String(c.idx), cs);
    }
    // экономика (gold/manpower/politPts) НЕ в broadcast-стейте — шлётся per-client в _sendEcon()

    // регистрация команды + фидбэк об отказе (sim вернул false → шлём клиенту 'denied')
    const cmd = (type, fn) => this.onMessage(type, (cl, m) => {
      const f = this.factionOf(cl); if (f === null) return;
      if (!this._allowCommand(cl)) { cl.send('denied', { cmd: type }); metrics.command(true); return; }
      let ok = true;
      try { ok = fn(f, m) !== false; } catch (e) { ok = false; metrics.error(`cmd:${type}`, e); }
      if (!ok) cl.send('denied', { cmd: type });
      metrics.command(!ok);
    });
    cmd('buy',      (f, m) => this.sim.cmdBuy(f, intOrNull(m.city), String(m.spec ?? m.n ?? 'max')));
    cmd('upg',      (f, m) => this.sim.cmdUpgrade(f, intOrNull(m.city), TRACK[m.track]));
    cmd('send',     (f, m) => this.sim.cmdSend(f, intOrNull(m.from), intOrNull(m.to), pctOrNull(m.pct)));
    cmd('war',      (f, m) => this.sim.cmdWar(f, intOrNull(m.tg)));
    cmd('ally',     (f, m) => this.sim.cmdAlly(f, intOrNull(m.tg)));
    cmd('break',    (f, m) => this.sim.cmdBreak(f, intOrNull(m.tg)));
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
    cmd('hero',     (f, m) => this.sim.cmdHeroAbility(f, intOrNull(m.h), intOrNull(m.ab)));   // активка героя (h=индекс слота, ab=индекс активки)
    // 💰 поддержка: успех → точный ack (сумма + получатель) + немедленный econ-пуш (голда отправителя/получателя)
    this.onMessage('sup', (cl, m) => {
      const f = this.factionOf(cl); if (f === null) return;
      if (!this._allowCommand(cl)) { cl.send('denied', { cmd: 'sup' }); metrics.command(true); return; }
      let r = { ok: false }; try { r = this.sim.cmdSupport(f, intOrNull(m.tg)); } catch (e) { metrics.error('cmd:sup', e); }
      if (!r || !r.ok) { cl.send('denied', { cmd: 'sup' }); metrics.command(true); return; }
      metrics.command(false);
      cl.send('supDone', { to: r.to, amt: r.amt });
      this._sendEcon();   // не ждём тика — голда отправителя/получателя обновится сразу
    });
    // 🎖 призыв героя за манпауэр: успех → шлём призвавшему обновлённый список его слотов (клиент перестроит панель)
    this.onMessage('summon', (cl, m) => {
      const f = this.factionOf(cl); if (f === null) return;
      if (!this._allowCommand(cl)) { cl.send('denied', { cmd: 'summon' }); metrics.command(true); return; }
      let ok = false; try { ok = this.sim.cmdSummonHero(f, String(m && m.id)); } catch (e) { metrics.error('cmd:summon', e); }
      if (!ok) { cl.send('denied', { cmd: 'summon' }); metrics.command(true); return; }
      metrics.command(false);
      cl.send('balance', { heroes: { pool: this.sim.B.heroes.pool, slots: this.sim.heroSlots[f].map(h => h.id), maxSlots: this.sim.heroMaxSlots } });
    });

    this.setSimulationInterval((dtMs) => this.tick(dtMs / 1000), 1000 / TICK_HZ);
    this.setPatchRate(PATCH_MS);   // реже шлём снапшоты (клиент интерполирует движение) → меньше трафика, сеть — главный лимит
    console.log(`[GameRoom ${this.roomId}] sim: ${this.sim.cities.length} cities, ${this.sim.factions} factions`);
    metrics.roomCreated();
  }

  onDispose() { metrics.roomDisposed(); }

  factionOf(cl) { const f = this.assigned[cl.sessionId]; return f === undefined ? null : f; }

  // экономика приватна: каждый клиент получает голду/манпауэр/политочки ТОЛЬКО своей фракции и союзников
  // (анти-чит — нельзя подсмотреть экономику врага через стейт). Враги в econ не попадают.
  _sendEcon() {
    const sim = this.sim, snap = (o) => [Math.round(sim.gold[o] || 0), Math.round(sim.manpower[o] || 0), Math.round(sim.politPts[o] || 0)];
    for (const cl of this.clients) {
      const f = this.factionOf(cl); if (f === null) continue;
      const econ = { [f]: snap(f) };
      for (let o = 0; o < sim.factions; o++) if (o !== f && sim.allied(f, o)) econ[o] = snap(o);
      cl.send('econ', { econ, hero: this._heroState(f) });   // кулдауны/баффы своих героев (приватно)
    }
  }
  // ПОЛНЫЙ публичный баланс юнитов/экономики/боя: ВСЕ числовые константы комнаты (this.K с учётом balance.tune)
  // — цены, ХП/урон/радиусы/скорости, ПВО, формулы города и т.д. Клиент берёт нужные для показа, чтобы UI
  // совпадал с авторитетным сервером (раньше слалась лишь горстка цен → правки SHIP_HP/радиусов/… не доходили).
  _prices() {
    const K = this.sim.K, out = {};
    for (const k in K) if (typeof K[k] === 'number') out[k] = K[k];
    return out;
  }
  // состояние героев фракции для клиента: кулдауны по слотам + активные баффы (с остатком времени)
  _heroState(f) {
    const sim = this.sim, hs = sim.heroSlots[f] || [];
    const buffs = [];
    for (const b of sim.heroBuffs) if (b.fid === f) buffs.push({ key: b.key, add: b.add, t: Math.max(0, b.until - sim.time) });
    return { cd: hs.map(h => h.cd.map(x => Math.max(0, Math.round(x * 10) / 10))), buffs };
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
    metrics.join();
    const taken = new Set(Object.values(this.assigned));
    const req = options && Number.isInteger(options.faction) ? options.faction : -1;
    let f;
    if (req >= 0 && req < this.sim.factions && !taken.has(req)) f = req;   // запрошенная страна свободна → отдаём её
    else { f = 0; while (f < this.sim.factions && taken.has(f)) f++; if (f >= this.sim.factions) f = 0; }
    this.assigned[cl.sessionId] = f;
    this.identities[cl.sessionId] = cl.auth || { guest: true, username: 'Гость' };
    cl.send('assigned', { faction: f, you: this.identities[cl.sessionId] });
    // активный баланс комнаты клиенту: глобальные правила (политика/техи) + СВОЯ фракция (без асимметрии врагов)
    const B = this.sim.B;
    // герои: пул определений (для UI) + РЕЗОЛВНУТЫЕ id героев именно этой страны (после авто-ротации). Чужих героев не шлём.
    // prices: эффективные цены/стоимости комнаты (this.K с учётом balance.tune) — клиент показывает их в UI.
    cl.send('balance', { version: (this.bmeta && this.bmeta.version) || B.version, updatedAt: this.bmeta && this.bmeta.updatedAt,
      politics: B.politics, tech: B.tech, faction: this.sim.fb[f],
      heroes: { pool: B.heroes.pool, slots: this.sim.heroSlots[f].map(h => h.id), maxSlots: this.sim.heroMaxSlots }, prices: this._prices() });
    this._syncMeta();
  }

  // обрыв связи → ждём реконнекта RECONNECT_SEC секунд (фракция сохраняется)
  async onLeave(cl, consented) {
    if (!consented) { try { await this.allowReconnection(cl, RECONNECT_SEC); return; } catch (e) { /* не вернулся */ } }
    delete this.assigned[cl.sessionId]; delete this.identities[cl.sessionId]; delete this.cmdBuckets[cl.sessionId];
    metrics.leave();
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
    // error-boundary: один битый тик логируется (с троттлингом) + считается в метрики, а не вешает комнату
    const t0 = performance.now();
    try { this._tick(dt); }
    catch (e) { metrics.error('tick', e); if (((this._tickErrs = (this._tickErrs || 0) + 1) % 60) === 1) console.error(`[GameRoom ${this.roomId}] tick error:`, (e && e.stack) || e); }
    metrics.tick(performance.now() - t0);
  }
  _tick(dt) {
    this.sim.tick(dt);
    if (this.sim.eliminations.length) this._handleEliminations();
    this.state.tick++;
    this._techN = this._techN || [];                     // «версии» завершённых техов на фракцию (растут)
    projectState(this.sim, this.state, this._techN);     // sim → схема (cities/movers/diplomacy/tech/clock) — см. schema-project.js
    if ((this.state.tick & 1) === 0) this._sendEcon();   // экономика per-client (own+allies) ~7.5 Гц — без утечки чужой голды
  }
}

GameRoom.simOptions = null;   // сервер может задать конфиг сима (напр. тесты); по умолчанию 6×18
module.exports = { GameRoom };
