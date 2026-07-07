/* ─────────────────────────────────────────────────────────────────────────
   build.js — система строительства зданий на хексах (game-hex).
   • кнопка в боковом меню (под дипломатией) открывает компактное меню зданий;
   • выбор здания → подсветка валидных хексов (суша без декора/дорог/реки, не у города);
   • ghost под курсором, клик ставит здание; один хекс — одно здание.
   Модели: KayKit Medieval Hexagon (assets/hex-kit/buildings/green).
   Данные валидных хексов: window.HEXBUILD (из hex-world.js).
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  const T = (typeof T3 !== 'undefined') ? T3 : THREE;
  const BASE = 'assets/hex-kit/buildings/green/';
  const BLUE_BASE = 'assets/hex-kit/buildings/blue/';
  // Внешние постройки: пока один слой строительства за пределами городов.
  const CATALOG = [
    { key: 'tower_A', file: 'building_tower_A_green', name: 'Башня', cat: 'def', role: 'tower', cost: 85, range: 7.5, damage: 2, attackSpeed: 0.75, icon: '🛡' },
    { key: 'shipyard', name: 'Верфь', cat: 'def', role: 'shipyard', cost: 90, icon: '⚓',
      parts: [{ key: 'workshop', path: BLUE_BASE + 'building_shipyard_blue' }, { key: 'docks', path: BLUE_BASE + 'building_docks_blue' }] },
    { key: 'airport', name: 'Аэропорт', cat: 'def', role: 'airport', cost: 110, icon: '✈',
      parts: [{ key: 'workshop', path: BLUE_BASE + 'building_workshop_blue' }] },
    { key: 'home_A', file: 'building_home_A_green', name: 'Деревня', cat: 'eco', role: 'village', cost: 45, manpowerRate: 0.35, icon: '👥' },
    { key: 'windmill', file: 'building_windmill_green', name: 'Ферма', cat: 'eco', role: 'farm', cost: 55, goldRate: 0.45, icon: '💰' },
    { key: 'church', file: 'building_church_green', name: 'Церковь', cat: 'state', role: 'church', cost: 70, politRate: 0.08, icon: '🏛' },
  ];

  const models = {};            // key → THREE.Group (нормализованный, origin у основания)
  let ready = false, loading = false;
  let selected = null;          // выбранный каталог-итем (режим размещения)
  let placedGroup = null;       // контейнер для поставленных зданий
  const placedBuildings = [];    // {item,obj,key,owner,gx,gz,y,cd}
  let highlightIM = null, hoverMesh = null, ghost = null;
  let hoverHex = null;          // {gx,gz,top,key} под курсором
  let panelEl = null, panelBody = null;
  window.MAP_BUILDINGS = placedBuildings;

  // ── цвет страны игрока: перекрашиваем зелёные (фракционные) пиксели KayKit-атласа в OWNER_COL ──
  function ownerColorLinear(owner) {
    let hex = 0x4c7ad8;
    if (owner == null) owner = playerId();
    try { if (typeof OWNER_COL !== 'undefined' && OWNER_COL[owner] != null) hex = OWNER_COL[owner]; } catch (e) {}
    const c = new T.Color(hex); if (T.sRGBEncoding && c.convertSRGBToLinear) c.convertSRGBToLinear();
    return c;
  }
  function playerColorLinear() { return ownerColorLinear(playerId()); }
  function setMaterialOwner(mat, owner) {
    if (!mat || !mat.userData || !mat.userData.__ownerUniform) return;
    mat.userData.__ownerUniform.value.copy(ownerColorLinear(owner));
  }
  function applyOwnerColor(mat, owner) {
    if (!mat) return;
    mat.userData = mat.userData || {};
    if (mat.userData.__owned) { setMaterialOwner(mat, owner); return; }
    mat.userData.__owned = true;
    const u = { value: ownerColorLinear(owner) };
    mat.userData.__ownerUniform = u;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uOwnerCol = u;
      sh.fragmentShader = 'uniform vec3 uOwnerCol;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        {
          float greenness = diffuseColor.g - max(diffuseColor.r, diffuseColor.b);
          float blueness = diffuseColor.b - max(diffuseColor.r, diffuseColor.g);
          float gm = max(
            smoothstep(0.03, 0.13, greenness),                  // green-наборы внешних зданий
            smoothstep(0.03, 0.13, blueness)                    // blue-набор верфи
          );
          if (gm > 0.001) {
            float lum = clamp(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
            vec3 tinted = uOwnerCol * (0.45 + lum * 1.05);        // цвет страны, сохраняя свет/тень крыши
            diffuseColor.rgb = mix(diffuseColor.rgb, tinted, gm);
          }
        }`);
    };
    mat.needsUpdate = true;
  }
  function recolorObject(obj, owner) {
    if (!obj) return;
    obj.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => applyOwnerColor(m, owner));
    });
  }
  function cloneOwnerMaterial(mat, owner) {
    const c = mat.clone();
    c.userData = Object.assign({}, c.userData || {});
    delete c.userData.__owned;
    delete c.userData.__ownerUniform;
    applyOwnerColor(c, owner);
    return c;
  }

  function playerId() {
    try { if (typeof OWNER !== 'undefined' && OWNER && OWNER.PLAYER != null) return OWNER.PLAYER | 0; } catch (e) {}
    try { if (typeof PLAYER !== 'undefined') return PLAYER | 0; } catch (e) {}
    return 0;
  }
  function localSim() {
    try { if (typeof LOCALSIM !== 'undefined' && LOCALSIM) return LOCALSIM; } catch (e) {}
    return null;
  }
  function syncSimResource(fid, key, value) {
    const sim = localSim();
    if (sim && sim[key] && sim[key].length > fid) sim[key][fid] = value;
  }
  function addResource(fid, key, amount) {
    if (!amount || amount <= 0) return;
    if (key === 'gold') {
      gold[fid] = (gold[fid] || 0) + amount;
      syncSimResource(fid, 'gold', gold[fid]);
    } else if (key === 'polit') {
      const cap = (typeof POLIT_MAX !== 'undefined') ? POLIT_MAX : Infinity;
      politPts[fid] = Math.min(cap, (politPts[fid] || 0) + amount);
      syncSimResource(fid, 'politPts', politPts[fid]);
    } else if (key === 'manpower') {
      const cap = (typeof manpowerCap === 'function') ? manpowerCap(fid) : Infinity;
      manpower[fid] = Math.min(cap, (manpower[fid] || 0) + amount);
      syncSimResource(fid, 'manpower', manpower[fid]);
    }
  }
  function spendGold(fid, amount) {
    if (!amount) return true;
    if ((gold[fid] || 0) < amount) return false;
    gold[fid] -= amount;
    syncSimResource(fid, 'gold', gold[fid]);
    return true;
  }
  function itemStats(item) {
    if (!item) return '';
    if (item.role === 'tower') return `−${item.cost}💰 · радиус ${item.range} · урон ${item.damage} · ${item.attackSpeed}/с`;
    if (item.role === 'village') return `−${item.cost}💰 · +${item.manpowerRate.toFixed(2)}👥/с`;
    if (item.role === 'farm') return `−${item.cost}💰 · +${item.goldRate.toFixed(2)}💰/с`;
    if (item.role === 'church') return `−${item.cost}💰 · +${item.politRate.toFixed(2)}🏛/с`;
    if (item.role === 'shipyard') return `−${item.cost}💰 · только берег у города`;
    if (item.role === 'airport') return `−${item.cost}💰 · рядом с городом`;
    return item.cost ? `−${item.cost}💰` : '';
  }
  function buildingIncomeRate(fid, key) {
    let r = 0;
    for (const b of placedBuildings) {
      if (!b || b.owner !== fid) continue;
      if (key === 'gold') r += b.item.goldRate || 0;
      else if (key === 'polit') r += b.item.politRate || 0;
      else if (key === 'manpower') r += b.item.manpowerRate || 0;
    }
    return r;
  }
  window.mapBuildingIncomeRate = buildingIncomeRate;

  // ── загрузка моделей ──
  function normalizeModel(root, owner, partKey) {
    root.updateWorldMatrix(true, true);
    const box = new T.Box3().setFromObject(root);
    const size = new T.Vector3(); box.getSize(size);
    const center = new T.Vector3(); box.getCenter(center);
    const holder = new T.Group();
    root.position.set(-center.x, -box.min.y, -center.z);
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = false; o.receiveShadow = true;
      if (!o.material) return;
      if (Array.isArray(o.material)) o.material = o.material.map((m) => { const c = m.clone(); c.metalness = 0; c.roughness = 0.9; applyOwnerColor(c, owner); return c; });
      else { o.material = o.material.clone(); o.material.metalness = 0; o.material.roughness = 0.9; applyOwnerColor(o.material, owner); }
    });
    holder.add(root);
    if (partKey) holder.userData.shipyardPart = partKey;
    holder.userData.footprint = Math.max(size.x, size.z) || 1;
    return holder;
  }
  function loadGltf(path) {
    return new Promise((res, rej) => new T.GLTFLoader().load(path + '.gltf', (g) => res(g.scene), undefined, rej));
  }
  function loadOne(item) {
    if (item.parts) {
      return Promise.all(item.parts.map((p) => loadGltf(p.path).catch(() => null))).then((roots) => {
        const holder = new T.Group();
        let fp = 1;
        roots.forEach((root, i) => {
          if (!root) return;
          const part = normalizeModel(root, playerId(), item.parts[i].key);
          fp = Math.max(fp, part.userData.footprint || 1);
          holder.add(part);
        });
        holder.userData.footprint = fp;
        models[item.key] = holder;
      });
    }
    return new Promise((res) => {
      new T.GLTFLoader().load(BASE + item.file + '.gltf', (g) => {
        models[item.key] = normalizeModel(g.scene, playerId());   // низ модели → y=0, центр по XZ
        res();
      }, undefined, () => { res(); });   // ошибку глотаем — здание просто будет недоступно
    });
  }
  async function ensureModels() {
    if (ready || loading) return;
    loading = true;
    await Promise.all(CATALOG.map(loadOne));
    ready = true; loading = false;
    buildThumbs();
  }

  // масштаб модели, чтобы основание совпало с хексом
  function modelScale(item) {
    const hb = window.HEXBUILD; if (!hb) return 1;
    const m = models[item.key]; const fp = (m && m.userData.footprint) || 1;
    return (hb.scale * 1.05) / fp;   // основание ≈ ширина хекса
  }

  // ── миниатюры (offscreen-рендер) ──
  let thumbRenderer = null;
  function buildThumbs() {
    try {
      const S = 76;
      thumbRenderer = new T.WebGLRenderer({ antialias: true, alpha: true });
      thumbRenderer.setSize(S, S); thumbRenderer.setPixelRatio(1);
      if (T.sRGBEncoding) thumbRenderer.outputEncoding = T.sRGBEncoding;
      const tScene = new T.Scene();
      tScene.add(new T.HemisphereLight(0xffffff, 0x6b7280, 1.1));
      const dl = new T.DirectionalLight(0xffffff, 1.1); dl.position.set(3, 6, 4); tScene.add(dl);
      const cam = new T.PerspectiveCamera(35, 1, 0.1, 100);
      for (const item of CATALOG) {
        const src = models[item.key]; if (!src) continue;
        const obj = src.clone(true);
        const box = new T.Box3().setFromObject(obj); const sz = new T.Vector3(); box.getSize(sz);
        const ctr = new T.Vector3(); box.getCenter(ctr);
        const rad = Math.max(sz.x, sz.y, sz.z) * 0.5 || 1;
        tScene.add(obj);
        const d = rad * 3.0;
        cam.position.set(ctr.x + d * 0.8, ctr.y + d * 0.85, ctr.z + d * 0.9);
        cam.lookAt(ctr); cam.updateProjectionMatrix();
        thumbRenderer.render(tScene, cam);
        item.thumb = thumbRenderer.domElement.toDataURL('image/png');
        tScene.remove(obj);
      }
      // подставим миниатюры в уже отрисованное меню
      if (panelBody) panelBody.querySelectorAll('button[data-key]').forEach((b) => {
        const it = CATALOG.find((c) => c.key === b.dataset.key);
        if (it && it.thumb) { b.style.backgroundImage = 'url(' + it.thumb + ')'; b.querySelector('.bIcoFallback') && b.querySelector('.bIcoFallback').remove(); }
      });
    } catch (e) { console.warn('[build] thumbs failed', e); }
  }

  // ── меню ──
  function buildPanel() {
    if (panelEl) return;
    panelEl = document.createElement('div');
    panelEl.id = 'buildPanel';
    panelEl.style.cssText = 'position:fixed;left:64px;top:120px;z-index:24;width:236px;display:none;'
      + 'background:linear-gradient(180deg,rgba(26,34,46,.97),rgba(18,24,33,.97));border:1px solid #34425a;border-radius:12px;'
      + 'box-shadow:0 10px 30px rgba(0,0,0,.45);padding:10px 11px 11px;color:#dfe7f0;font:12px/1.35 system-ui,sans-serif;';
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;';
    head.innerHTML = '<span style="font-weight:700;letter-spacing:.2px">🏠 Строительство</span>';
    const close = document.createElement('button');
    close.textContent = '✕'; close.style.cssText = 'background:none;border:none;color:#9fb0c4;font-size:14px;cursor:pointer;line-height:1;';
    close.onclick = () => toggle(false);
    head.appendChild(close);
    panelBody = document.createElement('div');
    const sections = [['def', 'Оборона'], ['eco', 'Экономика'], ['state', 'Власть']];
    for (const [cat, label] of sections) {
      const items = CATALOG.filter((c) => c.cat === cat); if (!items.length) continue;
      const h = document.createElement('div'); h.textContent = label;
      h.style.cssText = 'font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:#7d8ea3;margin:6px 0 5px;';
      panelBody.appendChild(h);
      const grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(2,1fr);gap:7px;';
      for (const item of items) {
        const b = document.createElement('button');
        b.dataset.key = item.key; b.title = item.name + ' · ' + itemStats(item);
        b.style.cssText = 'aspect-ratio:1.15;border:1px solid #33415a;border-radius:8px;background:#1c2533 center/72% no-repeat;cursor:pointer;padding:0;position:relative;transition:border-color .12s,transform .08s;';
        if (item.thumb) b.style.backgroundImage = 'url(' + item.thumb + ')';
        else { const f = document.createElement('span'); f.className = 'bIcoFallback'; f.textContent = item.icon || '🏚'; f.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:18px;opacity:.5'; b.appendChild(f); }
        const cap = document.createElement('span');
        cap.textContent = item.name;
        cap.style.cssText = 'position:absolute;left:3px;right:3px;bottom:2px;font-size:9px;font-weight:700;color:#dfe7f0;text-shadow:0 1px 2px #000;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
        b.appendChild(cap);
        b.onmouseenter = () => { if (selected !== item) b.style.borderColor = '#5b86c8'; };
        b.onmouseleave = () => { if (selected !== item) b.style.borderColor = '#33415a'; };
        b.onclick = () => selectItem(item, b);
        grid.appendChild(b);
      }
      panelBody.appendChild(grid);
    }
    const hint = document.createElement('div');
    hint.id = 'buildHint';
    hint.style.cssText = 'margin-top:9px;font-size:10.5px;color:#8aa0b8;min-height:14px;';
    hint.textContent = 'Выбери здание';
    panelEl.appendChild(head); panelEl.appendChild(panelBody); panelEl.appendChild(hint);
    document.body.appendChild(panelEl);
  }
  function setHint(t) { const h = document.getElementById('buildHint'); if (h) h.textContent = t; }

  function selectItem(item, btn) {
    if (panelBody) panelBody.querySelectorAll('button[data-key]').forEach((b) => { b.style.borderColor = '#33415a'; b.style.transform = ''; });
    if (selected === item) { selected = null; exitPlacing(); setHint('Выбери здание'); return; }
    selected = item;
    if (btn) { btn.style.borderColor = '#7fb0ff'; btn.style.transform = 'scale(.94)'; }
    enterPlacing();
    setHint(item.name + ': ' + itemStats(item));
  }

  // ── подсветка валидных хексов ──
  const FLAT_HEX = (() => { const g = new T.CircleGeometry(1, 6); g.rotateX(-Math.PI / 2); return g; })();   // радиус 1 → масштабируем под хекс
  const surfY = (gx, gz, fallback) => (typeof getTerrainHeight === 'function') ? getTerrainHeight(gx, gz) : fallback;
  let hexR = 0.8;   // радиус хекса (по spacing) — для маркеров и снапа
  function computeHexR() {
    const hb = window.HEXBUILD; if (!hb || !hb.hexes.length) return;
    const a = hb.hexes[0]; let best = 1e9;
    for (let i = 1; i < Math.min(hb.hexes.length, 3000); i++) { const b = hb.hexes[i], d = Math.hypot(a.gx - b.gx, a.gz - b.gz); if (d > 0.01 && d < best) best = d; }
    if (best < 1e8) hexR = best * 0.5;   // inradius
  }
  // владелец хекса = владелец ближайшего города (Voronoi-регион игры). Строить только на своей территории.
  function ownerOfHex(gx, gz) {
    if (typeof cities === 'undefined' || !cities.length) return null;
    let best = null, bd = Infinity;
    for (const c of cities) { const dx = gx - c.gx, dz = gz - c.gz, dd = dx * dx + dz * dz; if (dd < bd) { bd = dd; best = c; } }
    return best ? best.owner : null;
  }
  const isMine = (h) => (typeof OWNER === 'undefined') ? true : ownerOfHex(h.gx, h.gz) === OWNER.PLAYER;
  function controllingCityForBuildHex(h) {
    if (!h || typeof cities === 'undefined') return null;
    if (h.parentIdx != null) return cities[h.parentIdx] || null;
    const found = nearestCityForHex(h);
    return found ? found.city : null;
  }
  function isOccupiedBuildHex(h) {
    const c = controllingCityForBuildHex(h);
    return !!c && c.owner === playerId() && !!c.occ;
  }
  function isOwnBuildHex(item, h) {
    if (!item || (item.role !== 'shipyard' && item.role !== 'airport') || h.parentIdx == null) return isMine(h) && !isOccupiedBuildHex(h);
    const c = (typeof cities !== 'undefined') ? cities[h.parentIdx] : null;
    return !!c && c.owner === playerId() && !c.occ && !c.isShipyard && !c.isAirport;
  }
  let territoryHexes = null;                 // кэш своих хексов под застройку (на сессию размещения)
  function sourceHexesForItem(item) {
    const hb = window.HEXBUILD;
    if (!hb) return [];
    return item && (item.role === 'shipyard' || item.role === 'airport') ? (hb.cityNeighbors || []) : hb.hexes;
  }
  function computeTerritory() {
    const hb = window.HEXBUILD;
    territoryHexes = hb ? sourceHexesForItem(selected).filter((h) => isValidHexForItem(selected, h)) : [];
  }
  function nearestCityForHex(h) {
    if (!h || typeof cities === 'undefined' || !cities.length) return null;
    let best = null, bd = Infinity;
    for (const c of cities) {
      if (!c || c.isShipyard || c.isAirport) continue;
      const dx = h.gx - c.gx, dz = h.gz - c.gz, dd = dx * dx + dz * dz;
      if (dd < bd) { bd = dd; best = c; }
    }
    return best ? { city: best, d: Math.sqrt(bd) } : null;
  }
  function waterDirAt(gx, gz) {
    if (typeof tiles === 'undefined' || !tiles) return null;
    const cx = Math.round(gx), cz = Math.round(gz);
    let vx = 0, vz = 0, wsum = 0;
    for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
      if (!dx && !dz) continue;
      const t = tiles[cx + dx] && tiles[cx + dx][cz + dz];
      if (!t || !t.isWater || t.terrain !== 'sea') continue;
      const d = Math.hypot(dx, dz);
      if (d > 4.25) continue;
      const w = 1 / Math.max(0.6, d);
      vx += dx * w; vz += dz * w; wsum += w;
    }
    const mag = Math.hypot(vx, vz);
    return (wsum > 0 && mag > 1e-4) ? { x: vx / mag, z: vz / mag } : null;
  }
  function seaDirForHex(h) {
    if (h && h.seaDir) return { x: h.seaDir[0], z: h.seaDir[1] };
    return h ? waterDirAt(h.gx, h.gz) : null;
  }
  function shipyardParentForHex(h) {
    if (!h || h.parentIdx == null || !h.seaDir || !isOwnBuildHex({ role: 'shipyard' }, h)) return null;
    const c = (typeof cities !== 'undefined') ? cities[h.parentIdx] : null;
    if (!c || c.isShipyard || c.isAirport) return null;
    if (c.owner !== playerId() || c.occ) return null;
    if (typeof hasYardNear === 'function' && hasYardNear(c, true)) return null;
    return c;
  }
  function airportParentForHex(h) {
    if (!h || h.parentIdx == null || !isOwnBuildHex({ role: 'airport' }, h)) return null;
    const c = (typeof cities !== 'undefined') ? cities[h.parentIdx] : null;
    if (!c || c.isShipyard || c.isAirport) return null;
    if (c.owner !== playerId() || c.occ) return null;
    if (typeof hasYardNear === 'function' && hasYardNear(c, false)) return null;
    return c;
  }
  function isValidHexForItem(item, h) {
    const hb = window.HEXBUILD;
    if (!item || !h || !hb || hb.occupied.has(h.key) || !isOwnBuildHex(item, h)) return false;
    if (item.role === 'shipyard') return !!shipyardParentForHex(h);
    if (item.role === 'airport') return !!airportParentForHex(h);
    return true;
  }
  function configureShipyardVisual(obj, h, sc) {
    if (!obj || !h) return;
    const dir = seaDirForHex(h) || { x: 0, z: 1 };
    obj.rotation.y = Math.atan2(dir.x, dir.z);
    const invScale = 1 / Math.max(0.001, sc);
    const baseY = surfY(h.gx, h.gz, h.top);
    const waterY = (typeof WATER_Y_SHIP !== 'undefined' ? WATER_Y_SHIP : -0.05) + 0.02;
    const dockY = (waterY - baseY) * invScale;
    const dockOut = Math.max(0.9, hexR * 1.62 * invScale);
    const shoreIn = Math.max(0.18, hexR * 0.32 * invScale);
    obj.traverse((o) => {
      if (!o.userData || !o.userData.shipyardPart) return;
      if (o.userData.shipyardPart === 'docks') {
        o.position.set(0, dockY, dockOut);
        o.rotation.y = Math.PI * 1.5;
        o.scale.set(1.18, 2, 3.4);
      } else if (o.userData.shipyardPart === 'workshop') {
        o.position.set(0, 0, -shoreIn);
        o.rotation.y = 0;
        o.scale.set(1.05, 1.05, 1.05);
      }
    });
  }
  function attachShipyardToParent(h) {
    const parent = shipyardParentForHex(h);
    if (!parent) return null;
    parent.hasShipyard = true;
    parent.shipyardHexKey = h.key;
    parent.shipyardGX = h.gx;
    parent.shipyardGZ = h.gz;
    if (typeof MP !== 'undefined' && MP.localSim && typeof LOCALSIM !== 'undefined' && LOCALSIM && LOCALSIM.cities && LOCALSIM.cities[parent.idx]) {
      LOCALSIM.cities[parent.idx].hasShipyard = true;
      LOCALSIM.cities[parent.idx].shipyardGX = h.gx;
      LOCALSIM.cities[parent.idx].shipyardGZ = h.gz;
    }
    if (typeof updatePanel === 'function') updatePanel();
    if (typeof toast === 'function' && typeof CITY_NAMES !== 'undefined') toast('⚓ Построена верфь у «' + CITY_NAMES[parent.idx] + '»');
    return parent;
  }
  function attachAirportToParent(h) {
    const parent = airportParentForHex(h);
    if (!parent) return null;
    parent.hasAirport = true;
    parent.airportHexKey = h.key;
    parent.airportGX = h.gx;
    parent.airportGZ = h.gz;
    if (typeof MP !== 'undefined' && MP.localSim && typeof LOCALSIM !== 'undefined' && LOCALSIM && LOCALSIM.cities && LOCALSIM.cities[parent.idx]) {
      LOCALSIM.cities[parent.idx].hasAirport = true;
      LOCALSIM.cities[parent.idx].airportGX = h.gx;
      LOCALSIM.cities[parent.idx].airportGZ = h.gz;
    }
    if (typeof updatePanel === 'function') updatePanel();
    if (typeof toast === 'function' && typeof CITY_NAMES !== 'undefined') toast('✈ Построен аэропорт у «' + CITY_NAMES[parent.idx] + '»');
    return parent;
  }

  function buildHighlight() {
    const hb = window.HEXBUILD; if (!hb || highlightIM) return;
    computeHexR();
    if (!territoryHexes) computeTerritory();
    const free = territoryHexes.filter((h) => isValidHexForItem(selected, h));
    const s = hexR * 0.92;
    const mat = new T.MeshBasicMaterial({ color: 0x18e0ff, transparent: true, opacity: 0.6, depthWrite: false, depthTest: false });
    highlightIM = new T.InstancedMesh(FLAT_HEX, mat, hb.hexes.length);
    highlightIM.userData.perfGroup = 'build-ui'; highlightIM.renderOrder = 990; highlightIM.frustumCulled = false;
    const dm = new T.Object3D();
    let n = 0;
    highlightIM.userData.map = [];
    for (const h of free) { dm.position.set(h.gx, surfY(h.gx, h.gz, h.top) + 0.08, h.gz); dm.scale.set(s, 1, s); dm.updateMatrix(); highlightIM.setMatrixAt(n, dm.matrix); highlightIM.userData.map[n] = h; n++; }
    highlightIM.count = n;
    highlightIM.instanceMatrix.needsUpdate = true;
    scene.add(highlightIM);
    // hover-маркер (ярче)
    const hmat = new T.MeshBasicMaterial({ color: 0xeaffff, transparent: true, opacity: 0.78, depthWrite: false, depthTest: false });
    hoverMesh = new T.Mesh(FLAT_HEX, hmat); hoverMesh.renderOrder = 991; hoverMesh.visible = false; hoverMesh.scale.set(hexR * 0.98, 1, hexR * 0.98);
    hoverMesh.userData.perfGroup = 'build-ui';
    scene.add(hoverMesh);
  }
  function rebuildHighlight() { if (highlightIM) { scene.remove(highlightIM); highlightIM.geometry = highlightIM.geometry; highlightIM = null; } if (hoverMesh) { scene.remove(hoverMesh); hoverMesh = null; } buildHighlight(); }

  function enterPlacing() {
    territoryHexes = null;                   // пересчитать свою территорию (владение могло измениться)
    if (highlightIM) rebuildHighlight(); else buildHighlight();
    if (highlightIM) highlightIM.visible = true;
    makeGhost();
  }
  function exitPlacing() {
    if (highlightIM) highlightIM.visible = false;
    if (hoverMesh) hoverMesh.visible = false;
    if (ghost) ghost.visible = false;
    hoverHex = null;
  }

  function makeGhost() {
    if (ghost) { scene.remove(ghost); ghost = null; }
    if (!selected || !models[selected.key]) return;
    ghost = models[selected.key].clone(true);
    ghost.traverse((o) => { if (o.isMesh && o.material) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.55; o.material.depthWrite = false; } });
    const sc = modelScale(selected); ghost.scale.set(sc, sc, sc);
    ghost.visible = false; ghost.userData.perfGroup = 'build-ui';
    scene.add(ghost);
  }

  // ── снап экранной точки к хексу С УЧЁТОМ ВЫСОТЫ (иначе параллакс — приходится целиться в край) ──
  const _ray = new T.Raycaster(), _ndc = new T.Vector2(), _pl = new T.Plane(new T.Vector3(0, 1, 0), 0), _hit = new T.Vector3();
  function pointAtHeight(cx, cy, y) {
    _ndc.x = (cx / innerWidth) * 2 - 1; _ndc.y = -(cy / innerHeight) * 2 + 1;
    _ray.setFromCamera(_ndc, camera);
    _pl.constant = -y;                       // плоскость y = высота хекса
    return _ray.ray.intersectPlane(_pl, _hit) ? _hit : null;
  }
  function snapHex(gx, gz) {
    const hb = window.HEXBUILD; if (!hb) return null;
    const r2 = (hexR * 1.05) * (hexR * 1.05);
    let best = null, bestD = r2;
    const arr = highlightIM && highlightIM.userData.map ? highlightIM.userData.map.slice(0, highlightIM.count) : (territoryHexes || sourceHexesForItem(selected));
    for (const h of arr) { if (!isValidHexForItem(selected, h)) continue; const dx = h.gx - gx, dz = h.gz - gz, d = dx * dx + dz * dz; if (d < bestD) { bestD = d; best = h; } }
    return best;
  }
  // экран → хекс: ray-march к поверхности террейна (высоту берём из getTerrainHeight в точке), потом снап.
  // Не зависит от первого снапа → параллакс высоты не ломает попадание.
  function pickHex(cx, cy) {
    let p = pointAtHeight(cx, cy, 0); if (!p) return null;
    let px = p.x, pz = p.z;
    for (let i = 0; i < 4; i++) {
      const y = (typeof getTerrainHeight === 'function') ? getTerrainHeight(px, pz) : 0;
      const np = pointAtHeight(cx, cy, y); if (!np) break;
      if (Math.abs(np.x - px) < 0.03 && Math.abs(np.z - pz) < 0.03) { px = np.x; pz = np.z; break; }
      px = np.x; pz = np.z;
    }
    return snapHex(px, pz);
  }
  function onMove(e) {
    if (!selected) return;
    const h = pickHex(e.clientX, e.clientY);
    hoverHex = h;
    if (h && hoverMesh) { hoverMesh.position.set(h.gx, surfY(h.gx, h.gz, h.top) + 0.14, h.gz); hoverMesh.visible = true; }
    else if (hoverMesh) hoverMesh.visible = false;
    if (h && ghost) {
      const sc = modelScale(selected); ghost.scale.set(sc, sc, sc); ghost.position.set(h.gx, surfY(h.gx, h.gz, h.top), h.gz);
      if (selected && selected.role === 'shipyard') configureShipyardVisual(ghost, h, sc);
      ghost.visible = true;
    }
    else if (ghost) ghost.visible = false;
  }
  function onClickCapture(e) {
    if (!selected || e.button !== 0) return;
    const h = pickHex(e.clientX, e.clientY) || hoverHex;
    if (!h) return;
    place(selected, h);
    e.stopImmediatePropagation(); e.preventDefault();
  }

  function place(item, h) {
    const hb = window.HEXBUILD; if (!hb || !models[item.key]) return;
    if (isOccupiedBuildHex(h)) { setHint('На оккупированной территории строить нельзя'); return; }
    if (!isValidHexForItem(item, h)) return;
    const owner = playerId();
    if (!spendGold(owner, item.cost || 0)) { setHint('Не хватает голды: нужно ' + (item.cost || 0)); return; }
    const obj = models[item.key].clone(true);
    obj.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      if (Array.isArray(o.material)) o.material = o.material.map((m) => cloneOwnerMaterial(m, owner));
      else o.material = cloneOwnerMaterial(o.material, owner);
    });
    const sc = modelScale(item); obj.scale.set(sc, sc, sc);
    const y = surfY(h.gx, h.gz, h.top);
    obj.position.set(h.gx, y, h.gz);
    obj.rotation.y = 0;
    let parentCity = null;
    if (item.role === 'shipyard') {
      configureShipyardVisual(obj, h, sc);
      parentCity = attachShipyardToParent(h);
      if (!parentCity) {
        if (obj.parent) obj.parent.remove(obj);
        addResource(owner, 'gold', item.cost || 0);
        return;
      }
    } else if (item.role === 'airport') {
      parentCity = attachAirportToParent(h);
      if (!parentCity) {
        if (obj.parent) obj.parent.remove(obj);
        addResource(owner, 'gold', item.cost || 0);
        return;
      }
    }
    // 🏰 крепость (спец=def) занимает своими стенами/башнями соседние хексы — верфь/аэропорт
    //    на соседнем хексе оказывались ПОД стеной. Втягиваем модель внутрь двора, ближе к
    //    главному зданию (радиус двора ≈ между кепом ~0.48 и внутренней стеной крепости ~1.55).
    //    Двигаем только визуальную модель; логический хекс (h/gx/gz) для сима и дорог не трогаем.
    //    У верфи док вынесен в море отдельным оффсетом → он по-прежнему достаёт до воды,
    //    в двор уходит только береговая часть.
    if (parentCity) {
      const dx = parentCity.gx - h.gx, dz = parentCity.gz - h.gz;
      const d = Math.hypot(dx, dz) || 1;
      const COURTYARD_R = 1.05;
      const pull = Math.max(0, d - COURTYARD_R);
      obj.position.x = h.gx + (dx / d) * pull;
      obj.position.z = h.gz + (dz / d) * pull;
    }
    obj.userData.perfGroup = 'buildings';
    // 🌗 здание — динамический кастер: тень из ОТДЕЛЬНОЙ карты (attachDynShadowCaster ниже), статику не трогаем
    if (!placedGroup) { placedGroup = new T.Group(); placedGroup.userData.perfGroup = 'buildings'; scene.add(placedGroup); }
    placedGroup.add(obj);
    placedBuildings.push({ item, obj, key: h.key, owner, gx: h.gx, gz: h.gz, y, cd: 0, parentCity });
    hb.occupied.add(h.key);
    if (typeof attachDynShadowCaster === 'function') attachDynShadowCaster(obj);   // 🌗 в динамическую карту теней + её перепечь (дёшево)
    rebuildHighlight();           // убрать занятый хекс из подсветки
    if (highlightIM) highlightIM.visible = true;
    setHint('Поставлено: ' + item.name + ' · ' + itemStats(item));
  }

  function syncBuildingOwner(b) {
    const next = ownerOfHex(b.gx, b.gz);
    if (next == null || next === b.owner) return;
    b.owner = next;
    b.cd = 0;
    recolorObject(b.obj, next);
  }

  function enemyTargets(owner) {
    const out = [];
    const hostile = (o) => owner !== o && (typeof atWar !== 'function' || atWar(owner, o));
    const gy = (x, z) => (typeof getTerrainHeight === 'function') ? getTerrainHeight(x, z) : 0;
    const guest = (typeof MP !== 'undefined' && MP && MP.ghosts);
    if (guest) {
      for (const g of MP.ghosts.values()) {
        if ((g.count || 0) < 0.5 || !hostile(g.owner)) continue;
        const p = g.group.position;
        const y = g.kind === 2 ? (typeof PLANE_ALT !== 'undefined' ? PLANE_ALT : 4.5)
          : (g.kind === 1 ? ((typeof WATER_Y_SHIP !== 'undefined' ? WATER_Y_SHIP : 0) + 0.2) : gy(p.x, p.z) + 0.3);
        out.push({ x: p.x, z: p.z, y, ref: g, kind: 'ghost' });
      }
      return out;
    }
    if (typeof squads !== 'undefined') for (const s of squads) if (s.fcount >= 0.5 && hostile(s.owner)) out.push({ x: s.pos.x, z: s.pos.z, y: gy(s.pos.x, s.pos.z) + 0.3, ref: s, kind: 'squad' });
    if (typeof ships !== 'undefined') for (const s of ships) if (s.hp > 0 && hostile(s.owner)) out.push({ x: s.pos.x, z: s.pos.z, y: (typeof WATER_Y_SHIP !== 'undefined' ? WATER_Y_SHIP : 0) + 0.2, ref: s, kind: 'ship' });
    if (typeof planes !== 'undefined') for (const p of planes) if (p.hp > 0 && hostile(p.owner)) out.push({ x: p.pos.x, z: p.pos.z, y: (typeof PLANE_ALT !== 'undefined' ? PLANE_ALT : 4.5), ref: p, kind: 'plane' });
    return out;
  }
  function updateTower(b, dt) {
    const it = b.item, cd = 1 / Math.max(0.1, it.attackSpeed || 0.5);
    b.cd = (b.cd || 0) + dt;
    if (b.cd < cd || typeof TowerShot === 'undefined') return;
    let best = null, bd = (it.range || 1) * (it.range || 1);
    for (const t of enemyTargets(b.owner)) {
      const dx = b.gx - t.x, dz = b.gz - t.z, dd = dx * dx + dz * dz;
      if (dd < bd) { bd = dd; best = t; }
    }
    if (!best) return;
    b.cd = 0;
    const from = { x: b.gx, y: b.y + 1.0, z: b.gz };
    missiles.push(new TowerShot(b.owner, from, {
      kind: best.kind,
      ref: best.ref,
      x: best.x,
      y: best.y,
      z: best.z,
      dmg: Math.max(1, Math.round(it.damage || 1)),
    }));
  }
  function updateMapBuildings(dt) {
    if (!dt || dt <= 0 || !placedBuildings.length || gameOver) return;
    for (const b of placedBuildings) {
      syncBuildingOwner(b);
      const it = b.item;
      if (it.role === 'tower') updateTower(b, dt);
      else {
        addResource(b.owner, 'gold', (it.goldRate || 0) * dt);
        addResource(b.owner, 'polit', (it.politRate || 0) * dt);
        addResource(b.owner, 'manpower', (it.manpowerRate || 0) * dt);
      }
    }
  }
  function resetMapBuildings() {
    const hb = window.HEXBUILD;
    for (const b of placedBuildings) {
      if (b && b.obj && b.obj.parent) b.obj.parent.remove(b.obj);
      if (hb && hb.occupied && b && b.key) hb.occupied.delete(b.key);
      if (b && b.parentCity) {
        if (b.item && b.item.role === 'shipyard') {
          b.parentCity.hasShipyard = false;
          delete b.parentCity.shipyardHexKey;
          delete b.parentCity.shipyardGX;
          delete b.parentCity.shipyardGZ;
        } else if (b.item && b.item.role === 'airport') {
          b.parentCity.hasAirport = false;
          delete b.parentCity.airportHexKey;
          delete b.parentCity.airportGX;
          delete b.parentCity.airportGZ;
        }
      }
    }
    placedBuildings.length = 0;
    if (typeof markDynShadowsDirty === 'function') markDynShadowsDirty();   // 🌗 здания снесены → перепечь только динамическую карту
    if (highlightIM) rebuildHighlight();
  }
  window.updateMapBuildings = updateMapBuildings;
  window.resetMapBuildings = resetMapBuildings;

  // ── открытие/закрытие ──
  function toggle(on) {
    if (!panelEl) buildPanel();
    const show = on == null ? (panelEl.style.display === 'none') : on;
    panelEl.style.display = show ? 'block' : 'none';
    const sb = document.getElementById('sbBuild'); if (sb) sb.classList.toggle('active', show);
    if (show) { ensureModels(); }
    else { selected = null; exitPlacing(); if (panelBody) panelBody.querySelectorAll('button[data-key]').forEach((b) => { b.style.borderColor = '#33415a'; b.style.transform = ''; }); }
  }

  // ── wiring ──
  function init() {
    const sb = document.getElementById('sbBuild');
    if (sb) sb.onclick = () => toggle();
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyB' && !/input|textarea/i.test((e.target && e.target.tagName) || '')) toggle();
      if (e.code === 'Escape' && selected) { selected = null; exitPlacing(); setHint('Выбери здание'); if (panelBody) panelBody.querySelectorAll('button[data-key]').forEach((b) => { b.style.borderColor = '#33415a'; b.style.transform = ''; }); }
    });
    const cv = (typeof renderer !== 'undefined' && renderer && renderer.domElement) ? renderer.domElement : window;
    cv.addEventListener('pointermove', onMove, { passive: true });
    cv.addEventListener('click', onClickCapture, true);   // capture → перехват до игрового клика
  }
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', init); else init();
})();
