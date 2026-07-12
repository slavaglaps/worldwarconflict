// Чистый город: экономика + производство + осада. Без Three/DOM.
// Геттеры-формулы и update() портированы 1:1 из game.html (class City).
const C = require('./constants');
const ONE = () => 1;

// ── 👥 состав по типам юнитов: {inf,arc,cav}, сумма ≡ units/fcount ─────────────
// Прямые мутации units/fcount (урон башен/осады/ракеты/эффекты) comp НЕ трогают —
// syncComp() приводит состав к сумме ПРОПОРЦИОНАЛЬНО (вызов в начале update()).
// Точечные правки только при ПЕРЕНОСЕ между контейнерами: takeComp/addComp.
function syncComp(comp, total) {
  if (!comp) return comp;
  const s = comp.inf + comp.arc + comp.cav;
  if (!(s > 1e-9)) { comp.inf = Math.max(0, total); comp.arc = 0; comp.cav = 0; return comp; }
  if (Math.abs(s - total) > 1e-6) { const k = Math.max(0, total) / s; comp.inf *= k; comp.arc *= k; comp.cav *= k; }
  return comp;
}
function takeComp(comp, n, total) {         // изъять n из comp (пропорционально составу)
  const k = total > 1e-9 ? Math.max(0, Math.min(1, n / total)) : 0;
  const out = { inf: comp.inf * k, arc: comp.arc * k, cav: comp.cav * k };
  comp.inf -= out.inf; comp.arc -= out.arc; comp.cav -= out.cav;
  return out;
}
function addComp(dst, src, k = 1) { dst.inf += src.inf * k; dst.arc += src.arc * k; dst.cav += src.cav * k; return dst; }
// ⚔ counter-множитель урона состава `a` (атакующий) против `d` (защитник) по треугольнику inf›cav›arc›inf.
//   Взвешенное среднее по долям типов; сила = bonus. При bonus=0 → ВСЕГДА 1 (типы не различаются, бой 1:1 как раньше).
const CTR_BEATS = { inf: 'cav', cav: 'arc', arc: 'inf' };
function counterMul(a, d, bonus) {
  if (!bonus) return 1;
  const at = a.inf + a.arc + a.cav, dt = d.inf + d.arc + d.cav;
  if (at <= 0 || dt <= 0) return 1;
  const T = ['inf', 'arc', 'cav'];
  let sum = 0;
  for (const x of T) { const af = a[x] / at; if (!af) continue;
    for (const y of T) { const df = d[y] / dt; if (!df) continue;
      const m = CTR_BEATS[x] === y ? 1 + bonus : (CTR_BEATS[y] === x ? Math.max(0, 1 - bonus) : 1);
      sum += af * df * m; } }
  return sum;
}

class City {
  constructor(o) {
    this.idx = o.idx;
    this.gx = o.gx; this.gz = o.gz;
    this.country = o.country;
    this.size = o.size;                 // 1..3
    this.owner = o.owner;
    this.capital = !!o.capital;
    this.isShipyard = !!o.isShipyard;
    this.isAirport = !!o.isAirport;
    this.hasShipyard = !!o.hasShipyard;
    this.hasAirport = !!o.hasAirport;
    this.shipQueue = 0; this.shipTimer = 0;   // очередь постройки кораблей
    this.planeQueue = 0; this.planeTimer = 0; // очередь постройки самолётов
    this.aa = 0; this.aaTimer = 0;            // 🛡 ПВО (число стволов) + таймер залпа
    this.fireTimer = 0;                       // ⚔ таймер башни — точечная оборона (atk-город)
    this.bombTimer = 0;                       // ⚔ таймер осадного обстрела вражеских городов (atk-город)

    this.spec = null;                   // 'prod' | 'def' | 'atk'
    this.tier = 0;
    this.prodTier = null;               // null = legacy spec/tier ещё не разложены по веткам
    this.defTier = null;
    this.atkTier = null;
    this.occ = false; this.occFrom = null;   // оккупация (до мира)
    this.units = 8 + this.size * 4;          // стартовый гарнизон
    this.boosted = false;
    this.goldTimer = 0;
    this.batches = [];                  // очередь найма: {count,time,elapsed}
    this.completedProduction = [];      // завершённые ship/plane забирает Sim после update()
    this.siege = null;                  // {ownerId: {units, atkMult}}
    this._captured = undefined;         // сигнал Sim при смене владельца

    // tech-акксессоры внедряет Sim; по умолчанию ×1
    this.tm = o.tm || ONE;              // techMul(owner, branch)
    this.tv = o.tv || ONE;              // techVal(owner, key)
    this.K = o.K || C;                  // константы комнаты (balance.tune); фолбэк — код-дефолты

    // 👥 состав гарнизона по типам (сумма ≡ units); старт — по START_COMP
    const sc = this.K.START_COMP || { inf: 1, arc: 0, cav: 0 };
    this.comp = { inf: this.units * (sc.inf || 0), arc: this.units * (sc.arc || 0), cav: this.units * (sc.cav || 0) };
    syncComp(this.comp, this.units);
    this.recruitType = 'inf';           // тип, который производит город (задел под здания-специализаторы)
  }

