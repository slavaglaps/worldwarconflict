/* СКОПИРОВАНО из server/sim/ скриптом scripts/sync-sim.js — НЕ РЕДАКТИРОВАТЬ. Источник: server/sim/Plane.js */
// Воздушный юнит (дирижабль): управляется прямой целью, как корабль, но летит по воздуху.

let _pid = 1;

class Plane {
  constructor(owner, x, z, sim) {
    this.id = _pid++;
    this.owner = owner; this.sim = sim; this.K = sim.K;   // константы комнаты (balance.tune)
    this.hp = this.K.PLANE_HP * sim.techVal(owner, 'ph');
    this.foe = null;
    this.x = x; this.z = z;
    this.tx = x; this.tz = z;
    this.heading = (sim.rng ? sim.rng() : 0.5) * Math.PI * 2;
    this.bombTimer = 0;
  }
  setTarget(x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    this.tx = Math.max(0, Math.min(this.K.GRID, x));
    this.tz = Math.max(0, Math.min(this.K.GRID, z));
  }
  update(dt) {
    if (this.foe) return;                              // воздушный бой — кружим
    let aimx = this.tx, aimz = this.tz;
    const direct = Math.hypot(aimx - this.x, aimz - this.z) > this.K.SHIP_ARRIVE;
    const ord = direct ? null : this.sim.airOrder[this.owner]; // legacy-приказы оставлены для старых тестов/комнат
    if (!direct && ord && ord.kind === 'bomb') {
      const c = this.sim.cities[ord.cityIdx];
      if (c && c.owner !== this.owner && this.sim.atWar(this.owner, c.owner)) { aimx = c.gx; aimz = c.gz; }
      else { aimx = this.x + Math.cos(this.heading) * this.K.PLANE_AIM; aimz = this.z + Math.sin(this.heading) * this.K.PLANE_AIM; }
    } else if (!direct && ord && ord.kind === 'patrol') { aimx = ord.x; aimz = ord.z; }
    else if (!direct) return;
    const d = Math.hypot(aimx - this.x, aimz - this.z);
    const step = Math.min(d, this.K.PLANE_SPEED * dt);
    if (d > 1e-6) {
      this.heading = Math.atan2(aimz - this.z, aimx - this.x);
      this.x += (aimx - this.x) / d * step;
      this.z += (aimz - this.z) / d * step;
    }
    if (this.x < 0) { this.x = 0; this.heading = Math.PI - this.heading; }
    if (this.x > this.K.GRID) { this.x = this.K.GRID; this.heading = Math.PI - this.heading; }
    if (this.z < 0) { this.z = 0; this.heading = -this.heading; }
    if (this.z > this.K.GRID) { this.z = this.K.GRID; this.heading = -this.heading; }
  }
}

module.exports = { Plane };
