// Чистый корабль: движение по водному маршруту, морской бой (грид).
const { isWaterAt, nearestWaterPoint, findWaterPath } = require('./water');

let _sid = 1;

class Ship {
  constructor(owner, x, z, sim) {
    this.id = _sid++;
    this.owner = owner; this.sim = sim; this.K = sim.K;   // константы комнаты (balance.tune)
    this.hp = this.K.SHIP_HP * sim.techVal(owner, 'sh');
    this.foe = null;
    this.x = x; this.z = z;
    this.tx = x; this.tz = z;          // цель
    this.path = [];
    this.heading = 0;
    this.fireTimer = 0;                // 🚀 кулдаун обстрела берега
  }
  setTarget(x, z) {
    const w = nearestWaterPoint(x, z);
    this.tx = w.x; this.tz = w.z;
    this.path = findWaterPath(this.x, this.z, this.tx, this.tz) || [{ x: this.tx, z: this.tz }];
  }
  update(dt) {
    if (this.foe) return;              // в морском бою стоим
    const target = this.path.length ? this.path[0] : { x: this.tx, z: this.tz };
    const dx = target.x - this.x, dz = target.z - this.z, d = Math.hypot(dx, dz);
    if (d > this.K.SHIP_ARRIVE) {
      const step = Math.min(d, this.K.SHIP_SPEED * dt);
      const nx = this.x + dx / d * step, nz = this.z + dz / d * step;
      if (isWaterAt(nx, nz)) { this.x = nx; this.z = nz; this.heading = Math.atan2(dz, dx); }
      else {
        this.path = findWaterPath(this.x, this.z, this.tx, this.tz) || [];
        if (!this.path.length) { this.tx = this.x; this.tz = this.z; }
      }
    } else if (this.path.length) {
      this.path.shift();
    }
  }
}

module.exports = { Ship };
