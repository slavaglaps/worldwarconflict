// Чистый отряд: движется по пути из городов (граф), стоит в полевом бою.
// Позиция — линейная интерполяция вдоль ребра (клиент может рисовать по полилинии).

const { syncComp } = require('./City');
const { isWaterAt } = require('./water');

let _sid = 1;

// mode отряда: 0 — на суше (рой), 2 — на морском переходе (юниты «в корабле», клиент прячет их над водой)
const MODE_LAND = 0, MODE_SEA = 2;

class Squad {
  constructor(owner, count, path, sim, atkMult, comp) {
    this.id = _sid++;
    this.owner = owner;
    this.fcount = count;          // живых бойцов (дробное в бою)
    this.comp = comp || { inf: count, arc: 0, cav: 0 };   // 👥 состав по типам (сумма ≡ fcount)
    this.path = path;             // массив idx городов [from, ..., to]
    this.hop = 0;                 // индекс текущего сегмента (ребро path[hop]→path[hop+1])
    this.prog = 0;                // пройдено по текущему ребру (в ед. длины)
    this.foe = null;              // полевой бой
    this.sim = sim; this.K = sim.K;
    this.atkMult = atkMult || 1;
    this.x = 0; this.z = 0;
    this.mode = MODE_LAND;        // 0 суша / 2 морской переход (на воде И ребро морское)
    this.heading = 0;             // авторитетный курс (рад) — клиент рисует корабль без вывода из шумных дельт
    this._setPos(); this._updateSeaMode();
  }

  // позиция {x,z} для произвольных hop/prog (используется и для рендера, и для скана воды впереди)
  _posAt(hop, prog) {
    const a = this.sim.cities[this.path[hop]];
    const b = this.sim.cities[this.path[hop + 1]];
    if (!a) return { x: this.x, z: this.z };
    if (!b) return { x: a.gx, z: a.gz };
    const e = this.sim.edgeBetween(this.path[hop], this.path[hop + 1]);
    const f = e ? Math.min(1, prog / e.len) : 0;
    if (e && Array.isArray(e.pts) && e.pts.length >= 2 && e.len > 0) {
      const pts = e.a === this.path[hop] ? e.pts : e.pts.slice().reverse();
      const target = f * e.len;
      let walked = 0;
      for (let i = 1; i < pts.length; i++) {
        const p0 = pts[i - 1], p1 = pts[i];
        const seg = Math.hypot(p1.x - p0.x, p1.z - p0.z);
        if (walked + seg >= target || i === pts.length - 1) {
          const t = seg > 0 ? Math.max(0, Math.min(1, (target - walked) / seg)) : 0;
          return { x: p0.x + (p1.x - p0.x) * t, z: p0.z + (p1.z - p0.z) * t };
        }
        walked += seg;
      }
    }
    return { x: a.gx + (b.gx - a.gx) * f, z: a.gz + (b.gz - a.gz) * f };
  }

  _setPos() { const p = this._posAt(this.hop, this.prog); this.x = p.x; this.z = p.z; }

  _updateSeaMode() {
    const e = this.sim.edgeBetween(this.path[this.hop], this.path[this.hop + 1]);
    this.mode = (e && e.sea && isWaterAt(this.x, this.z)) ? MODE_SEA : MODE_LAND;
  }

  // true → отряд дошёл/упёрся (Sim вызовет resolveArrival и удалит)
  update(dt) {
    syncComp(this.comp, this.fcount);                        // 👥 потери боя/башен распределяются по типам пропорционально
    if (this.foe) return false;                              // дерёмся — стоим

    // Отряд движется НЕПРЕРЫВНО. mode 2 (море) = он на воде И текущее ребро морское (предвычислено в _buildGraph).
    //   Клиент над водой прячет юнитов → они «втекают/вытекают» у берега как в ворота города, а сверху едет корабль.
    let move = this.K.SQUAD_SPEED * this.sim.techMul(this.owner, 'speed') * dt;
    const px = this.x, pz = this.z;
    let guard = 0;
    while (move > 1e-9 && guard++ < 64) {
      const a = this.path[this.hop], b = this.path[this.hop + 1];
      if (b === undefined) return true;                      // конец пути
      const e = this.sim.edgeBetween(a, b);
      const remain = (e ? e.len : 0) - this.prog;
      const adv = move * (e ? e.mult : 1);
      if (adv >= remain) {
        move -= remain / (e ? e.mult : 1);
        this.prog = 0; this.hop++;
        if (this.hop >= this.path.length - 1) { this._setPos(); return true; }     // дошли до цели
        if (!this.sim.canPass(this.owner, this.sim.cities[this.path[this.hop]].owner)) { this._setPos(); return true; } // упёрлись во вражеский узел
      } else { this.prog += adv; move = 0; }
    }
    this._setPos();

    this._updateSeaMode();                                // море, кроме посадочной зоны города

    const hdx = this.x - px, hdz = this.z - pz;              // авторитетный курс из детерминированного сим-смещения
    if (hdx * hdx + hdz * hdz > 1e-7) this.heading = Math.atan2(hdz, hdx);
    return false;
  }

  get stopCity() { return this.path[this.hop]; }              // где отряд оказался при arrival
}

module.exports = { Squad };
