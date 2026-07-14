/* ── three.js setup ─────────────────────────────────────────── */
const app=document.getElementById('app');
// Renderer is created and initialized by the WebGPU bootstrap before game modules run.
const renderer=window.__WWC_RENDERER||new T3.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
const IS_WEBGPU=!!(window.__WWC_RENDER_INFO&&/^(webgpu|webgl2)$/.test(window.__WWC_RENDER_INFO.active));
const START_GRAPHICS=window.WWC_GRAPHICS||{renderScale:0.9,shadows:true,shadowMap:2048,shadowType:'PCFSoft'};
renderer.setPixelRatio(Math.max(0.5,Math.min(devicePixelRatio,2)*START_GRAPHICS.renderScale));
if('outputColorSpace' in renderer&&T3.SRGBColorSpace)renderer.outputColorSpace=T3.SRGBColorSpace;
else renderer.outputEncoding=T3.sRGBEncoding;
renderer.toneMapping=T3.ACESFilmicToneMapping;
renderer.toneMappingExposure=0.87;
renderer.shadowMap.enabled=true; renderer.shadowMap.type=T3.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const GAME_LIGHT_KEY='hexEuropeLightSettings.gameSync.v2';
const readGameLightSettings=()=>{
  const defaults={
    exposure:0.87,
    shadow:true,
    shadowType:'PCFSoft',
    background:0xfafafa,
    fogColor:0xa1bed9,
    fogNear:0,
    fogFar:230,
    hemiSky:0xffffff,
    hemiGround:0x0026bd,
    hemiIntensity:0.85,
    sunColor:0xffffff,
    sunIntensity:0.82,
    sunX:-0.42,
    sunY:0.4,
    sunZ:-0.09,
    sunTargetX:0.15,
    sunTargetY:0.01,
    sunTargetZ:0,
    shadowMap:4096,
    shadowRadius:2.1,
    shadowBias:0.0002,
    shadowNormalBias:0.024,
    shadowSize:0.5,
    shadowNear:1,
    shadowFar:2.42
  };
  try{
    const saved=JSON.parse(localStorage.getItem(GAME_LIGHT_KEY)||'{}')||{};
    return {...defaults,...saved};
  }catch(_){
    return defaults;
  }
};
const GAME_LIGHT=readGameLightSettings();
renderer.toneMappingExposure=Number.isFinite(+GAME_LIGHT.exposure)?+GAME_LIGHT.exposure:0.87;
renderer.shadowMap.enabled=GAME_LIGHT.shadow!==false&&START_GRAPHICS.shadows!==false;
renderer.shadowMap.type=({
  Basic:T3.BasicShadowMap,
  PCF:T3.PCFShadowMap,
  PCFSoft:T3.PCFSoftShadowMap
})[START_GRAPHICS.shadowType||GAME_LIGHT.shadowType]||T3.PCFSoftShadowMap;
// 🌓 ЗАПЕЧЁННЫЕ ТЕНИ (вариант A): мир статичен, солнце фиксировано в мире, юниты тень не кастуют →
//   теневую карту нет смысла перерисовывать каждый кадр. autoUpdate=false → рендерим её ТОЛЬКО когда
//   меняется геометрия (новый/захваченный город) или настройки света. Убирает shadow-pass
//   (~1.7M tris) из каждого кадра при идентичной картинке. markShadowsDirty() — запрос одного пере-рендера.
renderer.shadowMap.autoUpdate=false;
renderer.shadowMap.needsUpdate=START_GRAPHICS.shadows!==false; // первый рендер теней (после сборки мира)
const shadowsEnabled=()=>window.WWC_GRAPHICS?.shadows!==false&&renderer.shadowMap?.enabled!==false;
window.graphicsShadowsEnabled=shadowsEnabled;
window.markShadowsDirty=function markShadowsDirty(){
  if(!shadowsEnabled()){ if(renderer.shadowMap)renderer.shadowMap.needsUpdate=false; return; }
  renderer.shadowMap.needsUpdate=true;
};

