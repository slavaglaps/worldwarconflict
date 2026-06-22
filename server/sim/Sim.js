// Чистая симуляция мира (без Three/DOM/Colyseus). Крутится сервером.
// Фаза 1a: экономика + производство + манпауэр + осада/захват/оккупация.
// Пункт 1 (1b): дипломатия (война/мир/союз/поддержка), политочки, древо технологий.
// Фаза 1b далее: реальная карта-граф, движение отрядов, флот/авиация + spatial-grid.
const { City } = require('./City');
const { Squad } = require('./Squad');
const { Ship } = require('./Ship');
const { Plane } = require('./Plane');
const { SpatialGrid } = require('./SpatialGrid');
const { nearestWaterPoint, isWaterAt } = require('./water');
const { recomputeTech, nodeReady } = require('./tech');
const { makeBalance, makeConstants, factionBal } = require('./balance');

class Sim {
  constructor(opts = {}) {
    this.map = opts.map || null;                     // реальная карта (map-data.json) или toy-мир
    this.factions = this.map ? this.map.factions.length : (opts.factions || 6);
    this.rng = opts.rng || Math.random;             // инъекция для детерминированных тестов
    // ── баланс: дефолты ⊕ override (opts.balance). Старые opts goldStart/politStart/warPrep — совместимы. ──
    this.B = makeBalance(opts.balance);
    if (opts.goldStart != null) this.B.factionDefault.gold = opts.goldStart;
    if (opts.politStart != null) this.B.factionDefault.polit = opts.politStart;
    if (opts.warPrep != null) this.B.politics.warPrep = opts.warPrep;
    this.warPrep = this.B.politics.warPrep;          // секунд мобилизации перед атакой (warCountdown; тесты могут занулить)
    this.K = makeConstants(this.B);                  // игровые константы комнаты: код-дефолты ⊕ balance.tune (юниты/экономика/бой)
    this.fb = [];                                    // баланс на фракцию (factionDefault ⊕ factions[id]) — O(1) доступ
    for (let f = 0; f < this.factions; f++) this.fb[f] = factionBal(this.B, f);
    this.techNode = this.B.tech.nodes;               // узлы дерева технологий этой комнаты (id → узел, из баланса)
    this.techNodeList = Object.values(this.techNode);
    // ── ГЕРОИ: пер-фракционный авторитетный движок. heroSlots[fid]=[{id,cd:[кд активок]}]. ──
    this.heroPool = (this.B.heroes && this.B.heroes.pool) || {};
    const heroIds = Object.keys(this.heroPool);
    const perF = (this.B.heroes && this.B.heroes.perFaction) || 0, maxS = (this.B.heroes && this.B.heroes.maxSlots) || 3;   // сколько героев на фракцию (авто) + потолок слотов
    this.heroSlots = []; this.heroBuffs = []; this.heroMods = [];   // heroMods[fid]={key:сумма} — кэш для O(1) techMul
    for (let f = 0; f < this.factions; f++) {
      let ids = this.fb[f].heroes;                  // из баланса; null → авто-ротация из пула по fid (уникально на страну)
      if (!Array.isArray(ids)) { ids = []; for (let i = 0; i < perF && heroIds.length; i++) ids.push(heroIds[(f * perF + i) % heroIds.length]); }
      ids = ids.filter(id => this.heroPool[id]).slice(0, maxS);    // только валидные id, максимум maxSlots
      this.heroSlots[f] = ids.map(id => ({ id, cd: this.heroPool[id].abilities.filter(a => a.kind === 'active').map(() => 0) }));
      this._recomputeHeroMods(f);
    }
    this.aiEnabled = opts.ai ?? false;              // ИИ управляет незанятыми фракциями (вкл. для реальной игры)
    this.humanFactions = new Set();                 // обновляется комнатой; ИИ их не трогает
    this.factionTimer = [];                         // таймеры раздумий ИИ
    this.cities = [];
    this.squads = [];
    this.ships = [];
    this.planes = [];
    this.airOrder = [];                              // [fid]: {kind:'bomb',cityIdx} | {kind:'patrol',x,z} | null
    this.navalGrid = new SpatialGrid(this.K.SHIP_RANGE);  // O(n) морской бой
    this.airGrid = new SpatialGrid(this.K.PLANE_RANGE);   // O(n) воздушный бой
    this.squadGrid = new SpatialGrid(this.K.FIELD_RANGE); // O(n) полевой бой
    this.adj = new Map();                            // idx -> [{to, edge}]
    this.edgeKey = new Map();                        // "a_b" -> {a,b,type,len,mult}
    this.gold = [];
    this.manpower = [];
    this.politPts = [];
    this.time = 0;
    // дипломатия (ключ relKey "a_b", a<b)
    this.relations = {}; this.warSince = {}; this.truceUntil = {}; this.peaceCD = {};
    this.reparations = [];                           // {from,to,pct,until}
    this.eliminations = [];                          // очередь {dead, by} — дренируется комнатой для итогов
    // технологии (на фракцию)
    this.techDone = []; this.techRes = []; this.techCache = [];
    this._initTech();
    this._buildWorld(opts);
    if (opts.grantNavyTech) for (let f = 0; f < this.factions; f++) { this.techDone[f].add('i1'); this.techDone[f].add('i8'); this.techCache[f] = recomputeTech(this.techDone[f], this.techNode); }
    for (let f = 0; f < this.factions; f++) this.factionTimer[f] = this.rng() * 4.5;   // фазовый сдвиг «раздумий» ИИ → нет синхронного спайка тика
  }

  _initTech() {
    for (let f = 0; f < this.factions; f++) { this.techDone[f] = new Set(); this.techRes[f] = []; this.techCache[f] = recomputeTech(this.techDone[f], this.techNode); }
  }

  _buildWorld(opts) {
    const tm = (o, b) => this.techMul(o, b), tv = (o, k) => this.techVal(o, k);
    if (this.map) {
      const cid = {}; this.map.factions.forEach(f => cid[f.country] = f.id);   // имя страны → числовой id
      for (const cd of this.map.cities) this.cities.push(new City({
        idx: cd.idx, gx: cd.gx, gz: cd.gz, country: cid[cd.country] ?? 0, size: cd.size, owner: cd.owner,
        capital: cd.capital, isShipyard: cd.shipyard, isAirport: cd.airport, tm, tv, K: this.K,
      }));
      this._buildGraph(this.map.edges);
    } else {
      const N = opts.cities || 18;
      for (let i = 0; i < N; i++) this.cities.push(new City({
        idx: i, gx: (i * 7) % this.K.GRID, gz: (i * 13) % this.K.GRID,
        country: i % this.factions, size: 1 + (i % 3), owner: i % this.factions, capital: i < this.factions, tm, tv, K: this.K,
      }));
    }
    for (let f = 0; f < this.factions; f++) { this.gold[f] = this.fb[f].gold; this.politPts[f] = this.fb[f].polit; }
    for (const c of this.cities) c.units = this.fb[c.owner].garrisonBase + c.size * this.fb[c.owner].garrisonPerSize;  // пер-фракционный стартовый гарнизон
    for (let f = 0; f < this.factions; f++) this.manpower[f] = this.manpowerCap(f);
  }

