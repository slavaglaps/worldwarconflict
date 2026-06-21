// Чистый отряд: движется по пути из городов (граф), стоит в полевом бою.
// Позиция — линейная интерполяция вдоль ребра (клиент может рисовать по полилинии).
const C = require('./constants');

let _sid = 1;

class Squad {
  constructor(owner, count, path, sim, atkMult) {
    this.id = _sid++;
    this.owner = owner;
    this.fcount = count;          // живых бойцов (дробное в бою)
    this.path = path;             // массив idx городов [from, ..., to]
    this.hop = 0;                 // индекс текущего сегмента (ребро path[hop]→path[hop+1])
    this.prog = 0;                // пройдено по текущему ребру (в ед. длины)
    this.foe = null;              // полевой бой
    this.sim = sim;
    this.atkMult = atkMult || 1;
    this.x = 0; this.z = 0;
    this._setPos();
  }

  _setPos() {
    const a = this.sim.cities[this.path[this.hop]];
    const b = this.sim.cities[this.path[this.hop + 1]];
    if (!a) return;
    if (!b) { this.x = a.gx; this.z = a.gz; return; }
    const e = this.sim.edgeBetween(this.path[this.hop], this.path[this.hop + 1]);
    const f = e ? Math.min(1, this.prog / e.len) : 0;
    this.x = a.gx + (b.gx - a.gx) * f;
    this.z = a.gz + (b.gz - a.gz) * f;
  }

  // true → отряд дошёл/упёрся (Sim вызовет resolveArrival и удалит)
  update(dt) {
    if (this.foe) return false;                              // дерёмся — стоим
    let move = C.SQUAD_SPEED * this.sim.techMul(this.owner, 'speed') * dt;
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
    return false;
  }

  get stopCity() { return this.path[this.hop]; }              // где отряд оказался при arrival
}

module.exports = { Squad };
