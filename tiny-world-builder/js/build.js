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
  // компактный каталог (как в рефе: Standard + Military)
  const CATALOG = [
    { key: 'home_A', file: 'building_home_A_green', name: 'Дом', cat: 'std' },
    { key: 'home_B', file: 'building_home_B_green', name: 'Дом II', cat: 'std' },
    { key: 'well', file: 'building_well_green', name: 'Колодец', cat: 'std' },
    { key: 'market', file: 'building_market_green', name: 'Рынок', cat: 'std' },
    { key: 'tavern', file: 'building_tavern_green', name: 'Таверна', cat: 'std' },
    { key: 'church', file: 'building_church_green', name: 'Церковь', cat: 'std' },
    { key: 'windmill', file: 'building_windmill_green', name: 'Мельница', cat: 'std' },
    { key: 'watermill', file: 'building_watermill_green', name: 'Вод. мельница', cat: 'std' },
    { key: 'lumbermill', file: 'building_lumbermill_green', name: 'Лесопилка', cat: 'std' },
    { key: 'mine', file: 'building_mine_green', name: 'Шахта', cat: 'std' },
    { key: 'blacksmith', file: 'building_blacksmith_green', name: 'Кузница', cat: 'std' },
    { key: 'barracks', file: 'building_barracks_green', name: 'Казармы', cat: 'mil' },
    { key: 'archeryrange', file: 'building_archeryrange_green', name: 'Тир', cat: 'mil' },
    { key: 'tower_A', file: 'building_tower_A_green', name: 'Башня', cat: 'mil' },
    { key: 'tower_B', file: 'building_tower_B_green', name: 'Башня II', cat: 'mil' },
    { key: 'tower_catapult', file: 'building_tower_catapult_green', name: 'Катапульта', cat: 'mil' },
  ];

  const models = {};            // key → THREE.Group (нормализованный, origin у основания)
  let ready = false, loading = false;
  let selected = null;          // выбранный каталог-итем (режим размещения)
  let placedGroup = null;       // контейнер для поставленных зданий
  let highlightIM = null, hoverMesh = null, ghost = null;
  let hoverHex = null;          // {gx,gz,top,key} под курсором
  let panelEl = null, panelBody = null;

  // ── цвет страны игрока: перекрашиваем зелёные (фракционные) пиксели KayKit-атласа в OWNER_COL ──
  function playerColorLinear() {
    let hex = 0x4c7ad8;
    try { if (typeof OWNER_COL !== 'undefined' && typeof OWNER !== 'undefined' && OWNER_COL[OWNER.PLAYER] != null) hex = OWNER_COL[OWNER.PLAYER]; } catch (e) {}
    const c = new T.Color(hex); if (T.sRGBEncoding && c.convertSRGBToLinear) c.convertSRGBToLinear();
    return c;
  }
  function applyOwnerColor(mat) {
    if (!mat || (mat.userData && mat.userData.__owned)) return;
    mat.userData = mat.userData || {}; mat.userData.__owned = true;
    const u = { value: playerColorLinear() };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uOwnerCol = u;
      sh.fragmentShader = 'uniform vec3 uOwnerCol;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        {
          float greenness = diffuseColor.g - max(diffuseColor.r, diffuseColor.b);
          float gm = smoothstep(0.03, 0.13, greenness);          // зелёные (фракционные) пиксели атласа
          if (gm > 0.001) {
            float lum = clamp(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
            vec3 tinted = uOwnerCol * (0.45 + lum * 1.05);        // цвет страны, сохраняя свет/тень крыши
            diffuseColor.rgb = mix(diffuseColor.rgb, tinted, gm);
          }
        }`);
    };
    mat.needsUpdate = true;
  }

  // ── загрузка моделей ──
  function loadOne(item) {
    return new Promise((res) => {
      new T.GLTFLoader().load(BASE + item.file + '.gltf', (g) => {
        const root = g.scene;
        root.updateWorldMatrix(true, true);
        // нормализуем: bbox → origin в центр основания, единичный масштаб по ширине хекса
        const box = new T.Box3().setFromObject(root);
        const size = new T.Vector3(); box.getSize(size);
        const center = new T.Vector3(); box.getCenter(center);
        const holder = new T.Group();
        root.position.set(-center.x, -box.min.y, -center.z);   // низ модели → y=0, центр по XZ
        root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; if (o.material) { o.material = o.material.clone(); o.material.metalness = 0; o.material.roughness = 0.9; applyOwnerColor(o.material); } } });
        holder.add(root);
        holder.userData.footprint = Math.max(size.x, size.z) || 1;   // ширина модели в её ед. → для масштаба под хекс
        models[item.key] = holder;
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
    const sections = [['std', 'Постройки'], ['mil', 'Военные']];
    for (const [cat, label] of sections) {
      const items = CATALOG.filter((c) => c.cat === cat); if (!items.length) continue;
      const h = document.createElement('div'); h.textContent = label;
      h.style.cssText = 'font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:#7d8ea3;margin:6px 0 5px;';
      panelBody.appendChild(h);
      const grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:6px;';
      for (const item of items) {
        const b = document.createElement('button');
        b.dataset.key = item.key; b.title = item.name;
        b.style.cssText = 'aspect-ratio:1;border:1px solid #33415a;border-radius:8px;background:#1c2533 center/86% no-repeat;cursor:pointer;padding:0;position:relative;transition:border-color .12s,transform .08s;';
        if (item.thumb) b.style.backgroundImage = 'url(' + item.thumb + ')';
        else { const f = document.createElement('span'); f.className = 'bIcoFallback'; f.textContent = '🏚'; f.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:18px;opacity:.5'; b.appendChild(f); }
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
    setHint('Кликни по подсвеченному хексу');
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
  let territoryHexes = null;                 // кэш своих хексов под застройку (на сессию размещения)
  function computeTerritory() { const hb = window.HEXBUILD; territoryHexes = hb ? hb.hexes.filter(isMine) : []; }

  function buildHighlight() {
    const hb = window.HEXBUILD; if (!hb || highlightIM) return;
    computeHexR();
    if (!territoryHexes) computeTerritory();
    const free = territoryHexes.filter((h) => !hb.occupied.has(h.key));
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
    buildHighlight();
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
    const arr = highlightIM && highlightIM.userData.map ? highlightIM.userData.map.slice(0, highlightIM.count) : (territoryHexes || hb.hexes);
    for (const h of arr) { if (hb.occupied.has(h.key)) continue; const dx = h.gx - gx, dz = h.gz - gz, d = dx * dx + dz * dz; if (d < bestD) { bestD = d; best = h; } }
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
    if (h && ghost) { const sc = modelScale(selected); ghost.scale.set(sc, sc, sc); ghost.position.set(h.gx, surfY(h.gx, h.gz, h.top), h.gz); ghost.visible = true; }
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
    const hb = window.HEXBUILD; if (!hb || hb.occupied.has(h.key) || !isMine(h) || !models[item.key]) return;
    const obj = models[item.key].clone(true);
    obj.traverse((o) => { if (o.isMesh && o.material) o.material = o.material; });   // делим материал (общий) — ок
    const sc = modelScale(item); obj.scale.set(sc, sc, sc);
    obj.position.set(h.gx, surfY(h.gx, h.gz, h.top), h.gz);
    obj.rotation.y = 0;
    obj.userData.perfGroup = 'buildings';
    if (!placedGroup) { placedGroup = new T.Group(); placedGroup.userData.perfGroup = 'buildings'; scene.add(placedGroup); }
    placedGroup.add(obj);
    hb.occupied.add(h.key);
    rebuildHighlight();           // убрать занятый хекс из подсветки
    if (highlightIM) highlightIM.visible = true;
    setHint('Поставлено: ' + item.name);
  }

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
