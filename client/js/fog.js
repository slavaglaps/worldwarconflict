/* ── 🌫 fog.js — туман войны, пост-процесс (WC3-look) ─────────────────────────
   Вариант A: сцена рендерится в RenderTarget (+depth), затем один fullscreen-pass
   по depth-буферу восстанавливает мировую XZ каждого пикселя, сэмплит vision-
   текстуру и затемняет/обесцвечивает всё вне вижена РАВНОМЕРНО (террейн, декор,
   горы, города, вода — нечему «выпадать», в отличие от пер-материальных патчей).
   Маска — та же математика, что на сервере (sim/vision.js через __WWCSim.vision),
   поверх ТОЛЬКО легально видимого клиентом состояния (города + свои призраки).
   Плавный лерп маски ~0.3с — мягкое «прожигание»; шум по времени — «клубление». */
(function () {
  const T = (typeof T3 !== 'undefined') ? T3 : THREE;
  const G = (typeof GRID !== 'undefined') ? GRID : 256;
  const N = G * G;
  const LERP_T = 0.3;            // сек до полного проявления/затухания
  const CALC_EVERY = 0.4;        // период пересчёта целевой маски
  const BLUR_R = 2;              // радиус размытия маски (тайлы) — мягкая полутень на границе
  const BLUR_PASSES = 2;         // 2 прохода box-blur ≈ гаусс — без «лесенки» по текселям
  let tex = null, prevTex = null, target = null, raw = null, _tmpA = null, _tmpB = null, calcT = 0, started = false;
  let blend = 1, animating = false;

  function ensureTex() {
    if (tex) return;
    target = new Float32Array(N);    // размытая цель (0..1)
    raw = new Uint8Array(N);         // бинарная маска из computeVision
    _tmpA = new Float32Array(N); _tmpB = new Float32Array(N);
    tex = new T.DataTexture(new Uint8Array(N), G, G, T.LuminanceFormat !== undefined ? T.LuminanceFormat : T.RedFormat, T.UnsignedByteType);
    prevTex = new T.DataTexture(new Uint8Array(N), G, G, T.LuminanceFormat !== undefined ? T.LuminanceFormat : T.RedFormat, T.UnsignedByteType);
    tex.magFilter = T.LinearFilter; tex.minFilter = T.LinearFilter;
    tex.wrapS = T.ClampToEdgeWrapping; tex.wrapT = T.ClampToEdgeWrapping;
    prevTex.magFilter = T.LinearFilter; prevTex.minFilter = T.LinearFilter;
    prevTex.wrapS = T.ClampToEdgeWrapping; prevTex.wrapT = T.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    prevTex.needsUpdate = true;
  }

  // сепарабельный box-blur (окно 2R+1, скользящая сумма — O(N)); src/dst: Float32Array
  function blurAxis(src, dst, horizontal) {
    const R = BLUR_R, W = 2 * R + 1;
    for (let a = 0; a < G; a++) {
      let sum = 0;
      const idx = (b) => horizontal ? (a * G + b) : (b * G + a);
      for (let b = -R; b <= R; b++) sum += src[idx(Math.max(0, Math.min(G - 1, b)))];
      for (let b = 0; b < G; b++) {
        dst[idx(b)] = sum / W;
        const add = Math.min(G - 1, b + R + 1), del = Math.max(0, b - R);
        sum += src[idx(add)] - src[idx(del)];
      }
    }
  }
  function blurMask() {
    for (let i = 0; i < N; i++) _tmpA[i] = raw[i];
    for (let p = 0; p < BLUR_PASSES; p++) { blurAxis(_tmpA, _tmpB, true); blurAxis(_tmpB, _tmpA, false); }
    target.set(_tmpA);
  }

  // sim-подобный шим над клиентским состоянием: города + собственные призраки.
  const shim = {
    K: null, time: 0, factions: 0, cities: null, squads: [], ships: [], planes: [], towers: [],
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
      VISION_TOWER: typeof VISION_TOWER !== 'undefined' ? VISION_TOWER : 9,
      // без этих двух computeVision брал coastRadius=0 → полоса моря у берега НЕ раскрывалась в тумане
      VISION_COAST: typeof VISION_COAST !== 'undefined' ? VISION_COAST : 0,
      VISION_COAST_SEARCH: typeof VISION_COAST_SEARCH !== 'undefined' ? VISION_COAST_SEARCH : 1,
    };
    shim.factions = (typeof FACTIONS !== 'undefined') ? FACTIONS.length : 32;
    shim.cities = cities;
    shim.squads.length = 0; shim.ships.length = 0; shim.planes.length = 0; shim.towers.length = 0;
    // 🗼 башни из меню строительства — «глаза» на границе
    if (window.MAP_BUILDINGS) for (const b of window.MAP_BUILDINGS)
      if (b && b.item && b.item.role === 'tower') shim.towers.push({ owner: b.owner, x: b.gx, z: b.gz });
    if (typeof MP !== 'undefined' && MP.ghosts) {
      for (const gh of MP.ghosts.values()) {
        if (!gh || gh.owner == null || !gh.group) continue;
        const p = gh.group.position, src = { owner: gh.owner, x: p.x, z: p.z };
        if (gh.kind === 1) shim.ships.push(src);
        else if (gh.kind === 2) shim.planes.push(src);
        else shim.squads.push(src);
      }
    }
    if (typeof ships !== 'undefined') for (const s of ships) if (s && s.pos) shim.ships.push({ owner: s.owner, x: s.pos.x, z: s.pos.z });
    if (typeof planes !== 'undefined') for (const p of planes) if (p && p.pos) shim.planes.push({ owner: p.owner, x: p.pos.x, z: p.pos.z });
    const shared = typeof MP !== 'undefined' && MP.localSim && window.__LOCAL_VISION_MASK;
    if (shared && shared.length === raw.length) raw.set(shared);
    else V.computeVision(shim, PLAYER, raw);
    // UI использует реальную разведку отдельно от _fog: туториал может снять
    // туман целиком, но это не должно показывать плашки всех городов на карте.
    for (const c of cities) {
      const x = Math.round(c.gx), z = Math.round(c.gz);
      c._activelyScouted = x >= 0 && z >= 0 && x < G && z < G && raw[x * G + z] === 1;
    }
    blurMask();                                    // бинарная маска → мягкая полутень (без «лесенки»)
    return true;
  }

  // обновление маски + лерп текстуры (зовётся из loop каждый кадр)
  function fogUpdate(dt) {
    if (typeof cities === 'undefined' || !cities.length) return;
    ensureTex();
    calcT -= dt;
    if (calcT <= 0) {
      if (computeTarget()) {
        calcT = CALC_EVERY;
        const next = tex.image.data, prev = prevTex.image.data, oldBlend = blend;
        for (let i = 0; i < N; i++) {
          const current = started ? Math.round(prev[i] + (next[i] - prev[i]) * oldBlend) : Math.round(target[i] * 255);
          prev[i] = current;
          next[i] = Math.round(target[i] * 255);
        }
        prevTex.needsUpdate = true; tex.needsUpdate = true;
        started = true; blend = 0; animating = true;
      }
    }
    if (!started || !animating) return;
    blend = Math.min(1, blend + (dt || 0.016) / LERP_T);
    animating = blend < 1;
  }

  // ── пост-процесс: сцена → RT(+depth) → fullscreen-затемнение по vision ──
  let rt = null, postScene = null, postCam = null, postMat = null, _w = 0, _h = 0;
  let webgpuPipeline = null;
  const _invPV = new T.Matrix4(), _pv = new T.Matrix4();
  function ensurePost(renderer) {
    const size = renderer.getDrawingBufferSize(new T.Vector2());
    if (rt && size.x === _w && size.y === _h) return true;
    _w = size.x; _h = size.y;
    if (rt) { rt.dispose(); }
    if (!_w || !_h) return false;
    rt = new T.WebGLRenderTarget(_w, _h, { minFilter: T.LinearFilter, magFilter: T.LinearFilter });
    rt.depthTexture = new T.DepthTexture(_w, _h);
    rt.depthTexture.type = T.UnsignedIntType;
    if (!postMat) {
      postMat = new T.ShaderMaterial({
        uniforms: {
          tDiffuse: { value: null }, tDepth: { value: null }, uFogPrev: { value: null }, uFog: { value: null },
          uInvPV: { value: _invPV }, uTime: { value: 0 }, uFogBlend: { value: 1 },
        },
        depthTest: false, depthWrite: false,
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: `
          uniform sampler2D tDiffuse, tDepth, uFogPrev, uFog;
          uniform mat4 uInvPV; uniform float uTime, uFogBlend;
          varying vec2 vUv;
          float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
            return mix( mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y ); }
          // RT хранит ЛИНЕЙНЫЙ цвет (r128 не применяет outputEncoding при рендере в таргет) —
          // конвертируем в sRGB сами, той же кусочной формулой, что three encodings_fragment,
          // иначе финальная картинка темнее оригинала («свет поехал» после ввода пост-процесса)
          vec3 lin2srgb(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(vec3(0.0031308), c)); }
          void main(){
            vec4 c = texture2D(tDiffuse, vUv);
            c.rgb = lin2srgb(max(c.rgb, 0.0));                           // → как выглядело ДО пост-процесса
            float d = texture2D(tDepth, vUv).x;
            if (d >= 0.99999) { gl_FragColor = c; return; }              // небо/фон не тонируем
            vec4 ndc = vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
            vec4 wp = uInvPV * ndc; wp /= wp.w;                          // мировая позиция пикселя
            vec2 fogUv = (vec2(wp.z, wp.x) + 0.5) / ${G.toFixed(1)};
            float v = mix(texture2D(uFogPrev, fogUv).r, texture2D(uFog, fogUv).r, uFogBlend);
            // 🌫 органический край: порог гуляет по шуму → граница не ровная изолиния, а облачная
            float n1 = vnoise(wp.xz * 0.30 + vec2(uTime * 0.020, -uTime * 0.015));
            v = smoothstep(0.30, 0.70, v + (n1 - 0.5) * 0.18);
            // клочья на границе: медленный крупный шум тянет «языки» тумана вдоль края
            float edge = v * (1.0 - v) * 4.0;                            // 1 в центре перехода, 0 вдали
            float n2 = vnoise(wp.xz * 0.09 - vec2(uTime * 0.030, uTime * 0.022));
            v = clamp(v + edge * (n2 - 0.5) * 0.28, 0.0, 1.0);
            // «клубление» внутри тьмы: медленный шум приглушает туман неравномерно
            float n = vnoise(wp.xz * 0.14 + vec2(uTime * 0.05, uTime * 0.037)) * 0.5
                    + vnoise(wp.xz * 0.05 - vec2(uTime * 0.021, uTime * 0.03));
            float dim = 0.50 + 0.08 * (n - 0.75);                        // база ~50% ±небольшая рябь
            // WC3-ночь: полудесатурация + затемнение + холодный сдвиг
            float luma = dot(c.rgb, vec3(0.299, 0.587, 0.114));
            vec3 night = mix(vec3(luma), c.rgb, 0.45) * dim * vec3(0.80, 0.90, 1.18);
            gl_FragColor = vec4(mix(night, c.rgb, v), c.a);
          }`,
      });
      postScene = new T.Scene();
      postCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const quad = new T.Mesh(new T.PlaneBufferGeometry(2, 2), postMat);
      quad.frustumCulled = false;
      postScene.add(quad);
    }
    return true;
  }

  function fogRender(renderer, scene, camera) {
    if (window.__WWC_RENDER_INFO && /^(webgpu|webgl2)$/.test(window.__WWC_RENDER_INFO.active)) {
      if (!started || !tex) { renderer.render(scene, camera); return; }
      if (!webgpuPipeline && window.createWWCWebGPUFogPipeline) {
        webgpuPipeline = window.createWWCWebGPUFogPipeline(renderer, scene, camera, prevTex, tex, G);
      }
      if (webgpuPipeline) { if(webgpuPipeline.setFogBlend)webgpuPipeline.setFogBlend(blend); webgpuPipeline.render(); return; }
      renderer.render(scene, camera);
      return;
    }
    if (!started || !tex || !ensurePost(renderer)) { renderer.render(scene, camera); return; }
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _invPV.copy(_pv).invert();   // r128: Matrix4.invert есть с r123
    postMat.uniforms.tDiffuse.value = rt.texture;
    postMat.uniforms.tDepth.value = rt.depthTexture;
    postMat.uniforms.uFogPrev.value = prevTex;
    postMat.uniforms.uFog.value = tex;
    postMat.uniforms.uFogBlend.value = blend;
    postMat.uniforms.uInvPV.value = _invPV;
    postMat.uniforms.uTime.value = performance.now() / 1000;
    renderer.render(postScene, postCam);
  }

  window.fogUpdate = fogUpdate;
  window.fogRender = fogRender;
  window.FOG = { get tex() { return tex; }, get prevTex(){return prevTex;}, get blend(){return blend;}, computeTarget, _shim: shim, get started() { return started; } };
})();
