import * as Core from 'three';
import { WebGPURenderer, RenderPipeline, MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  attribute,
  getViewPosition,
  float,
  mix,
  mx_noise_float,
  pass,
  positionWorld,
  screenUV,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';

// Keep the legacy global API while game modules migrate incrementally.
const T3 = {
  ...Core,
  WebGPURenderer,
  GLTFLoader,
  PlaneBufferGeometry: Core.PlaneGeometry,
  BoxBufferGeometry: Core.BoxGeometry,
  CircleBufferGeometry: Core.CircleGeometry,
  ConeBufferGeometry: Core.ConeGeometry,
  CylinderBufferGeometry: Core.CylinderGeometry,
  DodecahedronBufferGeometry: Core.DodecahedronGeometry,
  RingBufferGeometry: Core.RingGeometry,
  SphereBufferGeometry: Core.SphereGeometry,
  TorusBufferGeometry: Core.TorusGeometry,
  sRGBEncoding: Core.SRGBColorSpace,
};

window.THREE = T3;
window.T3 = T3;

const requestedBackend = new URLSearchParams(location.search).get('renderer') || 'webgpu';

async function createRenderer() {
  const canUseWebGPU = !!navigator.gpu && requestedBackend !== 'webgl';
  let renderer;
  let active = 'webgl';
  let fallbackReason = '';

  if (canUseWebGPU) {
    try {
      renderer = new WebGPURenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
      await renderer.init();
      active = 'webgpu';
    } catch (error) {
      fallbackReason = error && error.message ? error.message : String(error);
      console.warn('[render] WebGPU initialization failed, using WebGL:', error);
    }
  } else if (requestedBackend !== 'webgl') {
    fallbackReason = 'navigator.gpu is unavailable';
  }

  if (!renderer) {
    try {
      renderer = new WebGPURenderer({ antialias: true, alpha: false, powerPreference: 'high-performance', forceWebGL: true });
      await renderer.init();
      active = 'webgl2';
    } catch (error) {
      fallbackReason = fallbackReason || (error && error.message ? error.message : String(error));
      console.warn('[render] unified WebGL2 backend failed, using legacy WebGL:', error);
      renderer = new Core.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
      active = 'webgl-legacy';
    }
  }

  window.__WWC_RENDERER = renderer;
  window.__WWC_RENDER_INFO = {
    requested: requestedBackend,
    active,
    fallbackReason,
    threeRevision: Core.REVISION,
  };
  console.info(`[render] ${active.toUpperCase()} pipeline, Three r${Core.REVISION}`);
  return renderer;
}

window.__WWC_RENDER_READY = createRenderer();

window.createWWCWebGPUFogPipeline = function createWWCWebGPUFogPipeline(renderer, scene, camera, previousFogTexture, fogTexture, grid) {
  const scenePass = pass(scene, camera);
  const sceneColor = scenePass.getTextureNode();
  const invProjection = uniform(camera.projectionMatrixInverse);
  const cameraWorld = uniform(camera.matrixWorld);
  // Intersect the camera ray with the map plane. This avoids backend-specific
  // depth conventions and keeps fog projection identical on WebGPU/WebGL.
  const nearView = getViewPosition(screenUV, 0.0, invProjection);
  const farView = getViewPosition(screenUV, 0.999, invProjection);
  const nearWorld = cameraWorld.mul(vec4(nearView, 1)).xyz;
  const farWorld = cameraWorld.mul(vec4(farView, 1)).xyz;
  const ray = farWorld.sub(nearWorld);
  const rayDistance = nearWorld.y.negate().div(ray.y);
  const worldPosition = nearWorld.add(ray.mul(rayDistance));
  const fogUv = vec2(worldPosition.z, worldPosition.x).add(0.5).div(grid).clamp(0.0, 1.0);
  const fogBlend = uniform(1);
  const fogAnimating = uniform(0);
  const fogNow = texture(fogTexture, fogUv).r;
  const fogValue = fogAnimating.greaterThan(0.5).select(mix(texture(previousFogTexture, fogUv).r, fogNow, fogBlend), fogNow);
  const visibility = smoothstep(0.3, 0.7, fogValue);
  const night = sceneColor.rgb.mul(vec3(0.40, 0.45, 0.59));
  const fogged = vec4(mix(night, sceneColor.rgb, visibility), sceneColor.a);
  const pipeline = new RenderPipeline(renderer);
  pipeline.outputNode = fogged;
  pipeline.setFogBlend = (value) => { fogBlend.value = value; fogAnimating.value = value < 0.999 ? 1 : 0; };
  return pipeline;
};

window.createWWCWebGPUBiomeMaterial = function createWWCWebGPUBiomeMaterial(options) {
  const { sourceMaterial, baseMap, desertMap, summerMap, winterMap } = options;
  const material = new MeshStandardNodeMaterial();
  material.copy(sourceMaterial);
  material.map = null;
  material.color.set(0xffffff);

  const biome = attribute('aPackBiome', 'float');
  const mapUv = uv();
  const base = texture(baseMap, mapUv);
  const desert = texture(desertMap, mapUv);
  const summer = texture(summerMap, mapUv);
  const winter = texture(winterMap, mapUv);
  const biomeColor = biome.greaterThan(2.5).select(
    winter,
    biome.greaterThan(1.5).select(summer, biome.greaterThan(0.5).select(desert, base)),
  );
  // Calibrated against the r128 reference frame. The unified renderer's
  // physically-correct lighting otherwise makes the terrain too dark/blue.
  material.colorNode = biomeColor.rgb.mul(vec3(1.30, 1.82, 1.00)).clamp();
  material.userData = { ...sourceMaterial.userData, packBiomeShader: true };
  return material;
};

window.createWWCWebGPUOwnerMaterial = function createWWCWebGPUOwnerMaterial(options) {
  const { sourceMaterial, ownerColor } = options;
  if (!sourceMaterial || !sourceMaterial.map) {
    return { material: sourceMaterial, ownerUniform: null };
  }

  const material = new MeshStandardNodeMaterial();
  material.copy(sourceMaterial);
  material.map = null;
  material.color.set(0xffffff);

  const atlas = texture(sourceMaterial.map, uv());
  const atlasColor = atlas.rgb;
  const greenness = atlasColor.g.sub(atlasColor.r.max(atlasColor.b));
  const blueness = atlasColor.b.sub(atlasColor.r.max(atlasColor.g));
  const factionMask = smoothstep(0.03, 0.13, greenness)
    .max(smoothstep(0.03, 0.13, blueness));
  const luminance = atlasColor.dot(vec3(0.299, 0.587, 0.114)).clamp(0.0, 1.0);
  const ownerUniform = uniform(ownerColor.clone());
  const tinted = ownerUniform.mul(float(0.45).add(luminance.mul(1.05)));

  material.colorNode = mix(atlasColor, tinted, factionMask);
  material.opacityNode = atlas.a.mul(sourceMaterial.opacity);
  material.userData = { ...sourceMaterial.userData, __owned: true };
  // Keep the untouched atlas material outside userData: Material.copy serializes
  // userData, while placed buildings need a fresh owner uniform per clone.
  material.__wwcOwnerSource = sourceMaterial.__wwcOwnerSource || sourceMaterial;
  return { material, ownerUniform };
};

window.createWWCWebGPURiverMaterial = function createWWCWebGPURiverMaterial(options) {
  const { sourceMaterial, dudvMap, timeNode, deepColor, shallowColor } = options;
  if (!sourceMaterial || !sourceMaterial.map) return sourceMaterial;
  const material = new MeshStandardNodeMaterial();
  material.copy(sourceMaterial);
  material.map = null;
  material.color.set(0xffffff);

  const legacyColor = (source) => {
    const srgb = source.clone().convertLinearToSRGB();
    return new Core.Vector3(srgb.r, srgb.g, srgb.b);
  };
  const riverTime = timeNode || uniform(0);
  const atlas = texture(sourceMaterial.map, uv());
  const atlasColor = atlas.rgb;
  const waterMask = smoothstep(0.05, 0.2, atlasColor.b.sub(atlasColor.r.max(atlasColor.g)));
  const rawDirection = attribute('aFlowDir', 'vec2');
  const direction = rawDirection.dot(rawDirection).greaterThan(0.0001)
    .select(rawDirection.normalize(), vec2(0, 1));
  const perpendicular = vec2(direction.y.negate(), direction.x);
  const baseUv = positionWorld.xz.mul(0.06);
  const jitter = texture(dudvMap, baseUv.mul(0.25)).rg.mul(2).sub(1);
  const flowVector = mix(direction, jitter, 0.35);
  const flowUv = baseUv.sub(flowVector.mul(riverTime.mul(0.18)));
  const alignedUv = vec2(flowUv.dot(perpendicular), flowUv.dot(direction));
  const streamUv = alignedUv.mul(vec2(21.0, 4.2));
  const streamNoise = mx_noise_float(vec3(streamUv, riverTime.mul(0.12))).mul(0.5).add(0.5).clamp();
  const broadNoise = mx_noise_float(vec3(alignedUv.mul(2.8), riverTime.mul(0.035))).mul(0.5).add(0.5);
  const streaks = streamNoise.pow(4.0);
  const broad = smoothstep(0.3, 0.7, broadNoise);
  const flowMix = broad.mul(0.4).add(streaks.mul(0.6)).clamp();
  const deep = uniform(legacyColor(deepColor));
  const shallow = uniform(legacyColor(shallowColor));
  const flowColor = mix(deep, shallow, flowMix);
  const finalColor = mix(atlasColor, flowColor, waterMask);

  material.colorNode = finalColor;
  material.emissiveNode = flowColor.mul(waterMask).mul(0.08);
  material.userData = { ...sourceMaterial.userData, __riverFlow: true };
  return material;
};

window.createWWCWebGPUWaterMaterial = function createWWCWebGPUWaterMaterial(options) {
  const {
    dudvMap,
    coastTexture,
    grid,
    deepColor = new Core.Color(0x007052),
    shallowColor = new Core.Color(0x06535b),
    foamColor = new Core.Color(0xe8f8ff),
  } = options;
  // r128 treated hexadecimal Color channels as already-linear shader values.
  // Restore those raw channels so the WebGPU material keeps the original look.
  const legacyColor = (source) => {
    const srgb = source.clone().convertLinearToSRGB();
    return new Core.Vector3(srgb.r, srgb.g, srgb.b);
  };
  const uTime = uniform(0);
  const deep = uniform(legacyColor(deepColor));
  const shallow = uniform(legacyColor(shallowColor));
  const foam = uniform(legacyColor(foamColor));
  const worldXZ = positionWorld.xz;

  const baseUv = worldXZ.mul(0.01);
  const dudvFlow = texture(dudvMap, baseUv.mul(0.25)).rg.mul(2).sub(1);
  const flowDir = mix(vec2(0, 1), dudvFlow, 0.05);
  const flowUv = baseUv.sub(flowDir.mul(uTime.mul(0.02)));
  const detailNoise = mx_noise_float(vec3(flowUv.mul(3.7), uTime.mul(0.04))).mul(0.5).add(0.5).clamp();
  const broadNoise = mx_noise_float(vec3(flowUv.mul(1.48), uTime.mul(0.018))).mul(0.5).add(0.5);
  const streaks = detailNoise.pow(8);
  const broad = smoothstep(0.3, 0.7, broadNoise);
  const surface = broad.mul(0.5).add(streaks.mul(0.5)).clamp();
  const waterColor = mix(deep, shallow, surface);

  const mapUv = worldXZ.div(grid);
  const foamDistortion = texture(dudvMap, worldXZ.mul(0.135).sub(uTime.mul(0.025))).rg.mul(2).sub(1);
  const shoreUv = mapUv.add(foamDistortion.mul(0.003));
  const inside = shoreUv.x.greaterThanEqual(0).and(shoreUv.x.lessThanEqual(1))
    .and(shoreUv.y.greaterThanEqual(0)).and(shoreUv.y.lessThanEqual(1));
  const coastMask = inside.select(texture(coastTexture, shoreUv).r, float(1));
  const shoreFoam = smoothstep(0.92, 0.42, coastMask).clamp();
  const ripple = mx_noise_float(vec3(flowUv.mul(5.55), uTime.mul(0.08))).mul(0.5);
  const rippledWater = waterColor.mul(float(1).add(ripple.mul(float(1).sub(shoreFoam)).mul(0.45)));
  // Match the r128 GLSL output after its legacy tone/color transform.
  const finalColor = mix(rippledWater, foam, shoreFoam).mul(vec3(2.12, 1.33, 1.38)).clamp();

  const material = new MeshBasicNodeMaterial();
  material.colorNode = finalColor;
  material.depthTest = true;
  material.depthWrite = true;
  material.transparent = false;
  return { material, uTime };
};