  // ── граф городов (для движения отрядов) ──
  _ek(a, b) { return a < b ? a + '_' + b : b + '_' + a; }
  edgeBetween(a, b) { return this.edgeKey.get(this._ek(a, b)); }
  _buildGraph(edges) {
    for (const e of edges) {
      const edge = { a: e.a, b: e.b, type: e.type, len: e.len, mult: e.mult };
      this.edgeKey.set(this._ek(e.a, e.b), edge);
      if (!this.adj.has(e.a)) this.adj.set(e.a, []);
      if (!this.adj.has(e.b)) this.adj.set(e.b, []);
      this.adj.get(e.a).push({ to: e.b, edge });
      this.adj.get(e.b).push({ to: e.a, edge });
    }
  }
  // Дейкстра: путь от from к to для владельца owner. Пройти через узел можно если он свой/союзный
  // (canPass); цель — исключение (по ней бьём). null если недостижимо.
  findPath(fromIdx, toIdx, owner) {
    if (fromIdx === toIdx || !this.adj.size) return null;
    const dist = new Map([[fromIdx, 0]]), prev = new Map(), seen = new Set();
    const pq = [[0, fromIdx]];
    while (pq.length) {
      let bi = 0; for (let i = 1; i < pq.length; i++) if (pq[i][0] < pq[bi][0]) bi = i;
      const [d, u] = pq.splice(bi, 1)[0];
      if (seen.has(u)) continue; seen.add(u);
      if (u === toIdx) break;
      for (const { to, edge } of (this.adj.get(u) || [])) {
        if (to !== toIdx && !this.canPass(owner, this.cities[to].owner)) continue;
        const nd = d + edge.len / (this.K.SQUAD_SPEED * edge.mult);
        if (nd < (dist.get(to) ?? Infinity)) { dist.set(to, nd); prev.set(to, u); pq.push([nd, to]); }
      }
    }
    if (!prev.has(toIdx)) return null;
    const path = [toIdx]; let c = toIdx;
    while (c !== fromIdx) { c = prev.get(c); if (c === undefined) return null; path.push(c); }
    return path.reverse();
  }
  resolveArrival(s) {
    const c = this.cities[s.stopCity]; if (!c) return;
    if (c.owner === s.owner || this.allied(s.owner, c.owner)) c.units = Math.min(c.capacity, c.units + s.fcount);
    else { c.siege = c.siege || {}; const p = c.siege[s.owner] || (c.siege[s.owner] = { units: 0, atkMult: s.atkMult }); p.units += s.fcount; p.atkMult = s.atkMult; }
  }
  // полевой бой через spatial-grid: O(n) вместо O(n²) (как navalBattles/airBattles)
  fieldBattles(dt) {
    this.squadGrid.clear();
    for (const s of this.squads) this.squadGrid.insert(s, s.x, s.z);
    const R2 = this.K.FIELD_RANGE * this.K.FIELD_RANGE;
    for (const s of this.squads) {
      if (s.foe && s.foe.fcount < this.K.UNIT_MIN) s.foe = null;
      if (s.foe) continue;
      let best = null, bd = R2;                                   // ближайший враг в радиусе (раньше — первый в массиве)
      this.squadGrid.queryWithin(s.x, s.z, this.K.FIELD_RANGE, (o) => {
        if (o === s || o.owner === s.owner || this.allied(s.owner, o.owner) || !this.atWar(s.owner, o.owner)) return;
        const dx = s.x - o.x, dz = s.z - o.z, dd = dx * dx + dz * dz;
        if (dd < bd) { bd = dd; best = o; }
      });
      if (best) { s.foe = best; if (!best.foe) best.foe = s; }
    }
    for (const s of this.squads) if (s.foe && s.foe.fcount >= 0.5 && s.fcount >= 0.5) s.foe.fcount -= s.fcount * s.atkMult * this.K.FIGHT_RATE * dt;
  }