  branchTier(track) { const v = this[track + 'Tier']; return v == null ? (this.spec === track ? this.tier : 0) : v; }
  get totalTier()   { return this.branchTier('prod') + this.branchTier('def') + this.branchTier('atk'); }
  get visualTier()  { return Math.max(this.branchTier('prod'), this.branchTier('def'), this.branchTier('atk')); }
  migrateTiers() {
    if (this.prodTier != null && this.defTier != null && this.atkTier != null) return;
    const spec = this.spec, tier = this.tier | 0;
    this.prodTier = spec === 'prod' ? tier : 0;
    this.defTier = spec === 'def' ? tier : 0;
    this.atkTier = spec === 'atk' ? tier : 0;
  }

  get capacity()    { let c = this.K.CITY_CAP_BASE + this.size * this.K.CITY_CAP_PER_SIZE; c *= 1 + this.K.CITY_DEF_CAP_PER_TIER * this.branchTier('prod'); if (this.boosted) c *= this.K.CITY_BOOST_CAP; return c * this.tv(this.owner, 'cc'); }
  get goldInterval(){ let g = this.K.CITY_GOLD_INTERVAL; if (this.boosted) g *= this.K.CITY_BOOST_GOLD; return g / this.tm(this.owner, 'eco'); }
  get goldRate()    { return this.size * this.K.CITY_GOLD_YIELD * (this.capital ? this.K.CITY_CAPITAL_GOLD : 1) * (this.occ ? this.K.OCCUPY_INCOME : 1) / this.goldInterval; }
  get trainPer()    { let t = this.K.CITY_TRAIN_BASE - this.size * this.K.CITY_TRAIN_PER_SIZE; if (this.boosted) t *= this.K.CITY_BOOST_TRAIN; return t / this.tm(this.owner, 'prod'); }
  get queued()      { return this.batches.reduce((s, b) => s + (b.type === 'ship' || b.type === 'plane' ? 0 : b.count), 0); }
  get defMult()     { return (1 + this.K.CITY_DEF_MULT_PER_TIER * this.branchTier('def')) * this.tm(this.owner, 'def'); }
  get atkMult()     { return (1 + this.K.CITY_ATK_MULT_PER_TIER * this.branchTier('atk')) * this.tm(this.owner, 'atk'); }
  // ⚔ башня: atk-город бьёт по врагам в радиусе (радиус/урон растут с тиром и tech)
  get fireRange()   { const tier = this.branchTier('atk'); return tier > 0 ? (this.K.TOWER_RANGE_BASE + this.K.TOWER_RANGE_PER * tier) * this.tv(this.owner, 'tr') : 0; }
  get fireDmg()     { return (this.K.TOWER_DMG_BASE + this.branchTier('atk')) * this.tm(this.owner, 'atk') * this.tv(this.owner, 'td'); }

