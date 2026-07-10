/* ── 🌫 fog.js — визуальный тёмный туман (WC3-look) ───────────────────────────
   Весь мир вне вижена затемнён и обесцвечен («ночь»); вижен = своя+союзная
   территория + свои отряды/корабли/самолёты (маска — та же математика, что на
   сервере: sim/vision.js через __WWCSim.vision, поверх КЛИЕНТСКОГО состояния —
   города/призраки, т.е. только легально видимых данных).
   Реализация: DataTexture GRID×GRID + инъекция в шейдеры материалов сцены
   (onBeforeCompile, r128: точка входа — dithering_fragment). Плавный лерп маски
   ~0.3с — мягкое «прожигание» тумана при движении армий. */
(function () {
  const T = (typeof T3 !== 'undefined') ? T3 : THREE;
  const G = (typeof GRID !== 'undefined') ? GRID : 256;
  const N = G * G;
  const LERP_T = 0.3;            // сек до полного проявления/затухания
  const CALC_EVERY = 0.4;        // период пересчёта целевой маски
  const PATCH_EVERY = 2.0;       // период до-патча новых материалов сцены
  let tex = null, cur = null, target = null, calcT = 0, patchT = 0, started = false;
  const uFog = { value: null }, uFogOn = { value: 0 };

  function ensureTex() {
    if (tex) return;
    cur = new Float32Array(N);            // текущее (лерпается)
    target = new Uint8Array(N);           // целевая маска 0/1
    const data = new Uint8Array(N);       // байтовый буфер текстуры
    tex = new T.DataTexture(data, G, G, T.LuminanceFormat !== undefined ? T.LuminanceFormat : T.RedFormat, T.UnsignedByteType);
    tex.magFilter = T.LinearFilter; tex.minFilter = T.LinearFilter;
    tex.wrapS = T.ClampToEdgeWrapping; tex.wrapT = T.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    uFog.value = tex;
  }

  // sim-подобный шим над клиентским состоянием: города + собственные призраки.
  // Данные только легально видимые → маску нельзя «расширить» читом дальше сервера.
  const shim = {
    K: null, time: 0, factions: 0, cities: null, squads: [], ships: [], planes: [],
    allied(a, b) { const k = a < b ? a + '_' + b : b + '_' + a; return (typeof relations !== 'undefined' && relations[k] === 'ally'); },
  };
  function computeTarget() {
    const V = window.__WWCSim && window.__WWCSim.vision; if (!V) return false;
    if (typeof cities === 'undefined' || !cities.length || typeof PLAYER === 'undefined') return false;
    shim.K = shim.K || {
      GRID: G,
      VISION_SQUAD: typeof VISION_SQUAD !== 'undefined' ? VISION_SQUAD : 6,
      VISION_SHIP: typeof VISION_SHIP !== 'undefined' ? VISION_SHIP : 8,
      VISION_PLANE: typeof VISION_PLANE !== 'undefined' ? VISION_PLANE : 12,
    };
    shim.factions = (typeof FACTIONS !== 'undefined') ? FACTIONS.length : 32;
    shim.cities = cities;
    shim.squads.length = 0; shim.ships.length = 0; shim.planes.length = 0;
    if (typeof MP !== 'undefined' && MP.ghosts) {
      for (const gh of MP.ghosts.values()) {
        if (!gh || gh.owner == null || !gh.group) continue;
        const p = gh.group.position, src = { owner: gh.owner, x: p.x, z: p.z };
        if (gh.kind === 1) shim.ships.push(src);
        else if (gh.kind === 2) shim.planes.push(src);
        else shim.squads.push(src);
      }
    }
    // и классические клиентские сущности (соло-легаси: ships/planes массивы)
    if (typeof ships !== 'undefined') for (const s of ships) if (s && s.pos) shim.ships.push({ owner: s.owner, x: s.pos.x, z: s.pos.z });
    if (typeof planes !== 'undefined') for (const p of planes) if (p && p.pos) shim.planes.push({ owner: p.owner, x: p.pos.x, z: p.pos.z });
    shim._voronoiN = shim._voronoiN;                     // вороной кэшируется внутри vision по числу городов
    V.computeVision(shim, PLAYER, target);
    return true;
  }

  // ── шейдер-инъекция: затемнение по маске (r128: dithering_fragment есть у всех) ──
  function patchMaterial(mat) {
    if (!mat || mat.userData && mat.userData.__fog) return;
    mat.userData = mat.userData || {};
    if (mat.userData.noFog) return;
    mat.userData.__fog = true;
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, r) => {
      if (prev) prev(sh, r);
      sh.uniforms.uFogTex = uFog; sh.uniforms.uFogOn = uFogOn;
      sh.vertexShader = 'varying vec2 vFogW;\n' + sh.vertexShader.replace('#include <project_vertex>',
        `#include <project_vertex>
        { vec4 _fw = vec4( transformed, 1.0 );
          #ifdef USE_INSTANCING
            _fw = instanceMatrix * _fw;
          #endif
          _fw = modelMatrix * _fw; vFogW = _fw.xz; }`);
      sh.fragmentShader = 'uniform sampler2D uFogTex; uniform float uFogOn; varying vec2 vFogW;\n'
        + sh.fragmentShader.replace('#include <dithering_fragment>',
        `#include <dithering_fragment>
        { float _fv = texture2D( uFogTex, ( vec2( vFogW.y, vFogW.x ) + 0.5 ) / ${G.toFixed(1)} ).r;   /* маска x-major → текстура (v=x,u=z) */
          _fv = mix( 1.0, smoothstep( 0.05, 0.85, _fv ), uFogOn );
          gl_FragColor.rgb = mix( gl_FragColor.rgb * vec3( 0.30, 0.34, 0.45 ), gl_FragColor.rgb, _fv ); }`);
    };
    mat.needsUpdate = true;
  }
  function patchScene() {
    if (typeof scene === 'undefined' || !scene) return;
    if (typeof cloudList !== 'undefined') for (const c of cloudList) c.traverse((o) => { o.userData.noFog = true; });   // ☁ облака не тонируем
    scene.traverse((o) => {
      if (!o.isMesh && !o.isInstancedMesh) return;
      if (o.userData && o.userData.noFog) return;
      const m = o.material; if (!m) return;
      if (Array.isArray(m)) m.forEach(patchMaterial); else patchMaterial(m);
    });
  }

  // главный тик: целевая маска (0.4с) + лерп текстуры (каждый кадр) + до-патч сцены (2с)
  function fogUpdate(dt) {
    if (typeof scene === 'undefined' || typeof cities === 'undefined' || !cities.length) return;
    ensureTex();
    calcT -= dt; patchT -= dt;
    if (calcT <= 0) { if (computeTarget()) { calcT = CALC_EVERY; if (!started) { started = true; cur.set(target); uFogOn.value = 1; } } }
    if (patchT <= 0) { patchScene(); patchT = PATCH_EVERY; }
    if (!started) return;
    const k = Math.min(1, (dt || 0.016) / LERP_T);
    const data = tex.image.data;
    let dirty = false;
    for (let i = 0; i < N; i++) {
      const t = target[i], c = cur[i];
      if (c !== t) { const nc = c + (t - c) * k; cur[i] = Math.abs(nc - t) < 0.004 ? t : nc; }
      const b = (cur[i] * 255) | 0;
      if (data[i] !== b) { data[i] = b; dirty = true; }
    }
    if (dirty) tex.needsUpdate = true;
  }

  window.fogUpdate = fogUpdate;
  window.FOG = { get tex() { return tex; }, uFogOn, patchScene, computeTarget, _shim: shim };
})();