  // ── флот / авиация ──
  spawnShip(city) { const w = nearestWaterPoint(city.gx, city.gz); this.ships.push(new Ship(city.owner, w.x, w.z, this)); }
  spawnPlane(city) { this.planes.push(new Plane(city.owner, city.gx, city.gz, this)); }
  advanceBuildQueues(dt) {
    for (const c of this.cities) {
      if (c.isShipyard && c.shipQueue > 0) { c.shipTimer += dt; if (c.shipTimer >= this.K.SHIP_BUILD_TIME) { c.shipTimer = 0; c.shipQueue--; this.spawnShip(c); } }
      if (c.isAirport && c.planeQueue > 0) { c.planeTimer += dt; if (c.planeTimer >= this.K.PLANE_BUILD_TIME) { c.planeTimer = 0; c.planeQueue--; this.spawnPlane(c); } }
    }
  }
  // морской бой через spatial-grid: O(n) вместо O(n²)
  navalBattles(dt) {
    this.navalGrid.clear();
    for (const s of this.ships) if (s.hp > 0) this.navalGrid.insert(s, s.x, s.z);
    const R2 = this.K.SHIP_RANGE * this.K.SHIP_RANGE;
    for (const s of this.ships) {
      if (s.foe && s.foe.hp <= 0) s.foe = null;
      if (s.foe) continue;
      let best = null, bd = R2;
      this.navalGrid.queryWithin(s.x, s.z, this.K.SHIP_RANGE, (o) => {
        if (o === s || o.hp <= 0 || !this.atWar(s.owner, o.owner)) return;
        const dx = s.x - o.x, dz = s.z - o.z, dd = dx * dx + dz * dz;
        if (dd < bd) { bd = dd; best = o; }
      });
      if (best) { s.foe = best; if (!best.foe) best.foe = s; }
    }
    for (const s of this.ships) if (s.foe && s.foe.hp > 0) s.foe.hp -= this.K.SHIP_DMG * dt;
  }
  // воздушный бой через spatial-grid: O(n)
  airBattles(dt) {
    this.airGrid.clear();
    for (const p of this.planes) if (p.hp > 0) this.airGrid.insert(p, p.x, p.z);
    const R2 = this.K.PLANE_RANGE * this.K.PLANE_RANGE;
    for (const s of this.planes) {
      if (s.foe && s.foe.hp <= 0) s.foe = null;
      if (s.foe) continue;
      let best = null, bd = R2;
      this.airGrid.queryWithin(s.x, s.z, this.K.PLANE_RANGE, (o) => {
        if (o === s || o.hp <= 0 || !this.atWar(s.owner, o.owner)) return;
        const dx = s.x - o.x, dz = s.z - o.z, dd = dx * dx + dz * dz;
        if (dd < bd) { bd = dd; best = o; }
      });
      if (best) { s.foe = best; if (!best.foe) best.foe = s; }
    }
    for (const s of this.planes) if (s.foe && s.foe.hp > 0) s.foe.hp -= this.K.PLANE_DMG * dt;
  }
  cmdBuildShip(fid, idx) {
    const c = this.cities[idx];
    if (!c || c.owner !== fid || c.occ || !c.isShipyard || !this.techFlag(fid, 'ships')) return false;
    if (this.gold[fid] < this.K.SHIP_COST || (this.manpower[fid] || 0) < this.K.SHIP_MP) return false;
    if (this._navalCount(fid) >= this.K.MAX_SHIPS) return false;   // хард-кап флота на фракцию
    this.gold[fid] -= this.K.SHIP_COST; this.manpower[fid] -= this.K.SHIP_MP; c.shipQueue++; return true;
  }
  cmdBuildPlane(fid, idx) {
    const c = this.cities[idx];
    if (!c || c.owner !== fid || c.occ || !c.isAirport || !this.techFlag(fid, 'planes')) return false;
    if (this.gold[fid] < this.K.PLANE_COST || (this.manpower[fid] || 0) < this.K.PLANE_MP) return false;
    if (this._airCount(fid) >= this.K.MAX_PLANES) return false;   // хард-кап авиации на фракцию
    this.gold[fid] -= this.K.PLANE_COST; this.manpower[fid] -= this.K.PLANE_MP; c.planeQueue++; return true;
  }
  cmdShipMove(fid, shipId, x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    const s = this.ships.find(sh => sh.id === shipId && sh.owner === fid); if (!s) return false; s.setTarget(x, z); return true;
  }
  // приказ авиации: бомбить вражеский город / патрулировать точку / отозвать
  cmdAirOrder(fid, cityIdx, x, z) {
    if (cityIdx != null && cityIdx >= 0) {
      const c = this.cities[cityIdx];
      if (c && c.owner !== fid && this.atWar(fid, c.owner)) { this.airOrder[fid] = { kind: 'bomb', cityIdx }; return true; }
      return false;
    }
    if (Number.isFinite(x) && Number.isFinite(z)) { this.airOrder[fid] = { kind: 'patrol', x, z }; return true; }
    this.airOrder[fid] = null; return true;                               // отзыв
  }
  cmdBuildAA(fid, idx) {
    const c = this.cities[idx]; if (!c || c.owner !== fid || c.occ || (c.aa | 0) >= this.K.AA_MAX) return false;
    const cost = (this.K.AA_COST_BASE + (c.aa | 0) * this.K.AA_COST_STEP);
    if (this.gold[fid] < cost || (this.manpower[fid] || 0) < this.K.AA_MP) return false;
    this.gold[fid] -= cost; this.manpower[fid] -= this.K.AA_MP; c.aa = (c.aa | 0) + 1; return true;
  }