  // Возвращает заработанную за тик голду (Sim начисляет владельцу).
  update(dt) {
    syncComp(this.comp, this.units);    // 👥 состав ≡ units (урон/эффекты с прошлого тика распределяются пропорционально)
    // ── осада: бой за город во времени ──
    if (this.siege) {
      const pools = Object.values(this.siege);
      const totalAtk = pools.reduce((s, p) => s + p.units, 0);
      if (totalAtk < this.K.UNIT_MIN) { this.siege = null; }
      else {
        let dmgToCity = 0;
        const cb = this.K.UNIT_COUNTER_BONUS || 0;                          // ⚔ бонус треугольника типов (0 = типы не различаются)
        for (const p of pools) dmgToCity += p.units * p.atkMult * counterMul(p.comp, this.comp, cb) * this.K.SIEGE_ATK;
        const defDps = this.units * this.defMult * this.K.SIEGE_DEF;
        for (const p of pools) p.units -= defDps * (p.units / totalAtk) * counterMul(this.comp, p.comp, cb) * dt;
        this.units = Math.max(0, this.units - dmgToCity * dt);
        for (const o of Object.keys(this.siege)) if (this.siege[o].units < this.K.SIEGE_POOL_MIN) delete this.siege[o];
        if (this.units <= this.K.CITY_CAPTURE_MIN) {
          let bo = null, bu = 0;
          for (const o of Object.keys(this.siege)) { const p = this.siege[o]; if (p.units > bu) { bu = p.units; bo = +o; } }
          if (bo != null) {
            const prev = this.owner;
            this.owner = bo; this.units = Math.max(this.K.GARRISON_FLOOR, this.siege[bo].units);
            // 👥 гарнизон = выжившие атакующие → состав от их пула (fallback: вся пехота)
            const pc = this.siege[bo].comp;
            this.comp = pc ? { inf: pc.inf, arc: pc.arc, cav: pc.cav } : { inf: this.units, arc: 0, cav: 0 };
            syncComp(this.comp, this.units);
            if (this.occ && this.occFrom === bo) { this.occ = false; this.occFrom = null; } // вернул свой город
            else { this.occ = true; this.occFrom = prev; }                                  // оккупация
            delete this.siege[bo];
            this.goldTimer = 0; this.batches = []; this.completedProduction = [];
            this._captured = prev;                                                          // → Sim проверит аннексию
          } else this.units = this.K.GARRISON_FLOOR;                                        // взаимное истощение
        }
        if (this.siege && Object.keys(this.siege).length === 0) this.siege = null;
      }
    }
    // ── экономика: голда по интервалу (×size×YIELD; оккупированный город — ×OCCUPY_INCOME) ──
    let income = 0;
    this.goldTimer += dt;
    while (this.goldTimer >= this.goldInterval) { this.goldTimer -= this.goldInterval; income += this.size * this.K.CITY_GOLD_YIELD * (this.capital ? this.K.CITY_CAPITAL_GOLD : 1); }
    if (this.occ) income *= this.K.OCCUPY_INCOME;
    // ── производство: FIFO, продвигается только batches[0] ──
    if (this.batches.length) {
      const b = this.batches[0]; b.elapsed += dt;
      if (b.elapsed >= b.time) {
        if (b.type === 'ship' || b.type === 'plane') this.completedProduction.push(b.type);
        else {
          const add = Math.max(0, Math.min(this.capacity - this.units, b.count));   // 👥 рекруты идут в тип батча (или recruitType города)
          this.units += add;
          if (this.comp) this.comp[b.type || this.recruitType || 'inf'] += add;
        }
        this.batches.shift();
      }
    }
    // 👥 переполнение гарнизона (units>capacity) дренажится в Sim (нужен сид-rng для выбора типа) — см. Sim._drainOvercap.
    return income;
  }
}

module.exports = { City, syncComp, takeComp, addComp, counterMul };
