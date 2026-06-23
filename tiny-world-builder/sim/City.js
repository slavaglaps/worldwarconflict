/* СКОПИРОВАНО из server/sim/ скриптом scripts/sync-sim.js — НЕ РЕДАКТИРОВАТЬ. Источник: server/sim/City.js */
// Чистый город: экономика + производство + осада. Без Three/DOM.
// Геттеры-формулы и update() портированы 1:1 из game.html (class City).
const C = require('./constants');
const ONE = () => 1;

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
    this.shipQueue = 0; this.shipTimer = 0;   // очередь постройки кораблей
    this.planeQueue = 0; this.planeTimer = 0; // очередь постройки самолётов
    this.aa = 0; this.aaTimer = 0;            // 🛡 ПВО (число стволов) + таймер залпа
    this.fireTimer = 0;                       // ⚔ таймер башни — точечная оборона (atk-город)
    this.bombTimer = 0;                       // ⚔ таймер осадного обстрела вражеских городов (atk-город)

    this.spec = null;                   // 'prod' | 'def' | 'atk'
    this.tier = 0;
    this.occ = false; this.occFrom = null;   // оккупация (до мира)
    this.units = 8 + this.size * 4;          // стартовый гарнизон
    this.boosted = false;
    this.goldTimer = 0;
    this.batches = [];                  // очередь найма: {count,time,elapsed}
    this.siege = null;                  // {ownerId: {units, atkMult}}
    this._captured = undefined;         // сигнал Sim при смене владельца

    // tech-акксессоры внедряет Sim; по умолчанию ×1
    this.tm = o.tm || ONE;              // techMul(owner, branch)
    this.tv = o.tv || ONE;              // techVal(owner, key)
    this.K = o.K || C;                  // константы комнаты (balance.tune); фолбэк — код-дефолты
  }

  get capacity()    { let c = this.K.CITY_CAP_BASE + this.size * this.K.CITY_CAP_PER_SIZE; if (this.spec === 'def') c *= 1 + this.K.CITY_DEF_CAP_PER_TIER * this.tier; if (this.boosted) c *= this.K.CITY_BOOST_CAP; return c * this.tv(this.owner, 'cc'); }
  get goldInterval(){ let g = this.K.CITY_GOLD_INTERVAL; if (this.spec === 'prod') g *= Math.pow(this.K.CITY_PROD_GOLD_DECAY, this.tier); if (this.boosted) g *= this.K.CITY_BOOST_GOLD; return g / this.tm(this.owner, 'eco'); }
  get trainPer()    { let t = this.K.CITY_TRAIN_BASE - this.size * this.K.CITY_TRAIN_PER_SIZE; if (this.boosted) t *= this.K.CITY_BOOST_TRAIN; return t / this.tm(this.owner, 'prod'); }
  get queued()      { return this.batches.reduce((s, b) => s + b.count, 0); }
  get defMult()     { return (1 + (this.spec === 'def' ? this.K.CITY_DEF_MULT_PER_TIER * this.tier : 0)) * this.tm(this.owner, 'def'); }
  get atkMult()     { return (1 + (this.spec === 'atk' ? this.K.CITY_ATK_MULT_PER_TIER * this.tier : 0)) * this.tm(this.owner, 'atk'); }
  // ⚔ башня: atk-город бьёт по врагам в радиусе (радиус/урон растут с тиром и tech)
  get fireRange()   { return this.spec === 'atk' ? (this.K.TOWER_RANGE_BASE + this.K.TOWER_RANGE_PER * this.tier) * this.tv(this.owner, 'tr') : 0; }
  get fireDmg()     { return (this.K.TOWER_DMG_BASE + this.tier) * this.tm(this.owner, 'atk') * this.tv(this.owner, 'td'); }

  // Возвращает заработанную за тик голду (Sim начисляет владельцу).
  update(dt) {
    // ── осада: бой за город во времени ──
    if (this.siege) {
      const pools = Object.values(this.siege);
      const totalAtk = pools.reduce((s, p) => s + p.units, 0);
      if (totalAtk < this.K.UNIT_MIN) { this.siege = null; }
      else {
        let dmgToCity = 0;
        for (const p of pools) dmgToCity += p.units * p.atkMult * this.K.SIEGE_ATK;
        const defDps = this.units * this.defMult * this.K.SIEGE_DEF;
        for (const p of pools) p.units -= defDps * (p.units / totalAtk) * dt;
        this.units = Math.max(0, this.units - dmgToCity * dt);
        for (const o of Object.keys(this.siege)) if (this.siege[o].units < this.K.SIEGE_POOL_MIN) delete this.siege[o];
        if (this.units <= this.K.CITY_CAPTURE_MIN) {
          let bo = null, bu = 0;
          for (const o of Object.keys(this.siege)) { const p = this.siege[o]; if (p.units > bu) { bu = p.units; bo = +o; } }
          if (bo != null) {
            const prev = this.owner;
            this.owner = bo; this.units = Math.max(this.K.GARRISON_FLOOR, this.siege[bo].units);
            if (this.occ && this.occFrom === bo) { this.occ = false; this.occFrom = null; } // вернул свой город
            else { this.occ = true; this.occFrom = prev; }                                  // оккупация
            delete this.siege[bo];
            this.goldTimer = 0; this.batches = [];
            this._captured = prev;                                                          // → Sim проверит аннексию
          } else this.units = this.K.GARRISON_FLOOR;                                        // взаимное истощение
        }
        if (this.siege && Object.keys(this.siege).length === 0) this.siege = null;
      }
    }
    // ── экономика: голда по интервалу (×size×YIELD; оккупированный город — ×OCCUPY_INCOME) ──
    let income = 0;
    this.goldTimer += dt;
    while (this.goldTimer >= this.goldInterval) { this.goldTimer -= this.goldInterval; income += this.size * this.K.CITY_GOLD_YIELD; }
    if (this.occ) income *= this.K.OCCUPY_INCOME;
    // ── производство: FIFO, продвигается только batches[0] ──
    if (this.batches.length) {
      const b = this.batches[0]; b.elapsed += dt;
      if (b.elapsed >= b.time) { this.units = Math.min(this.capacity, this.units + b.count); this.batches.shift(); }
    }
    return income;
  }
}

module.exports = { City };
