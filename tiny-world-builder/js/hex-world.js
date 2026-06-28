/* ─────────────────────────────────────────────────────────────────────────
   hex-world.js — game-scope рендер ЗАПЕЧЁННОЙ карты (hex-map.json) в координатах ИГРЫ.
   Переопределяет buildWorld/getTerrainHeight/assignRegions. Все слои как в редакторе:
   трава/вода/реки/дороги/мосты/декор. Растеризует ячейки в tiles[][] → логика
   воды/портов/высот/дорог работает без правок. Данные из hex-preload.js (window.HEXDATA).

   Координаты: q,r → wx/wz (проекция редактора) → lng/lat → gx/gz (КОНСТАНТЫ ИГРЫ, как CITY_DATA)
   → города ложатся ровно. Декор/мосты приходят в wx/wz, конвертятся тем же путём.
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  if (!window.HEXDATA) { console.warn('[hex] HEXDATA не готова — остаётся стандартная карта'); return; }
  const T = window.THREE, MAP = window.HEXDATA.MAP, M = window.HEXDATA.models, m = MAP.meta;
  // sRGB-вывод как в редакторе: без него KayKit-текстуры тёмные/коричневые, пляж не виден.
  // Только для хекс-варианта (game.html не грузит этот модуль) — рендерер общий, но создаётся свой на страницу.
  if (typeof renderer !== 'undefined' && renderer && T.sRGBEncoding) renderer.outputEncoding = T.sRGBEncoding;

  // проекция редактора: q,r → wx/wz
  const SQ3 = Math.sqrt(3), Rg = m.R * m.HEXS, ox = m.worldW / 2, oz = m.worldH / 2;
  const qrToWX = (q, r) => SQ3 * Rg * (q + (r & 1) * 0.5) - ox;
  const qrToWZ = (q, r) => 1.5 * Rg * r - oz;
  // wx/wz → geo → игровое gx/gz (теми же константами, что CITY_DATA)
  const wxToGX = (wx) => { const lng = m.B.minX + ((wx + ox) / m.worldW) * m.lngSpan; return (lng - LON0) / (LON1 - LON0) * GRID; };
  const wzToGZ = (wz) => { const lat = m.B.maxY - ((wz + oz) / m.worldH) * m.latSpan; return (LAT1 - lat) / (LAT1 - LAT0) * GRID; };
  // масштаб тайла по осям игры
  const kx = (GRID / (LON1 - LON0)) * (m.lngSpan / m.worldW);
  const kz = (GRID / (LAT1 - LAT0)) * (m.latSpan / m.worldH);
  const kY = (kx + kz) / 2, FLOORg = m.FLOOR * kY;
  let HEXROADS = new Map();                 // ekey "a_b" → {from, pts[gx,gz], cum, len} для путей юнитов
  let HEXSNAP = null;                        // [x][z] → центр ближайшего хекса (снап зданий городов в центр гекса)
  let HEXCOAST = [];                         // центры сухих прибрежных хексов
  let HEXTYPES = new Map();                  // "q,r" → тип исходного тайла без игровой подложки

  const dummy = new T.Object3D(), WHITE = new T.Color(0xffffff);
  const BIOME_TINT = {
    default: new T.Color(0xffffff),
    desert: new T.Color(0xfff0b8),
    summer: new T.Color(0xd8ff78),
    darkForest: new T.Color(0x2f7a45),
    basalt: new T.Color(0x7b7f86),
    terracotta: new T.Color(0xc97950),
    alpineStone: new T.Color(0xa9b9c9),
    burgundyClay: new T.Color(0x9a5b64),
    wheatGold: new T.Color(0xd4c36b),
    steppeAmber: new T.Color(0xbfa15a),
    aegeanMarble: new T.Color(0x8fc7d9),
    karst: new T.Color(0x9c8b78),
    caucasusHighland: new T.Color(0x9b735f),
    apricotTuff: new T.Color(0xc88457),
    saffronDrylands: new T.Color(0xd49a43),
    amberBog: new T.Color(0xa77a48),
    heatherField: new T.Color(0x9b7fb4),
    mistCoast: new T.Color(0x91aeb9),
    peatland: new T.Color(0x7f7a66),
    roseValley: new T.Color(0xc98293),
    paprikaPlain: new T.Color(0xb8694f),
    copperIsland: new T.Color(0xc89149),
    slateMeadow: new T.Color(0x8a94a1),
    vineyardDusk: new T.Color(0x8b6a8f),
    dunePolder: new T.Color(0xc7b77a),
    carpathianDusk: new T.Color(0x867394),
    limestoneBlue: new T.Color(0x9fb2c1),
    bohemianClay: new T.Color(0xad6d58),
    glacierAlpine: new T.Color(0xd7e8f0),
    pyreneanStone: new T.Color(0xb7a690),
    volcanic: new T.Color(0x3e3a37),
    anatolia: new T.Color(0xd6aa68),
    winter: new T.Color(0xf4fbff),
  };
  const BIOME_ROAD_TINT = {
    desert: new T.Color(0xfff0b8),
    summer: new T.Color(0xd8ff78),
    darkForest: new T.Color(0x2f7a45),
    basalt: new T.Color(0x7b7f86),
    terracotta: new T.Color(0xd17655),
    alpineStone: new T.Color(0xd7e1e8),
    burgundyClay: new T.Color(0xd7a09a),
    wheatGold: new T.Color(0xefe0a1),
    steppeAmber: new T.Color(0xe5c982),
    aegeanMarble: new T.Color(0xd9f0ee),
    karst: new T.Color(0xcbb9a3),
    caucasusHighland: new T.Color(0xd2aa86),
    apricotTuff: new T.Color(0xe8bd8b),
    saffronDrylands: new T.Color(0xf0c36c),
    amberBog: new T.Color(0xd6a970),
    heatherField: new T.Color(0xc7aedb),
    mistCoast: new T.Color(0xc6d7dc),
    peatland: new T.Color(0xb7aa8a),
    roseValley: new T.Color(0xe8b3bc),
    paprikaPlain: new T.Color(0xdfa07c),
    copperIsland: new T.Color(0xe9c778),
    slateMeadow: new T.Color(0xc3ccd4),
    vineyardDusk: new T.Color(0xbda5be),
    dunePolder: new T.Color(0xeadca7),
    carpathianDusk: new T.Color(0xb9a7c4),
    limestoneBlue: new T.Color(0xd1dee6),
    bohemianClay: new T.Color(0xd9a18c),
    glacierAlpine: new T.Color(0xeef7fa),
    pyreneanStone: new T.Color(0xd9c8a8),
    volcanic: new T.Color(0xff6a1a),
    anatolia: new T.Color(0xe8c985),
    winter: new T.Color(0xf4fbff),
  };
  const biomeModelSuffix = (biome) => String(biome || '').replace(/(^|_)([a-z])/g, (_, __, ch) => ch.toUpperCase());
  const biomeGrassModel = (biome) => {
    const key = 'grass' + biomeModelSuffix(biome);
    if (M[key]) return M[key];
    return M.grass;
  };
  const biomeRoadModel = (base, biome) => {
    if (!base || !biome || biome === 'default') return base;
    const key = '__road_' + biome;
    if (base[key]) return base[key];
    const source = biomeGrassModel(biome);
    const mat = base.mat.clone();
    if (source?.mat?.map) mat.map = source.mat.map;
    mat.color = (BIOME_ROAD_TINT[biome] || BIOME_TINT[biome] || BIOME_TINT.default).clone();
    base[key] = { geo: base.geo, mat };
    return base[key];
  };
  const biomeTileModel = (base, biome, assetKey = '') => {
    if (!base || !biome || biome === 'default') return base;
    if (String(assetKey).startsWith('coast')) return biomeGrassModel(biome);
    const key = '__tile_' + biome;
    if (base[key]) return base[key];
    const source = biomeGrassModel(biome);
    const mat = base.mat.clone();
    if (source?.mat?.map) mat.map = source.mat.map;
    if (source?.mat?.color) mat.color = source.mat.color.clone();
    base[key] = { geo: base.geo, mat };
    return base[key];
  };
  const isBiomeDecorAsset = (asset) => /^(treesA|treesB|tree1|mtnA|mtnB|mtnC|rockA|rockC)$/.test(asset)
    || (/^nature_/.test(asset) && !/^nature_(cloud|waterlily|waterplant)/.test(asset));
  const biomeDecorModel = (base, biome, assetKey = '') => {
    if (!base || !biome || biome === 'default' || !isBiomeDecorAsset(assetKey)) return base;
    const key = '__decor_' + biome;
    if (base[key]) return base[key];
    const source = biomeGrassModel(biome);
    const mat = base.mat.clone();
    if (source?.mat?.map) mat.map = source.mat.map;
    mat.color = biome === 'darkForest'
      ? new T.Color(0x2f7a45)
      : (BIOME_TINT[biome] || BIOME_TINT.default).clone();
    base[key] = { geo: base.geo, mat };
    return base[key];
  };
  // строит инстансы из списка {gx,gz,top,ry,col} одной моделью
  function instMesh(model, list, tinted) {
    if (!list.length || !model) return null;
    const im = new T.InstancedMesh(model.geo, model.mat, list.length);
    im.castShadow = true; im.receiveShadow = true;
    for (let i = 0; i < list.length; i++) {
      const c = list[i], sy = c.top - FLOORg;
      dummy.position.set(c.gx, c.top, c.gz); dummy.rotation.set(0, c.ry || 0, 0); dummy.scale.set(kx * m.HEXS, sy, kz * m.HEXS); dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix); im.setColorAt(i, tinted && c.col != null ? c.col : WHITE);
    }
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    return im;
  }

  function hexBuildWorld() {
    const grass = [], water = [], rivByKey = {}, roadByKey = {};
    HEXTYPES = new Map();
    for (const t of MAP.tiles) HEXTYPES.set(t[0] + ',' + t[1], { water: !!t[2], river: !!t[5] });
    const neighborQR = (q, r) => (r & 1)
      ? [[q+1,r],[q-1,r],[q+1,r-1],[q,r-1],[q+1,r+1],[q,r+1]]
      : [[q+1,r],[q-1,r],[q,r-1],[q-1,r-1],[q,r+1],[q-1,r+1]];
    HEXCOAST = [];
    // tiles: [q, r, water, elev, colHex, rivKey, rivRy, roadKey, roadRy, tileKey?, tileRy?]
    const tileByKey = {};                          // ручные тайл-переопределения (coast*/grassSlope*)
    for (const t of MAP.tiles) {
      const q = t[0], r = t[1], isW = t[2], elev = t[3], colHex = t[4], rk = t[5], rry = t[6], dk = t[7], dry = t[8], tk = t[9], try_ = t[10], biome = t[11] || 'default';
      const gx = wxToGX(qrToWX(q, r)), gz = wzToGZ(qrToWZ(q, r));
      const waterNeighbors = neighborQR(q, r).filter(([nq, nr]) => HEXTYPES.get(nq + ',' + nr)?.water);
      if (!isW && !rk && waterNeighbors.length) {
        let sx = 0, sz = 0;
        for (const [nq, nr] of waterNeighbors) { sx += wxToGX(qrToWX(nq, nr)); sz += wzToGZ(qrToWZ(nq, nr)); }
        HEXCOAST.push({ gx, gz, seaAngle: Math.atan2(sz / waterNeighbors.length - gz, sx / waterNeighbors.length - gx) });
      }
      if (tk) {                                   // переопределённая модель тайла (берег/склон, ручная покраска)
        const tileBucket = tk + ':' + biome;
        (tileByKey[tileBucket] || (tileByKey[tileBucket] = { modelKey: tk, biome, list: [] })).list.push({ gx, gz, top: elev * kY, ry: try_ });
      } else if (rk) {                            // речной тайл — только модель реки
        (rivByKey[rk] || (rivByKey[rk] = [])).push({ gx, gz, top: elev * kY, ry: rry });
      } else if (isW) {                           // море
        water.push({ gx, gz, top: (elev - 0.2) * kY });
      } else {                                    // суша (с дорогой → тайл чуть утоплен)
        const lowered = dk ? elev - 0.075 : elev;
        grass.push({ gx, gz, top: lowered * kY, biome, col: colHex >= 0 ? new T.Color().setHex(colHex) : (BIOME_TINT[biome] || BIOME_TINT.default).clone() });
        if (dk) {
          const roadBucket = dk + ':' + biome;
          (roadByKey[roadBucket] || (roadByKey[roadBucket] = { modelKey: dk, biome, list: [] })).list.push({ gx, gz, top: (elev + 0.035) * kY, ry: dry });
        }
      }
    }
    const _add = (mm) => { if (mm) scene.add(mm); };
    _add(instMesh(M.water, water, false));
    const grassByBiome = {};
    for (const c of grass) (grassByBiome[c.biome || 'default'] || (grassByBiome[c.biome || 'default'] = [])).push(c);
    for (const biome in grassByBiome) _add(instMesh(biomeGrassModel(biome), grassByBiome[biome], true));
    for (const k in rivByKey) { const mm = instMesh(M[k], rivByKey[k], false); if (mm) scene.add(mm); }
    for (const k in roadByKey) {
      const bucket = roadByKey[k];
      const mm = instMesh(biomeRoadModel(M[bucket.modelKey], bucket.biome), bucket.list, false);
      if (mm) scene.add(mm);
    }
    for (const k in tileByKey) {
      const bucket = tileByKey[k];
      const mm = instMesh(biomeTileModel(M[bucket.modelKey], bucket.biome, bucket.modelKey), bucket.list, false);
      if (mm) scene.add(mm);
    }

    // мосты: [wx, wz, bridgeKey, bridgeRy, bankY]
    const brByKey = {};
    for (const b of MAP.bridges) (brByKey[b[2]] || (brByKey[b[2]] = [])).push({ gx: wxToGX(b[0]), gz: wzToGZ(b[1]), top: b[4] * kY, ry: b[3] });
    for (const k in brByKey) { const mm = instMesh(M[k], brByKey[k], false); if (mm) scene.add(mm); }

    // декор: [asset, wx, wz, y, yaw, scale, biome] — модель с равномерным масштабом
    const decByKey = {};
    for (const d of MAP.decor) {
      const bucket = d[0] + ':' + (d[6] || 'default');
      (decByKey[bucket] || (decByKey[bucket] = { asset: d[0], biome: d[6] || 'default', list: [] })).list.push(d);
    }
    const decorGroup = new T.Group();
    for (const k in decByKey) {
      const bucket = decByKey[k], list = bucket.list, model = biomeDecorModel(M[bucket.asset], bucket.biome, bucket.asset); if (!model) continue;
      const im = new T.InstancedMesh(model.geo, model.mat, list.length);
      im.castShadow = true; im.receiveShadow = true;
      for (let i = 0; i < list.length; i++) {
        const d = list[i], s = (d[5] || 1) * kY;
        dummy.position.set(wxToGX(d[1]), (d[3] || 0) * kY, wzToGZ(d[2])); dummy.rotation.set(0, d[4] || 0, 0); dummy.scale.set(s, s, s); dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix); im.setColorAt(i, WHITE);   // instanceColor ОБЯЗАТЕЛЕН: без него THREE падает в рендере (смешение инстансов с/без цвета)
      }
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; decorGroup.add(im);
    }
    scene.add(decorGroup);

    // ── растеризация в tiles[][] (256²): вода/высоты/порты/декор/дороги ──
    const SEA_TOP = -0.2 * kY;
    for (let x = 0; x < GRID; x++) { tiles[x] = []; for (let z = 0; z < GRID; z++) tiles[x][z] = { isWater: true, topY: SEA_TOP, terrain: 'sea', region: null }; }
    HEXSNAP = []; for (let x = 0; x < GRID; x++) HEXSNAP[x] = [];   // [x][z] = [центр хекса gx, gz, dist²] — снап зданий в центр гекса
    for (const t of MAP.tiles) {
      const q = t[0], r = t[1], isW = t[2], elev = t[3], rk = t[5];
      const gxC = wxToGX(qrToWX(q, r)), gzC = wzToGZ(qrToWZ(q, r));
      const xi = Math.round(gxC), zi = Math.round(gzC);
      const landTile = !isW && !rk;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const x = xi + a, z = zi + b; if (x < 0 || z < 0 || x >= GRID || z >= GRID) continue;
        const cur = tiles[x][z];
        if (landTile) tiles[x][z] = { isWater: false, topY: elev * kY, terrain: 'land', region: null };
        else if (cur.isWater) cur.topY = (rk ? elev : elev - 0.2) * kY;
        const nd = (gxC - x) * (gxC - x) + (gzC - z) * (gzC - z), prev = HEXSNAP[x][z];   // ближайший центр хекса
        if (!prev || nd < prev[2]) HEXSNAP[x][z] = [gxC, gzC, nd, !isW];
      }
    }
    // суша под городами — чтобы порты не тонули
    if (typeof CITY_DATA !== 'undefined') for (const d of CITY_DATA) {
      const gx = Math.round(d[0]), gz = Math.round(d[1]);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const x = gx + a, z = gz + b; if (x < 0 || z < 0 || x >= GRID || z >= GRID) continue;
        const tt = tiles[x][z]; if (tt.isWater) { tt.isWater = false; tt.terrain = 'land'; tt.topY = Math.max(tt.topY, 0.05); }
      }
    }

    // ── маршруты дорог по парам городов → юниты идут по визуальным дорогам ──
    HEXROADS = new Map();
    const nearestCityIndex = (pt) => {
      if (!pt || typeof CITY_DATA === 'undefined') return null;
      let best = null, bestD = Infinity;
      for (let i = 0; i < CITY_DATA.length; i++) {
        const d = (CITY_DATA[i][0] - pt[0]) ** 2 + (CITY_DATA[i][1] - pt[1]) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      }
      return bestD <= 20 * 20 ? best : null;
    };
    for (const rd of (MAP.roads || [])) {
      let a = rd[0], b = rd[1];
      const raw = rd[2];
      const pts = raw.map((p) => [wxToGX(p[0]), wzToGZ(p[1])]);
      if (a == null || b == null || a === b || pts.length < 2) continue;
      const cum = [0]; for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      HEXROADS.set(Math.min(a, b) + '_' + Math.max(a, b), { a, b, from: a, pts, cum, len: cum[cum.length - 1] });
    }

    if (typeof buildGraph === 'function') buildGraph();   // дорожный граф (пути юнитов)
    addHexRoadGraphEdges();                               // ручные дороги редактора тоже должны быть путями
    console.log('[hex] карта из hex-map.json: tiles=' + MAP.tiles.length + ' bridges=' + MAP.bridges.length + ' decor=' + MAP.decor.length + ' roads=' + HEXROADS.size);
  }

  function addHexRoadGraphEdges() {
    if (typeof EDGES === 'undefined' || typeof EDGE_BY_KEY === 'undefined' || typeof ADJ === 'undefined') return;
    const ek = typeof edgeKey === 'function' ? edgeKey : ((a, b) => a < b ? a + '_' + b : b + '_' + a);
    EDGES.length = 0; EDGE_BY_KEY.clear(); ADJ.clear();
    const pushGraphEdge = (e) => {
      const key = ek(e.a, e.b);
      if (EDGE_BY_KEY.has(key)) return;
      EDGES.push(e); EDGE_BY_KEY.set(key, e);
      if (!ADJ.has(e.a)) ADJ.set(e.a, []); if (!ADJ.has(e.b)) ADJ.set(e.b, []);
      ADJ.get(e.a).push({ to: e.b, e }); ADJ.get(e.b).push({ to: e.a, e });
    };
    for (const rd of HEXROADS.values()) {
      const pts = rd.pts.map(p => new T.Vector3(p[0], getTerrainHeight(p[0], p[1]), p[1]));
      const e = { a: rd.a, b: rd.b, type: 'road', len: rd.len, mult: 1, time: rd.len / SQUAD_SPEED, pts };
      pushGraphEdge(e);
    }
  }

  // позиция вдоль визуальной дороги ребра (a→b) на доле f∈[0,1]. null, если дороги нет.
  window.hexRoadPos = function hexRoadPos(a, b, f) {
    const rd = HEXROADS.get(Math.min(a, b) + '_' + Math.max(a, b));
    if (!rd || rd.len <= 0) return null;
    let t = Math.max(0, Math.min(1, f));
    if (rd.from !== a) t = 1 - t;                 // дорога запечена a→b; едем в обратную сторону → реверс
    const target = t * rd.len, cum = rd.cum, pts = rd.pts;
    let i = 1; while (i < cum.length && cum[i] < target) i++;
    if (i >= pts.length) return { x: pts[pts.length - 1][0], z: pts[pts.length - 1][1] };
    const seg = cum[i] - cum[i - 1] || 1, lf = (target - cum[i - 1]) / seg;
    return { x: pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * lf, z: pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * lf };
  };
  window.hexRoadPolyline = function hexRoadPolyline(a, b) {
    const rd = HEXROADS.get(Math.min(a, b) + '_' + Math.max(a, b));
    if (!rd || !rd.pts || rd.pts.length < 2) return null;
    const pts = rd.from === a ? rd.pts : [...rd.pts].reverse();
    return pts.map(p => ({ x: p[0], z: p[1] }));
  };

  buildWorld = hexBuildWorld;
  getTerrainHeight = function (x, z) { const col = tiles[Math.floor(x)]; const t = col && col[Math.floor(z)]; return t && t.topY != null ? t.topY : -0.2 * kY; };
  if (typeof assignRegions === 'function') assignRegions = function () { };

  // ── перекраска KayKit-зданий в цвет фракции: синие («командные») пиксели атласа → оттенок владельца, камень не трогаем ──
  const _facTex = new Map();
  function factionTexture(owner) {
    if (_facTex.has(owner)) return _facTex.get(owner);
    let tex = null;
    try {
      const atlas = M.cityL3 || M.castle, src = atlas && atlas.mat.map, img = src && src.image;
      if (img) {
        const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
        const id = cx.getImageData(0, 0, w, h), d = id.data;
        const fh = { h: 0, s: 0, l: 0 }; new T.Color(OWNER_COL[owner] != null ? OWNER_COL[owner] : 0x6f8fd0).getHSL(fh);
        const c = new T.Color(), hsl = { h: 0, s: 0, l: 0 };
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx === 0 ? 0 : (mx - mn) / mx;
          if (b > r && b > g && sat > 0.25) {                          // синяя «командная» часть → оттенок фракции
            c.setRGB(r, g, b); c.getHSL(hsl); c.setHSL(fh.h, Math.min(1, hsl.s + 0.05), hsl.l);
            d[i] = c.r * 255; d[i + 1] = c.g * 255; d[i + 2] = c.b * 255;
          }
        }
        cx.putImageData(id, 0, 0);
        tex = new T.CanvasTexture(cv); tex.flipY = src.flipY; tex.encoding = src.encoding; tex.wrapS = src.wrapS; tex.wrapT = src.wrapT; tex.needsUpdate = true;
      }
    } catch (e) { console.warn('[hex] перекраска здания не удалась:', e.message || e); }
    _facTex.set(owner, tex);
    return tex;
  }

  let _woodTowerTex;
  function woodTowerTexture() {
    if (_woodTowerTex !== undefined) return _woodTowerTex;
    let tex = null;
    try {
      const src = M.defTower && M.defTower.mat.map, img = src && src.image;
      if (img) {
        const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
        const id = cx.getImageData(0, 0, w, h), d = id.data;
        const c = new T.Color(), hsl = { h: 0, s: 0, l: 0 };
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] === 0) continue;
          c.setRGB(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255); c.getHSL(hsl);
          c.setHSL(0.075, 0.58, Math.max(0.12, Math.min(0.68, hsl.l * 0.78)));
          d[i] = c.r * 255; d[i + 1] = c.g * 255; d[i + 2] = c.b * 255;
        }
        cx.putImageData(id, 0, 0);
        tex = new T.CanvasTexture(cv); tex.flipY = src.flipY; tex.encoding = src.encoding; tex.wrapS = src.wrapS; tex.wrapT = src.wrapT; tex.needsUpdate = true;
      }
    } catch (e) { console.warn('[hex] деревянная перекраска башни не удалась:', e.message || e); }
    _woodTowerTex = tex;
    return tex;
  }

  // ── укрепления: кольцо стен вокруг гекса (def/atk) + башни по углам (atk, по тиру) ──
  const _bbMinY = (m) => { if (!m.geo.boundingBox) m.geo.computeBoundingBox(); return m.geo.boundingBox.min.y; };
  const _bbX = (m) => { if (!m.geo.boundingBox) m.geo.computeBoundingBox(); return m.geo.boundingBox.max.x - m.geo.boundingBox.min.x; };
  const _bbY = (m) => { if (!m.geo.boundingBox) m.geo.computeBoundingBox(); return m.geo.boundingBox.max.y - m.geo.boundingBox.min.y; };
  const _bbZ = (m) => { if (!m.geo.boundingBox) m.geo.computeBoundingBox(); return m.geo.boundingBox.max.z - m.geo.boundingBox.min.z; };
  const _bbCX = (m) => { if (!m.geo.boundingBox) m.geo.computeBoundingBox(); return (m.geo.boundingBox.min.x + m.geo.boundingBox.max.x) * 0.5; };
  const _bbCZ = (m) => { if (!m.geo.boundingBox) m.geo.computeBoundingBox(); return (m.geo.boundingBox.min.z + m.geo.boundingBox.max.z) * 0.5; };
  function isHexLand(gx, gz) {
    const lng = LON0 + (gx / GRID) * (LON1 - LON0);
    const lat = LAT1 - (gz / GRID) * (LAT1 - LAT0);
    const wx = ((lng - m.B.minX) / m.lngSpan) * m.worldW - ox;
    const wz = ((m.B.maxY - lat) / m.latSpan) * m.worldH - oz;
    const r = Math.round((wz + oz) / (1.5 * Rg));
    const q = Math.round((wx + ox) / (SQ3 * Rg) - (r & 1) * 0.5);
    const type = HEXTYPES.get(q + ',' + r);
    return !!(type && !type.water);
  }
  function nearestCoastHex(gx, gz, parent) {
    let best = null, bd = Infinity;
    const minParentDist = 3.15;
    for (const p of HEXCOAST) {
      if (parent && Math.hypot(p.gx - parent.gx, p.gz - parent.gz) < minParentDist) continue;
      const d = (p.gx - gx) ** 2 + (p.gz - gz) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
  function syncCityVisualPosition(city, gx, gz) {
    const y = getTerrainHeight(gx, gz);
    if (city._dataGX == null) { city._dataGX = city.gx; city._dataGZ = city.gz; city._dataBaseY = city.baseY; }
    city.gx = gx; city.gz = gz; city.baseY = y;
    city._visualGX = gx; city._visualGZ = gz; city._visualY = y;
    if (city.buildGroup) city.buildGroup.position.set(gx, y, gz);
    if (city.hit) city.hit.position.set(gx, y + 0.8 * CITY_SCALE, gz);
    if (city.ring) city.ring.position.set(gx, y + 0.03, gz);
    if (city.rangeRing) city.rangeRing.position.set(gx, y + 0.1, gz);
    if (city.pring) city.pring.position.set(gx, y + 0.05, gz);
    if (city.bring) city.bring.position.set(gx, y + 0.08, gz);
  }
  function _segmentHit(a, b, c, d) {
    const rx = b[0] - a[0], rz = b[1] - a[1], sx = d[0] - c[0], sz = d[1] - c[1];
    const den = rx * sz - rz * sx;
    if (Math.abs(den) < 1e-7) return null;
    const qx = c[0] - a[0], qz = c[1] - a[1];
    const u = (qx * rz - qz * rx) / den;
    const t = (qx * sz - qz * sx) / den;
    return t >= -1e-5 && t <= 1.00001 && u >= -1e-5 && u <= 1.00001 ? { roadT: t, edgeT: u } : null;
  }
  function cityName(idx) { return (typeof CITY_NAMES !== 'undefined' && CITY_NAMES[idx]) || (CITY_LIST[idx] && CITY_LIST[idx][0]) || ''; }
  function isInlineShipyardChild(parent, child) {
    if (!parent || !child || parent === child || !child.isShipyard || parent.isShipyard || parent.isAirport) return false;
    const childName = cityName(child.idx), parentName = cityName(parent.idx);
    if (childName === 'Верфь Бордо' && parentName === 'Бордо') return true;
    return childName === 'Верфь ' + parentName && Math.hypot(child.gx - parent.gx, child.gz - parent.gz) <= 4.4;
  }
  function roadEndsAtInlineShipyard(city, rd) {
    if (typeof cities === 'undefined') return false;
    const otherIdx = rd.a === city.idx ? rd.b : rd.a;
    return isInlineShipyardChild(city, cities[otherIdx]);
  }
  function inlineShipyardVisualPosition(yard, parent) {
    const hs = (kx + kz) / 2;
    let dx = yard.gx - parent.gx, dz = yard.gz - parent.gz;
    let mag = Math.hypot(dx, dz);
    if (mag < 1e-4) {
      const coast = nearestCoastHex(parent.gx, parent.gz, null);
      dx = coast ? coast.gx - parent.gx : -1;
      dz = coast ? coast.gz - parent.gz : 0;
      mag = Math.hypot(dx, dz) || 1;
    }
    dx /= mag; dz /= mag;
    const dist = Math.max(1.8 * hs, Math.min(2.35 * hs, mag * 0.68));
    const target = { gx: parent.gx + dx * dist, gz: parent.gz + dz * dist };
    let snap = null, bd = Infinity;
    const tx = Math.round(target.gx), tz = Math.round(target.gz);
    if (HEXSNAP) for (let ax = -2; ax <= 2; ax++) for (let az = -2; az <= 2; az++) {
      const s = HEXSNAP[tx + ax] && HEXSNAP[tx + ax][tz + az];
      if (!s || !s[3]) continue;
      const d = (s[0] - target.gx) ** 2 + (s[1] - target.gz) ** 2;
      if (d < bd) { bd = d; snap = s; }
    }
    const base = snap ? { gx: snap[0], gz: snap[1] } : target;
    const edgeShift = 0.82 * hs;
    return { gx: base.gx + dx * edgeShift, gz: base.gz + dz * edgeShift };
  }
  function inlineShipyardWallBreakEdges(city, vertices, offX, offZ) {
    const edges = new Set();
    if (typeof cities === 'undefined') return edges;
    const centerX = city.gx + offX * CITY_SCALE, centerZ = city.gz + offZ * CITY_SCALE;
    for (const child of cities) {
      if (!isInlineShipyardChild(city, child)) continue;
      const pos = inlineShipyardVisualPosition(child, city);
      const local = [(pos.gx - centerX) / CITY_SCALE, (pos.gz - centerZ) / CITY_SCALE];
      const mag = Math.hypot(local[0], local[1]) || 1;
      const far = [local[0] / mag * 100, local[1] / mag * 100];
      let best = null;
      for (let k = 0; k < vertices.length; k++) {
        const hit = _segmentHit([0, 0], far, vertices[k], vertices[(k + 1) % vertices.length]);
        if (hit && (!best || hit.roadT < best.roadT)) best = { edge: k, roadT: hit.roadT };
      }
      if (best) edges.add(best.edge);
    }
    return edges;
  }
  function gatePositionsForCity(city, vertices, offX, offZ) {
    const gates = new Map();
    const centerX = city.gx + offX * CITY_SCALE, centerZ = city.gz + offZ * CITY_SCALE;
    const cityRoads = [...HEXROADS.values()]
      .filter(rd => (rd.a === city.idx || rd.b === city.idx) && !roadEndsAtInlineShipyard(city, rd))
      .sort((a, b) => a.len - b.len);
    const maxGates = city.size <= 1 ? 3 : city.size === 2 ? 4 : 6;
    for (const rd of cityRoads.slice(0, maxGates)) {
      const forward = rd.from === city.idx, pts = rd.pts;
      if (!pts || pts.length < 2) continue;
      const start = forward ? 0 : pts.length - 1, step = forward ? 1 : -1;
      let found = null;
      for (let i = start; i + step >= 0 && i + step < pts.length && !found; i += step) {
        const pa = pts[i], pb = pts[i + step];
        const a = [(pa[0] - centerX) / CITY_SCALE, (pa[1] - centerZ) / CITY_SCALE];
        const b = [(pb[0] - centerX) / CITY_SCALE, (pb[1] - centerZ) / CITY_SCALE];
        for (let k = 0; k < vertices.length; k++) {
          const hit = _segmentHit(a, b, vertices[k], vertices[(k + 1) % vertices.length]);
          if (hit) { found = { edge: k, t: Math.max(0, Math.min(1, hit.edgeT)) }; break; }
        }
      }
      // Некоторые запечённые дороги заканчиваются в соседнем хексе, не доходя
      // до периметра. В таком случае продолжаем направление до стены лучом.
      if (!found) {
        let nearest = null, nearestD = Infinity;
        for (const p of pts) {
          const x = (p[0] - centerX) / CITY_SCALE, z = (p[1] - centerZ) / CITY_SCALE;
          const d = x * x + z * z;
          if (d > 1e-5 && d < nearestD) { nearestD = d; nearest = [x, z]; }
        }
        if (nearest) {
          const mag = Math.hypot(nearest[0], nearest[1]) || 1;
          const far = [nearest[0] / mag * 100, nearest[1] / mag * 100];
          let best = null;
          for (let k = 0; k < vertices.length; k++) {
            const hit = _segmentHit([0, 0], far, vertices[k], vertices[(k + 1) % vertices.length]);
            if (hit && (!best || hit.roadT < best.roadT)) best = { edge: k, t: hit.edgeT, roadT: hit.roadT };
          }
          if (best) found = { edge: best.edge, t: Math.max(0, Math.min(1, best.t)) };
        }
      }
      if (!found) continue;
      const list = gates.get(found.edge) || [];
      if (!list.some(t => Math.abs(t - found.t) < 0.08)) list.push(found.t);
      gates.set(found.edge, list);
    }
    return gates;
  }
  function buildFortifications(city, group, offX, offZ) {
    const defTier = city.branchTier ? city.branchTier('def') : (city.spec === 'def' ? city.tier || 0 : 0);
    const atkTier = city.branchTier ? city.branchTier('atk') : (city.spec === 'atk' ? city.tier || 0 : 0);
    const tier = defTier || atkTier;
    if (tier <= 0 || !M.wall) return;
    const hs = (kx + kz) / 2;
    const tier1Defense = defTier === 1;
    const tier2Defense = defTier === 2;
    // Tier 1 — полностью деревянный вариант уменьшенной крепости.
    // Tier 2 — та же компоновка из камня.
    const wallM = tier1Defense && M.fenceWood ? M.fenceWood : M.wall;
    const gateM = tier1Defense && M.fenceWoodGate ? M.fenceWoodGate : (M.wallGate || wallM);
    const ringR = (tier1Defense || tier >= 2 ? 1.65 : 0.85) * hs;
    const targetH = (tier >= 3 ? 0.442 : tier2Defense ? 0.34 : tier1Defense ? 0.30 : tier === 2 ? 0.30 : 0.18) * hs;
    const cross = targetH / (_bbY(wallM) || 1);       // масштаб высоты/толщины (сохраняет пропорции)
    const wLong = Math.max(_bbX(wallM), _bbZ(wallM)), idealSeg = wLong * cross;
    // угловые башни: def — базовая, atk — по тиру
    const towerTier = atkTier || defTier;
    const atkM = towerTier >= 3 ? M.atkTier3 : towerTier === 2 ? M.atkTier2 : M.atkTier1;
    const towerM = atkTier > 0 && atkM ? atkM : (M.defTower || M.atkTier1);
    const ft = tier1Defense ? woodTowerTexture() : factionTexture(city.owner);
    const towerTargetH = (tier1Defense ? 0.30 : 0.34) * hs;
    const towerFactor = (tier1Defense || tier2Defense) ? 1.3 : 2.6;
    const tScale = (towerTargetH * towerFactor) / (_bbY(towerM) || 1);
    const corners = 6;
    const angleStep = 360 / corners, angleOffset = 30;
    const V = []; for (let k = 0; k < corners; k++) { const a = (angleOffset + angleStep * k) * Math.PI / 180; V.push([Math.cos(a) * ringR, Math.sin(a) * ringR]); }
    const gatePositions = gatePositionsForCity(city, V, offX, offZ);
    const breakEdges = inlineShipyardWallBreakEdges(city, V, offX, offZ);
    const blockedTowerPoints = new Set();
    for (const k of breakEdges) {
      const p = V[k], q = V[(k + 1) % corners];
      blockedTowerPoints.add(Math.round(p[0] * 1000) + ',' + Math.round(p[1] * 1000));
      blockedTowerPoints.add(Math.round(q[0] * 1000) + ',' + Math.round(q[1] * 1000));
    }
    const towerPoints = new Map();
    const addTowerPoint = (x, z) => {
      const key = Math.round(x * 1000) + ',' + Math.round(z * 1000);
      if (!blockedTowerPoints.has(key)) towerPoints.set(key, [x, z]);
    };
    // стены: тайлим N сегментов, ЗАПОЛНЯЯ ребро (N = ребро / желаемая длина сегмента). Высота/толщина — пропорц.
    for (let k = 0; k < corners; k++) {
      const p = V[k], q = V[(k + 1) % corners], ang = Math.atan2(q[1] - p[1], q[0] - p[0]);
      const edgeLen = Math.hypot(q[0] - p[0], q[1] - p[1]);
      let n = Math.max(1, Math.round(edgeLen / idealSeg));
      const edgeGates = gatePositions.get(k) || [];
      const gateSlots = new Set(edgeGates.map(t => Math.max(0, Math.min(n - 1, Math.round(t * n - 0.5)))));
      const lZ = _bbZ(wallM) > _bbX(wallM), lenScale = (edgeLen / n) * 1.1 / wLong;
      const land = [];
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n, cx = p[0] + (q[0] - p[0]) * t, cz = p[1] + (q[1] - p[1]) * t;
        land[i] = isHexLand(city.gx + (offX + cx) * CITY_SCALE, city.gz + (offZ + cz) * CITY_SCALE);
      }
      if (!breakEdges.has(k)) {
        if (land[0]) addTowerPoint(p[0], p[1]);
        if (land[n - 1]) addTowerPoint(q[0], q[1]);
        for (let i = 1; i < n; i++) if (land[i - 1] !== land[i]) {
          const t = i / n;
          addTowerPoint(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t);
        }
      }
      for (let i = 0; i < n; i++) {
        if (!land[i]) continue;
        if (breakEdges.has(k)) continue;
        const t = (i + 0.5) / n, cx = p[0] + (q[0] - p[0]) * t, cz = p[1] + (q[1] - p[1]) * t;
        const isGate = gateSlots.has(i) && gateM;
        const wm = isGate ? gateM : wallM, m = new T.Mesh(wm.geo, wm.mat);
        m.position.set(offX + cx, -_bbMinY(wm) * cross, offZ + cz);
        m.rotation.y = -ang + Math.PI + (lZ ? Math.PI / 2 : 0);   // длинной осью вдоль ребра, внешн. стороной наружу
        if (lZ) m.scale.set(cross, cross, lenScale); else m.scale.set(lenScale, cross, cross);
        if (tier1Defense || isGate) {
          const lx = _bbCX(wm) * m.scale.x, lz = _bbCZ(wm) * m.scale.z;
          const cos = Math.cos(m.rotation.y), sin = Math.sin(m.rotation.y);
          m.position.x -= lx * cos + lz * sin;
          m.position.z -= -lx * sin + lz * cos;
        }
        m.castShadow = true; group.add(m);
      }
    }
    // башни в углах и в каждой точке, где стена заканчивается у моря
    for (const p of towerPoints.values()) {
      const mat = ft ? towerM.mat.clone() : towerM.mat; if (ft) mat.map = ft;
      const m = new T.Mesh(towerM.geo, mat);
      m.position.set(offX + p[0], -_bbMinY(towerM) * tScale, offZ + p[1]); m.scale.setScalar(tScale);
      m.rotation.y = Math.atan2(p[0], p[1]) + Math.PI;   // вход башни — к замку (центру)
      m.castShadow = true; group.add(m);
    }
  }

  // ── KayKit-здания по УРОВНЯМ ПРОКАЧКИ (tier) вместо процедурных воксельных городов (только хекс-вариант) ──
  if (typeof City !== 'undefined' && (M.cityL3 || M.castle)) {
    const _origBuild = City.prototype.buildMeshes, _origRecolor = City.prototype.recolor;
    City.prototype.buildMeshes = function () {
      if (this.isShipyard || this.isAirport) {
        _origBuild.call(this);
        if (this.isShipyard) {
          let parent = null, parentD = Infinity;
          if (typeof cities !== 'undefined') for (const c of cities) {
            if (c === this || c.isShipyard || c.isAirport) continue;
            const d = (c.gx - this.gx) ** 2 + (c.gz - this.gz) ** 2;
            if (d < parentD) { parentD = d; parent = c; }
          }
          const inlinePos = isInlineShipyardChild(parent, this) ? inlineShipyardVisualPosition(this, parent) : null;
          const snap = inlinePos || nearestCoastHex(this.gx, this.gz, parent);
          if (snap) syncCityVisualPosition(this, snap.gx, snap.gz);
        }
        return;
      }
      while (this.buildGroup.children.length) this.buildGroup.remove(this.buildGroup.children[0]);
      this.mats = [];                                                        // здание — текстурой; владелец цветом фракции (см. factionTexture)
      const buildingTier = this.branchTier ? this.branchTier('prod') : (this.spec === 'prod' ? this.tier || 0 : 0);
      const model = (buildingTier >= 3 ? M.cityL3 : buildingTier === 2 ? M.cityL2 : M.cityL1) || M.cityL3 || M.castle;  // основное здание растёт только от экономики
      const ft = factionTexture(this.owner);
      const mat = ft ? model.mat.clone() : model.mat; if (ft) mat.map = ft;
      const mesh = new T.Mesh(model.geo, mat); mesh.castShadow = true; mesh.receiveShadow = true; this._hexMesh = mesh;
      // снап в центр гекса: город стоит в гео-координатах, а хексы на сетке → сдвигаем здание на центр ближайшего хекса
      const sx = Math.max(0, Math.min(GRID - 1, Math.round(this.gx))), sz = Math.max(0, Math.min(GRID - 1, Math.round(this.gz)));
      const snap = HEXSNAP && HEXSNAP[sx] && HEXSNAP[sx][sz];
      const hcx = snap ? snap[0] : this.gx, hcz = snap ? snap[1] : this.gz;
      if (Math.abs(hcx - this.gx) > 1e-6 || Math.abs(hcz - this.gz) > 1e-6) syncCityVisualPosition(this, hcx, hcz);
      mesh.position.set(0, 0, 0);
      // масштаб по тиру (растёт с прокачкой) × поправка хекс-игры (горизонт ~kx/kz), buildGroup уже ×CITY_SCALE
      const tierS = [0.92, 1.00, 0.928, 0.72][Math.min(buildingTier, 3)] * (this.capital ? 1.08 : 1);   // размер основного здания = экономика
      const s = tierS * ((kx + kz) / 2) / CITY_SCALE;
      mesh.scale.setScalar(s);
      this.buildGroup.add(mesh);
      buildFortifications(this, this.buildGroup, 0, 0);   // стены (def) / башни (atk)
      // ОБЯЗАТЕЛЬНО: topY для позиции подписи/кольца (updateLabel: baseY + topY*CITY_SCALE + 0.7). Без него подпись = NaN → пропадает.
      if (!model.geo.boundingBox) model.geo.computeBoundingBox();
      this.topY = Math.max(0.5, (model.geo.boundingBox.max.y || 1) * s);
    };
    City.prototype.recolor = function () {                                  // захват города → перекраска здания в цвет нового владельца
      if (this._hexMesh && !this.isShipyard && !this.isAirport) {
        const ft = factionTexture(this.owner);
        if (ft) { const m = this._hexMesh.material.clone(); m.map = ft; this._hexMesh.material = m; }
        return;
      }
      return _origRecolor.call(this);
    };
  }
})();