  // ⚔ башни atk-городов: бьют осаждающих (приоритет), иначе ближайшего врага/город в радиусе
  cityTowers(dt) {
    for (const c of this.cities) {
      const range = c.fireRange; if (range <= 0) continue;
      c.fireTimer += dt; if (c.fireTimer < this.K.TOWER_FIRE_CD) continue;
      if (c.siege) {
        let pool = null, bu = 0;
        for (const o in c.siege) { if (+o === c.owner || !this.atWar(c.owner, +o)) continue; if (c.siege[o].units > bu) { bu = c.siege[o].units; pool = c.siege[o]; } }
        if (pool) {
          c.fireTimer = 0; pool.units = Math.max(0, pool.units - c.fireDmg);
          for (const o in c.siege) if (c.siege[o] === pool && c.siege[o].units < this.K.SIEGE_POOL_MIN) delete c.siege[o];
          if (c.siege && Object.keys(c.siege).length === 0) c.siege = null;
          continue;
        }
      }
      let best = null, bd = range * range, kind = null;
      for (const s of this.squads) { if (s.fcount < this.K.UNIT_MIN || !this.atWar(c.owner, s.owner)) continue; const dx = c.gx - s.x, dz = c.gz - s.z, dd = dx * dx + dz * dz; if (dd < bd) { bd = dd; best = s; kind = 's'; } }
      for (const s of this.ships) { if (s.hp <= 0 || !this.atWar(c.owner, s.owner)) continue; const dx = c.gx - s.x, dz = c.gz - s.z, dd = dx * dx + dz * dz; if (dd < bd) { bd = dd; best = s; kind = 'h'; } }
      for (const s of this.planes) { if (s.hp <= 0 || !this.atWar(c.owner, s.owner)) continue; const dx = c.gx - s.x, dz = c.gz - s.z, dd = dx * dx + dz * dz; if (dd < bd) { bd = dd; best = s; kind = 'h'; } }
      if (!best) for (const o of this.cities) { if (o === c || o.owner === c.owner || !this.atWar(c.owner, o.owner)) continue; const dx = c.gx - o.gx, dz = c.gz - o.gz, dd = dx * dx + dz * dz; if (dd < bd) { bd = dd; best = o; kind = 'c'; } }
      if (!best) continue;
      c.fireTimer = 0;
      if (kind === 's') best.fcount -= c.fireDmg;
      else if (kind === 'h') best.hp -= c.fireDmg;
      else if (kind === 'c') best.units = Math.max(this.K.GARRISON_FLOOR, best.units - c.fireDmg);
    }
  }
  // 🛡 ПВО: город с зенитками бьёт ближайший вражеский самолёт
  cityAA(dt) {
    for (const c of this.cities) {
      if ((c.aa | 0) <= 0) continue;
      c.aaTimer += dt; if (c.aaTimer < this.K.AA_CD) continue;
      let best = null, bd = this.K.AA_RANGE * this.K.AA_RANGE;
      for (const s of this.planes) { if (s.hp <= 0 || !this.atWar(c.owner, s.owner)) continue; const dx = c.gx - s.x, dz = c.gz - s.z, dd = dx * dx + dz * dz; if (dd < bd) { bd = dd; best = s; } }
      if (!best) continue;
      c.aaTimer = 0; best.hp -= this.K.AA_DMG * c.aa;
    }
  }
  // 🚀 обстрел берега: корабль с tech shipMissile бьёт ближайший вражеский город/отряд в радиусе
  shipBombard(dt) {
    for (const s of this.ships) {
      if (s.hp <= 0 || !this.techFlag(s.owner, 'shipMissile')) continue;
      s.fireTimer += dt; if (s.fireTimer < this.K.SHIP_FIRE_CD) continue;
      const R = this.K.SHIP_ATTACK_RANGE * this.techVal(s.owner, 'sr'), R2 = R * R;
      let best = null, bd = R2, city = false;
      for (const c of this.cities) { if (c.owner === s.owner || !this.atWar(s.owner, c.owner)) continue; const dx = s.x - c.gx, dz = s.z - c.gz, dd = dx * dx + dz * dz; if (dd < bd) { bd = dd; best = c; city = true; } }
      for (const q of this.squads) { if (!this.atWar(s.owner, q.owner)) continue; const dx = s.x - q.x, dz = s.z - q.z, dd = dx * dx + dz * dz; if (dd < bd) { bd = dd; best = q; city = false; } }
      if (!best) continue;
      s.fireTimer = 0;
      if (city) best.units = Math.max(this.K.GARRISON_FLOOR, best.units - this.K.SHIP_MISSILE_DMG);
      else best.fcount -= this.K.SHIP_MISSILE_DMG;
    }
  }
  // 💣 бомбёжка: самолёт по приказу bomb, в радиусе цели, бьёт гарнизон (tech planeBomb)
  planeBomb(dt) {
    for (const p of this.planes) {
      if (p.hp <= 0 || p.foe) continue;
      const ord = this.airOrder[p.owner]; if (!ord || ord.kind !== 'bomb') continue;
      const c = this.cities[ord.cityIdx];
      if (!c || c.owner === p.owner || !this.atWar(p.owner, c.owner) || !this.techFlag(p.owner, 'planeBomb')) continue;
      const dx = p.x - c.gx, dz = p.z - c.gz;
      if (dx * dx + dz * dz > this.K.PLANE_BOMB_RANGE * this.K.PLANE_BOMB_RANGE) continue;
      p.bombTimer += dt; if (p.bombTimer < this.K.PLANE_BOMB_CD) continue;
      p.bombTimer = 0; c.units = Math.max(this.K.GARRISON_FLOOR, c.units - this.K.PLANE_BOMB_DMG * this.techVal(p.owner, 'bd'));
    }
  }

  _isCoastal(c) { for (let r = 1; r <= 3; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) { if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; if (isWaterAt(c.gx + dx, c.gz + dz)) return true; } return false; }
  // постройка верфи (прибрежный город) / аэродрома (любой) — любой фракции. Даёт умение строить корабли/самолёты.
  cmdBuildYard(fid, idx, kind) {
    const c = this.cities[idx]; if (!c || c.owner !== fid || c.occ) return false;
    if (kind === 'ship') {
      if (c.isShipyard || !this._isCoastal(c) || this.gold[fid] < this.K.SHIPYARD_BUILD_COST) return false;
      this.gold[fid] -= this.K.SHIPYARD_BUILD_COST; c.isShipyard = true;
      this.techDone[fid].add('i1'); this.techCache[fid] = recomputeTech(this.techDone[fid], this.techNode);   // верфь → умение строить корабли
      return true;
    }
    if (kind === 'air') {
      if (c.isAirport || this.gold[fid] < this.K.AIRPORT_BUILD_COST) return false;
      this.gold[fid] -= this.K.AIRPORT_BUILD_COST; c.isAirport = true;
      this.techDone[fid].add('i8'); this.techCache[fid] = recomputeTech(this.techDone[fid], this.techNode);   // аэродром → умение строить самолёты
      return true;
    }
    return false;
  }

