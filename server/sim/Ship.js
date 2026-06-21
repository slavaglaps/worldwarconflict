// Чистый корабль: движение по воде (прямо, обход берега — стоп), морской бой (грид).
const C = require('./constants');
const { isWaterAt } = require('./water');

let _sid = 1;

class Ship {
  constructor(owner, x, z, sim) {
    this.id = _sid++;
    this.owner = owner; this.sim = sim;
    this.hp = C.SHIP_HP * sim.techVal(owner, 'sh');
    this.foe = null;
    this.x = x; this.z = z;
    this.tx = x; this.tz = z;          // цель
    this.heading = 0;
    this.fireTimer = 0;                // 🚀 кулдаун обстрела берега
  }
  setTarget(x, z) { this.tx = x; this.tz = z; }
  update(dt) {
    if (this.foe) return;              // в морском бою стоим
    const dx = this.tx - this.x, dz = this.tz - this.z, d = Math.hypot(dx, dz);
    if (d > 0.1) {
      const step = Math.min(d, C.SHIP_SPEED * dt);
      const nx = this.x + dx / d * step, nz = this.z + dz / d * step;
      if (isWaterAt(nx, nz)) { this.x = nx; this.z = nz; this.heading = Math.atan2(dz, dx); }
      else { this.tx = this.x; this.tz = this.z; }   // упёрлись в берег → стоп
    }
  }
}

module.exports = { Ship };