const scene=new T3.Scene();
scene.background=new T3.Color(GAME_LIGHT.background);
// лёгкая атмосфера для дальней суши/облаков (туман океана делает сам водный шейдер)
scene.fog=new T3.Fog(GAME_LIGHT.fogColor,GAME_LIGHT.fogNear,GAME_LIGHT.fogFar);

const camera=new T3.PerspectiveCamera(45,1,.1,3000);
const target=new T3.Vector3(GRID/2,2,GRID/2);
let orbit={r:240, theta:Math.PI*0.25, phi:0.80}; // azimuth, polar
// 🌓 ЗАПЕЧЁННАЯ shadow-map на ВСЮ КАРТУ: солнце и теневой фрустум привязаны к ЦЕНТРУ карты (не к виду).
//   Камера двигается — тень не меняется → shadow-map печётся ОДИН раз (старт/загрузка/постройка города), и НИКОГДА
//   при пане/зуме/повороте. Полигоны теней (1.7M) уходят из рантайма полностью. Плата: тень чуть мягче
//   (≈0.06 ед/тексель на 4096 против ~0.015 у слежения за видом) — компенсируется shadowRadius/bias при желании.
function updateSunFollow(){
  if(typeof sun==='undefined')return;
  const cx=GRID/2, cy=2, cz=GRID/2;                          // центр карты — фиксированная привязка
  const sx=GRID*(GAME_LIGHT.sunX-GAME_LIGHT.sunTargetX);     // направление света прежнее (лайтинг не меняется)
  const sy=GRID*(GAME_LIGHT.sunY-GAME_LIGHT.sunTargetY);
  const sz=GRID*(GAME_LIGHT.sunZ-GAME_LIGHT.sunTargetZ);
  sun.position.set(cx+sx,cy+sy,cz+sz);
  sun.target.position.set(cx,cy,cz);
  sun.target.updateMatrixWorld();
  const ss=GRID*0.62;                                        // покрытие ВСЕЙ карты (±~159 ед, с запасом на поля)
  const sc=sun.shadow.camera;
  sc.left=-ss; sc.right=ss; sc.top=ss; sc.bottom=-ss;
  sc.near=1; sc.far=GRID*2.2;
  sc.updateProjectionMatrix();
  // needsUpdate здесь НЕ трогаем: фрустум фиксирован, камера тень не меняет.
  //   Перепечь запускают: старт (needsUpdate=true ниже), загрузка карты и markShadowsDirty() (постройка/захват города).
}
function applyCam(){
  const {r,theta,phi}=orbit;
  camera.position.set(
    target.x+r*Math.sin(phi)*Math.cos(theta),
    target.y+r*Math.cos(phi),
    target.z+r*Math.sin(phi)*Math.sin(theta));
  camera.lookAt(target);
}
applyCam();

const hemi=new T3.HemisphereLight(GAME_LIGHT.hemiSky,GAME_LIGHT.hemiGround,GAME_LIGHT.hemiIntensity);
scene.add(hemi);
var sun=new T3.DirectionalLight(GAME_LIGHT.sunColor,GAME_LIGHT.sunIntensity);
sun.castShadow=GAME_LIGHT.shadow!==false&&START_GRAPHICS.shadows!==false;
sun.shadow.mapSize.set(START_GRAPHICS.shadowMap||GAME_LIGHT.shadowMap,START_GRAPHICS.shadowMap||GAME_LIGHT.shadowMap);
sun.shadow.radius=GAME_LIGHT.shadowRadius;
sun.shadow.bias=GAME_LIGHT.shadowBias;
sun.shadow.normalBias=GAME_LIGHT.shadowNormalBias;
const sc=sun.shadow.camera,SS=GRID*GAME_LIGHT.shadowSize;
sc.left=-SS;sc.right=SS;sc.top=SS;sc.bottom=-SS;sc.near=GAME_LIGHT.shadowNear;sc.far=GRID*GAME_LIGHT.shadowFar;
scene.add(sun); scene.add(sun.target);
updateSunFollow();
if(typeof applyGraphicsPreset==='function')applyGraphicsPreset(START_GRAPHICS.id||'balanced',false);