  // ── ИИ: незанятые фракции «думают» раз в 4.5с (порт aiActFaction из game.html) ──
  aiUpdate(dt) {
    for (let fid = 0; fid < this.factions; fid++) {
      if (this.humanFactions.has(fid)) continue;
      if (!this.cities.some(c => c.owner === fid)) continue;               // выбыла
      this.factionTimer[fid] = (this.factionTimer[fid] || 0) + dt;
      if (this.factionTimer[fid] >= this.B.ai.thinkInterval) { this.factionTimer[fid] = 0; this._aiAct(fid); }
    }
  }
  _aiAct(fid) {
    const mine = this.cities.filter(c => c.owner === fid); if (!mine.length) return;
    const rng = this.rng, myStr = this.factionStrength(fid), A = this.B.ai;
    // мир: проигрывает или война затянулась → белый мир с ИИ
    for (let f = 0; f < this.factions; f++) {
      if (f === fid || !this.atWar(fid, f)) continue;
      const losing = myStr < this.factionStrength(f) * A.losingRatio;
      const exhaust = Math.max(0, (this.time - (this.warSince[this.relKey(fid, f)] || this.time)) - A.exhaustWindow) / A.exhaustDivisor;
      if (((losing && rng() < A.peaceLosingProb) || rng() < exhaust * A.peaceExhaustMult) && !this.humanFactions.has(f)) {
        this.resolveOccupation(fid, f, 'white'); this.setRelation(fid, f, 'neutral'); this.setTruce(fid, f);
      }
    }
    // война слабому соседу
    if (this.warList(fid).length === 0 && rng() < A.warProb) {
      const nb = new Set();
      for (const c of mine) for (const n of (this.adj.get(c.idx) || [])) { const o = this.cities[n.to].owner; if (o !== fid) nb.add(o); }
      let target = null, ts = 1e9;
      for (const o of nb) { if (this.relation(fid, o) !== 'neutral' || this.truceLeft(fid, o) > 0) continue; const st = this.factionStrength(o); if (st < ts) { ts = st; target = o; } }
      if (target != null && myStr > ts * A.warStrengthRatio) { this.setWar(fid, target); this.dragAlliesIntoWar(fid, target); }
    }
    // союз с соседом против общего врага
    if (this.allyList(fid).length < A.allyCap && rng() < A.allyProb) {
      const nbs = [];
      for (const c of mine) for (const n of (this.adj.get(c.idx) || [])) { const o = this.cities[n.to].owner; if (o !== fid && this.relation(fid, o) === 'neutral' && this.commonEnemy(fid, o) && !nbs.includes(o)) nbs.push(o); }
      if (nbs.length) this.setRelation(fid, nbs[(rng() * nbs.length) | 0], 'ally');
    }
    // исследования: занять слоты (приоритет — слоты/анлоки/дёшево)
    if (this.techRes[fid].length < this.slotCount(fid)) {
      const avail = this.techNodeList.filter(n => !this.techHas(fid, n.id) && !this.techRes[fid].some(r => r.id === n.id) && nodeReady(this.techDone[fid], n) && this.gold[fid] >= n.g);
      if (avail.length && rng() < A.researchProb) {
        const prio = n => (n.slot ? A.techPrioSlot : 0) + (n.u ? A.techPrioUnlock : 0);
        avail.sort((a, b) => prio(b) - prio(a) || a.g - b.g);
        const pick = avail[0]; this.gold[fid] -= pick.g; this.techRes[fid].push({ id: pick.id, t: 0 });
        if (rng() < A.researchEarlyExit) return;
      }
    }
    // ПВО: если воюет — иногда ставит зенитку (контра вражеской авиации)
    if (rng() < A.aaProb && this.warList(fid).length > 0) {
      const aac = mine.filter(c => (c.aa | 0) < this.K.AA_MAX && this.gold[fid] >= (this.K.AA_COST_BASE + (c.aa | 0) * this.K.AA_COST_STEP) + A.aaGoldBuffer);
      if (aac.length) this.cmdBuildAA(fid, aac[(rng() * aac.length) | 0].idx);
    }
    // армия: набор, прокачка, отправка на лучшую цель
    if (this.squads.filter(s => s.owner === fid).length > A.squadCap) return;
    const buildable = mine.filter(c => !c.occ); if (!buildable.length) return;
    const src = buildable.reduce((a, b) => b.units > a.units ? b : a);
    this.cmdBuy(fid, src.idx, 'max');
    if (src.tier < this.K.MAX_TIER && this.gold[fid] >= (this.K.UPGRADE_COST_BASE + src.tier * this.K.UPGRADE_COST_STEP) + A.upgradeGoldBuffer && rng() < A.upgradeProb) {
      const near = this.cities.some(c => c.owner !== fid && (c.gx - src.gx) ** 2 + (c.gz - src.gz) ** 2 < A.nearRadius2);
      this.cmdUpgrade(fid, src.idx, src.spec || (near ? 'atk' : 'prod')); return;
    }
    if (src.units < A.minArmy) return;
    const cand = new Map();
    for (const t of this.cities) {
      if (t.owner === fid) continue;
      const path = this.findPath(src.idx, t.idx, fid); if (!path) continue;
      let effIdx = path[path.length - 1];
      for (let i = 1; i < path.length; i++) if (this.cities[path[i]].owner !== fid) { effIdx = path[i]; break; }
      const eff = this.cities[effIdx];
      if (!this.warReady(fid, eff.owner)) continue;                        // ждём окончания мобилизации
      if (!cand.has(eff.idx)) cand.set(eff.idx, { eff, time: path.length });
    }
    let best = null, bs = 1e9;
    for (const { eff, time } of cand.values()) {
      const sieging = eff.siege && eff.siege[fid] ? eff.siege[fid].units : 0;
      const sc = time * A.targetTimeWeight + (eff.units * eff.defMult - sieging) * A.targetDefWeight;
      if (sc < bs) { bs = sc; best = eff; }
    }
    if (!best) return;
    const n = Math.floor(src.units * A.sendFraction), ongoing = best.siege && best.siege[fid];
    if (n > best.units * best.defMult * A.attackOverkill + A.attackBuffer || (ongoing && n > A.ongoingSiegeMin)) {
      const path = this.findPath(src.idx, best.idx, fid);
      if (path) { src.units -= n; this.squads.push(new Squad(fid, n, path, this, src.atkMult)); }
    }
  }

  // ── технологии ──
  techMul(o, branch) { const c = this.techCache[o], m = this.fb[o] ? (this.fb[o].mods[branch] || 1) : 1; return (1 + (c ? (c.add[branch] || 0) : 0) + this.heroAdd(o, branch)) * m; }   // atk/def/eco/speed/prod (тех + герои, × фракционный мод)
  techVal(o, key)    { const c = this.techCache[o]; return 1 + (c ? (c.add[key] || 0) : 0) + this.heroAdd(o, key); }       // tr/td/sh/ph/sr/bd/cc (тех + герои)
  techFlag(o, flag)  { const c = this.techCache[o]; return !!(c && c.flags.has(flag)); }
  slotCount(o)       { const c = this.techCache[o]; return c ? c.slots : 1; }
  techHas(o, id)     { return this.techDone[o] && this.techDone[o].has(id); }
  advanceResearch(dt) {
    for (let f = 0; f < this.factions; f++) {
      const rs = this.techRes[f]; if (!rs || !rs.length) continue;
      for (let i = rs.length - 1; i >= 0; i--) {
        const n = this.techNode[rs[i].id]; if (!n) { rs.splice(i, 1); continue; }
        rs[i].t += dt;
        if (rs[i].t >= n.t) { this.techDone[f].add(n.id); this.techCache[f] = recomputeTech(this.techDone[f], this.techNode); rs.splice(i, 1); }
      }
    }
  }
  cmdResearch(fid, nodeId) {
    const n = this.techNode[nodeId]; if (!n) return false;
    if (this.techHas(fid, nodeId) || this.techRes[fid].some(r => r.id === nodeId)) return false;
    if (!nodeReady(this.techDone[fid], n)) return false;
    if (this.techRes[fid].length >= this.slotCount(fid)) return false;
    if (this.gold[fid] < n.g) return false;
    this.gold[fid] -= n.g; this.techRes[fid].push({ id: nodeId, t: 0 }); return true;
  }

