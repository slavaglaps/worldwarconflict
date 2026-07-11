/* ── 🗺 minimap.js — миникарта (правый нижний угол) ───────────────────────────
   2D-канвас GRID×GRID (1px = 1 тайл): политическая раскраска (как assignRegions)
   × туман войны (FOG-текстура) + точки городов и видимых армий + рамка вьюпорта.
   Клик/драг по карте — перенос камеры. Слои:
     #mmBase — территория+туман (переком позиция ~7 Гц),
     #mmTop  — города/армии/вьюпорт (каждый кадр, дёшево). */
(function () {
  const G = (typeof GRID !== 'undefined') ? GRID : 256;
  const SIZE = 184;                       // CSS-размер виджета (px)
  const FOG_MIN = 0.38;                   // яркость тумана на миникарте (0 = чёрный)
  let box = null, cvBase = null, cvTop = null, ctxB = null, ctxT = null;
  let base = null;                        // Uint8ClampedArray RGBA — политическая подложка
  let img = null;                         // ImageData для композита
  let baseT = 0, fogT = 0;
  const _rc = (typeof T3 !== 'undefined') ? new T3.Raycaster() : null;
  const _v2 = (typeof T3 !== 'undefined') ? new T3.Vector2() : null;

  function ensureDom() {
    if (box) return true;
    if (!document.body) return false;
    box = document.createElement('div');
    box.id = 'minimap';
    const head = document.createElement('div'); head.className = 'mmHead';
    head.innerHTML = '<span class="mmLine"></span><span class="mmTitle">' + ((typeof t === 'function') ? t('hud.minimap_title') : 'Europe') + '</span><span class="mmLine"></span>';
    const view = document.createElement('div'); view.className = 'mmView';
    cvBase = document.createElement('canvas'); cvBase.width = G; cvBase.height = G;
    cvTop = document.createElement('canvas'); cvTop.width = G; cvTop.height = G;
    const vig = document.createElement('div'); vig.className = 'mmVig';
    view.appendChild(cvBase); view.appendChild(cvTop); view.appendChild(vig);
    box.appendChild(head); box.appendChild(view);
    document.body.appendChild(box);
    ctxB = cvBase.getContext('2d'); ctxT = cvTop.getContext('2d');
    img = ctxB.createImageData(G, G);
    // клик/драг → перенос камеры (мировые координаты = позиция на карте)
    let drag = false;
    const move = (e) => {
      const r = cvTop.getBoundingClientRect();
      const wx = (e.clientX - r.left) / r.width * G;
      const wz = (e.clientY - r.top) / r.height * G;
      if (typeof target !== 'undefined' && typeof applyCam === 'function') {
        target.set(Math.max(4, Math.min(G - 4, wx)), 2, Math.max(4, Math.min(G - 4, wz)));
        applyCam();
      }
    };
    view.addEventListener('pointerdown', (e) => { drag = true; move(e); e.preventDefault(); });
    addEventListener('pointermove', (e) => { if (drag) move(e); });
    addEventListener('pointerup', () => { drag = false; });
    return true;
  }

  // политическая подложка: вода / цвет владельца ближайшего города.
  // Вороной берём из sim/vision.js (тот же, что у тумана) — в hex-режиме t.region не заполняется.
  function _voronoi() {
    const V = window.__WWCSim && window.__WWCSim.vision;
    if (!V || typeof cities === 'undefined' || !cities.length) return null;
    const sh = (typeof FOG !== 'undefined' && FOG._shim) ? FOG._shim : (window.__MMSHIM = window.__MMSHIM || {});
    if (!sh._voronoi || sh._voronoiN !== cities.length) { sh._voronoi = V.buildVoronoi(cities, G); sh._voronoiN = cities.length; }
    return sh._voronoi;
  }
  function rebuildBase() {
    if (typeof tiles === 'undefined' || !tiles || !tiles.length) return;
    if (!base) base = new Uint8ClampedArray(G * G * 4);
    const vor = _voronoi();
    for (let z = 0; z < G; z++) {
      for (let x = 0; x < G; x++) {
        const o = (z * G + x) * 4;                       // канвас: px=мир x, py=мир z (север сверху)
        const t = tiles[x] && tiles[x][z];
        if (!t || t.isWater) { base[o] = 13; base[o + 1] = 30; base[o + 2] = 48; base[o + 3] = 255; continue; }
        let hex = 0x9aa6b2;
        const ci = vor ? vor[x * G + z] : 65535;
        if (ci !== 65535 && cities[ci] && typeof OWNER_COL !== 'undefined' && OWNER_COL[cities[ci].owner] != null) hex = OWNER_COL[cities[ci].owner];
        // приглушаем как на большой карте (чуть темнее и мягче)
        base[o] = ((hex >> 16) & 255) * 0.82;
        base[o + 1] = ((hex >> 8) & 255) * 0.82;
        base[o + 2] = (hex & 255) * 0.82;
        base[o + 3] = 255;
      }
    }
  }

  // подложка × туман → #mmBase
  function composeFog() {
    if (!base || !img) return;
    const d = img.data;
    const fog = (typeof FOG !== 'undefined' && FOG.tex) ? FOG.tex.image.data : null;   // байты, x-major (x*G+z)
    for (let z = 0; z < G; z++) {
      for (let x = 0; x < G; x++) {
        const o = (z * G + x) * 4;
        let k = 1;
        if (fog) { const v = fog[x * G + z] / 255; k = FOG_MIN + (1 - FOG_MIN) * v; }
        d[o] = base[o] * k; d[o + 1] = base[o + 1] * k; d[o + 2] = base[o + 2] * k; d[o + 3] = 255;
      }
    }
    ctxB.putImageData(img, 0, 0);
  }

  // города + видимые армии + рамка вьюпорта → #mmTop
  const _corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  function drawTop() {
    ctxT.clearRect(0, 0, G, G);
    const fog = (typeof FOG !== 'undefined' && FOG.tex) ? FOG.tex.image.data : null;
    if (typeof cities !== 'undefined') {
      for (const c of cities) {
        if (!c) continue;
        const hex = (typeof OWNER_COL !== 'undefined' && OWNER_COL[c.owner] != null) ? OWNER_COL[c.owner] : 0x9aa6b2;
        let k = 1;
        if (fog) { const v = fog[Math.round(c.gx) * G + Math.round(c.gz)] / 255; k = FOG_MIN + (1 - FOG_MIN) * v; }
        const r = ((hex >> 16) & 255) * k, g = ((hex >> 8) & 255) * k, b = (hex & 255) * k;
        ctxT.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
        const s = c.capital ? 4 : 3;
        ctxT.fillRect(c.gx - s / 2, c.gz - s / 2, s, s);
        if (typeof PLAYER !== 'undefined' && c.owner === PLAYER) { ctxT.strokeStyle = 'rgba(255,255,255,.85)'; ctxT.lineWidth = 0.6; ctxT.strokeRect(c.gx - s / 2, c.gz - s / 2, s, s); }
      }
    }
    // видимые армии/корабли/самолёты (в MP сервер шлёт только видимых; в соло проектор фильтрует)
    if (typeof MP !== 'undefined' && MP.ghosts) {
      for (const gh of MP.ghosts.values()) {
        if (!gh || !gh.group) continue;
        const p = gh.group.position;
        ctxT.fillStyle = (typeof PLAYER !== 'undefined' && gh.owner === PLAYER) ? '#ffffff' : '#ff6a4a';
        ctxT.fillRect(p.x - 1, p.z - 1, 2, 2);
      }
    }
    // рамка вьюпорта: bounding-box трапеции обзора (лучи из углов экрана на плоскость y=0,
    // затем описанный прямоугольник — аккуратнее визуально, чем сама трапеция)
    if (_rc && typeof camera !== 'undefined') {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, n = 0;
      for (const [nx, ny] of _corners) {
        _v2.set(nx, ny); _rc.setFromCamera(_v2, camera);
        const o = _rc.ray.origin, dir = _rc.ray.direction;
        if (Math.abs(dir.y) < 1e-4) continue;
        const t = -o.y / dir.y; if (t <= 0) continue;
        const wx = o.x + dir.x * t, wz = o.z + dir.z * t;
        if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
        if (wz < minZ) minZ = wz; if (wz > maxZ) maxZ = wz;
        n++;
      }
      if (n === 4) {
        // не даём боксу разъезжаться за карту (у горизонта дальние лучи улетают далеко)
        minX = Math.max(-4, minX); minZ = Math.max(-4, minZ);
        maxX = Math.min(G + 4, maxX); maxZ = Math.min(G + 4, maxZ);
        ctxT.strokeStyle = 'rgba(232,206,138,.9)'; ctxT.lineWidth = 1.2;   // золото в тон уголков панелей
        ctxT.strokeRect(minX, minZ, maxX - minX, maxZ - minZ);
      }
    }
  }

  // главный тик (зовётся из loop): подложка 0.5 Гц, туман ~7 Гц, точки/вьюпорт — каждый кадр
  function minimapUpdate(dt) {
    if (typeof tiles === 'undefined' || !tiles || !tiles.length) return;
    if (!ensureDom()) return;
    baseT -= dt; fogT -= dt;
    if (!base || baseT <= 0) { rebuildBase(); baseT = 2.0; fogT = 0; }
    if (fogT <= 0) { composeFog(); fogT = 0.15; }
    drawTop();
  }

  window.minimapUpdate = minimapUpdate;
  window.MINIMAP = { rebuildBase, get el() { return box; }, SIZE };
})();
