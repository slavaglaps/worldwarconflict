/* ─────────────────────────────────────────────────────────────────────────
   hex-preload.js — ТОНКИЙ загрузчик запечённой карты (вариант A: бейк+загрузка).
   Грузится ОТДЕЛЬНЫМ <script> ДО игровых модулей (нужен только THREE + GLTFLoader + fetch).
   НИКАКОЙ генерации: берём hex-map.json (испечён редактором hex-europe.html → «Экспорт карты»)
   и грузим ТОЛЬКО реально используемые модели KayKit. Рендерит hex-world.js.
   Синхронизация: правки в редакторе → ре-экспорт hex-map.json → игра обновилась (без дрейфа).
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
window.hexPreload = async function hexPreload() {
  if (window.HEXDATA) return window.HEXDATA;
  const T = window.THREE;
  let BASE = '';
  const fetchJson = async (path) => {
    let lastErr;
    for (const base of ['', 'tiny-world-builder/']) {
      const bust = location.search.includes('nocache') ? (path.includes('?') ? '&' : '?') + '_=' + Date.now() : '';
      try { const r = await fetch(base + path + bust, { cache: 'no-store' }); if (!r.ok) throw new Error(r.status); BASE = base; return await r.json(); }
      catch (e) { lastErr = e; }
    }
    throw lastErr;
  };

  const MAP = await fetchJson('hex-map.json');

  // какие модели реально нужны (а не все 200+ из names)
  const used = new Set(['grass', 'water', 'castle', 'tower', 'home']);   // + модели зданий городов (KayKit) для hex-world
  for (const t of MAP.tiles) { if (t[5]) used.add(t[5]); if (t[7]) used.add(t[7]); if (t[9]) used.add(t[9]); }
  for (const b of MAP.bridges) used.add(b[2]);
  for (const d of MAP.decor) used.add(d[0]);

  const loader = new T.GLTFLoader();
  const loadModel = (path) => new Promise((res, rej) => loader.load(BASE + path + '.gltf', (g) => {
    let mesh = null; g.scene.updateWorldMatrix(true, true); g.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
    if (!mesh) return rej(new Error('нет меша: ' + path));
    const geo = mesh.geometry.clone(); geo.applyMatrix4(mesh.matrixWorld);
    res({ geo, mat: mesh.material });
  }, undefined, rej));
  const texLoader = new T.TextureLoader();
  const loadTexture = (path) => new Promise((res, rej) => texLoader.load(BASE + path, (tex) => {
    if (T.sRGBEncoding) tex.encoding = T.sRGBEncoding;
    tex.flipY = false;
    res(tex);
  }, undefined, rej));

  const keys = [...used].filter((k) => MAP.names[k]);
  // устойчиво: одна не загрузившаяся модель НЕ должна ронять всю игру (тайлы/декор с ней просто не отрисуются)
  const settled = await Promise.allSettled(keys.map((k) => loadModel(MAP.names[k])));
  const M = {}; const failed = [];
  settled.forEach((r, i) => { if (r.status === 'fulfilled') M[keys[i]] = r.value; else failed.push(keys[i]); });
  if (!M.grass || !M.water) throw new Error('базовые тайлы (grass/water) не загрузились — карта без основы');
  if (failed.length) console.warn('[hex] не загрузились модели (пропущены):', failed.join(', '));
  Object.values(M).forEach((m) => { m.mat = m.mat.clone(); m.mat.metalness = 0; m.mat.roughness = 0.92; });

  const BIOME_TEXTURES = {};
  try {
    BIOME_TEXTURES.desert = await loadTexture('assets/hex-kit/textures/hexagons_medieval_Fall.png');
    BIOME_TEXTURES.summer = await loadTexture('assets/hex-kit/textures/hexagons_medieval_Summer.png');
    BIOME_TEXTURES.winter = await loadTexture('assets/hex-kit/textures/hexagons_medieval_Winter.png');
  } catch (e) { console.warn('[hex] alternate biome textures skipped:', e); }
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
  const biomeModelSuffix = (biome) => String(biome || '').replace(/(^|_)([a-z])/g, (_, __, ch) => ch.toUpperCase());
  const biomeModel = (base, biome) => {
    if (!base || !biome || biome === 'default') return base;
    const key = '__' + biome;
    if (base[key]) return base[key];
    const mat = base.mat.clone();
    if (biome === 'desert' && BIOME_TEXTURES.desert) mat.map = BIOME_TEXTURES.desert;
    else if (biome === 'summer' && BIOME_TEXTURES.summer) mat.map = BIOME_TEXTURES.summer;
    else if (biome === 'winter' && BIOME_TEXTURES.winter) mat.map = BIOME_TEXTURES.winter;
    if (biome !== 'desert' && biome !== 'summer' && biome !== 'winter' && BIOME_TINT[biome]) {
      mat.color = BIOME_TINT[biome].clone();
    }
    base[key] = { geo: base.geo, mat };
    return base[key];
  };
  for (const biome of Object.keys(BIOME_TINT)) {
    if (biome === 'default') continue;
    M['grass' + biomeModelSuffix(biome)] = biomeModel(M.grass, biome);
  }

  // ── здания городов по уровням прокачки (KayKit, общий атлас) — явными путями ──
  const CITY_B = {
    cityL1: 'assets/hex-kit/buildings/blue/building_church_blue',     // tier 0–1: церковь
    cityL2: 'assets/hex-kit/buildings/blue/building_barracks_blue',   // tier 2: казарма-каре (то самое здание из палитры)
    cityL3: 'assets/hex-kit/buildings/blue/building_castle_blue',     // tier 3: большой замок
    // укрепления: стены по тиру def (1 — маленькие каменные, 2 — деревянные, 3 — большие каменные) + башни (atk)
    fenceStone: 'assets/hex-kit/buildings/neutral/fence_stone_straight',        // tier 1: маленькие стены
    fenceStoneGate: 'assets/hex-kit/buildings/neutral/fence_stone_straight_gate',
    fenceWood: 'assets/hex-kit/buildings/neutral/fence_wood_straight',          // tier 2: деревянные стены
    fenceWoodGate: 'assets/hex-kit/buildings/neutral/fence_wood_straight_gate',
    wall: 'assets/hex-kit/buildings/neutral/wall_straight',                     // tier 3: большие каменные
    wallGate: 'assets/hex-kit/buildings/neutral/wall_straight_gate',
    defTower: 'assets/hex-kit/buildings/blue/building_tower_base_blue',   // угловая башня для def (круглая → чистый стык)
    atkTier1: 'assets/hex-kit/buildings/blue/building_tower_catapult_blue',
    atkTier2: 'assets/hex-kit/buildings/blue/building_tower_A_blue',
    atkTier3: 'assets/hex-kit/buildings/blue/building_tower_B_blue',
  };
  const cbKeys = Object.keys(CITY_B);
  const cb = await Promise.allSettled(cbKeys.map((k) => loadModel(CITY_B[k])));
  cb.forEach((r, i) => { if (r.status === 'fulfilled') { const mm = r.value; mm.mat = mm.mat.clone(); mm.mat.metalness = 0; mm.mat.roughness = 0.92; M[cbKeys[i]] = mm; } });

  window.HEXDATA = { MAP, models: M };
  return window.HEXDATA;
};
