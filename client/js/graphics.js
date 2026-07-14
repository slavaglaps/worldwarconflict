/* ── Graphics presets ──────────────────────────────────────────────────────
   Presets only affect presentation. Visibility rules, simulation cadence and
   the number of represented soldiers remain identical on every setting. */
'use strict';

var WWC_GRAPHICS_KEY='wwc_graphics_preset';
var WWC_GRAPHICS_PRESETS={
  low:{
    id:'low',renderScale:0.60,shadows:false,shadowMap:0,shadowType:'Basic',
    blobShadows:false,fogScale:0.25,fogQuality:'low',water:'low',decorDensity:0.28,particles:0.20
  },
  performance:{
    id:'performance',renderScale:0.75,shadows:true,shadowMap:1024,shadowType:'Basic',
    blobShadows:true,fogScale:0.50,fogQuality:'low',water:'medium',decorDensity:0.58,particles:0.50
  },
  balanced:{
    id:'balanced',renderScale:0.90,shadows:true,shadowMap:2048,shadowType:'PCFSoft',
    blobShadows:true,fogScale:0.50,fogQuality:'high',water:'high',decorDensity:0.82,particles:0.75
  },
  ultra:{
    id:'ultra',renderScale:1.00,shadows:true,shadowMap:4096,shadowType:'PCFSoft',
    blobShadows:true,fogScale:1.00,fogQuality:'high',water:'high',decorDensity:1.00,particles:1.00
  }
};

function readGraphicsPreset(){
  var id='balanced';
  try{id=localStorage.getItem(WWC_GRAPHICS_KEY)||id;}catch(e){}
  return WWC_GRAPHICS_PRESETS[id]||WWC_GRAPHICS_PRESETS.balanced;
}
var WWC_GRAPHICS=readGraphicsPreset();
window.WWC_GRAPHICS_PRESETS=WWC_GRAPHICS_PRESETS;
window.WWC_GRAPHICS=WWC_GRAPHICS;

function graphicsFxLimit(base){
  return Math.max(2,Math.round((base||70)*(window.WWC_GRAPHICS?.particles??1)));
}
window.graphicsFxLimit=graphicsFxLimit;

function applyGraphicsPreset(id,save){
  var next=WWC_GRAPHICS_PRESETS[id]||WWC_GRAPHICS_PRESETS.balanced;
  WWC_GRAPHICS=next; window.WWC_GRAPHICS=next;
  if(save!==false)try{localStorage.setItem(WWC_GRAPHICS_KEY,next.id);}catch(e){}
  document.documentElement.dataset.graphics=next.id;
  document.documentElement.dataset.graphicsShadows=next.shadows?'on':'off';
  document.documentElement.dataset.graphicsWater=next.water;
  document.documentElement.dataset.graphicsFog=String(next.fogScale);

  if(typeof renderer!=='undefined'&&renderer){
    renderer.setPixelRatio(Math.max(0.5,Math.min(devicePixelRatio||1,2)*next.renderScale));
    renderer.setSize(innerWidth,innerHeight,false);
    if(renderer.shadowMap){
      renderer.shadowMap.enabled=next.shadows;
      renderer.shadowMap.type=next.shadowType==='Basic'?T3.BasicShadowMap:T3.PCFSoftShadowMap;
      renderer.shadowMap.needsUpdate=next.shadows;
    }
  }
  if(typeof sun!=='undefined'&&sun){
    sun.castShadow=next.shadows;
    if(next.shadows&&sun.shadow&&next.shadowMap){
      var oldSize=sun.shadow.mapSize.x;
      if(oldSize!==next.shadowMap){
        if(sun.shadow.map&&sun.shadow.map.dispose)sun.shadow.map.dispose();
        sun.shadow.map=null;
        sun.shadow.mapSize.set(next.shadowMap,next.shadowMap);
      }
    }
  }
  if(typeof scene!=='undefined'&&scene){
    scene.traverse(function(o){
      if(o?.userData?.perfGroup==='unit-blob-shadows')o.visible=next.blobShadows;
    });
  }
  var decor=window.HEX_DECOR_GROUP;
  if(decor)decor.traverse(function(o){
    if(!o.isInstancedMesh)return;
    var full=o.userData.graphicsFullCount||o.count;
    o.userData.graphicsFullCount=full;
    o.count=Math.max(0,Math.min(full,Math.round(full*next.decorDensity)));
    o.visible=o.count>0;
    o.castShadow=next.shadows;
    o.instanceMatrix.needsUpdate=true;
  });
  var water=window.HEXWATER;
  if(water){
    if(water.mesh&&water.qualityMaterial&&water.simpleMaterial)
      water.mesh.material=next.water==='low'?water.simpleMaterial:water.qualityMaterial;
    if(water.uMotion)water.uMotion.value=next.water==='high'?1:next.water==='medium'?0.55:0;
    if(water.uFoam)water.uFoam.value=next.water==='high'?1:next.water==='medium'?0.45:0;
  }
  if(window.FOG){
    if(window.FOG.setResolutionScale)window.FOG.setResolutionScale(next.fogScale);
    window.FOG.setQuality(next.fogQuality);
  }
  return next;
}
window.applyGraphicsPreset=applyGraphicsPreset;
