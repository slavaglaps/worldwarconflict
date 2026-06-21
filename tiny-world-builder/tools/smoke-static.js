#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const htmlRaw = fs.readFileSync(path.join(root, 'tiny-world-builder.html'), 'utf8');
const devServer = fs.readFileSync(path.join(root, 'tools/dev-server.js'), 'utf8');

// App logic lives in external modules (LandscapeEngine.js + engine/**/*.js)
// since the single-file HTML was split up. Match against the combined source
// so these guards still find the functions/markers they expect.
function collectAppModules(rootDir) {
  const out = [];
  const landscape = path.join(rootDir, 'LandscapeEngine.js');
  if (fs.existsSync(landscape)) out.push(fs.readFileSync(landscape, 'utf8'));
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.js')) out.push(fs.readFileSync(full, 'utf8'));
    }
  };
  const engineDir = path.join(rootDir, 'engine');
  if (fs.existsSync(engineDir)) walk(engineDir);
  return out;
}
const html = htmlRaw + '\n' + collectAppModules(root).join('\n');

function fail(message) {
  console.error('smoke failed:', message);
  process.exit(1);
}
function requireIncludes(text, label) {
  if (!html.includes(text)) fail('missing ' + label + ': ' + text);
}
function requireNotIncludes(text, label) {
  if (html.includes(text)) fail('unexpected ' + label + ': ' + text);
}

requireIncludes('function setCell(', 'state mutation entry point');
requireIncludes('function renderCellObject(', 'object renderer');
requireIncludes('function applyTool(', 'tool application');
requireIncludes('function doClear(', 'clear action');
requireIncludes('function togglePerspective(', 'camera toggle');
requireIncludes('function runSeededVehicleDemo(', 'shareable vehicle seed demo');
requireIncludes('VEHICLE_DEMO_DEFAULT_SEED', 'vehicle demo default seed');
requireIncludes('vehicle-demo-badge', 'visible vehicle demo badge');
requireIncludes('M_VEHICLE.beacon', 'visible vehicle beacon marker');
requireIncludes('VEHICLE_COLLISION_RADIUS', 'vehicle collision radius');
requireIncludes('function getVehicleCollisionRisk(', 'vehicle collision risk check');
requireIncludes('function rerouteVehicleAroundTraffic(', 'traffic-aware vehicle reroute');
requireIncludes('function isVehicleDrivableCell(', 'object-aware vehicle drivable cell check');
requireIncludes('function refreshVehiclesForWorldObstacleChange(', 'vehicle reroute on world obstacle edits');
requireIncludes('__getVehicleRuntimeSnapshot', 'vehicle runtime debug snapshot');
requireIncludes('function makeCloud(', 'voxel cloud factory');
requireIncludes('function openTinyModal(', 'modal focus helper');
requireIncludes('customDepthMaterial', 'cloud shadow depth material');
requireIncludes('vendor/three/three.r128.min.js', 'self-hosted Three.js');
requireIncludes('vendor/three/GLTFLoader.r128.js', 'self-hosted GLTFLoader');

const netlifyToml = fs.readFileSync(path.join(root, 'netlify.toml'), 'utf8');
if (!netlifyToml.includes('publish = "dist"') || !netlifyToml.includes('command = "./publish.sh"')) {
  fail('netlify.toml does not point Netlify at publish.sh/dist');
}

requireNotIncludes('cdnjs.cloudflare.com/ajax/libs/three.js', 'Three.js CDN');
requireNotIncludes('cdn.jsdelivr.net/npm/three', 'GLTFLoader CDN');
requireNotIncludes('postTarget', 'post-processing render target');
requireNotIncludes('postMaterial', 'post-processing shader material');
requireNotIncludes('postProcessingEnabled', 'post-processing mode flag');
requireNotIncludes('render-smoothing', 'dead post smoothing control');
requireNotIncludes('cluso/cluso-embed.js', 'Cluso runtime script');
requireNotIncludes('cluso/cluso-embed.css', 'Cluso runtime stylesheet');

for (const asset of [
  'vendor/three/three.r128.min.js',
  'vendor/three/GLTFLoader.r128.js',
]) {
  if (!fs.existsSync(path.join(root, asset))) fail('missing local asset ' + asset);
}

// Dev server should now default to normal welcome menu (Farm) on bare access.
// Vehicle demo is available via the button in the welcome menu or by adding ?demo=vehicles manually.
if (!devServer.includes("if (pathname === '/') return { redirect: '/tiny-world-builder' };")) {
  fail('dev server bare root should redirect to /tiny-world-builder (welcome menu)');
}
if (!devServer.includes("if (pathname === '/tiny-world-builder') return { file:")) {
  fail('dev server should serve tiny-world-builder.html for normal access');
}

console.log('smoke ok');
