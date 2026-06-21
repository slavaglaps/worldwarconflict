// Чистый самолёт: летит по приказу фракции (sim.airOrder), воздушный бой (грид), бомбит по приказу.
const C = require('./constants');

let _pid = 1;

class Plane {
  constructor(owner, x, z, sim) {
    this.id = _pid++;
    this.owner = owner; this.sim = sim;
    this.hp = C.PLANE_HP * sim.techVal(owner, 'ph');
    this.foe = null;
    this.x = x; this.z = z;
    this.heading = (sim.rng ? sim.rng() : 0.5) * Math.PI * 2;
    this.bombTimer = 0;
  }
  update(dt) {
    if (this.foe) return;                              // воздушный бой — кружим
    const ord = this.sim.airOrder[this.owner];
    let aimx, aimz;
    if (ord && ord.kind === 'bomb') {
      const c = this.sim.cities[ord.cityIdx];
      if (c && c.owner !== this.owner && this.sim.atWar(this.owner, c.owner)) { aimx = c.gx; aimz = c.gz; }
      else { aimx = this.x + Math.cos(this.heading) * 10; aimz = this.z + Math.sin(this.heading) * 10; }
    } else if (ord && ord.kind === 'patrol') { aimx = ord.x; aimz = ord.z; }
    else { aimx = this.x + Math.cos(this.heading) * 10; aimz = this.z + Math.sin(this.heading) * 10; }
    let dh = Math.atan2(aimz - this.z, aimx - this.x) - this.heading;
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    const TURN = 1.35;
    this.heading += Math.max(-TURN * dt, Math.min(TURN * dt, dh));
    this.x += Math.cos(this.heading) * C.PLANE_SPEED * dt;
    this.z += Math.sin(this.heading) * C.PLANE_SPEED * dt;
    if (this.x < 0) { this.x = 0; this.heading = Math.PI - this.heading; }
    if (this.x > C.GRID) { this.x = C.GRID; this.heading = Math.PI - this.heading; }
    if (this.z < 0) { this.z = 0; this.heading = -this.heading; }
    if (this.z > C.GRID) { this.z = C.GRID; this.heading = -this.heading; }
  }
}

module.exports = { Plane };