  // ── ГЕРОИ ──
  // heroMods[fid] = {key: суммарный пассив + активные баффы}. Пересчёт только при изменении (init/активка/истечение)
  // — чтобы techMul/techVal (горячий путь боя) оставались O(1).
  _recomputeHeroMods(fid) {
    const m = this.heroMods[fid] = {};
    const hs = this.heroSlots[fid];
    if (hs) for (const h of hs) { const d = this.heroPool[h.id]; if (!d) continue;
      for (const ab of d.abilities) if (ab.kind === 'passive' && ab.pass) for (const p of ab.pass) m[p.key] = (m[p.key] || 0) + p.add; }
    if (this.heroBuffs.length) for (const b of this.heroBuffs) if (b.fid === fid) m[b.key] = (m[b.key] || 0) + b.add;
  }
  heroAdd(fid, key) { const m = this.heroMods[fid]; return m ? (m[key] || 0) : 0; }
  // активировать активку героя: heroIdx — индекс в heroSlots[fid], abIdx — индекс среди АКТИВНЫХ абилок героя.
  cmdHeroAbility(fid, heroIdx, abIdx) {
    if (!this.validFaction(fid)) return false;
    const hs = this.heroSlots[fid]; if (!hs) return false;
    const h = hs[heroIdx]; if (!h) return false;
    const d = this.heroPool[h.id]; if (!d) return false;
    const ab = d.abilities.filter(a => a.kind === 'active')[abIdx]; if (!ab) return false;
    if (h.cd[abIdx] > 0) return false;                          // на кулдауне
    if (!this._runHeroFx(fid, ab.fx)) return false;             // не применилось (нет цели) → КД не тратим
    h.cd[abIdx] = ab.cd; return true;
  }
  _runHeroFx(fid, fx) {
    if (!fx) return false;
    if (fx.type === 'buff')     { this.heroBuffs.push({ fid, key: fx.key, add: fx.add, until: this.time + fx.dur }); this._recomputeHeroMods(fid); return true; }
    if (fx.type === 'gold')     { this.gold[fid] = (this.gold[fid] || 0) + fx.amount; return true; }
    if (fx.type === 'manpower') { this.manpower[fid] = this.manpowerCap(fid); return true; }
    if (fx.type === 'garrison') { for (const c of this.cities) if (c.owner === fid) c.units = Math.min(c.capacity, c.units + fx.amount); return true; }
    if (fx.type === 'airstrike') {
      let tgt = null; const ord = this.airOrder[fid];
      if (ord && ord.kind === 'bomb' && ord.cityIdx != null) { const oc = this.cities[ord.cityIdx]; if (oc && oc.owner !== fid && this.atWar(fid, oc.owner)) tgt = oc; }
      if (!tgt) { const cap = this.cities.find(c => c.owner === fid && c.capital) || this.cities.find(c => c.owner === fid);
        let bd = Infinity; for (const c of this.cities) { if (c.owner === fid || !this.atWar(fid, c.owner)) continue;
          const dd = cap ? ((c.gx - cap.gx) ** 2 + (c.gz - cap.gz) ** 2) : 0; if (dd < bd) { bd = dd; tgt = c; } } }
      if (!tgt) return false;                                   // нет цели — нужна война
      tgt.units = Math.max(this.K.GARRISON_FLOOR, tgt.units - fx.amount); return true;
    }
    return true;
  }
  _tickHeroes(dt) {
    for (let f = 0; f < this.factions; f++) { const hs = this.heroSlots[f]; if (!hs) continue;
      for (const h of hs) for (let i = 0; i < h.cd.length; i++) if (h.cd[i] > 0) h.cd[i] = Math.max(0, h.cd[i] - dt); }
    if (this.heroBuffs.length) {                                // истечение баффов → пересчёт модов затронутых фракций
      const dirty = new Set();
      for (let i = this.heroBuffs.length - 1; i >= 0; i--) if (this.time >= this.heroBuffs[i].until) { dirty.add(this.heroBuffs[i].fid); this.heroBuffs.splice(i, 1); }
      for (const f of dirty) this._recomputeHeroMods(f);
    }
  }

  // ── ресурсные потолки/притоки (учитывают tech 'prod') ──
  manpowerCap(fid) { let m = 0; for (const c of this.cities) if (c.owner === fid) m += (this.K.MP_BASE + c.size * this.K.MP_PER_SIZE + c.tier * this.K.MP_PER_TIER) * (c.capital ? this.K.MP_CAPITAL : 1); return m * this.techMul(fid, 'prod'); }
  manpowerRate(fid) { let r = 0; for (const c of this.cities) if (c.owner === fid) r += (this.K.MP_RATE_BASE + c.size * this.K.MP_RATE_PER_SIZE + c.tier * this.K.MP_RATE_PER_TIER) * (c.capital ? this.K.MP_CAPITAL : 1); return r * this.techMul(fid, 'prod'); }
  politRate(fid) { let n = 0, t = 0; for (const c of this.cities) if (c.owner === fid) { n++; t += c.tier; } const P = this.B.politics; return Math.min(P.rateMax, P.rateBase + n * P.perCity + t * P.perTier); }
  factionStrength(fid) { let s = 0; for (const c of this.cities) if (c.owner === fid) s += c.units + this.K.FACTION_STR_CITY_BASE; return s; }
  validFaction(fid) { return Number.isInteger(fid) && fid >= 0 && fid < this.factions; }
  // счётчики сущностей фракции (existing + queued) — для хард-капов
  _navalCount(fid) { let n = 0; for (const s of this.ships) if (s.owner === fid) n++; for (const c of this.cities) if (c.owner === fid) n += c.shipQueue; return n; }
  _airCount(fid)   { let n = 0; for (const p of this.planes) if (p.owner === fid) n++; for (const c of this.cities) if (c.owner === fid) n += c.planeQueue; return n; }
  _squadCount(fid) { let n = 0; for (const s of this.squads) if (s.owner === fid) n++; return n; }

