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
  window.HEXWIDTH = SQ3 * Rg * kx;          // ширина хекса в ИГРОВЫХ координатах (шаг соседних хексов) — для лимита ширины шеренги в loop.js
  const BRIDGE_VISUAL_LIFT = 0.08;
  const BRIDGE_DEFAULT_SCALE = 1.025;
  // ── профиль высот дороги + сэмплер — в ОБЛАСТИ МОДУЛЯ ──
  // Нужны и hexBuildWorld (точная запечённая карта), и ensureHexRoadSamplesForMap (фолбэк для сим-рёбер,
  // который initLocalSim зовёт ДО buildWorld). До постройки карты _visualTopByCell/_brTops пусты → высота
  // деградирует к рельефу тайлов, а точные samples перепекутся при buildWorld (он безусловно перезаписывает HEXROADS).
  let _visualTopByCell = new Map(), _brTops = [], _roadTopByCell = new Map();
  const _cellKey = (a, b) => a * 100003 + b;   // числовой ключ клетки (a,b — целые индексы 0..GRID): без аллокации строки на юнит/кадр в hexGroundY/roadPtY
  const ROAD_SAMPLE_STEP = 0.12;
  // БИЛИНЕЙНАЯ высота рельефа: гладкая рампа между клетками (без ступенек nearest-cell). На подъёме
  // наклонный road-тайл идёт от elev низкой клетки к elev высокой — билинейка даёт ту же рампу,
  // поэтому юнит не проваливается ниже полотна и не взлетает на соседний пик (это не максимум по 3×3).
  const _bilinearTopY = (x, z) => {
    if (typeof tiles === 'undefined' || !tiles) return null;
    const x0 = Math.floor(x), z0 = Math.floor(z), fx = x - x0, fz = z - z0;
    // на дорожных клетках предпочитаем ВЕРХ ПОДНЯТОГО road-тайла (насыпь/рампа), иначе — рельеф клетки
    const at = (px, pz) => { const rt = _roadTopByCell.get(_cellKey(px, pz)); if (rt != null) return rt; const c = tiles[px]; const t = c && c[pz]; return (t && t.topY != null && !t.isWater) ? t.topY : null; };
    let h00 = at(x0, z0), h10 = at(x0 + 1, z0), h01 = at(x0, z0 + 1), h11 = at(x0 + 1, z0 + 1);
    const valid = [h00, h10, h01, h11].filter((v) => v != null);
    if (!valid.length) return null;
    const avg = valid.reduce((a, b) => a + b, 0) / valid.length;   // край/вода → добираем средним валидных (не тянем к 0)
    if (h00 == null) h00 = avg; if (h10 == null) h10 = avg; if (h01 == null) h01 = avg; if (h11 == null) h11 = avg;
    const a = h00 * (1 - fx) + h10 * fx, b = h01 * (1 - fx) + h11 * fx;
    return a * (1 - fz) + b * fz;
  };
  const roadPtY = (x, z) => {
    let h = _bilinearTopY(x, z);
    if (h == null) h = (typeof getTerrainHeight === 'function') ? getTerrainHeight(x, z) : -Infinity;
    const vt = _visualTopByCell.get(_cellKey(Math.round(x), Math.round(z)));   // sloped/override-полотно своей клетки
    if (vt != null) h = Math.max(h, vt);
    if (!Number.isFinite(h)) h = 0;
    for (const br of _brTops) { const d2 = (br.gx - x) * (br.gx - x) + (br.gz - z) * (br.gz - z); if (d2 < 0.9 * 0.9 && br.top > h) h = br.top; }
    return h;
  };
  // Дешёвый лукап поверхности ПОД фактической позицией юнита (для клампа рендер-высоты в loop.js):
  //   билинейка полотна/рельефа + верх поднятого sloped/override-тайла своей клетки. БЕЗ цикла мостов
  //   (на мосту u.ey уже = верх полотна, кламп к рельефу его не опустит). O(1) — безопасно на юнит/кадр.
  //   Над водой билинейка = null → рельеф = уровень моря, поэтому корабль/десант на воде не поднимается.
  window.hexGroundY = (x, z) => {
    let h = _bilinearTopY(x, z);
    if (h == null) h = (typeof getTerrainHeight === 'function') ? getTerrainHeight(x, z) : -Infinity;
    const vt = _visualTopByCell.get(_cellKey(Math.round(x), Math.round(z)));
    if (vt != null && vt > h) h = vt;
    return Number.isFinite(h) ? h : -Infinity;
  };
  const buildRoadSamples = (rd) => {
    const pts = rd.pts, cum = rd.cum, len = rd.len;
    const atDist = (dist) => {
      const target = Math.max(0, Math.min(len, dist));
      let i = 1; while (i < cum.length && cum[i] < target) i++;
      if (i >= pts.length) i = pts.length - 1;
      const seg = cum[i] - cum[i - 1] || 1, f = Math.max(0, Math.min(1, (target - cum[i - 1]) / seg));
      const x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f;
      const z = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f;
      return { s: target, x, z, y: roadPtY(x, z) };   // Y пересэмплируется билинейно в каждой точке (рампа, без провала/взлёта)
    };
    const count = Math.max(2, Math.ceil(len / ROAD_SAMPLE_STEP) + 1);
    const samples = new Array(count);
    for (let i = 0; i < count; i++) samples[i] = atDist(i === count - 1 ? len : i * ROAD_SAMPLE_STEP);
    for (let i = 0; i < count; i++) {
      const a = samples[Math.max(0, i - 1)], b = samples[Math.min(count - 1, i + 1)];
      const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
      samples[i].tx = dx / l; samples[i].tz = dz / l;
      samples[i].nx = -samples[i].tz; samples[i].nz = samples[i].tx;
    }
    rd.sampleStep = ROAD_SAMPLE_STEP;
    rd.samples = samples;
  };
  const TILE_XZ_OVERLAP = 1;                // не растягиваем игровые тайлы: игра должна совпадать с редакторной геометрией
  let HEXROADS = new Map();                 // ekey "a_b" → {from, pts[gx,gz], cum, len} для путей юнитов
  let HEXSNAP = null;                        // [x][z] → центр ближайшего хекса (снап зданий городов в центр гекса)
  let GRASSREF = [];                         // [{mesh, idx, gx, gz, base, biome}] — перекраска территории при захвате
  let ROADREF = [];                          // то же для дорожных тайлов — они тоже красятся в биом владельца
  let TILEREF = [];                           // land-тайлы с переопределённой моделью: coast/slope/manual grass
  let FACBIOME = null;                       // fid → домашний биом фракции
  let FACBIOME_SIG = '';
  let HEXCOAST = [];                         // центры сухих прибрежных хексов
  let HEXROADTILES = [];                      // центры видимых road/bridge-тайлов для ворот в стенах
  let HEXTYPES = new Map();                  // "q,r" → тип исходного тайла без игровой подложки

  const dummy = new T.Object3D(), WHITE = new T.Color(0xffffff), INSTANCE_TINT = new T.Color();
  // Только тяжёлый декор дробится пространственно. Земля, дороги, реки и мосты
  // остаются крупными батчами: на обычном зуме видна почти вся Европа, поэтому
  // сотни маленьких submissions дороже, чем лишние видимые треугольники.
  const DECOR_CHUNK_SIZE = 96;
  const DECOR_CHUNK_PAD = 12;
  const chunkLists = (list, pos = (o) => o, size = DECOR_CHUNK_SIZE) => {
    const out = new Map();
    for (const item of list) {
      const p = pos(item), cx = Math.floor(p.gx / size), cz = Math.floor(p.gz / size);
      const key = cx + ',' + cz;
      let bucket = out.get(key);
      if (!bucket) { bucket = []; out.set(key, bucket); }
      bucket.push(item);
    }
    return out;
  };
  const setChunkBounds = (mesh, list, pos = (o) => o, pad = DECOR_CHUNK_PAD) => {
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const item of list) {
      const p = pos(item), x = p.gx, z = p.gz, y = Number.isFinite(p.top) ? p.top : (Number.isFinite(p.y) ? p.y : 0);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    if (!Number.isFinite(minX)) return mesh;
    const box = new T.Box3(
      new T.Vector3(minX - pad, minY - pad, minZ - pad),
      new T.Vector3(maxX + pad, maxY + pad, maxZ + pad),
    );
    const sphere = box.getBoundingSphere(new T.Sphere());
    // Legacy WebGL reads geometry bounds; current InstancedMesh reads its own.
    // Keep both paths populated because the game can switch backend at boot.
    mesh.geometry.boundingBox = box.clone();
    mesh.geometry.boundingSphere = sphere.clone();
    mesh.boundingBox = box;
    mesh.boundingSphere = sphere;
    mesh.frustumCulled = true;
    mesh.userData.mapChunk = true;
    return mesh;
  };
  const makeChunkMeshes = (list, create, pos = (o) => o, size = DECOR_CHUNK_SIZE, pad = DECOR_CHUNK_PAD) => {
    const out = [];
    for (const bucket of chunkLists(list, pos, size).values()) {
      const mesh = create(bucket);
      // create() already gives each chunk its own geometry because per-instance
      // attributes and bounds belong to that chunk. Cloning again doubled startup
      // allocations without adding isolation.
      if (mesh) out.push({ mesh: setChunkBounds(mesh, bucket, pos, pad), list: bucket });
    }
    return out;
  };
  const instanceTint = (color) => {
    INSTANCE_TINT.copy(color || WHITE);
    // Three r128 treated hexadecimal channels as raw linear instance colors.
    if (IS_WEBGPU) INSTANCE_TINT.convertLinearToSRGB();
    return INSTANCE_TINT;
  };
  const tileTranslate = new T.Matrix4(), tileProjection = new T.Matrix4(), tileRotation = new T.Matrix4();
  function writeProjectedHexMatrix(out, gx, top, gz, ry, sy) {
    // kx/kz are map projection scales. They must stay in world axes; applying them
    // as local scale after rotation changes the footprint of rotated road/river tiles.
    tileTranslate.makeTranslation(gx, top, gz);
    tileProjection.makeScale(kx * m.HEXS * TILE_XZ_OVERLAP, sy, kz * m.HEXS * TILE_XZ_OVERLAP);
    tileRotation.makeRotationY(ry || 0);
    out.multiplyMatrices(tileTranslate, tileProjection).multiply(tileRotation);
  }
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
  const TEXTURE_BIOMES = new Set(['desert', 'summer', 'winter']);
  const biomeTextureKey = (biome) => TEXTURE_BIOMES.has(biome) ? biome : 'default';
  const hasPackBiomeTexture = (biome) => TEXTURE_BIOMES.has(biome) && !!biomeGrassModel(biome)?.mat?.map;
  const packBiomeIndex = (biome) => {
    if (biome === 'desert') return 1;
    if (biome === 'summer') return 2;
    if (biome === 'winter') return 3;
    return 0;
  };
  const setPackBiomeAt = (mesh, idx, biome) => {
    const attr = mesh?.geometry?.getAttribute?.('aPackBiome');
    if (!attr) return;
    attr.setX(idx, packBiomeIndex(biome));
    attr.needsUpdate = true;
  };
  const installPackBiomeShader = (mat, baseMap = null) => {
    if (!mat || mat.userData?.packBiomeShader) return mat;
    const desertMap = biomeGrassModel('desert')?.mat?.map || null;
    const summerMap = biomeGrassModel('summer')?.mat?.map || null;
    const winterMap = biomeGrassModel('winter')?.mat?.map || null;
    if (!desertMap || !summerMap || !winterMap) return mat;
    // index 0 (родной/нетекстурный биом) ВСЕГДА сэмплит истинную базовую карту материала
    // (трава/дорога/песок), а не biome-override этого батча — иначе захваченный winter/summer/desert
    // тайл при сбросе в обычный биом сохранял бы свою снежную/пустынную текстуру.
    const idx0Map = baseMap || mat.map || null;
    if (IS_WEBGPU && idx0Map && window.createWWCWebGPUBiomeMaterial) {
      return window.createWWCWebGPUBiomeMaterial({
        sourceMaterial: mat,
        baseMap: idx0Map,
        desertMap,
        summerMap,
        winterMap,
      });
    }
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uBiomeBaseMap = { value: idx0Map };
      shader.uniforms.uBiomeDesertMap = { value: desertMap };
      shader.uniforms.uBiomeSummerMap = { value: summerMap };
      shader.uniforms.uBiomeWinterMap = { value: winterMap };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aPackBiome;\nvarying float vPackBiome;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPackBiome = aPackBiome;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uBiomeBaseMap;\nuniform sampler2D uBiomeDesertMap;\nuniform sampler2D uBiomeSummerMap;\nuniform sampler2D uBiomeWinterMap;\nvarying float vPackBiome;')
        .replace('#include <map_fragment>', `
#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D(uBiomeBaseMap, vUv);
  if (vPackBiome > 2.5) {
    sampledDiffuseColor = texture2D(uBiomeWinterMap, vUv);
  } else if (vPackBiome > 1.5) {
    sampledDiffuseColor = texture2D(uBiomeSummerMap, vUv);
  } else if (vPackBiome > 0.5) {
    sampledDiffuseColor = texture2D(uBiomeDesertMap, vUv);
  }
  sampledDiffuseColor = mapTexelToLinear(sampledDiffuseColor);
  diffuseColor *= sampledDiffuseColor;
#endif
`);
    };
    mat.customProgramCacheKey = () => 'pack-biome-texture-index-v2';
    mat.userData.packBiomeShader = true;
    mat.needsUpdate = true;
    return mat;
  };
  const cloneMapMaterial = (baseMat, textureBiome) => {
    const mat = baseMat.clone();
    const baseMap = baseMat.map || null;                         // истинная база (до biome-override) → index 0 в шейдере
    const source = textureBiome && textureBiome !== 'asset' && textureBiome !== 'default'
      ? biomeGrassModel(textureBiome)
      : null;
    if (source?.mat?.map) mat.map = source.mat.map;
    else mat.map = baseMap;
    if (mat.color) mat.color = WHITE.clone();
    mat.needsUpdate = true;
    return installPackBiomeShader(mat, baseMap);
  };
  const biomeTint = (biome) => (BIOME_TINT[biome] || BIOME_TINT.default).clone();
  const roadTint = (biome) => (BIOME_ROAD_TINT[biome] || BIOME_TINT[biome] || BIOME_TINT.default).clone();
  const landInstanceColor = (biome, colHex) => {
    if (hasPackBiomeTexture(biome)) return WHITE;
    return biome && biome !== 'default' ? biomeTint(biome) : (colHex >= 0 ? new T.Color().setHex(colHex) : biomeTint(biome));
  };
  const landBatchModel = (textureBiome) => {
    const key = '__batch_land_' + textureBiome;
    if (M.grass[key]) return M.grass[key];
    M.grass[key] = { geo: M.grass.geo, mat: cloneMapMaterial(M.grass.mat, textureBiome) };
    return M.grass[key];
  };
  const roadBatchModel = (base, textureBiome) => {
    if (!base) return base;
    const key = '__batch_road_' + textureBiome;
    if (base[key]) return base[key];
    base[key] = { geo: base.geo, mat: cloneMapMaterial(base.mat, textureBiome) };
    return base[key];
  };
  const decorTextureKey = (asset, biome) => {
    if (!isBiomeDecorAsset(asset) || !biome || biome === 'default') return 'asset';
    return biomeTextureKey(biome);
  };
  const decorInstanceColor = (asset, biome) => {
    if (!isBiomeDecorAsset(asset) || !biome || biome === 'default') return WHITE;
    if (hasPackBiomeTexture(biome)) return WHITE;
    return biome === 'darkForest' ? new T.Color(0x2f7a45) : biomeTint(biome);
  };
  const decorBatchModel = (base, textureKey) => {
    if (!base || textureKey === 'asset') return base;
    const key = '__batch_decor_' + textureKey;
    if (base[key]) return base[key];
    base[key] = { geo: base.geo, mat: cloneMapMaterial(base.mat, textureKey) };
    return base[key];
  };
  const tileInstanceColor = (biome) => hasPackBiomeTexture(biome) ? WHITE : (biome && biome !== 'default' ? biomeTint(biome) : WHITE);
  const tileBatchModel = (base, textureKey, assetKey = '') => {
    if (!base) return base;
    // coast рисуем как coast: своя атлас-текстура (песок берега), без biome-свопа карты
    // (иначе у summer/desert песок перекрашивается в траву). Совпадает с сырым рендером редактора.
    if (String(assetKey).startsWith('coast')) return base;
    const key = '__batch_tile_' + textureKey;
    if (base[key]) return base[key];
    base[key] = { geo: base.geo, mat: cloneMapMaterial(base.mat, textureKey) };
    return base[key];
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
  function isSlopedTileAsset(asset) {
    return asset === 'grassSlopeHigh' || asset === 'grassSlopeLow'
      || asset === 'roadAHigh' || asset === 'roadALow'
      || /sloped/i.test(String(asset || ''));
  }
  // строит инстансы из списка {gx,gz,top,ry,col} одной моделью
  function instMesh(model, list, perfGroup = 'hex-map', castShadow = false) {
    if (!list.length || !model) return null;
    const geo = model.geo.clone();
    const im = new T.InstancedMesh(geo, model.mat, list.length);
    im.castShadow = !!castShadow; im.receiveShadow = true;
    im.userData.perfGroup = perfGroup;
    const packBiome = new Float32Array(list.length);
    for (let i = 0; i < list.length; i++) {
      const c = list[i], sy = (c.scaleTop != null ? c.scaleTop : c.top) - FLOORg;
      writeProjectedHexMatrix(dummy.matrix, c.gx, c.top, c.gz, c.ry || 0, sy);
      im.setMatrixAt(i, dummy.matrix); im.setColorAt(i, instanceTint(c.col != null ? c.col : WHITE));
      packBiome[i] = packBiomeIndex(c.biome);
    }
    geo.setAttribute('aPackBiome', new T.InstancedBufferAttribute(packBiome, 1));
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    return im;
  }
  function instObjectMesh(model, list, perfGroup = 'hex-objects', castShadow = true) {
    if (!list.length || !model) return null;
    const im = new T.InstancedMesh(model.geo.clone(), model.mat, list.length);
    im.castShadow = !!castShadow; im.receiveShadow = true;
    im.userData.perfGroup = perfGroup;
    for (let i = 0; i < list.length; i++) {
      const c = list[i], s = c.scale || 1;
      dummy.position.set(c.gx, c.top, c.gz);
      dummy.rotation.set(0, c.ry || 0, 0);
      dummy.scale.set(kx * s, kY * s, kz * s);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
      im.setColorAt(i, WHITE);
    }
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    return im;
  }

  // ── ВОДА: шейдерная плоскость (flow-поток + береговая пена + анимация) — порт из редактора hex-europe.
  //    Заменяет инстансы хекс-тайлов воды. Маска вода/суша строится в координатах игры
  //    (инверсия gx/gz → q,r, 512²), цвет почти весь в emissive → видно при любом свете. uTime тикает loop.js.
  function buildHexWater() {
    const SEA_TOP = -0.2 * kY;
    const dudvMap = new T.TextureLoader().load('assets/water-dudv.png');
    dudvMap.wrapS = dudvMap.wrapT = T.RepeatWrapping;
    const colStep = SQ3 * Rg;
    const coastTex = (() => {                       // 1=море, 0=суша; по хексам с разрешением 512²
      const seaSet = new Set();
      const knownSet = new Set();
      for (const t of MAP.tiles) {
        const key = t[0] + ',' + t[1];
        knownSet.add(key);
        if (t[2]) seaSet.add(key);   // t[2] = water
      }
      const W = 512, H = 512, data = new Uint8Array(W * H * 4);
      for (let ty = 0; ty < H; ty++) {
        const gz = ((ty + 0.5) / H) * GRID;
        const lat = LAT1 - (gz / GRID) * (LAT1 - LAT0);
        const wz = ((m.B.maxY - lat) / m.latSpan) * m.worldH - oz;          // инверсия wzToGZ
        const r = Math.round((wz + oz) / (1.5 * Rg)), half = (r & 1) * 0.5;
        for (let tx = 0; tx < W; tx++) {
          const gx = ((tx + 0.5) / W) * GRID;
          const lng = LON0 + (gx / GRID) * (LON1 - LON0);
          const wx = ((lng - m.B.minX) / m.lngSpan) * m.worldW - ox;        // инверсия wxToGX
          const q = Math.round((wx + ox) / colStep - half);
          const key = q + ',' + r;
          const v = (!knownSet.has(key) || seaSet.has(key)) ? 255 : 0;
          const i = (tx + ty * W) * 4; data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
        }
      }
      const tex = new T.DataTexture(data, W, H, T.RGBAFormat, T.UnsignedByteType);
      tex.minFilter = tex.magFilter = T.LinearFilter; tex.wrapS = tex.wrapT = T.ClampToEdgeWrapping; tex.needsUpdate = true; return tex;
    })();
    const waterFX = {
      uTime: { value: 0 }, tDudv: { value: dudvMap },
      tCoast: { value: coastTex }, uMapMin: { value: new T.Vector2(0, 0) }, uMapSize: { value: new T.Vector2(GRID, GRID) },
      uColorDeep: { value: new T.Color(0x007052) },
      uColorShallow: { value: new T.Color(0x06535b) },
      uColorFoam: { value: new T.Color(0xe8f8ff) },
      flowSpeed: { value: 0.02 }, flowScale: { value: 0.01 }, flowStrength: { value: 0.05 },
      flowContrast: { value: 8.0 }, noiseScale: { value: 3.7 }, noiseStrength: { value: 0.5 },
      shoreFoamWidth: { value: 10.5 }, shoreFoamSharp: { value: 1.0 },
      foamScale: { value: 0.135 }, foamSpeed: { value: 0.025 },
      // ── РЕКА: flow прямо на материал речного тайла (маска по синему), течение вдоль русла (aFlowDir) ──
      rColorDeep: { value: new T.Color(0x1a6f7d) },
      rColorShallow: { value: new T.Color(0x57c2d2) },
      rFlowSpeed: { value: 0.18 }, rFlowScale: { value: 0.06 }, rFlowStrength: { value: 0.35 },
      rFlowContrast: { value: 4.0 }, rNoiseScale: { value: 7.0 }, rNoiseStrength: { value: 0.4 },
    };
    let waterMat = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.0 });
    if (IS_WEBGPU && window.createWWCWebGPUWaterMaterial) {
      const gpuWater = window.createWWCWebGPUWaterMaterial({
        dudvMap,
        coastTexture: coastTex,
        grid: GRID,
        deepColor: waterFX.uColorDeep.value,
        shallowColor: waterFX.uColorShallow.value,
        foamColor: waterFX.uColorFoam.value,
      });
      waterMat = gpuWater.material;
      waterFX.uTime = gpuWater.uTime;
    } else waterMat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, waterFX);
      sh.vertexShader = 'varying vec3 vPos; varying vec3 vWorldPos;\n' +
        sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vPos = position; vWorldPos = (modelMatrix * vec4(position,1.0)).xyz;');
      sh.fragmentShader = `
        uniform float uTime; uniform sampler2D tDudv;
        uniform vec3 uColorDeep, uColorShallow, uColorFoam;
        uniform float flowSpeed, flowScale, flowStrength, flowContrast, noiseScale, noiseStrength, shoreFoamWidth, shoreFoamSharp, foamScale, foamSpeed;
        uniform sampler2D tCoast; uniform vec2 uMapMin, uMapSize;
        varying vec3 vPos; varying vec3 vWorldPos;
        vec3 mod289v3(vec3 x){ return x - floor(x*(1.0/289.0))*289.0; }
        vec4 mod289v4(vec4 x){ return x - floor(x*(1.0/289.0))*289.0; }
        vec4 permute4(vec4 x){ return mod289v4(((x*34.0)+10.0)*x); }
        vec4 taylorInvSqrt4(vec4 r){ return 1.79284291400159 - 0.85373472095314*r; }
        vec3 fade3(vec3 t){ return t*t*t*(t*(t*6.0-15.0)+10.0); }
        float cnoise(vec3 P){
          vec3 Pi0=floor(P), Pi1=Pi0+vec3(1.0); Pi0=mod289v3(Pi0); Pi1=mod289v3(Pi1);
          vec3 Pf0=fract(P), Pf1=Pf0-vec3(1.0);
          vec4 ix=vec4(Pi0.x,Pi1.x,Pi0.x,Pi1.x), iy=vec4(Pi0.yy,Pi1.yy);
          vec4 iz0=Pi0.zzzz, iz1=Pi1.zzzz;
          vec4 ixy=permute4(permute4(ix)+iy), ixy0=permute4(ixy+iz0), ixy1=permute4(ixy+iz1);
          vec4 gx0=ixy0*(1.0/7.0), gy0=fract(floor(gx0)*(1.0/7.0))-0.5; gx0=fract(gx0);
          vec4 gz0=vec4(0.5)-abs(gx0)-abs(gy0), sz0=step(gz0,vec4(0.0));
          gx0-=sz0*(step(0.0,gx0)-0.5); gy0-=sz0*(step(0.0,gy0)-0.5);
          vec4 gx1=ixy1*(1.0/7.0), gy1=fract(floor(gx1)*(1.0/7.0))-0.5; gx1=fract(gx1);
          vec4 gz1=vec4(0.5)-abs(gx1)-abs(gy1), sz1=step(gz1,vec4(0.0));
          gx1-=sz1*(step(0.0,gx1)-0.5); gy1-=sz1*(step(0.0,gy1)-0.5);
          vec3 g000=vec3(gx0.x,gy0.x,gz0.x), g100=vec3(gx0.y,gy0.y,gz0.y),
               g010=vec3(gx0.z,gy0.z,gz0.z), g110=vec3(gx0.w,gy0.w,gz0.w),
               g001=vec3(gx1.x,gy1.x,gz1.x), g101=vec3(gx1.y,gy1.y,gz1.y),
               g011=vec3(gx1.z,gy1.z,gz1.z), g111=vec3(gx1.w,gy1.w,gz1.w);
          vec4 n0=taylorInvSqrt4(vec4(dot(g000,g000),dot(g010,g010),dot(g100,g100),dot(g110,g110)));
          g000*=n0.x; g010*=n0.y; g100*=n0.z; g110*=n0.w;
          vec4 n1=taylorInvSqrt4(vec4(dot(g001,g001),dot(g011,g011),dot(g101,g101),dot(g111,g111)));
          g001*=n1.x; g011*=n1.y; g101*=n1.z; g111*=n1.w;
          float v000=dot(g000,Pf0), v100=dot(g100,vec3(Pf1.x,Pf0.yz)),
                v010=dot(g010,vec3(Pf0.x,Pf1.y,Pf0.z)), v110=dot(g110,vec3(Pf1.xy,Pf0.z)),
                v001=dot(g001,vec3(Pf0.xy,Pf1.z)), v101=dot(g101,vec3(Pf1.x,Pf0.y,Pf1.z)),
                v011=dot(g011,vec3(Pf0.x,Pf1.yz)), v111=dot(g111,Pf1);
          vec3 fz=fade3(Pf0);
          vec4 nz=mix(vec4(v000,v100,v010,v110),vec4(v001,v101,v011,v111),fz.z);
          vec2 nyz=mix(nz.xy,nz.zw,fz.y);
          return 2.2*mix(nyz.x,nyz.y,fz.x);
        }
        float streamNoise(vec2 uv, float t){ vec2 s=vec2(uv.x*3.0, uv.y*0.6); return cnoise(vec3(s, 0.0))*0.5+0.5; }
      ` + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec2 baseUv = vWorldPos.xz * flowScale;
          vec2 flowDir = texture2D(tDudv, baseUv * 0.25).rg * 2.0 - 1.0;
          flowDir = mix(vec2(0.0, 1.0), flowDir, flowStrength);
          vec2 fuv = baseUv - flowDir * (uTime * flowSpeed);
          float streaks = pow(clamp(streamNoise(fuv * noiseScale, uTime), 0.0, 1.0), flowContrast);
          float broad = smoothstep(0.3, 0.7, cnoise(vec3(fuv * noiseScale * 0.4, 0.0)) * 0.5 + 0.5);
          float surfaceMask = clamp(broad * noiseStrength + streaks * (1.0 - noiseStrength), 0.0, 1.0);
          vec3 water = mix(uColorDeep, uColorShallow, surfaceMask);
          vec2 cuv = (vWorldPos.xz - uMapMin) / uMapSize;
          vec2 cdisp = texture2D(tDudv, vWorldPos.xz * foamScale - uTime * foamSpeed).rg * 2.0 - 1.0;
          vec2 shoreUv = cuv + cdisp * 0.003;
          float shoreInside = step(0.0, shoreUv.x) * step(shoreUv.x, 1.0) * step(0.0, shoreUv.y) * step(shoreUv.y, 1.0);
          float wmask = mix(1.0, texture2D(tCoast, shoreUv).r, shoreInside);
          float w = clamp(shoreFoamWidth * 0.04, 0.02, 0.6);
          float landBias = mix(0.5, 0.42, shoreFoamSharp);
          float shoreFoam = smoothstep(0.5 + w, landBias, wmask);
          vec3 fc = mix(water, uColorFoam, shoreFoam);
          float ripple = streamNoise(fuv * noiseScale * 1.5, uTime) - 0.5;
          float caps = 0.0;
          fc *= (1.0 + ripple * 0.45 * (1.0 - shoreFoam));
          fc = mix(fc, uColorFoam, caps * 0.30 * (1.0 - shoreFoam));
          diffuseColor.rgb = fc * 0.5;
          totalEmissiveRadiance = fc * 0.45 + uColorFoam * shoreFoam * 0.5 + uColorFoam * caps * 0.25 * (1.0 - shoreFoam);
        }`);
    };
    const geo = new T.PlaneGeometry(GRID * 8, GRID * 8);   // большой запас за карту → океан уходит за горизонт, внешняя зона = открытое море
    geo.rotateX(-Math.PI / 2);
    const qualityWaterMat=waterMat;
    const simpleWaterMat=new T.MeshBasicMaterial({color:0x126b74,depthTest:true,depthWrite:true});
    const seaMesh = new T.Mesh(geo, window.WWC_GRAPHICS?.water==='low'?simpleWaterMat:qualityWaterMat);
    seaMesh.position.set(GRID / 2, SEA_TOP, GRID / 2);
    seaMesh.renderOrder = -1; seaMesh.frustumCulled = false;
    seaMesh.userData.perfGroup = 'map-water';
    scene.add(seaMesh);
    waterFX.mesh=seaMesh;waterFX.qualityMaterial=qualityWaterMat;waterFX.simpleMaterial=simpleWaterMat;
    window.HEXWATER = waterFX;                       // loop.js двигает uTime каждый кадр
  }

  // ── flow-шейдер ПРЯМО на материал речного тайла, маска по синим (водяным) пикселям атласа ──
  //    Течёт только русло (по реальной геометрии канала), направление — per-instance aFlowDir. Униформы из window.HEXWATER.
  const _riverNoiseGLSL = `
    vec3 mod289v3(vec3 x){ return x - floor(x*(1.0/289.0))*289.0; }
    vec4 mod289v4(vec4 x){ return x - floor(x*(1.0/289.0))*289.0; }
    vec4 permute4(vec4 x){ return mod289v4(((x*34.0)+10.0)*x); }
    vec4 taylorInvSqrt4(vec4 r){ return 1.79284291400159 - 0.85373472095314*r; }
    vec3 fade3(vec3 t){ return t*t*t*(t*(t*6.0-15.0)+10.0); }
    float cnoise(vec3 P){
      vec3 Pi0=floor(P), Pi1=Pi0+vec3(1.0); Pi0=mod289v3(Pi0); Pi1=mod289v3(Pi1);
      vec3 Pf0=fract(P), Pf1=Pf0-vec3(1.0);
      vec4 ix=vec4(Pi0.x,Pi1.x,Pi0.x,Pi1.x), iy=vec4(Pi0.yy,Pi1.yy);
      vec4 iz0=Pi0.zzzz, iz1=Pi1.zzzz;
      vec4 ixy=permute4(permute4(ix)+iy), ixy0=permute4(ixy+iz0), ixy1=permute4(ixy+iz1);
      vec4 gx0=ixy0*(1.0/7.0), gy0=fract(floor(gx0)*(1.0/7.0))-0.5; gx0=fract(gx0);
      vec4 gz0=vec4(0.5)-abs(gx0)-abs(gy0), sz0=step(gz0,vec4(0.0));
      gx0-=sz0*(step(0.0,gx0)-0.5); gy0-=sz0*(step(0.0,gy0)-0.5);
      vec4 gx1=ixy1*(1.0/7.0), gy1=fract(floor(gx1)*(1.0/7.0))-0.5; gx1=fract(gx1);
      vec4 gz1=vec4(0.5)-abs(gx1)-abs(gy1), sz1=step(gz1,vec4(0.0));
      gx1-=sz1*(step(0.0,gx1)-0.5); gy1-=sz1*(step(0.0,gy1)-0.5);
      vec3 g000=vec3(gx0.x,gy0.x,gz0.x), g100=vec3(gx0.y,gy0.y,gz0.y), g010=vec3(gx0.z,gy0.z,gz0.z), g110=vec3(gx0.w,gy0.w,gz0.w),
           g001=vec3(gx1.x,gy1.x,gz1.x), g101=vec3(gx1.y,gy1.y,gz1.y), g011=vec3(gx1.z,gy1.z,gz1.z), g111=vec3(gx1.w,gy1.w,gz1.w);
      vec4 n0=taylorInvSqrt4(vec4(dot(g000,g000),dot(g010,g010),dot(g100,g100),dot(g110,g110)));
      g000*=n0.x; g010*=n0.y; g100*=n0.z; g110*=n0.w;
      vec4 n1=taylorInvSqrt4(vec4(dot(g001,g001),dot(g011,g011),dot(g101,g101),dot(g111,g111)));
      g001*=n1.x; g011*=n1.y; g101*=n1.z; g111*=n1.w;
      float v000=dot(g000,Pf0), v100=dot(g100,vec3(Pf1.x,Pf0.yz)), v010=dot(g010,vec3(Pf0.x,Pf1.y,Pf0.z)), v110=dot(g110,vec3(Pf1.xy,Pf0.z)),
            v001=dot(g001,vec3(Pf0.xy,Pf1.z)), v101=dot(g101,vec3(Pf1.x,Pf0.y,Pf1.z)), v011=dot(g011,vec3(Pf0.x,Pf1.yz)), v111=dot(g111,Pf1);
      vec3 fz=fade3(Pf0);
      vec4 nz=mix(vec4(v000,v100,v010,v110),vec4(v001,v101,v011,v111),fz.z);
      vec2 nyz=mix(nz.xy,nz.zw,fz.y);
      return 2.2*mix(nyz.x,nyz.y,fz.x);
    }
    float streamNoise(vec2 uv, float t){ vec2 s=vec2(uv.x*3.0, uv.y*0.6); return cnoise(vec3(s,0.0))*0.5+0.5; }`;
  function applyRiverFlow(mat) {
    if (!mat) return mat;
    if (IS_WEBGPU && window.createWWCWebGPURiverMaterial && window.HEXWATER) {
      if (mat.userData.__riverFlowMaterial) return mat.userData.__riverFlowMaterial;
      const riverMat = window.createWWCWebGPURiverMaterial({
        sourceMaterial: mat,
        dudvMap: window.HEXWATER.tDudv.value,
        timeNode: window.HEXWATER.uTime,
        deepColor: window.HEXWATER.rColorDeep.value,
        shallowColor: window.HEXWATER.rColorShallow.value,
      });
      mat.userData.__riverFlowMaterial = riverMat;
      return riverMat;
    }
    if (mat.userData.__riverFlow) return mat;
    mat.userData.__riverFlow = true;
    mat.onBeforeCompile = (sh) => {
      if (window.HEXWATER) Object.assign(sh.uniforms, window.HEXWATER);
      sh.vertexShader = 'attribute vec2 aFlowDir;\nvarying vec3 vWorldPosR;\nvarying vec2 vFlowDir;\n' + sh.vertexShader.replace('#include <begin_vertex>',
        `#include <begin_vertex>
        vFlowDir = aFlowDir;
        #ifdef USE_INSTANCING
          vWorldPosR = (modelMatrix * instanceMatrix * vec4(position,1.0)).xyz;
        #else
          vWorldPosR = (modelMatrix * vec4(position,1.0)).xyz;
        #endif`);
      sh.fragmentShader = `
        uniform float uTime; uniform sampler2D tDudv;
        uniform vec3 rColorDeep, rColorShallow;
        uniform float rFlowSpeed, rFlowScale, rFlowStrength, rFlowContrast, rNoiseScale, rNoiseStrength;
        varying vec3 vWorldPosR; varying vec2 vFlowDir;
        ${_riverNoiseGLSL}
      ` + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        {
          float blueness = diffuseColor.b - max(diffuseColor.r, diffuseColor.g);
          float waterMask = smoothstep(0.05, 0.2, blueness);              // синие пиксели атласа = вода
          if (waterMask > 0.001) {
            vec2 dir = length(vFlowDir) > 0.01 ? normalize(vFlowDir) : vec2(0.0, 1.0);
            vec2 perp = vec2(-dir.y, dir.x);
            vec2 baseUv = vWorldPosR.xz * rFlowScale;
            vec2 jit = texture2D(tDudv, baseUv * 0.25).rg * 2.0 - 1.0;
            vec2 flowVec = mix(dir, jit, rFlowStrength);
            vec2 fuv = baseUv - flowVec * (uTime * rFlowSpeed);
            vec2 auv = vec2(dot(fuv, perp), dot(fuv, dir));
            float streaks = pow(clamp(streamNoise(auv * rNoiseScale, uTime), 0.0, 1.0), rFlowContrast);
            float broad = smoothstep(0.3, 0.7, cnoise(vec3(auv * rNoiseScale * 0.4, 0.0)) * 0.5 + 0.5);
            float sm = clamp(broad * rNoiseStrength + streaks * (1.0 - rNoiseStrength), 0.0, 1.0);
            vec3 flowCol = mix(rColorDeep, rColorShallow, sm);
            diffuseColor.rgb = mix(diffuseColor.rgb, flowCol, waterMask);
          }
        }`);
    };
    mat.needsUpdate = true;
    return mat;
  }

  function hexBuildWorld() {
    const grass = [], water = [], rivByKey = {}, roadByKey = {};
    HEXTYPES = new Map();
    HEXROADTILES = [];
    for (const t of MAP.tiles) HEXTYPES.set(t[0] + ',' + t[1], { water: !!t[2], river: !!t[5] });
    const neighborQR = (q, r) => (r & 1)
      ? [[q+1,r],[q-1,r],[q+1,r-1],[q,r-1],[q+1,r+1],[q,r+1]]
      : [[q+1,r],[q-1,r],[q,r-1],[q-1,r-1],[q,r+1],[q-1,r+1]];
    const OCEAN_KEYS = (() => {
      let minQ = Infinity, maxQ = -Infinity, minR = Infinity, maxR = -Infinity;
      for (const key of HEXTYPES.keys()) {
        const [q, r] = key.split(',').map(Number);
        minQ = Math.min(minQ, q); maxQ = Math.max(maxQ, q); minR = Math.min(minR, r); maxR = Math.max(maxR, r);
      }
      const ocean = new Set(), queue = [];
      for (const [key, ht] of HEXTYPES) {
        if (!ht.water || ht.river) continue;
        const [q, r] = key.split(',').map(Number);
        if (q === minQ || q === maxQ || r === minR || r === maxR) { ocean.add(key); queue.push([q, r]); }
      }
      for (let i = 0; i < queue.length; i++) {
        const [q, r] = queue[i];
        for (const [nq, nr] of neighborQR(q, r)) {
          const nk = nq + ',' + nr, ht = HEXTYPES.get(nk);
          if (!ht || !ht.water || ht.river || ocean.has(nk)) continue;
          ocean.add(nk); queue.push([nq, nr]);
        }
      }
      return ocean;
    })();
    const isOpenOceanKey = (key) => {
      if (!OCEAN_KEYS.has(key)) return false;
      const [q, r] = key.split(',').map(Number);
      let n = 0;
      for (const [nq, nr] of neighborQR(q, r)) if (OCEAN_KEYS.has(nq + ',' + nr)) n++;
      // Узкие реки/каналы могут быть связаны с морем flood-fill'ом, но у них обычно 1-2 водных соседа.
      // Для верфи нужен настоящий берег открытой воды, а не речной тайл.
      return n >= 3;
    };
    HEXCOAST = [];
    // tiles: [q, r, water, elev, colHex, rivKey, rivRy, roadKey, roadRy, tileKey?, tileRy?]
    const tileByKey = {};                          // ручные тайл-переопределения (coast*/grassSlope*)
    const visualTopByCell = (_visualTopByCell = new Map());             // gx,z -> реальный верх override/sloped-модели (алиас модульного для roadPtY)
    _roadTopByCell = new Map();                                          // клетка → верх поднятого road-тайла (насыпь/рампа), заполняется блоком 3×3 как tiles[][]
    for (const t of MAP.tiles) {
      const q = t[0], r = t[1], isW = t[2], elev = t[3], colHex = t[4], rk = t[5], rry = t[6], dk = t[7], dry = t[8], tk = t[9], try_ = t[10], biome = t[11] || 'default', yOffset = Number(t[12]) || 0;
      const gx = wxToGX(qrToWX(q, r)), gz = wzToGZ(qrToWZ(q, r));
      const waterNeighbors = neighborQR(q, r).filter(([nq, nr]) => HEXTYPES.get(nq + ',' + nr)?.water);
      if (!isW && !rk && waterNeighbors.length) {
        let sx = 0, sz = 0;
        for (const [nq, nr] of waterNeighbors) { sx += wxToGX(qrToWX(nq, nr)); sz += wzToGZ(qrToWZ(nq, nr)); }
        HEXCOAST.push({ gx, gz, seaAngle: Math.atan2(sz / waterNeighbors.length - gz, sx / waterNeighbors.length - gx) });
      }
      if (tk) {                                   // переопределённая модель тайла (берег/склон/ручной тайл)
        const textureKey = biomeTextureKey(biome), tileBucket = tk + ':' + textureKey;
        const isSloped = isSlopedTileAsset(tk);
        const visualTop = (elev + (isSloped ? yOffset : 0)) * kY;
        visualTopByCell.set(_cellKey(Math.round(gx), Math.round(gz)), visualTop);
        (tileByKey[tileBucket] || (tileByKey[tileBucket] = { modelKey: tk, textureKey, list: [] })).list.push({ gx, gz, top: visualTop, scaleTop: elev * kY, ry: try_, biome, col: String(tk).startsWith('coast') ? WHITE : tileInstanceColor(biome) });
      } else if (rk) {                            // речной тайл — только модель реки
        (rivByKey[rk] || (rivByKey[rk] = [])).push({ gx, gz, top: elev * kY, ry: rry, q, r });
      } else if (isW) {                           // море
        water.push({ gx, gz, top: (elev - 0.2) * kY });
      } else if (dk) {                            // дорожный тайл — полноценная замена grass-хекса
        HEXROADTILES.push({ gx, gz });
        const textureKey = biomeTextureKey(biome);
        const roadBucket = dk + ':' + textureKey;
        const isSloped = isSlopedTileAsset(dk);
        const roadTop = (elev + (isSloped ? yOffset : 0)) * kY;
        // ФИКС: верх ПОДНЯТОГО road-тайла в блок 3×3 (шаг хексов 1.63 → между центрами есть целые клетки).
        //   Иначе roadPtY брал рельеф и юнит проваливался под насыпь/рампу. Заполняем МАКСИМУМОМ (только вверх).
        const rxi = Math.round(gx), rzi = Math.round(gz);
        for (let aa = -1; aa <= 1; aa++) for (let bb = -1; bb <= 1; bb++) {
          const rk2 = _cellKey(rxi + aa, rzi + bb), cur = _roadTopByCell.get(rk2);
          if (cur == null || roadTop > cur) _roadTopByCell.set(rk2, roadTop);
        }
        (roadByKey[roadBucket] || (roadByKey[roadBucket] = { modelKey: dk, textureKey, list: [] })).list.push({ gx, gz, top: roadTop, scaleTop: elev * kY, ry: dry, q, r, biome, col: landInstanceColor(biome, colHex) });
      } else {                                    // обычная суша
        grass.push({ gx, gz, top: elev * kY, q, r, biome, textureKey: biomeTextureKey(biome), col: landInstanceColor(biome, colHex) });
      }
    }
    const _add = (mm) => { if (mm) scene.add(mm); };
    buildHexWater();                                 // шейдерная вода-плоскость вместо инстансов хекс-тайлов воды
    const grassByTexture = {};
    for (const c of grass) (grassByTexture[c.textureKey || 'default'] || (grassByTexture[c.textureKey || 'default'] = [])).push(c);
    GRASSREF = [];                                   // индекс инстансов травы → перекраска территории при захвате
    for (const textureKey in grassByTexture) {
      const list = grassByTexture[textureKey], model = landBatchModel(textureKey);
      const mm = instMesh(model, list, 'map-land', false);
      if (mm) { mm.frustumCulled = false; _add(mm); for (let i = 0; i < list.length; i++) {
        const c = list[i]; GRASSREF.push({ mesh: mm, idx: i, gx: c.gx, gz: c.gz, base: c.col, biome: c.biome || 'default' });
      } }
    }
    // течение по руслу: BFS от моря через речные хексы → per-instance aFlowDir (координаты игры)
    const rivDir = (() => {
      const seaSet = new Set(), rivSet = new Set();
      for (const [key, t] of HEXTYPES) { if (t.water) seaSet.add(key); if (t.river) rivSet.add(key); }
      const gpos = (q, r) => [wxToGX(qrToWX(q, r)), wzToGZ(qrToWZ(q, r))];
      const dist = new Map(), queue = [];
      for (const key of rivSet) { const p = key.split(',').map(Number); for (const [nq, nr] of neighborQR(p[0], p[1])) if (seaSet.has(nq + ',' + nr)) { dist.set(key, 1); queue.push(key); break; } }
      for (let h = 0; h < queue.length; h++) { const key = queue[h], p = key.split(',').map(Number), d = dist.get(key); for (const [nq, nr] of neighborQR(p[0], p[1])) { const nk = nq + ',' + nr; if (rivSet.has(nk) && !dist.has(nk)) { dist.set(nk, d + 1); queue.push(nk); } } }
      const dir = new Map();
      for (const key of rivSet) { const p = key.split(',').map(Number), g = gpos(p[0], p[1]); const d = dist.has(key) ? dist.get(key) : 1e9; let dx = 0, dz = 0;
        for (const [nq, nr] of neighborQR(p[0], p[1])) { const nk = nq + ',' + nr, isSea = seaSet.has(nk), isRiv = rivSet.has(nk); if (!isSea && !isRiv) continue; const nd = isSea ? 0 : (dist.has(nk) ? dist.get(nk) : 1e9); if (nd < d) { const ng = gpos(nq, nr); dx += ng[0] - g[0]; dz += ng[1] - g[1]; } }
        if (dx === 0 && dz === 0) for (const [nq, nr] of neighborQR(p[0], p[1])) if (rivSet.has(nq + ',' + nr)) { const ng = gpos(nq, nr); dx = ng[0] - g[0]; dz = ng[1] - g[1]; break; }
        const len = Math.hypot(dx, dz); dir.set(key, len > 1e-4 ? [dx / len, dz / len] : [0, 1]); }
      for (let pass = 0; pass < 3; pass++) { const nx = new Map(); for (const [key, dd] of dir) { const p = key.split(',').map(Number); let sx = dd[0], sz = dd[1]; for (const [nq, nr] of neighborQR(p[0], p[1])) { const nd = dir.get(nq + ',' + nr); if (nd) { sx += nd[0]; sz += nd[1]; } } const l = Math.hypot(sx, sz); nx.set(key, l > 1e-4 ? [sx / l, sz / l] : dd); } for (const [key, dd] of nx) dir.set(key, dd); }
      return dir;
    })();
    for (const k in rivByKey) {
      const list = rivByKey[k], model = M[k]; if (!model || !list.length) continue;
      const geo = model.geo.clone(), im = new T.InstancedMesh(geo, applyRiverFlow(model.mat), list.length);
      im.castShadow = false; im.receiveShadow = true; im.frustumCulled = false; im.userData.perfGroup = 'map-rivers';
      const fa = new Float32Array(list.length * 2);
      for (let i = 0; i < list.length; i++) {
        const c = list[i], sy = c.top - FLOORg;
        writeProjectedHexMatrix(dummy.matrix, c.gx, c.top, c.gz, c.ry || 0, sy);
        im.setMatrixAt(i, dummy.matrix); im.setColorAt(i, WHITE);
        const d = rivDir.get(c.q + ',' + c.r) || [0, 1]; fa[i * 2] = d[0]; fa[i * 2 + 1] = d[1];
      }
      geo.setAttribute('aFlowDir', new T.InstancedBufferAttribute(fa, 2));
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
      scene.add(im);
    }
    ROADREF = [];                                    // индекс инстансов дорог → перекраска при захвате (как трава)
    for (const k in roadByKey) {
      const bucket = roadByKey[k], list = bucket.list, model = roadBatchModel(M[bucket.modelKey], bucket.textureKey);
      const mm = instMesh(model, list, 'map-roads', true);
      if (mm) { mm.frustumCulled = false; scene.add(mm); for (let i = 0; i < list.length; i++) {
        const c = list[i]; ROADREF.push({ mesh: mm, idx: i, gx: c.gx, gz: c.gz, base: c.col, biome: c.biome || 'default' });
      } }
    }
    TILEREF = [];
    for (const k in tileByKey) {
      const bucket = tileByKey[k], model = tileBatchModel(M[bucket.modelKey], bucket.textureKey, bucket.modelKey);
      const mm = instMesh(model, bucket.list, 'map-overrides', true);
      if (mm) { mm.frustumCulled = false; scene.add(mm); for (let i = 0; i < bucket.list.length; i++) {
        const c = bucket.list[i]; TILEREF.push({ mesh: mm, idx: i, gx: c.gx, gz: c.gz, base: c.col, biome: c.biome || 'default' });
      } }
    }

    // мосты: [wx, wz, bridgeKey, bridgeRy, bankY]
    const brByKey = {};
    const bridgeCenters = [];
    for (const b of MAP.bridges) {
      const gx = wxToGX(b[0]), gz = wzToGZ(b[1]);
      HEXROADTILES.push({ gx, gz });
      bridgeCenters.push({ gx, gz });
      (brByKey[b[2]] || (brByKey[b[2]] = [])).push({
        gx,
        gz,
        top: ((b[4] || 0) + BRIDGE_VISUAL_LIFT) * kY,
        ry: b[3],
        scale: b[5] != null ? Number(b[5]) || BRIDGE_DEFAULT_SCALE : BRIDGE_DEFAULT_SCALE,
      });
    }
    window.HEXBRIDGES = bridgeCenters;                       // центры мостов → рой сужается в колонну на мосту
    for (const k in brByKey) { const mm = instObjectMesh(M[k], brByKey[k], 'map-bridges', true); if (mm) { mm.frustumCulled = false; scene.add(mm); } }

    // декор: [asset, wx, wz, y, yaw, scale, biome] — модель с равномерным масштабом
    const decByKey = {};
    for (const d of MAP.decor) {
      const biome = d[6] || 'default', textureKey = decorTextureKey(d[0], biome), bucket = d[0] + ':' + textureKey;
      (decByKey[bucket] || (decByKey[bucket] = { asset: d[0], textureKey, list: [] })).list.push({ d, gx: wxToGX(d[1]), gz: wzToGZ(d[2]), top: (d[3] || 0) * kY, col: decorInstanceColor(d[0], biome) });
    }
    const decorGroup = new T.Group();
    decorGroup.userData.perfGroup = 'map-decor';
    for (const k in decByKey) {
      const bucket = decByKey[k], list = bucket.list, model = decorBatchModel(M[bucket.asset], bucket.textureKey); if (!model) continue;
      for (const chunk of makeChunkMeshes(list, part => {
        const im = new T.InstancedMesh(model.geo.clone(), model.mat, part.length);
        im.castShadow = true; im.receiveShadow = true; im.userData.perfGroup = 'map-decor';
        im.userData.graphicsFullCount=part.length;
        const packBiome = model.mat?.userData?.packBiomeShader ? new Float32Array(part.length) : null;
        for (let i = 0; i < part.length; i++) {
          const item = part[i], d = item.d, s = (d[5] || 1) * kY;
          dummy.position.set(item.gx, item.top, item.gz); dummy.rotation.set(0, d[4] || 0, 0); dummy.scale.set(s, s, s); dummy.updateMatrix();
          im.setMatrixAt(i, dummy.matrix); im.setColorAt(i, instanceTint(item.col || WHITE));
          if (packBiome) packBiome[i] = packBiomeIndex(d[6] || 'default');
        }
        if (packBiome) im.geometry.setAttribute('aPackBiome', new T.InstancedBufferAttribute(packBiome, 1));
        im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
        return im;
      })) decorGroup.add(chunk.mesh);
    }
    window.HEX_DECOR_GROUP=decorGroup;
    scene.add(decorGroup);
    if(typeof applyGraphicsPreset==='function')applyGraphicsPreset(window.WWC_GRAPHICS?.id||'balanced',false);

    // ── хексы под застройку: суша без декора/дорог/реки, не вплотную к городу (там стены) ──
    {
      const _qrFromW = (wx, wz) => { const rr = Math.round((wz + oz) / (1.5 * Rg)); const qq = Math.round((wx + ox) / (SQ3 * Rg) - (rr & 1) * 0.5); return qq + ',' + rr; };
      const _gxToWX = (gx) => { const lng = LON0 + (gx / GRID) * (LON1 - LON0); return ((lng - m.B.minX) / m.lngSpan) * m.worldW - ox; };
      const _gzToWZ = (gz) => { const lat = LAT1 - (gz / GRID) * (LAT1 - LAT0); return ((m.B.maxY - lat) / m.latSpan) * m.worldH - oz; };
      const decorKeys = new Set();
      for (const d of MAP.decor) decorKeys.add(_qrFromW(d[1], d[2]));            // хекс с любым декором — занят
      const grassByKey = new Map();
      for (const c of grass) grassByKey.set(c.q + ',' + c.r, c);
      const cityNeighbors = [];
      const cityKeys = new Set();
      if (typeof CITY_DATA !== 'undefined') for (let ci = 0; ci < CITY_DATA.length; ci++) {
        const d = CITY_DATA[ci];
        const ck = _qrFromW(_gxToWX(d[0]), _gzToWZ(d[1])); cityKeys.add(ck);     // сам город + кольцо соседей (стены)
        const p = ck.split(',').map(Number);
        for (const [nq, nr] of neighborQR(p[0], p[1])) {
          const nk = nq + ',' + nr;
          cityKeys.add(nk);
          const c = grassByKey.get(nk);
          if (c && !decorKeys.has(nk)) {
            const seaNeighbors = neighborQR(nq, nr).filter(([sq, sr]) => isOpenOceanKey(sq + ',' + sr));
            let seaDir = null;
            if (seaNeighbors.length) {
              const outX = c.gx - d[0], outZ = c.gz - d[1];
              let bestDir = null, bestDot = -Infinity;
              for (const [sq, sr] of seaNeighbors) {
                const dx = wxToGX(qrToWX(sq, sr)) - c.gx, dz = wzToGZ(qrToWZ(sq, sr)) - c.gz;
                const mag = Math.hypot(dx, dz) || 1, ux = dx / mag, uz = dz / mag;
                const dot = ux * outX + uz * outZ;
                if (dot > bestDot) { bestDot = dot; bestDir = [ux, uz]; }
              }
              seaDir = bestDir;
            }
            cityNeighbors.push({ gx: c.gx, gz: c.gz, top: c.top, key: 'city:' + ci + ':' + nk, parentIdx: ci, q: nq, r: nr, seaDir });
          }
        }
      }
      const buildHexes = [];
      for (const c of grass) { const k = c.q + ',' + c.r; if (decorKeys.has(k) || cityKeys.has(k)) continue; buildHexes.push({ gx: c.gx, gz: c.gz, top: c.top, key: k }); }
      window.HEXBUILD = { hexes: buildHexes, cityNeighbors, occupied: new Set(), scale: kx * m.HEXS, kY };
    }

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
        else if (cur.isWater) {
          cur.topY = (rk ? elev : elev - 0.2) * kY;
          if (rk) cur.terrain = 'river';
        }
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
    // мосты в игровых координатах с высотой полотна — дорога через реку идёт ПО мосту, не по дну
    const brTops = (_brTops = (MAP.bridges || []).map((b) => ({ gx: wxToGX(b[0]), gz: wzToGZ(b[1]), top: ((b[4] || 0) + BRIDGE_VISUAL_LIFT) * kY })));   // алиас модульного для roadPtY
    // roadPtY — в области модуля (нужен и ensureHexRoadSamplesForMap до buildWorld)
    // сглаживание пути ПОД НАРИСОВАННУЮ дорогу: тайлы дорог входят/выходят через СЕРЕДИНЫ РЁБЕР хекса,
    // на поворотных тайлах рисуют дугу мимо центра. Путь по центрам клеток (сырая полилиния) на поворотах
    // резал хорду → юниты сходили с ленты. Заменяем каждый узел квадратичной Безье: середина-ребра →
    // (контроль = центр клетки) → середина-ребра. Прямые тайлы вырождаются в прямую, повороты — в ту же дугу.
    const smoothRoad = (raw) => {
      if (raw.length < 3) return raw.slice();
      // КАЖДЫЙ внутренний узел (центр клетки) → квадратичная Безье: середина-ребра-входа → КОНТРОЛЬ=ЦЕНТР клетки → середина-ребра-выхода.
      // Дорожный тайл входит/выходит через середины рёбер, а на поворотном/развилочном тайле дуга идёт ЧЕРЕЗ центр клетки.
      // Прямой тайл: mIn, центр, mOut коллинеарны → прямая. Поворот/развилка: дуга через центр = ровно как нарисовано (не срезаем хорду).
      const SEG = 8;
      const out = [raw[0].slice()];
      for (let i = 1; i < raw.length - 1; i++) {
        const mInx = (raw[i - 1][0] + raw[i][0]) / 2, mInz = (raw[i - 1][1] + raw[i][1]) / 2;
        const mOutx = (raw[i][0] + raw[i + 1][0]) / 2, mOutz = (raw[i][1] + raw[i + 1][1]) / 2;
        const cx = raw[i][0], cz = raw[i][1];
        for (let k = 0; k <= SEG; k++) {
          const t = k / SEG, u = 1 - t, uu = u * u, ut2 = 2 * u * t, tt = t * t;
          out.push([uu * mInx + ut2 * cx + tt * mOutx, uu * mInz + ut2 * cz + tt * mOutz]);
        }
      }
      out.push(raw[raw.length - 1].slice());
      const ded = [out[0]];
      for (const q of out) { const l = ded[ded.length - 1]; if (Math.hypot(q[0] - l[0], q[1] - l[1]) > 1e-4) ded.push(q); }
      straightenEnds(ded, 0.9);   // 🎯 выпрямить подход к городам-концам (убрать «крючок» → юниты выходят/проходят прямо, без арки)
      return ded;
    };
    // Концы дороги forced в ЦЕНТР города, а последняя дорожная клетка смещена → сглаженная полилиния «дёргается»
    // (доворот ~30° в последние 0.15) и юниты у города делают странную дугу. Репроецируем последние R ед. каждого
    // конца на ПРЯМУЮ хорду (конец→якорь на арк-дистанции R) — подход становится прямым (сим не трогаем: это только рендер).
    const straightenEnds = (pts, R) => {
      if (pts.length < 4) return pts;
      const oneEnd = (endIdx, dir) => {
        const ep = pts[endIdx];
        let acc = 0, ai = endIdx, prev = endIdx;                       // якорь на арк-дистанции R от конца
        for (let s = 0; s < pts.length - 2; s++) { const cur = prev + dir; if (cur < 0 || cur >= pts.length) { ai = prev; break; } acc += Math.hypot(pts[cur][0] - pts[prev][0], pts[cur][1] - pts[prev][1]); ai = cur; prev = cur; if (acc >= R) break; }
        const anchor = pts[ai];
        const idx = []; for (let i = endIdx; i !== ai + dir; i += dir) idx.push(i);   // конец..якорь
        let c = 0; const cums = [0]; for (let k = 1; k < idx.length; k++) { c += Math.hypot(pts[idx[k]][0] - pts[idx[k - 1]][0], pts[idx[k]][1] - pts[idx[k - 1]][1]); cums.push(c); }
        const tot = c || 1;
        for (let k = 1; k < idx.length - 1; k++) { const t = cums[k] / tot; pts[idx[k]] = [ep[0] + (anchor[0] - ep[0]) * t, ep[1] + (anchor[1] - ep[1]) * t]; }   // на прямую хорду
      };
      oneEnd(0, 1); oneEnd(pts.length - 1, -1);
      return pts;
    };
    // ROAD_SAMPLE_STEP / buildRoadSamples / roadPtY — в области модуля (см. верх файла)
    for (const rd of (MAP.roads || [])) {
      let a = rd[0], b = rd[1];
      const raw = rd[2];
      const pts = smoothRoad(raw.map((p) => [wxToGX(p[0]), wzToGZ(p[1])]));
      if (a == null || b == null || a === b || pts.length < 2) continue;
      const cum = [0]; for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const hts = pts.map((p) => roadPtY(p[0], p[1]));                 // профиль высот вдоль дороги (склоны — рампой, мосты — по полотну)
      const edge = { a, b, from: a, pts, cum, hts, len: cum[cum.length - 1] };
      buildRoadSamples(edge);
      HEXROADS.set(Math.min(a, b) + '_' + Math.max(a, b), edge);
    }

    if (typeof buildGraph === 'function') buildGraph();   // дорожный граф (пути юнитов)
    addHexRoadGraphEdges();                               // ручные дороги редактора тоже должны быть путями
    console.log('[hex] карта из hex-map.json: tiles=' + MAP.tiles.length + ' bridges=' + MAP.bridges.length + ' decor=' + MAP.decor.length + ' roads=' + HEXROADS.size);
    if (typeof markShadowsDirty === 'function') markShadowsDirty();   // вся статичная геометрия карты в сцене → перепечь тени один раз
    if (typeof installDynShadowOnWorld === 'function') installDynShadowOnWorld();   // 🌗 земля/дороги/мосты принимают тени городов/построек из динамической карты
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
  // Dev-only уточнение пути РЕЙКАСТОМ по отрендеренной геометрии.
  // Gameplay-рендер НЕ вызывает это в runtime: юниты используют precomputed rd.samples.
  // 1) высоты: склоновые тайлы — рампы, сетка tiles topY — ступени → юниты парили/тонули на подъёмах;
  // 2) 🎯 ЛАТЕРАЛЬНЫЙ СНАП: клетки сырого пути местами расходятся с НАРИСОВАННОЙ лентой (развилки у мостов,
  //    острые поворотные тайлы — лента дугой/нырком, путь хордой по траве). Точку вне полотна сдвигаем
  //    перпендикулярно к ближайшей точке ленты, предпочитая НЕПРЕРЫВНОСТЬ (кандидат ближе к предыдущей
  //    точке) — у V-развилки путь трассирует рукава, а не прыгает между ними. Концы у городов не трогаем
  //    (там площадь города, ленты нет — снап утащил бы путь вбок). Клиент-only: длины пересчитываем,
  //    сим движется по своему edge.len — рассинхрона нет.
  let _rcMaps = null;
  const _rc = new T.Raycaster(), _rcO = new T.Vector3(), _rcD = new T.Vector3(0, -1, 0);
  window.hexRoadRefineHts = function hexRoadRefineHts(a, b) {
    const rd = HEXROADS.get(Math.min(a, b) + '_' + Math.max(a, b));
    if (!rd || rd._refined || !rd.hts) return;
    if (!_rcMaps) { _rcMaps = []; scene.traverse((o) => { const t = o.name || o.userData.perfGroup || ''; if (o.isInstancedMesh && /map-(roads|bridges)/.test(t)) _rcMaps.push(o); }); }
    const hit = (x, z) => { _rcO.set(x, 8, z); _rc.set(_rcO, _rcD); const h = _rc.intersectObjects(_rcMaps, false); return h.length ? h[0].point.y : null; };
    const n = rd.pts.length, ys = new Array(n), on = new Array(n);
    for (let i = 0; i < n; i++) { ys[i] = hit(rd.pts[i][0], rd.pts[i][1]); on[i] = ys[i] != null; }
    // off-run'ы (непрерывные участки мимо ленты) ВНЕ приконцевых зон обводим ПО ЛЕНТЕ:
    // жадная трассировка от входа к выходу — шаг с минимальным отклонением от направления на цель,
    // который попадает на полотно (0,±15°..±90°). Прямая по траве недоступна → трасса огибает по рукавам
    // развилки/дуге поворотного тайла. Затем трасса ресемплируется в исходные индексы точек.
    const END_GUARD = 1.5, STEP = 0.12, ANGLES = [0, 0.262, -0.262, 0.524, -0.524, 0.785, -0.785, 1.047, -1.047, 1.309, -1.309, 1.571, -1.571];
    let moved = false, i = 1;
    while (i < n - 1) {
      if (on[i] || rd.cum[i] <= END_GUARD || rd.len - rd.cum[i] <= END_GUARD) { i++; continue; }
      let j = i; while (j < n - 1 && !on[j] && rd.len - rd.cum[j] > END_GUARD) j++;    // run: [i..j-1], границы on-road
      const A = rd.pts[i - 1], B = rd.pts[j];
      const traced = []; let px = A[0], pz = A[1], guard = 0;
      while (Math.hypot(B[0] - px, B[1] - pz) > 0.16 && guard++ < 220) {
        let dx = B[0] - px, dz = B[1] - pz; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
        let placed = false;
        for (const ang of ANGLES) {
          const ca = Math.cos(ang), sa = Math.sin(ang);
          const nx = px + (dx * ca - dz * sa) * STEP, nz = pz + (dx * sa + dz * ca) * STEP;
          if (hit(nx, nz) != null) { px = nx; pz = nz; traced.push([nx, nz]); placed = true; break; }
        }
        if (!placed) { px += dx * STEP; pz += dz * STEP; traced.push([px, pz]); }      // лента прервалась — шаг к цели
      }
      if (traced.length > 1) {
        const cl = [0]; for (let k = 1; k < traced.length; k++) cl[k] = cl[k - 1] + Math.hypot(traced[k][0] - traced[k - 1][0], traced[k][1] - traced[k - 1][1]);
        const tot = cl[cl.length - 1] || 1, cnt = j - i;
        for (let k = 0; k < cnt; k++) {                                                // равномерный ресемпл трассы в pts[i..j-1]
          const target = tot * (k + 1) / (cnt + 1);
          let m = 1; while (m < cl.length && cl[m] < target) m++;
          if (m >= traced.length) { rd.pts[i + k][0] = traced[traced.length - 1][0]; rd.pts[i + k][1] = traced[traced.length - 1][1]; }
          else { const seg = cl[m] - cl[m - 1] || 1, f = (target - cl[m - 1]) / seg;
            rd.pts[i + k][0] = traced[m - 1][0] + (traced[m][0] - traced[m - 1][0]) * f;
            rd.pts[i + k][1] = traced[m - 1][1] + (traced[m][1] - traced[m - 1][1]) * f; }
          ys[i + k] = hit(rd.pts[i + k][0], rd.pts[i + k][1]);
        }
        moved = true;
      }
      i = j;
    }
    // 🎯 ЦЕНТРИРОВАНИЕ: ось могла лежать НА ленте, но у её внутреннего края (Безье-центр на остром
    //    поворотном тайле) → визуально юниты «срезают» по внутренней кромке. Меряем поперёк ленты
    //    расстояние до обоих краёв рейкастом и сдвигаем точку на СЕРЕДИНУ. Пропускаем: guard-зоны,
    //    точки мимо ленты, широкие места (развилка/площадь — там «край» размыт рукавами).
    for (let k = 1; k < n - 1; k++) {
      if (ys[k] == null) continue;
      if (rd.cum[k] <= END_GUARD || rd.len - rd.cum[k] <= END_GUARD) continue;
      const p = rd.pts[k], q0 = rd.pts[k - 1], q1 = rd.pts[k + 1];
      let dx = q1[0] - q0[0], dz = q1[1] - q0[1]; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
      const px = -dz, pz = dx;
      let L = null, R = null;
      for (let t = 0.1; t <= 0.92 && (L == null || R == null); t += 0.1) {
        if (R == null && hit(p[0] + px * t, p[1] + pz * t) == null) R = t - 0.05;
        if (L == null && hit(p[0] - px * t, p[1] - pz * t) == null) L = t - 0.05;
      }
      if (L == null || R == null) continue;                                           // край не найден — широкое место, не трогаем
      if (L + R > 2.0) continue;                                                      // слишком широко (развилка) — не центрируем
      const shift = (R - L) / 2;
      if (Math.abs(shift) > 0.03 && Math.abs(shift) <= 0.42) {
        p[0] += px * shift; p[1] += pz * shift;
        const y2 = hit(p[0], p[1]); if (y2 != null) ys[k] = y2;
        moved = true;
      }
    }
    for (let k = 0; k < n; k++) if (ys[k] != null) rd.hts[k] = ys[k];                  // верх полотна/моста; совсем мимо — сеточная высота
    if (moved) {                                                                       // пересчёт арк-длин
      for (let k = 1; k < n; k++) rd.cum[k] = rd.cum[k - 1] + Math.hypot(rd.pts[k][0] - rd.pts[k - 1][0], rd.pts[k][1] - rd.pts[k - 1][1]);
      rd.len = rd.cum[n - 1];
    }
    buildRoadSamples(rd);
    rd._refined = true;
  };
  window.ensureHexRoadSamplesForMap = function ensureHexRoadSamplesForMap(map) {
    const edges = map && Array.isArray(map.edges) ? map.edges : [];
    const citiesSrc = map && Array.isArray(map.cities) ? map.cities : [];
    let added = 0;
    for (const e of edges) {
      if (!e || e.a == null || e.b == null || e.a === e.b) continue;
      const key = Math.min(e.a, e.b) + '_' + Math.max(e.a, e.b);
      const existing = HEXROADS.get(key);
      if (existing && existing.samples && existing.samples.length) continue;
      let pts = Array.isArray(e.pts) && e.pts.length >= 2 ? e.pts.map(p => [p.x, p.z]) : null;
      if (!pts) {
        const ca = citiesSrc[e.a], cb = citiesSrc[e.b];
        if (!ca || !cb) continue;
        pts = [[ca.gx, ca.gz], [cb.gx, cb.gz]];
      }
      const cum = [0]; for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const hts = pts.map(p => roadPtY(p[0], p[1]));       // roadPtY/buildRoadSamples теперь модульные → видны и здесь (до buildWorld деградируют к рельефу)
      const edge = { a: e.a, b: e.b, from: e.a, pts, cum, hts, len: cum[cum.length - 1] || e.len || 0 };
      buildRoadSamples(edge);                              // всегда строим samples → hexRoadSample не вернёт null → юниты не исчезают
      HEXROADS.set(key, edge);
      added++;
    }
    if (added) console.info('[hex] добавлены fallback road samples:', added);
    return added;
  };
  // быстрый сэмпл дороги С ВЫСОТОЙ и tangent/normal из precomputed rd.samples — для потока юнитов.
  window.hexRoadSample = function hexRoadSample(a, b, f) {
    const rd = HEXROADS.get(Math.min(a, b) + '_' + Math.max(a, b));
    if (!rd || rd.len <= 0) return null;
    let t = Math.max(0, Math.min(1, f));
    if (rd.from !== a) t = 1 - t;                 // дорога запечена a→b; едем в обратную сторону → реверс
    const samples = rd.samples, step = rd.sampleStep || 0.12;
    if (!samples || !samples.length) return null;
    const target = t * rd.len, raw = target / step, i = Math.max(0, Math.min(samples.length - 1, Math.floor(raw)));
    const a0 = samples[i], b0 = samples[Math.min(samples.length - 1, i + 1)];
    const lf = Math.max(0, Math.min(1, raw - i));
    const dir = rd.from === a ? 1 : -1;
    const tx = (a0.tx + (b0.tx - a0.tx) * lf) * dir;
    const tz = (a0.tz + (b0.tz - a0.tz) * lf) * dir;
    const l = Math.hypot(tx, tz) || 1;
    return {
      x: a0.x + (b0.x - a0.x) * lf,
      z: a0.z + (b0.z - a0.z) * lf,
      y: a0.y + (b0.y - a0.y) * lf,
      tx: tx / l, tz: tz / l,
      nx: -tz / l, nz: tx / l,
    };
  };
  window.hexRoadLen = function hexRoadLen(a, b) {
    const rd = HEXROADS.get(Math.min(a, b) + '_' + Math.max(a, b));
    return rd ? rd.len : 0;
  };
  window.hexRoadPolyline = function hexRoadPolyline(a, b) {
    const rd = HEXROADS.get(Math.min(a, b) + '_' + Math.max(a, b));
    if (!rd || !rd.pts || rd.pts.length < 2) return null;
    const pts = rd.from === a ? rd.pts : [...rd.pts].reverse();
    return pts.map(p => ({ x: p[0], z: p[1] }));
  };

  buildWorld = hexBuildWorld;
  getTerrainHeight = function (x, z) { const col = tiles[Math.floor(x)]; const t = col && col[Math.floor(z)]; return t && t.topY != null ? t.topY : -0.2 * kY; };
  // ── политическая перекраска: тайл-территория красится в БИОМ владельца ближайшего города ──
  //    (захват → markRegions (city.js) → loop дёргает assignRegions). Цвет фракции не смешивается с цветом биома.
  const canonCountryName = (c) => typeof canonicalCountry === 'function' ? canonicalCountry(c) : c;
  const factionBiomeSignature = () => (typeof FACTIONS === 'undefined' || !Array.isArray(FACTIONS))
    ? ''
    : FACTIONS.map(f => canonCountryName(f && f.country || '')).join('|');
  const explicitHomeBiome = (country, fallback) => {
    if (typeof COUNTRY_HOME_BIOME === 'undefined' || !COUNTRY_HOME_BIOME) return fallback;
    const biome = COUNTRY_HOME_BIOME[canonCountryName(country)] || COUNTRY_HOME_BIOME[country];
    return biome && BIOME_TINT[biome] ? biome : fallback;
  };
  // Ближайший город к тайлу статичен (города не двигаются) → кэшируем индекс на ref-объекте.
  // Инвалидация по длине cities[]: при основании нового города (hud.js cities.push) пересчитываем.
  function nearestCityIdxFor(g) {
    if (g._ci !== undefined && g._ciN === cities.length) return g._ci;
    let bi = -1, bd = 1e18;
    for (let i = 0; i < cities.length; i++) { const c = cities[i], dx = g.gx - c.gx, dz = g.gz - c.gz, dd = dx * dx + dz * dz; if (dd < bd) { bd = dd; bi = i; } }
    g._ci = bi; g._ciN = cities.length;
    return bi;
  }
  function buildFacBiome() {
    if (typeof FACTIONS === 'undefined' || typeof cities === 'undefined' || !cities.length || !GRASSREF.length) { FACBIOME = {}; return; }  // не кэшируем сигнатуру, пока нет данных → ensureFacBiome повторит
    // tally (доминирующий биом территории) нужен ТОЛЬКО как fallback, если у фракции нет явного home-биома.
    let needTally = false;
    for (let fid = 0; fid < FACTIONS.length; fid++) {
      const country = FACTIONS[fid] && FACTIONS[fid].country;
      if (!country || explicitHomeBiome(country, null) == null) { needTally = true; break; }
    }
    let tally = null;                                          // canonicalCountry → { biome: count }
    if (needTally) {
      tally = {};
      for (const g of GRASSREF) {                              // voronoi ближайшего города; по КАНОНИЧЕСКОЙ стране (агрегаты типа «Северная империя»)
        const ci = nearestCityIdxFor(g); if (ci < 0) continue;
        const key = canonCountryName(cities[ci].country), t = tally[key] || (tally[key] = {}), b = g.biome || 'default';
        t[b] = (t[b] || 0) + 1;
      }
    }
    const modeBiome = (key) => {                               // доминирующий биом страны (default — только если других нет)
      const t = tally && tally[key]; if (!t) return 'default';
      let bb = null, bc = -1;
      for (const b in t) if (b !== 'default' && t[b] > bc) { bc = t[b]; bb = b; }
      if (bb) return bb;
      for (const b in t) if (t[b] > bc) { bc = t[b]; bb = b; }
      return bb || 'default';
    };
    FACBIOME = {};
    for (let fid = 0; fid < FACTIONS.length; fid++) {
      const country = FACTIONS[fid] && FACTIONS[fid].country;
      FACBIOME[fid] = country ? explicitHomeBiome(country, modeBiome(canonCountryName(country))) : 'default';
    }
    FACBIOME_SIG = factionBiomeSignature();                    // сигнатуру выставляем только после успешной сборки
  }
  function ensureFacBiome() {
    if (!FACBIOME || !Object.keys(FACBIOME).length || FACBIOME_SIG !== factionBiomeSignature()) buildFacBiome();
  }
  function recolorRefByOwner(refs, tmp) {                                    // цвет каждого инстанса к биому владельца ближайшего города
    for (const g of refs) {
      const ci = nearestCityIdxFor(g); if (ci < 0) continue;
      const biome = (FACBIOME && FACBIOME[cities[ci].owner]) || g.biome || 'default';
      setPackBiomeAt(g.mesh, g.idx, biome);
      if (hasPackBiomeTexture(biome)) tmp.copy(WHITE);                         // готовый KayKit-атлас даёт цвет сам
      else if (biome === g.biome) tmp.copy(g.base || WHITE);                   // владелец = родной биом → базовый цвет этого биома
      else tmp.copy(biomeTint(biome));                                        // захват → прямой цвет биома нового владельца
      g.mesh.setColorAt(g.idx, instanceTint(tmp));
    }
    const meshes = new Set(); for (const g of refs) meshes.add(g.mesh);
    for (const mm of meshes) if (mm.instanceColor) mm.instanceColor.needsUpdate = true;
  }
  function hexAssignRegions() {
    if (typeof cities === 'undefined' || !cities.length) return;
    ensureFacBiome();
    const tmp = new T.Color();
    recolorRefByOwner(GRASSREF, tmp);                                         // территория (трава)
    recolorRefByOwner(ROADREF, tmp);                                         // дороги — тоже в биом владельца
    recolorRefByOwner(TILEREF, tmp);                                         // coast/slope/manual land-тайлы
    // бонус контроля страны (как в logic.js assignRegions): вся страна у одной фракции → boost
    if (typeof COUNTRIES !== 'undefined') {
      const checked = new Set();
      for (const country of COUNTRIES) {
        const cname = typeof canonicalCountry === 'function' ? canonicalCountry(country.name) : country.name;
        if (checked.has(cname)) continue;
        checked.add(cname);
        const cs = cities.filter(c => c.country === cname);
        if (!cs.length) continue;
        const o = cs[0] && cs[0].owner;
        const ctrl = cs.every(c => c.owner === o);
        for (const c of cs) c.boosted = ctrl;
      }
    }
  }
  if (typeof assignRegions === 'function') assignRegions = hexAssignRegions;

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

  let CITY_BATCH_GROUP = null, CITY_BATCH_DIRTY = false;
  const CITY_BATCH_MATS = new Map();
  const CITY_MODEL_KEYS = new WeakMap();
  function cityModelForTier(tier) {
    if (tier >= 3 && M.cityL3) return { key: 'cityL3', model: M.cityL3 };
    if (tier === 2 && M.cityL2) return { key: 'cityL2', model: M.cityL2 };
    if (M.cityL1) return { key: 'cityL1', model: M.cityL1 };
    if (M.cityL3) return { key: 'cityL3', model: M.cityL3 };
    return { key: 'castle', model: M.castle };
  }
  function modelKey(model, fallback = 'model') {
    if (!model) return fallback;
    let key = CITY_MODEL_KEYS.get(model);
    if (key) return key;
    for (const k in M) if (M[k] === model) { CITY_MODEL_KEYS.set(model, k); return k; }
    key = fallback + ':' + (model.geo && model.geo.uuid || Math.random());
    CITY_MODEL_KEYS.set(model, key);
    return key;
  }
  function cityBatchMaterial(modelKey, model, owner) {
    const key = modelKey + ':' + owner;
    let mat = CITY_BATCH_MATS.get(key);
    if (mat) return mat;
    const ft = factionTexture(owner);
    mat = ft ? model.mat.clone() : model.mat;
    if (ft) mat.map = ft;
    CITY_BATCH_MATS.set(key, mat);
    return mat;
  }
  function fortBatchMaterial(modelKey, model, owner, kind) {
    const key = 'fort:' + modelKey + ':' + kind + ':' + owner;
    let mat = CITY_BATCH_MATS.get(key);
    if (mat) return mat;
    const tex = kind === 'wood' ? woodTowerTexture() : (kind === 'faction' ? factionTexture(owner) : null);
    mat = tex ? model.mat.clone() : model.mat;
    if (tex) mat.map = tex;
    CITY_BATCH_MATS.set(key, mat);
    return mat;
  }
  function markCityBatchesDirty() { CITY_BATCH_DIRTY = true; }
  function addBatchInstance(buckets, key, model, mat, group, matrix) {
    let b = buckets.get(key);
    if (!b) {
      b = { model, mat, group, matrices: [] };
      buckets.set(key, b);
    }
    b.matrices.push(matrix.clone());
  }
  function rebuildCityBatchesIfDirty() {
    if (!CITY_BATCH_DIRTY || typeof cities === 'undefined') return;
    CITY_BATCH_DIRTY = false;
    if (CITY_BATCH_GROUP) scene.remove(CITY_BATCH_GROUP);
    CITY_BATCH_GROUP = new T.Group();
      CITY_BATCH_GROUP.userData.perfGroup = 'city-main-batch';
    const buckets = new Map();
    for (const c of cities) {
      if (!c || c.isShipyard || c.isAirport) continue;
      if (c._hexMesh && c._hexModel && c._hexBatchScale != null) {
        c._hexMesh.visible = false;
        const key = 'main:' + c._hexModelKey + ':' + c.owner;
        dummy.position.set(c.gx, c.baseY, c.gz);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(c._hexBatchScale, c._hexBatchScale, c._hexBatchScale);
        dummy.updateMatrix();
        addBatchInstance(buckets, key, c._hexModel, cityBatchMaterial(c._hexModelKey, c._hexModel, c.owner), 'city-main-batch', dummy.matrix);
      }
      if (c.buildGroup) {
        c.buildGroup.updateWorldMatrix(true, true);
        c.buildGroup.traverse((o) => {
          if (!o.isMesh) return;
          const group = o.userData && o.userData.perfGroup;
          if (group !== 'city-walls' && group !== 'city-gates' && group !== 'city-towers') return;
          o.visible = false;
          const model = o.userData.batchModel, key = o.userData.batchModelKey, kind = o.userData.batchMatKind || 'base';
          if (!model || !key) return;
          addBatchInstance(
            buckets,
            group + ':' + key + ':' + kind + ':' + (o.userData.batchOwner ?? c.owner),
            model,
            fortBatchMaterial(key, model, o.userData.batchOwner ?? c.owner, kind),
            group,
            o.matrixWorld
          );
        });
      }
    }
    for (const b of buckets.values()) {
      if (typeof installDynShadowReceiver === 'function') installDynShadowReceiver(b.mat, { bias: 0.00012 });
      const im = new T.InstancedMesh(b.model.geo, b.mat, b.matrices.length);
      // 🌗 города — ДИНАМИЧЕСКИЕ кастеры: из статичной карты исключены (castShadow=false),
      //    тень рисуют через отдельную карту (слой DYN_SHADOW_LAYER) — апгрейд перепекает только её
      im.castShadow = !!IS_WEBGPU && (typeof graphicsShadowsEnabled !== 'function' || graphicsShadowsEnabled()); im.receiveShadow = true;
      im.layers.enable(typeof DYN_SHADOW_LAYER !== 'undefined' ? DYN_SHADOW_LAYER : 2);
      im.userData.perfGroup = b.group;
      for (let i = 0; i < b.matrices.length; i++) {
        im.setMatrixAt(i, b.matrices[i]);
        im.setColorAt(i, WHITE);
      }
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
      CITY_BATCH_GROUP.add(im);
    }
    scene.add(CITY_BATCH_GROUP);
    if (IS_WEBGPU && typeof markShadowsDirty === 'function') markShadowsDirty();
    if (typeof markDynShadowsDirty === 'function') markDynShadowsDirty();   // батчи городов пересобраны → одна перепечь динамической карты
  }
  window.rebuildCityBatchesIfDirty = rebuildCityBatchesIfDirty;

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
    markCityBatchesDirty();
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
  function _gateHitFromDirection(vertices, dir) {
    const mag = Math.hypot(dir[0], dir[1]);
    if (mag < 1e-5) return null;
    const far = [dir[0] / mag * 100, dir[1] / mag * 100];
    let best = null;
    for (let k = 0; k < vertices.length; k++) {
      const hit = _segmentHit([0, 0], far, vertices[k], vertices[(k + 1) % vertices.length]);
      if (hit && (!best || hit.roadT < best.roadT)) best = { edge: k, t: hit.edgeT, roadT: hit.roadT };
    }
    return best ? { edge: best.edge, t: Math.max(0.12, Math.min(0.88, best.t)) } : null;
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
    const wallRadius = vertices.reduce((sum, p) => sum + Math.hypot(p[0], p[1]), 0) / Math.max(1, vertices.length);
    const gateCount = () => {
      let n = 0;
      for (const list of gates.values()) n += list.length;
      return n;
    };
    const addGate = (found, minGap = 0.08) => {
      if (!found) return false;
      const list = gates.get(found.edge) || [];
      if (list.some(t => Math.abs(t - found.t) < minGap)) return false;
      list.push(found.t);
      list.sort((a, b) => a - b);
      gates.set(found.edge, list);
      return true;
    };
    const refineGate = (found, maxDelta = 0.34) => {
      if (!found) return false;
      const list = gates.get(found.edge);
      if (!list || !list.length) return false;
      let best = -1, bestDelta = Infinity;
      for (let i = 0; i < list.length; i++) {
        const delta = Math.abs(list[i] - found.t);
        if (delta < bestDelta) { bestDelta = delta; best = i; }
      }
      if (best < 0 || bestDelta > maxDelta) return false;
      if (bestDelta > 0.035) {
        list[best] = found.t;
        list.sort((a, b) => a - b);
      }
      return true;
    };
    const nearGate = (found, maxDelta = 0.34) => {
      const list = found && gates.get(found.edge);
      return !!(list && list.some(t => Math.abs(t - found.t) <= maxDelta));
    };
    const cityRoads = [...HEXROADS.values()]
      .filter(rd => (rd.a === city.idx || rd.b === city.idx) && !roadEndsAtInlineShipyard(city, rd))
      .sort((a, b) => a.len - b.len);
    const maxGates = 6;
    for (const rd of cityRoads.slice(0, maxGates)) {
      const forward = rd.from === city.idx, pts = rd.pts;
      if (!pts || pts.length < 2) continue;
      const start = forward ? 0 : pts.length - 1, step = forward ? 1 : -1;
      const localPts = [];
      for (let i = start; i >= 0 && i < pts.length; i += step) {
        const p = pts[i];
        localPts.push([(p[0] - centerX) / CITY_SCALE, (p[1] - centerZ) / CITY_SCALE]);
      }
      let found = null;
      for (let i = 0; i + 1 < localPts.length && !found; i++) {
        const a = localPts[i], b = localPts[i + 1];
        for (let k = 0; k < vertices.length; k++) {
          const hit = _segmentHit(a, b, vertices[k], vertices[(k + 1) % vertices.length]);
          if (hit) { found = { edge: k, t: Math.max(0.12, Math.min(0.88, hit.edgeT)) }; break; }
        }
      }
      // Некоторые запечённые дороги заканчиваются в соседнем хексе, не доходя
      // до периметра. В таком случае продолжаем направление до стены лучом.
      if (!found) {
        const outer = localPts.find(p => Math.hypot(p[0], p[1]) >= wallRadius * 0.85)
          || localPts.reduce((best, p) => Math.hypot(p[0], p[1]) > Math.hypot(best[0], best[1]) ? p : best, localPts[0]);
        if (outer) found = _gateHitFromDirection(vertices, outer);
      }
      if (!found) continue;
      addGate(found);
    }

    // Граф дорог хранит только связи город-город. Визуально возле города могут быть
    // дополнительные road/bridge-тайлы, и ворота должны смотреть на них тоже.
    if (HEXROADTILES.length) {
      const candidates = [];
      const minD = wallRadius * 1.05, maxD = wallRadius * (city.size >= 3 ? 5.0 : city.size === 2 ? 4.2 : 3.8);
      const targetD = wallRadius * 1.65;
      const maxScore = wallRadius * 0.85;
      for (const tile of HEXROADTILES) {
        const lx = (tile.gx - centerX) / CITY_SCALE, lz = (tile.gz - centerZ) / CITY_SCALE;
        const d = Math.hypot(lx, lz);
        if (d < minD || d > maxD) continue;
        const found = _gateHitFromDirection(vertices, [lx, lz]);
        if (found) candidates.push({ ...found, d, score: Math.abs(d - targetD) });
      }
      candidates.sort((a, b) => a.score - b.score || a.d - b.d);
      const usedSlots = new Set();
      const refinedEdges = new Set();
      for (const found of candidates) {
        if (found.score > maxScore) continue;
        const slotKey = found.edge + ':' + Math.round(found.t * 8);
        if (usedSlots.has(slotKey)) continue;
        usedSlots.add(slotKey);
        if (!refinedEdges.has(found.edge) && refineGate(found)) { refinedEdges.add(found.edge); continue; }
        if (refinedEdges.has(found.edge) && nearGate(found)) continue;
        if (gates.has(found.edge)) continue;
        if (gateCount() >= maxGates) continue;
        addGate(found, 0.18);
      }
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
    const wallRadiusScale = 0.7;
    const ringR = (tier1Defense || tier >= 2 ? 1.65 : 0.85) * wallRadiusScale * hs;
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
    city._gates = [];                                          // мировые смещения ворот от центра города (для штурма «в ворота»)
    city._wallR = ringR * CITY_SCALE;                          // радиус кольца стен (мир) — рой сужается у ворот
    // стены: тайлим N сегментов, ЗАПОЛНЯЯ ребро (N = ребро / желаемая длина сегмента). Высота/толщина — пропорц.
    for (let k = 0; k < corners; k++) {
      const p = V[k], q = V[(k + 1) % corners], ang = Math.atan2(q[1] - p[1], q[0] - p[0]);
      const edgeLen = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const edgeGates = gatePositions.get(k) || [];
      let n = Math.max(1, Math.round(edgeLen / idealSeg));
      if (edgeGates.length) n = Math.max(n, Math.min(5, edgeGates.length * 2 + 1));
      const gateSlots = new Map();
      for (const gateT of edgeGates) {
        const slot = Math.max(0, Math.min(n - 1, Math.round(gateT * n - 0.5)));
        const prev = gateSlots.get(slot), slotCenter = (slot + 0.5) / n;
        if (prev == null || Math.abs(gateT - slotCenter) < Math.abs(prev - slotCenter)) gateSlots.set(slot, gateT);
      }
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
        const gateT = gateSlots.get(i);
        const t = gateT == null ? (i + 0.5) / n : gateT, cx = p[0] + (q[0] - p[0]) * t, cz = p[1] + (q[1] - p[1]) * t;
        const isGate = gateT != null && gateM;
        if (isGate) city._gates.push({ dx: (offX + cx) * CITY_SCALE, dz: (offZ + cz) * CITY_SCALE });  // проём ворот (смещение от центра)
        const wm = isGate ? gateM : wallM, m = new T.Mesh(wm.geo, wm.mat);
        m.userData.perfGroup = isGate ? 'city-gates' : 'city-walls';
        m.userData.batchModel = wm;
        m.userData.batchModelKey = modelKey(wm, isGate ? 'gate' : 'wall');
        m.userData.batchMatKind = 'base';
        m.userData.batchOwner = city.owner;
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
      m.userData.perfGroup = 'city-towers';
      m.userData.batchModel = towerM;
      m.userData.batchModelKey = modelKey(towerM, 'tower');
      m.userData.batchMatKind = tier1Defense ? 'wood' : 'faction';
      m.userData.batchOwner = city.owner;
      m.position.set(offX + p[0], -_bbMinY(towerM) * tScale, offZ + p[1]); m.scale.setScalar(tScale);
      m.rotation.y = Math.atan2(p[0], p[1]) + Math.PI;   // вход башни — к замку (центру)
      m.castShadow = true; group.add(m);
    }
  }

  // ── KayKit-здания по УРОВНЯМ ПРОКАЧКИ (tier) вместо процедурных воксельных городов (только хекс-вариант) ──
  if (typeof City !== 'undefined' && (M.cityL1 || M.cityL3 || M.castle)) {
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
      const cityModel = cityModelForTier(buildingTier);
      const model = cityModel.model;  // основное здание растёт только от экономики
      const ft = factionTexture(this.owner);
      const mat = ft ? model.mat.clone() : model.mat; if (ft) mat.map = ft;
      const mesh = new T.Mesh(model.geo, mat); mesh.castShadow = true; mesh.receiveShadow = true; mesh.visible = false; mesh.userData.perfGroup = 'city-main'; this._hexMesh = mesh;
      this._hexModel = model; this._hexModelKey = cityModel.key;
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
      this._hexBatchScale = s * CITY_SCALE;
      this.buildGroup.add(mesh);
      buildFortifications(this, this.buildGroup, 0, 0);   // стены (def) / башни (atk)
      // ОБЯЗАТЕЛЬНО: topY для позиции подписи/кольца (updateLabel: baseY + topY*CITY_SCALE + 0.7). Без него подпись = NaN → пропадает.
      if (!model.geo.boundingBox) model.geo.computeBoundingBox();
      this.topY = Math.max(0.5, (model.geo.boundingBox.max.y || 1) * s);
      markCityBatchesDirty();
    };
    City.prototype.recolor = function () {                                  // захват города → перекраска здания в цвет нового владельца
      if (this._hexMesh && !this.isShipyard && !this.isAirport) {
        const ft = factionTexture(this.owner);
        if (ft) { const m = this._hexMesh.material.clone(); m.map = ft; this._hexMesh.material = m; }
        markCityBatchesDirty();
        return;
      }
      return _origRecolor.call(this);
    };
  }
})();
