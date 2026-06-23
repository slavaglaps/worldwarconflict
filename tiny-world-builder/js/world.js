/* ── three.js setup ─────────────────────────────────────────── */
const app=document.getElementById('app');
const renderer=new T3.WebGLRenderer({antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.shadowMap.enabled=true; renderer.shadowMap.type=T3.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const scene=new T3.Scene();
scene.background=new T3.Color(0x9fd4ea);
// лёгкая атмосфера для дальней суши/облаков (туман океана делает сам водный шейдер)
scene.fog=new T3.Fog(0x9fd4ea, 660, 1500);

const camera=new T3.PerspectiveCamera(45,1,.1,3000);
const target=new T3.Vector3(GRID/2,2,GRID/2);
let orbit={r:240, theta:Math.PI*0.25, phi:0.80}; // azimuth, polar
function applyCam(){
  const {r,theta,phi}=orbit;
  camera.position.set(
    target.x+r*Math.sin(phi)*Math.cos(theta),
    target.y+r*Math.cos(phi),
    target.z+r*Math.sin(phi)*Math.sin(theta));
  camera.lookAt(target);
}
applyCam();

scene.add(new T3.HemisphereLight(0xffffff,0x6b7a5a,0.9));
const sun=new T3.DirectionalLight(0xfff8f0,1.1);
sun.position.set(GRID*0.3,220,GRID*0.1); sun.castShadow=true;
sun.shadow.mapSize.set(4096,4096);
const sc=sun.shadow.camera; sc.left=-190;sc.right=190;sc.top=190;sc.bottom=-190;sc.near=1;sc.far=620;
scene.add(sun); scene.add(sun.target); sun.target.position.copy(target);

/* ── Perlin/Simplex noise (simple gradient noise) ──────────────── */
const NoiseGen = (() => {
  const p = [151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,
    8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,
    32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,74,165,71,134,139,48,27,
    166,77,146,158,231,83,111,229,122,60,211,133,230,206,39,59,142,136,46,51,32,253,66,
    52,31,98,119,43,142,161,26,248,22,353,24,265,8,25,6,98];
  const perm = p.concat(p);
  const fade = t => t*t*t*(t*(t*6-15)+10);
  const lerp = (a, b, t) => a + (b-a)*t;
  const grad = (hash, x, y) => {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 8 ? y : x;
    return ((h&1) === 0 ? u : -u) + ((h&2) === 0 ? v : -v);
  };
  return {
    noise: (x, y) => {
      const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255;
      const xf = x - Math.floor(x), yf = y - Math.floor(y);
      const u = fade(xf), v = fade(yf);
      const p00 = perm[perm[xi] + yi];
      const p10 = perm[perm[xi + 1] + yi];
      const p01 = perm[perm[xi] + yi + 1];
      const p11 = perm[perm[xi + 1] + yi + 1];
      const n00 = grad(p00, xf, yf);
      const n10 = grad(p10, xf - 1, yf);
      const n01 = grad(p01, xf, yf - 1);
      const n11 = grad(p11, xf - 1, yf - 1);
      const nx0 = lerp(n00, n10, u), nx1 = lerp(n01, n11, u);
      return lerp(nx0, nx1, v);
    }
  };
})();

/* ── water shader (stylised ocean: swell + fresnel + sun glints + edge fog) ── */
const waterShader = {
  uniforms: {
    time:         {value: 0},
    camPos:       {value: new T3.Vector3()},
    sunDir:       {value: new T3.Vector3(-0.21, 0.88, -0.42)},
    deepColor:    {value: new T3.Color(0x123f5c)},
    shallowColor: {value: new T3.Color(0x3fa0c8)},
    skyColor:     {value: new T3.Color(0x9fd4ea)}, // = scene.background → бесшовный горизонт
    fogStart:     {value: 22.0},   // расстояние ЗА краем карты, где начинается туман
    fogEnd:       {value: 150.0},  // и где океан полностью растворяется в небе
  },
  vertexShader: `
    precision highp float;
    varying vec3 vWorld;
    varying float vSwell;
    uniform float time;
    void main(){
      vec4 wpos = modelMatrix * vec4(position, 1.0);
      vec2 P = wpos.xz;
      // крупная пологая зыбь (мировые координаты → не зависит от тесселяции)
      float h = sin(P.x*0.05 + time*0.7) * 0.5
              + cos(P.y*0.045 - time*0.55) * 0.5
              + sin((P.x+P.y)*0.03 + time*0.35) * 0.45;
      h *= 0.12;
      wpos.y += h;
      vSwell = h;
      vWorld = wpos.xyz;
      gl_Position = projectionMatrix * viewMatrix * wpos;
    }
  `,
  fragmentShader: `
    precision highp float;
    varying vec3 vWorld;
    varying float vSwell;
    uniform float time;
    uniform vec3 camPos, sunDir, deepColor, shallowColor, skyColor;
    uniform float fogStart, fogEnd;

    // рябь как высотное поле → нормали считаем аналитически
    // всего 2 крупные волны (низкие частоты) → спокойная вода без шума
    float ripple(vec2 p){
      float h = 0.0;
      h += sin(dot(p, vec2( 0.93, 0.36))*0.55 + time*1.1) * 0.055;
      h += sin(dot(p, vec2(-0.51, 0.86))*0.95 - time*1.4) * 0.035;
      return h;
    }
    void main(){
      vec2 P = vWorld.xz;
      // затухание детализации с дистанцией: вдалеке рябь недосэмплится и даёт муар → сглаживаем
      float dist = length(camPos - vWorld);
      float detail = clamp(1.0 - (dist - 40.0)*0.011, 0.0, 1.0);

      float e = 0.4;
      float h0 = ripple(P);
      float hx = ripple(P + vec2(e, 0.0));
      float hz = ripple(P + vec2(0.0, e));
      vec3 N = normalize(vec3(h0-hx, e, h0-hz));
      N = normalize(mix(vec3(0.0, 1.0, 0.0), N, detail)); // вдали — гладкая плоскость

      vec3 V = normalize(camPos - vWorld);
      vec3 L = normalize(sunDir);

      // цвет: глубокая ↔ мелкая в основном по крупной зыби (рябь подмешивается слабо)
      float crest = clamp((vSwell*3.0 + h0*detail*1.8)*0.5 + 0.5, 0.0, 1.0);
      vec3 col = mix(deepColor, shallowColor, crest);

      // Френель: на пологом угле к горизонту отражает небо
      float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
      col = mix(col, skyColor, fres*0.6);

      // мягкое диффузное затенение по ряби
      float diff = max(dot(N, L), 0.0);
      col *= 0.85 + 0.22*diff;

      // солнечные блики (мягкие, неяркие, гаснут вдали)
      vec3 H = normalize(L + V);
      float spec = pow(max(dot(N, H), 0.0), 45.0);
      col += vec3(1.0, 0.96, 0.88) * spec * 0.35 * detail;

      // туман войны: гаснет за прямоугольником карты [0,255]² (мировые координаты, не зависит от зума)
      float dx = max(max(-P.x, P.x - 255.0), 0.0);
      float dz = max(max(-P.y, P.y - 255.0), 0.0);
      float outside = length(vec2(dx, dz));
      float fog = smoothstep(fogStart, fogEnd, outside);
      col = mix(col, skyColor, fog);

      gl_FragColor = vec4(col, 1.0);
    }
  `
};

/* ── world / tiles ──────────────────────────────────────────── */
const TILE_GEO=new T3.BoxGeometry(TILE*0.98,0.5,TILE*0.98);
const tiles=[];      // tiles[x][z] = {mesh,mat,terrain,region,height}
let cities=[], squads=[], ships=[], planes=[], missiles=[], fx=[], waterMesh=null, borderLines=null, landTopIM=null, landPillarIM=null;
const SHIPYARD_NAMES=new Set(['Верфь Бордо']);
const ORIG_SHIPYARDS=['Верфь Бордо'], ORIG_AIRPORTS=['Аэропорт Париж']; // для сброса при рестарте
// постройка новых верфей/аэродромов как отдельных под-городов рядом с городом
// постройка верфи/аэродрома — только голда (SHIPYARD/AIRPORT_BUILD_COST из _rules.gen.js); манпауэр НЕ берём (как сервер)
let dynamicEdges=[], dynamicRoadMeshes=[]; // динамически добавленные дороги (для очистки на newGame)
// SHIP_SPEED/COST/BUILD_TIME/HP/DMG/RANGE — из _rules.gen.js
const SHIP_SCALE=5;          // размер корабля
// SHIP_ATTACK_RANGE, SHIP_MISSILE_DMG, SHIP_FIRE_CD (обстрел берега ракетами) — из _rules.gen.js
const WATER_Y_SHIP=-0.05; // высота, на которой плавают корабли
const AIRPORT_NAMES=new Set(['Аэропорт Париж']);
// PLANE_SPEED/COST/BUILD_TIME/HP/DMG/RANGE — из _rules.gen.js
// PLANE_ALT (высота полёта) — из _rules.gen.js
const PLANE_SCALE=5;  // размер самолёта
// бомбёжка городов: самолёт кружит над вражеским городом и сбрасывает бомбы
// PLANE_BOMB_DMG, PLANE_BOMB_CD (урон/кулдаун бомбы) — из _rules.gen.js
const PLANE_EGRESS=15; // дальность отхода для разворота (клиентский). PLANE_TURN (вираж), PLANE_BOMB_RANGE — из _rules.gen.js
let airOrder=[];                                  // [fid]: {kind:'bomb'|'patrol', city, x, z} — приказ авиации (из аэропорта)
// 🚀 зенитки (ПВО города): сбивают вражеские самолёты в радиусе, выбиваются бомбёжкой/обстрелом
// AA_RANGE, AA_CD, AA_DMG, AA_MAX (радиус/кулдаун/урон/лимит), AA_COST_BASE/STEP/MP,
// AA_KILL_CHANCE, AA_INTERCEPT — из _rules.gen.js
function aaCost(c){ return AA_COST_BASE + (c.aa||0)*AA_COST_STEP; }