  // ── дипломатия ──
  relKey(a, b) { return a < b ? a + '_' + b : b + '_' + a; }
  relation(a, b) { return a === b ? 'self' : (this.relations[this.relKey(a, b)] || 'neutral'); }
  atWar(a, b) { return this.relation(a, b) === 'war'; }
  allied(a, b) { return this.relation(a, b) === 'ally'; }
  setRelation(a, b, r) { const k = this.relKey(a, b); if (r === 'neutral') { delete this.relations[k]; delete this.warSince[k]; } else this.relations[k] = r; }
  setWar(a, b) { this.setRelation(a, b, 'war'); this.warSince[this.relKey(a, b)] = this.time; }
  warCountdown(a, b) { return Math.max(0, this.warPrep - (this.time - (this.warSince[this.relKey(a, b)] || 0))); }
  warReady(a, b) { return this.atWar(a, b) && this.warCountdown(a, b) <= 0; }
  canPass(o, no) { return o === no || this.allied(o, no); }
  setTruce(a, b) { this.truceUntil[this.relKey(a, b)] = this.time + this.B.politics.truceTime; }
  truceLeft(a, b) { return Math.max(0, (this.truceUntil[this.relKey(a, b)] || 0) - this.time); }
  setPeaceCD(a, b) { this.peaceCD[this.relKey(a, b)] = this.time + this.B.politics.peaceCd; }
  peaceCDLeft(a, b) { return Math.max(0, (this.peaceCD[this.relKey(a, b)] || 0) - this.time); }
  commonEnemy(a, b) { for (let f = 0; f < this.factions; f++) if (f !== a && f !== b && this.atWar(a, f) && this.atWar(b, f)) return true; return false; }
  acceptAlliance(fid, vs) { return this.commonEnemy(fid, vs) || this.rng() < this.B.politics.allyAcceptProb; }
  occCount(by, from) { let n = 0; for (const c of this.cities) if (c.occ && c.owner === by && c.occFrom === from) n++; return n; }
  warList(fid) { const r = []; for (let f = 0; f < this.factions; f++) if (f !== fid && this.atWar(fid, f)) r.push(f); return r; }
  allyList(fid) { const r = []; for (let f = 0; f < this.factions; f++) if (f !== fid && this.allied(fid, f)) r.push(f); return r; }
  dragAlliesIntoWar(aggressor, target) {
    const dragged = [];
    for (let f = 0; f < this.factions; f++) if (f !== target && f !== aggressor && this.allied(target, f) && !this.atWar(aggressor, f)) { this.setWar(aggressor, f); dragged.push(f); }
    return dragged;
  }
  peaceAcceptChance(ai, vs, terms) {
    const strAi = this.factionStrength(ai), strVs = this.factionStrength(vs), P = this.B.politics.peace;
    let s = P.base + (strVs / (strAi + 1) - 1) * P.strengthWeight;
    s += this.occCount(vs, ai) * P.occBonus;
    if (terms.land) s -= this.occCount(vs, ai) * P.landPenalty;
    s -= ((terms.money || 0) / 100) * P.moneyWeight;
    s -= ((terms.repar || 0) / 100) * P.reparWeight;
    return Math.max(P.min, Math.min(P.max, s));
  }
  resolveOccupation(a, b, terms) {
    for (const c of this.cities) {
      if (!c.occ) continue;
      if (!((c.owner === a && c.occFrom === b) || (c.owner === b && c.occFrom === a))) continue;
      if (terms === 'keep') { c.occ = false; c.occFrom = null; }
      else { c.owner = c.occFrom; c.occ = false; c.occFrom = null; c.units = Math.max(this.K.GARRISON_FLOOR, c.units); c.goldTimer = 0; c.batches = []; }
    }
  }
  permanentAnnex(deadFid, byFid) {
    this.eliminations.push({ dead: deadFid, by: byFid });   // комната запишет итог
    for (const c of this.cities) if (c.occFrom === deadFid) { c.occ = false; c.occFrom = null; }
    if (byFid != null && byFid !== deadFid) {
      const loot = this.K.ANNEX_LOOT;   // доля казны/политы/манпауэра выбывшего → победителю
      const g = Math.floor((this.gold[deadFid] || 0) * loot), pp = Math.floor((this.politPts[deadFid] || 0) * loot), mp = Math.floor((this.manpower[deadFid] || 0) * loot);
      this.gold[byFid] = (this.gold[byFid] || 0) + g;
      this.politPts[byFid] = Math.min(this.B.politics.max, (this.politPts[byFid] || 0) + pp);
      this.manpower[byFid] = Math.min(this.manpowerCap(byFid), (this.manpower[byFid] || 0) + mp);
      this.gold[deadFid] = 0; this.politPts[deadFid] = 0; this.manpower[deadFid] = 0;
    }
  }

  // ── дипломатические команды (валидируются на сервере) ──
  cmdWar(fid, t) {
    // atWar-гард: повторное объявление уже идущей войны отклоняем — иначе списывались бы политочки повторно
    // и сбрасывался warSince (а с ним отсчёт мобилизации). UI этого не предлагает, но команда не должна это позволять.
    if (!this.validFaction(fid) || !this.validFaction(t) || fid === t || this.atWar(fid, t) || this.truceLeft(fid, t) > 0 || this.politPts[fid] < this.B.politics.costWar) return false;
    this.politPts[fid] -= this.B.politics.costWar; this.setWar(fid, t); this.dragAlliesIntoWar(fid, t); return true;
  }
  cmdAlly(fid, t) {
    if (!this.validFaction(fid) || !this.validFaction(t) || fid === t || this.atWar(fid, t) || this.allied(fid, t) || this.politPts[fid] < this.B.politics.costAlly) return false;
    if (!this.acceptAlliance(t, fid)) return false;
    this.politPts[fid] -= this.B.politics.costAlly; this.setRelation(fid, t, 'ally'); return true;
  }
  cmdBreak(fid, t) {
    if (!this.validFaction(fid) || !this.validFaction(t) || fid === t || !this.allied(fid, t) || this.politPts[fid] < this.B.politics.costBreak) return false;
    this.politPts[fid] -= this.B.politics.costBreak; this.setRelation(fid, t, 'neutral'); return true;
  }
  cmdSupport(fid, t) {
    if (!this.validFaction(fid) || !this.validFaction(t) || fid === t) return false;
    const amt = Math.min(this.B.politics.supportMax, this.gold[fid] | 0); if (amt < this.B.politics.supportMin) return false;
    this.gold[fid] -= amt; this.gold[t] = (this.gold[t] || 0) + amt; return true;
  }
  cmdPeace(fid, t, terms = {}) {
    if (!this.validFaction(fid) || !this.validFaction(t) || fid === t || !this.atWar(fid, t) || this.peaceCDLeft(fid, t) > 0 || this.politPts[fid] < this.B.politics.costPeace) return { ok: false };
    const occ = this.occCount(fid, t);
    const money = Math.max(0, Math.min(100, Number.isFinite(Number(terms.money)) ? Number(terms.money) : 0));
    const repar = Math.max(0, Math.min(100, Number.isFinite(Number(terms.repar)) ? Number(terms.repar) : 0));
    const T = { land: !!terms.land && occ > 0, money, repar, occ };
    this.setPeaceCD(fid, t);
    if (this.rng() < this.peaceAcceptChance(t, fid, T)) {
      this.politPts[fid] -= this.B.politics.costPeace;
      this.resolveOccupation(fid, t, T.land ? 'keep' : 'white');
      let grab = 0; if (T.money > 0) { grab = Math.floor((this.gold[t] | 0) * T.money / 100); this.gold[t] -= grab; this.gold[fid] += grab; }
      if (T.repar > 0) this.reparations.push({ from: t, to: fid, pct: T.repar / 100, until: this.time + this.B.politics.reparationTime });
      this.setRelation(fid, t, 'neutral'); this.setTruce(fid, t);
      return { ok: true, accepted: true, grab };
    }
    return { ok: true, accepted: false };
  }