/* ── 🌗 ДВЕ КАРТЫ ТЕНЕЙ: статика (окружение) + динамика (города/постройки) ─────────────
   Статичная карта (sun.shadow) печётся ОДИН раз и содержит только неизменяемое окружение
   (декор/дороги/мосты/рельеф). Города и рантайм-здания из неё ИСКЛЮЧЕНЫ (castShadow=false)
   и рисуются в отдельную depth-карту (DYN_SHADOW) — она перепекается только при постройке/
   апгрейде (~0.4M tris вместо 1.7M), а затемняет землю/дороги через инъекцию в их шейдеры
   (одно солнце, две карты глубины, композит по直ому свету — тени не «вымываются»).      */
const DYN_SHADOW_LAYER=2;
const DYN_SHADOW={size:8192,rt:null,cam:null,mat:null,matrix:new T3.Matrix4(),dirty:false,ready:false};
window.__DYN_SHADOW=DYN_SHADOW;   // дебаг/инструменты
function initDynShadow(){
  if(IS_WEBGPU)return;
  if(DYN_SHADOW.ready)return;
  DYN_SHADOW.rt=new T3.WebGLRenderTarget(DYN_SHADOW.size,DYN_SHADOW.size,{minFilter:T3.LinearFilter,magFilter:T3.LinearFilter});
  DYN_SHADOW.rt.texture.generateMipmaps=false;
  DYN_SHADOW.mat=new T3.MeshDepthMaterial({depthPacking:T3.RGBADepthPacking});
  const s=GRID*0.62, cx=GRID/2, cy=2, cz=GRID/2;                       // тот же фрустум/направление, что статичная карта
  const cam=new T3.OrthographicCamera(-s,s,s,-s,1,GRID*2.2);
  cam.position.set(cx+GRID*(GAME_LIGHT.sunX-GAME_LIGHT.sunTargetX), cy+GRID*(GAME_LIGHT.sunY-GAME_LIGHT.sunTargetY), cz+GRID*(GAME_LIGHT.sunZ-GAME_LIGHT.sunTargetZ));
  cam.lookAt(cx,cy,cz); cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
  cam.layers.set(DYN_SHADOW_LAYER);                                     // depth-камера видит ТОЛЬКО динамические кастеры
  DYN_SHADOW.cam=cam;
  DYN_SHADOW.matrix.set(0.5,0,0,0.5, 0,0.5,0,0.5, 0,0,0.5,0.5, 0,0,0,1);
  DYN_SHADOW.matrix.multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
  DYN_SHADOW.ready=true;
}
window.markDynShadowsDirty=function markDynShadowsDirty(){
  if(!shadowsEnabled()){
    DYN_SHADOW.dirty=false;
    if(renderer.shadowMap)renderer.shadowMap.needsUpdate=false;
    return;
  }
  if(IS_WEBGPU){ if(renderer.shadowMap)renderer.shadowMap.needsUpdate=true; return; }
  DYN_SHADOW.dirty=true;
};
window.bakeDynShadowIfDirty=function bakeDynShadowIfDirty(){            // зовётся из render-цикла; события одного кадра коалесятся в 1 запечку
  if(!shadowsEnabled()){
    DYN_SHADOW.dirty=false;
    if(renderer.shadowMap)renderer.shadowMap.needsUpdate=false;
    return;
  }
  if(IS_WEBGPU){
    if(DYN_SHADOW.dirty&&renderer.shadowMap)renderer.shadowMap.needsUpdate=true;
    DYN_SHADOW.dirty=false;
    return;
  }
  if(!DYN_SHADOW.dirty)return; DYN_SHADOW.dirty=false;
  initDynShadow();
  const prevRT=renderer.getRenderTarget(), prevOv=scene.overrideMaterial, prevBg=scene.background, prevFog=scene.fog;
  const prevClear=new T3.Color(); renderer.getClearColor(prevClear); const prevAlpha=renderer.getClearAlpha();
  scene.overrideMaterial=DYN_SHADOW.mat; scene.background=null; scene.fog=null;
  renderer.setRenderTarget(DYN_SHADOW.rt);
  renderer.setClearColor(0xffffff,1); renderer.clear(true,true,false);  // clear=депth 1.0 (далеко) → «нет тени»
  renderer.render(scene,DYN_SHADOW.cam);
  renderer.setRenderTarget(prevRT); renderer.setClearColor(prevClear,prevAlpha);
  scene.overrideMaterial=prevOv; scene.background=prevBg; scene.fog=prevFog;
};
// город/здание → динамический слой теней (и исключение из статичной карты)
window.attachDynShadowCaster=function attachDynShadowCaster(root){
  if(!root)return;
  if(!shadowsEnabled()){
    root.traverse(o=>{ if(o.isMesh){o.castShadow=false;o.receiveShadow=true;} });
    DYN_SHADOW.dirty=false;
    return;
  }
  if(IS_WEBGPU){
    root.traverse(o=>{ if(o.isMesh){o.castShadow=true;o.receiveShadow=true;} });
    if(renderer.shadowMap)renderer.shadowMap.needsUpdate=true;
    return;
  }
  root.traverse(o=>{
    if(o.isMesh){
      o.castShadow=false;
      o.receiveShadow=true;
      const mats=Array.isArray(o.material)?o.material:[o.material];
      for(const m of mats)if(m)window.installDynShadowReceiver(m,{bias:0.00012});
    }
    o.layers.enable(DYN_SHADOW_LAYER);
  });
  DYN_SHADOW.dirty=true;
};
window.scheduleCityShadowRefresh=function scheduleCityShadowRefresh(city){  // buildMeshes зовёт ДО сборки детей → доделываем микротаском
  queueMicrotask(()=>{ try{ if(city&&city.buildGroup)window.attachDynShadowCaster(city.buildGroup); }catch(e){} });
};
// инъекция сэмплинга динамической карты в материал-приёмник (земля/дороги/мосты)
window.installDynShadowReceiver=function installDynShadowReceiver(mat,opts){
  if(IS_WEBGPU)return mat;
  if(!mat||(mat.userData&&mat.userData.dynShadowReceiver))return mat;
  initDynShadow();
  const shadowBias=opts&&Number.isFinite(opts.bias)?opts.bias:0.00012;
  mat.userData=mat.userData||{}; mat.userData.dynShadowReceiver=true; mat.userData.dynShadowBias=shadowBias;
  const prev=mat.onBeforeCompile;                                       // композиция с biome-шейдером (он ставит свой onBeforeCompile)
  const prevKeyFn=mat.customProgramCacheKey;
  mat.onBeforeCompile=(shader,rnd)=>{
    if(prev)prev(shader,rnd);
    shader.uniforms.uDynShadowMap={value:DYN_SHADOW.rt.texture};
    shader.uniforms.uDynShadowMatrix={value:DYN_SHADOW.matrix};
    shader.vertexShader=shader.vertexShader
      .replace('#include <common>','#include <common>\nuniform mat4 uDynShadowMatrix;\nvarying vec4 vDynShadowCoord;')
      .replace('#include <project_vertex>',`#include <project_vertex>
{
  vec4 dynWP = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    dynWP = instanceMatrix * dynWP;
  #endif
  dynWP = modelMatrix * dynWP;
  vDynShadowCoord = uDynShadowMatrix * dynWP;
}`);
    const pars=`
uniform sampler2D uDynShadowMap;
varying vec4 vDynShadowCoord;
float dynUnpackDepth( const in vec4 v ){
  return dot( v, (255.0/256.0) / vec4( 16777216.0, 65536.0, 256.0, 1.0 ) );   // = unpackRGBAToFloat (RGBADepthPacking); в этой сборке three её нет в packing
}
float getDynShadow(){
  vec3 dsc = vDynShadowCoord.xyz / vDynShadowCoord.w;
  if(dsc.x<0.0||dsc.x>1.0||dsc.y<0.0||dsc.y>1.0||dsc.z>1.0) return 1.0;
  float sh=0.0; float tw=0.0; vec2 px=vec2(${(1.5/DYN_SHADOW.size).toFixed(8)});
  for(int dx=-1;dx<=1;dx++)for(int dy=-1;dy<=1;dy++){
    vec2 o=vec2(float(dx),float(dy));
    float w=1.0/(1.0+dot(o,o)*0.35);
    float d=dynUnpackDepth(texture2D(uDynShadowMap, dsc.xy+o*px));
    sh+=step(dsc.z-${shadowBias.toFixed(7)}, d)*w; tw+=w;
  }
  return sh/tw;
}`;
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\n'+pars);   // после common: есть во всех материалах, pars самодостаточен
    if(shader.fragmentShader.indexOf('#include <lights_fragment_begin>')!==-1){
      // Standard/Phong: гасим только ПРЯМОЙ свет (как настоящая тень — ambient/hemi остаются)
      shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_begin>',`#include <lights_fragment_begin>
{ float dynSh=getDynShadow(); reflectedLight.directDiffuse*=dynSh; reflectedLight.directSpecular*=dynSh; }`);
    } else {
      // Lambert (gouraud): совмещаем с общей маской теней
      shader.fragmentShader=shader.fragmentShader.replace(/getShadowMask\(\)/g,'( getShadowMask() * getDynShadow() )');
    }
  };
  mat.customProgramCacheKey=function(){ return (prevKeyFn?prevKeyFn.call(this):'') + '|dyn-shadow-soft-v3|b' + shadowBias.toFixed(7); };
  mat.needsUpdate=true;
  return mat;
};
// применить ко всем приёмникам (батчи земли/дорог/мостов) — после сборки мира
window.installDynShadowOnWorld=function installDynShadowOnWorld(){
  if(!shadowsEnabled())return;
  if(IS_WEBGPU){
    if(renderer.shadowMap)renderer.shadowMap.needsUpdate=true;
    return;
  }
  scene.traverse(o=>{
    if(!(o.isMesh||o.isInstancedMesh))return;
    const g=o.name||(o.userData&&o.userData.perfGroup)||'';
    if(!/map-(land|roads|bridges)/.test(g))return;
    const mats=Array.isArray(o.material)?o.material:[o.material];
    for(const m of mats)if(m)window.installDynShadowReceiver(m);
  });
  DYN_SHADOW.dirty=true;
};

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
    skyColor:     {value: new T3.Color(GAME_LIGHT.background)}, // = scene.background → бесшовный горизонт
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
const PLANE_SCALE=5;  // размер дирижабля
// бомбёжка городов: самолёт кружит над вражеским городом и сбрасывает бомбы
// PLANE_BOMB_DMG, PLANE_BOMB_CD (урон/кулдаун бомбы) — из _rules.gen.js
const PLANE_EGRESS=15; // дальность отхода для разворота (клиентский). PLANE_TURN (вираж), PLANE_BOMB_RANGE — из _rules.gen.js
let airOrder=[];                                  // [fid]: {kind:'bomb'|'patrol', city, x, z} — приказ авиации (из аэропорта)
// 🚀 зенитки (ПВО города): сбивают вражеские самолёты в радиусе, выбиваются бомбёжкой/обстрелом
// AA_RANGE, AA_CD, AA_DMG, AA_MAX (радиус/кулдаун/урон/лимит), AA_COST_BASE/STEP/MP,
// AA_KILL_CHANCE, AA_INTERCEPT — из _rules.gen.js
function aaCost(c){ return AA_COST_BASE + (c.aa||0)*AA_COST_STEP; }
