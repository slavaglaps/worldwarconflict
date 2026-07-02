/**
 * LandscapeEngine — water surface mixin.
 *
 * Builds the animated reflective water plane (ripples, fresnel, sun
 * glint, fog, optional XZ clip box) and registers the mesh into the
 * scene. Attaches `_initWater` to LandscapeEngine.prototype.
 *
 * Depends on: LandscapeEngine being defined globally and window.THREE.
 */
(function (global) {
  if (!global.LandscapeEngine) {
    throw new Error('engine/landscape/water.js: LandscapeEngine must be loaded first.');
  }
  const THREE = global.THREE;
  if (!THREE) {
    throw new Error('engine/landscape/water.js: THREE must be loaded first.');
  }

  Object.assign(global.LandscapeEngine.prototype, {
    // --- Water Implementation ---
    _initWater() {
      this.waterMat = new THREE.ShaderMaterial({
        uniforms: {
          time:      { value: 0 },
          shallow:   { value: new THREE.Color(0x4ea68a) },
          deep:      { value: new THREE.Color(0x143a46) },
          skyTop:    { value: new THREE.Color(this.currentBiome.skyTop) },
          skyBottom: { value: new THREE.Color(this.currentBiome.skyBottom) },
          cameraPos: { value: new THREE.Vector3() },
          fogColor:  { value: new THREE.Color(this.currentBiome.fogColor) },
          fogNear:   { value: 500 },
          fogFar:    { value: 6100 },
          sunDir:    { value: this.sunDir.clone() },
          runwayR:   { value: this.WATER_RUNWAY_R },
          reflectivity: { value: 1.28 },
          fresnelBoost: { value: 1.12 },
          sunGlint:     { value: 1.18 },
          waterOpacity: { value: 0.92 },
          // --- flow / foam / specular controls (3d-game-shaders water+lighting) ---
          flowDir:      { value: new THREE.Vector2(0.94, 0.34) },
          foamColor:    { value: new THREE.Color(0xeaf7ff) },
          foamAmount:   { value: 0.55 },
          specPower:    { value: 90.0 },
          posterize:    { value: 12.0 },
          // Gated by the "Enhanced water" Settings toggle (renderEnhancedWater).
          uEnhance:     { value: (typeof renderEnhancedWater === 'undefined' || renderEnhancedWater) ? 1.0 : 0.0 },
          clipEnabled:  { value: 0.0 },
          clipMin:      { value: this._clipMin },
          clipMax:      { value: this._clipMax },
          // --- planet-distance tint (parity with terrain ShaderMaterials) ---
          planetDistanceEffect:     { value: 0.0 },
          planetDistanceColor:      { value: new THREE.Color(this.currentBiome.fogColor) },
          planetDistanceDesaturate: { value: 0.0 },
          planetDistanceDim:        { value: 1.0 },
        },
        vertexShader: `
          varying vec3 vWorldPos;
          varying float vDist;
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorldPos = wp.xyz;
            vec4 mv = viewMatrix * wp;
            vDist = -mv.z;
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: `
          precision highp float;
          uniform float time;
          uniform vec3 shallow;
          uniform vec3 deep;
          uniform vec3 skyTop;
          uniform vec3 skyBottom;
          uniform vec3 cameraPos;
          uniform vec3 fogColor;
          uniform float fogNear;
          uniform float fogFar;
          uniform vec3 sunDir;
          uniform float runwayR;
          uniform float reflectivity;
          uniform float fresnelBoost;
          uniform float sunGlint;
          uniform float waterOpacity;
          uniform vec2 flowDir;
          uniform vec3 foamColor;
          uniform float foamAmount;
          uniform float specPower;
          uniform float posterize;
          uniform float uEnhance;
          uniform float clipEnabled;
          uniform vec3 clipMin;
          uniform vec3 clipMax;
          uniform float planetDistanceEffect;
          uniform vec3 planetDistanceColor;
          uniform float planetDistanceDesaturate;
          uniform float planetDistanceDim;
          varying vec3 vWorldPos;
          varying float vDist;

          float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
          }
          float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(
              mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
              mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
              u.y
            );
          }

          void main() {
            float edgeFade = 1.0;
            // Clip bounds discard
            if (clipEnabled > 0.5) {
              float dx1 = vWorldPos.x - clipMin.x;
              float dx2 = clipMax.x - vWorldPos.x;
              float dz1 = vWorldPos.z - clipMin.z;
              float dz2 = clipMax.z - vWorldPos.z;
              float minDist = min(min(dx1, dx2), min(dz1, dz2));
              if (minDist < 0.0) {
                discard;
              } else {
                float fadeZone = 2.5;
                edgeFade = clamp(minDist / fadeZone, 0.0, 1.0);
              }
            }

            float rw = length(vWorldPos.xz);
            if (rw < runwayR) discard;
            float rwFade = smoothstep(runwayR, runwayR + 60.0, rw);

            // --- Flowing, multi-directional ripple field (6 noise taps) ---
            // Two layers scroll along flowDir and its perpendicular so the
            // surface never visibly tiles. Cost stays on par with the old
            // single-layer ripple but reads far livelier.
            vec2 fl = flowDir;
            vec2 baseUv = vWorldPos.xz * 0.012;
            vec2 uv1 = baseUv + fl * (time * 0.05);
            vec2 uv2 = baseUv * 2.3 + vec2(-fl.y, fl.x) * (time * 0.07);

            float h0 = noise(uv1) * 0.62 + noise(uv2) * 0.38;
            float e = 0.5;
            float hX = noise(uv1 + vec2(e, 0.0)) * 0.62 + noise(uv2 + vec2(e, 0.0)) * 0.38;
            float hZ = noise(uv1 + vec2(0.0, e)) * 0.62 + noise(uv2 + vec2(0.0, e)) * 0.38;
            vec3 norm = normalize(vec3(-(hX - h0) * 0.85, 1.0, -(hZ - h0) * 0.85));

            vec3 viewDir = normalize(cameraPos - vWorldPos);
            vec3 L = normalize(sunDir);
            vec3 Hh = normalize(L + viewDir);

            // --- Blinn-Phong sun glint (tight specular) + broad sheen ---
            float ndh = max(dot(norm, Hh), 0.0);
            float glint = pow(ndh, specPower);
            float sheen = pow(ndh, max(specPower * 0.16, 1.0)) * 0.12;

            // --- Fresnel sky reflection ---
            float fresnel = pow(1.0 - max(0.0, dot(norm, viewDir)), 3.0);
            float skyMix = clamp(viewDir.y * 0.5 + 0.5, 0.0, 1.0);
            vec3 reflectedSky = mix(skyBottom, skyTop, pow(skyMix, 0.8));

            // --- Depth-tinted base with a hint of subsurface back-glow ---
            vec3 col = mix(deep, shallow, h0 * 0.58 + 0.24);
            float back = max(dot(-norm, L), 0.0);
            col += shallow * back * 0.05 * uEnhance;

            float reflectionMix = clamp((0.14 + fresnel * 0.44 * fresnelBoost) * reflectivity, 0.0, 0.94);
            col = mix(col, reflectedSky, reflectionMix);
            col += reflectedSky * sheen * uEnhance;
            col += vec3(1.0, 0.98, 0.92) * glint * (0.28 + 0.42 * sunGlint);

            // --- Foam: animated wave crests + a shoreline ring at the island edge ---
            float crest = smoothstep(0.66, 0.95, h0);
            float shore = 1.0 - smoothstep(runwayR, runwayR + 24.0, rw);
            float foamN = noise(baseUv * 7.0 + fl * (time * 0.22));
            float foam = clamp((crest + shore * 0.85) * foamAmount * (0.45 + foamN * 0.75), 0.0, 1.0);
            col = mix(col, foamColor, foam * uEnhance);

            // --- Optional cel posterization (12 levels reproduces the old look) ---
            if (posterize > 0.5) col = floor(col * posterize) / posterize;

            float fogF = clamp((vDist - fogNear) / (fogFar - fogNear), 0.0, 1.0);
            col = mix(col, fogColor, fogF);

            // --- Planet-distance tint (parity with terrain materials) ---
            if (planetDistanceEffect > 0.001) {
              float distMix = clamp(planetDistanceEffect, 0.0, 1.0);
              float grey = dot(col, vec3(0.299, 0.587, 0.114));
              col = mix(col, vec3(grey), clamp(planetDistanceDesaturate, 0.0, 1.0) * distMix);
              col = mix(col, planetDistanceColor, distMix);
              col *= mix(1.0, planetDistanceDim, distMix);
            }

            gl_FragColor = vec4(col, waterOpacity * rwFade * edgeFade);
          }
        `,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

      this.waterGeo = new THREE.PlaneGeometry(this.WATER_EXTENT, this.WATER_EXTENT, 1, 1);
      this.waterGeo.rotateX(-Math.PI / 2);
      this.waterMesh = new THREE.Mesh(this.waterGeo, this.waterMat);
      this.waterMesh.position.y = this.WATER_LEVEL;
      this.waterMesh.renderOrder = 3;
      this.scene.add(this.waterMesh);
    },
  });
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
