/* СКОПИРОВАНО из server/sim/ скриптом scripts/sync-sim.js — НЕ РЕДАКТИРОВАТЬ. Источник: server/sim/SpatialGrid.js */
// Равномерная пространственная сетка для поиска целей за O(1) на юнита.
// Бой бьёт по очень малому радиусу (PLANE_RANGE 2.6, SHIP_RANGE 2.2 на карте 256),
// поэтому бакет размером с радиус → каждый юнит проверяет только соседние клетки,
// а не всех. Так O(n²) скан превращается в ~O(n).
class SpatialGrid {
  constructor(cell) {
    this.cell = cell || 4;
    this.b = new Map();              // packed cell key -> массив юнитов
  }
  _key(cx, cz) { return cx * 100003 + cz; }   // cx,cz ∈ [0..~100] на карте 256 → без коллизий

  clear() { this.b.clear(); }

  insert(item, x, z) {
    const cx = (x / this.cell) | 0, cz = (z / this.cell) | 0;
    const k = this._key(cx, cz);
    let a = this.b.get(k);
    if (!a) { a = []; this.b.set(k, a); }
    a.push(item);
  }

  // Вызывает fn для каждого юнита в клетках, покрывающих круг радиуса `radius` вокруг (x,z).
  queryWithin(x, z, radius, fn) {
    const cell = this.cell, span = Math.max(1, Math.ceil(radius / cell));
    const cx = (x / cell) | 0, cz = (z / cell) | 0;
    for (let dx = -span; dx <= span; dx++)
      for (let dz = -span; dz <= span; dz++) {
        const a = this.b.get(this._key(cx + dx, cz + dz));
        if (a) for (let i = 0; i < a.length; i++) fn(a[i]);
      }
  }
}

module.exports = { SpatialGrid };