  // ── авторитетный тик ──
  tick(dt) {
    this.time += dt;
    this.advanceResearch(dt);
    this._tickHeroes(dt);                            // кулдауны активок + истечение баффов
    for (const c of this.cities) {
      const income = c.update(dt);
      if (income) this.gold[c.owner] = (this.gold[c.owner] || 0) + income;
      if (c._captured !== undefined) { const prev = c._captured; c._captured = undefined; if (prev != null && !this.cities.some(x => x.owner === prev)) this.permanentAnnex(prev, c.owner); }
    }
    if (this.aiEnabled) this.aiUpdate(dt);          // ИИ незанятых фракций
    // отряды: движение → прибытие, затем полевой бой, затем уборка павших
    for (let i = this.squads.length - 1; i >= 0; i--) if (this.squads[i].update(dt)) { this.resolveArrival(this.squads[i]); this.squads.splice(i, 1); }
    this.fieldBattles(dt);
    for (let i = this.squads.length - 1; i >= 0; i--) if (this.squads[i].fcount < this.K.UNIT_MIN) { const s = this.squads[i]; for (const o of this.squads) if (o.foe === s) o.foe = null; this.squads.splice(i, 1); }
    // флот/авиация: постройка → движение → бой (грид) → уборка павших
    this.advanceBuildQueues(dt);
    for (const s of this.ships) s.update(dt);
    for (const p of this.planes) p.update(dt);
    this.navalBattles(dt);
    this.airBattles(dt);
    this.shipBombard(dt);    // 🚀 обстрел берега
    this.planeBomb(dt);      // 💣 бомбёжка городов
    this.cityTowers(dt);     // ⚔ башни atk-городов
    this.cityAA(dt);         // 🛡 ПВО сбивает самолёты
    if (this.ships.some(s => s.hp <= 0)) this.ships = this.ships.filter(s => s.hp > 0);
    if (this.planes.some(p => p.hp <= 0)) this.planes = this.planes.filter(p => p.hp > 0);
    for (let f = 0; f < this.factions; f++) {
      this.politPts[f] = Math.min(this.B.politics.max, (this.politPts[f] || 0) + this.politRate(f) * dt);
      const cap = this.manpowerCap(f);
      this.manpower[f] = Math.min(cap, (this.manpower[f] || 0) + this.manpowerRate(f) * dt);
    }
    for (let i = this.reparations.length - 1; i >= 0; i--) {
      const r = this.reparations[i];
      if (this.time >= r.until) { this.reparations.splice(i, 1); continue; }
      let inc = 0; for (const c of this.cities) if (c.owner === r.from) inc += c.size / c.goldInterval;   // goldRate
      const amt = inc * r.pct * dt; if (amt > 0) { this.gold[r.from] = Math.max(0, this.gold[r.from] - amt); this.gold[r.to] += amt; }
    }
  }

  // ── команды городов (валидируются на сервере) ──
  buyAmount(c, spec) {
    const space = Math.floor(c.capacity - c.units - c.queued); if (space <= 0) return 0;
    const cap = Math.min(space, Math.floor(this.gold[c.owner] / this.K.SOLDIER_PRICE), Math.floor((this.manpower[c.owner] || 0) / this.K.SOLDIER_MP));
    if (spec === 'max') return Math.max(0, cap);
    return Math.min(parseInt(spec, 10) || 0, cap);
  }
  cmdBuy(fid, idx, spec) {
    const c = this.cities[idx]; if (!c || c.owner !== fid || c.occ) return false;
    const amt = this.buyAmount(c, spec); if (amt <= 0) return false;
    this.gold[fid] -= amt * this.K.SOLDIER_PRICE; this.manpower[fid] -= amt * this.K.SOLDIER_MP;
    c.batches.push({ count: amt, time: amt * c.trainPer, elapsed: 0 });
    return true;
  }
  cmdUpgrade(fid, idx, track) {
    const c = this.cities[idx]; if (!c || c.owner !== fid || c.occ || c.tier >= this.K.MAX_TIER) return false;
    if (!['prod', 'def', 'atk'].includes(track)) return false;
    if (c.spec && c.spec !== track) return false;
    const cost = this.K.UPGRADE_COST_BASE + c.tier * this.K.UPGRADE_COST_STEP;
    if (this.gold[fid] < cost) return false;
    this.gold[fid] -= cost; c.spec = track; c.tier++;
    return true;
  }
  // Отправка войск. Реальная карта → движущийся отряд по графу (Squad); toy-мир → мгновенная осада.
  // Атаковать чужой город можно только в состоянии войны.
  cmdSend(fid, fromIdx, toIdx, pct = this.K.SEND_DEFAULT_PCT) {
    const a = this.cities[fromIdx], b = this.cities[toIdx];
    if (!a || !b || a === b || a.owner !== fid) return false;
    if (!Number.isFinite(pct) || pct <= 0 || pct > 1) return false;
    const enemy = b.owner !== fid && !this.allied(fid, b.owner);
    if (enemy && !this.warReady(fid, b.owner)) return false;    // нельзя нападать без войны и до конца мобилизации (WAR_PREP)
    const n = Math.floor(a.units * pct); if (n <= 0) return false;
    if (this.map) {                                            // реальная карта: отряд идёт по пути
      if (this._squadCount(fid) >= this.K.MAX_SQUADS) return false; // хард-кап отрядов на фракцию
      const path = this.findPath(fromIdx, toIdx, fid); if (!path) return false;
      a.units -= n;
      this.squads.push(new Squad(fid, n, path, this, a.atkMult));
      return true;
    }
    a.units -= n;                                              // toy-мир: мгновенно
    if (b.owner === fid || this.allied(fid, b.owner)) { b.units = Math.min(b.capacity, b.units + n); }
    else { b.siege = b.siege || {}; const pool = b.siege[fid] || (b.siege[fid] = { units: 0, atkMult: a.atkMult }); pool.units += n; pool.atkMult = a.atkMult; }
    return true;
  }
}

module.exports = { Sim };
