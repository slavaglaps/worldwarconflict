/**
 * LandscapeEngine — chunk streaming mixin.
 *
 * Builds high-detail terrain chunks (with instanced rocks/flora scatter)
 * and the cheaper far-LOD chunk tiles, plus the build-queue plumbing
 * that the update() loop drives each frame. Attaches `_makeChunk`,
 * `_makeFarChunk`, `_queueChunkBuild`, `_trimPendingChunkBuilds`, and
 * `_processChunkBuildQueues` to LandscapeEngine.prototype.
 *
 * Depends on: LandscapeEngine being defined globally and window.THREE.
 */
(function (global) {
  if (!global.LandscapeEngine) {
    throw new Error('engine/landscape/chunks.js: LandscapeEngine must be loaded first.');
  }
  const THREE = global.THREE;
  if (!THREE) {
    throw new Error('engine/landscape/chunks.js: THREE must be loaded first.');
  }

  Object.assign(global.LandscapeEngine.prototype, {
    // --- Terrain Chunk Builder ---
    _makeChunk(cx, cz) {
      const cxW = (cx + 0.5) * this.CHUNK_SIZE;
      const czW = (cz + 0.5) * this.CHUNK_SIZE;

      const group = new THREE.Group();
      group.position.set(cxW, 0, czW);

      const lowPoly = this.styleMode === 'lowpoly';
      const backdrop = this.BACKDROP_MODE === true;
      const sandM = lowPoly ? this.sandMatLowPoly : this.terrainMat;
      const rockM = lowPoly ? this.rockMatLowPoly : this.rockMat;

      const geo = new THREE.PlaneGeometry(this.CHUNK_SIZE, this.CHUNK_SIZE, this.CHUNK_RES, this.CHUNK_RES);
      geo.rotateX(-Math.PI / 2);

      const pos = geo.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      const tmp = new THREE.Color();

      for (let i = 0; i < pos.count; i++) {
        const lx = pos.getX(i);
        const lz = pos.getZ(i);
        const wx = cxW + lx;
        const wz = czW + lz;
        const h = this.getHeight(wx, wz);
        pos.setY(i, h);

        this._strataColor(h, tmp);

        // Cliff face tint
        const hN = this.getHeight(wx + 5, wz);
        const hE = this.getHeight(wx, wz + 5);
        const slope = Math.min(1, (Math.abs(hN - h) + Math.abs(hE - h)) * 0.045);
        if (slope > 0.25) {
          tmp.lerp(this.CLIFF_TINT, (slope - 0.25) * 0.55);
        }

        // Mottling noise
        const n1 = this._vnoise(wx * 0.045, wz * 0.045);
        const n2 = this._vnoise(wx * 0.011, wz * 0.011);
        tmp.multiplyScalar(0.78 + n1 * 0.22 + (n2 - 0.5) * 0.18);

        colors[i * 3] = tmp.r;
        colors[i * 3 + 1] = tmp.g;
        colors[i * 3 + 2] = tmp.b;
      }

      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.computeVertexNormals();

      const mesh = new THREE.Mesh(geo, sandM);
      mesh.position.set(0, 0, 0);
      mesh.castShadow = false;
      mesh.receiveShadow = !backdrop;
      group.add(mesh);

      if (backdrop) {
        this.scene.add(group);
        return { group, geo, mesh };
      }

      // --- Scatter Instanced Rocks ---
      const ROCKS_PER_CHUNK = 50;
      const rocks = new THREE.InstancedMesh(this.rockGeo, rockM, ROCKS_PER_CHUNK);
      const dummy = new THREE.Object3D();
      let added = 0;

      for (let i = 0; i < ROCKS_PER_CHUNK * 2 && added < ROCKS_PER_CHUNK; i++) {
        const r1 = this._srand(cx, cz, i * 2);
        const r2 = this._srand(cx, cz, i * 2 + 1);
        const lxr = (r1 - 0.5) * this.CHUNK_SIZE;
        const lzr = (r2 - 0.5) * this.CHUNK_SIZE;
        const wx = cxW + lxr;
        const wz = czW + lzr;
        const dist = Math.sqrt(wx * wx + wz * wz);
        if (dist < 280) continue;
        const h = this.getHeight(wx, wz);
        if (h < 4) continue;
        const scl = 0.6 + this._srand(cx, cz, i + 100) * 3.2;
        dummy.position.set(lxr, h - scl * 0.3, lzr);
        dummy.rotation.set(
          this._srand(cx, cz, i + 200) * Math.PI,
          this._srand(cx, cz, i + 300) * Math.PI * 2,
          this._srand(cx, cz, i + 400) * Math.PI
        );
        dummy.scale.set(scl, scl * (0.7 + this._srand(cx, cz, i + 500) * 0.6), scl);
        dummy.updateMatrix();
        rocks.setMatrixAt(added, dummy.matrix);
        added++;
      }
      rocks.count = added;
      rocks.instanceMatrix.needsUpdate = true;
      rocks.castShadow = true;
      rocks.receiveShadow = true;
      group.add(rocks);

      // --- Scatter Flora Clutter ---
      const floraMaterial = lowPoly ? this.floraMatLow : this.floraMat;
      const CAP_PINE = 180, CAP_CACTUS = 100, CAP_SHRUB = 220, CAP_BOULDER = 60;

      const pines    = new THREE.InstancedMesh(this.pineGeo,    floraMaterial, CAP_PINE);
      const cacti    = new THREE.InstancedMesh(this.cactusGeo,  floraMaterial, CAP_CACTUS);
      const shrubs   = new THREE.InstancedMesh(this.shrubGeo,   floraMaterial, CAP_SHRUB);
      const boulders = new THREE.InstancedMesh(this.boulderGeo, floraMaterial, CAP_BOULDER);

      let nPine = 0, nCactus = 0, nShrub = 0, nBoulder = 0;
      const d = new THREE.Object3D();

      const samples = 600;
      for (let i = 0; i < samples; i++) {
        const rx = this._srand(cx, cz, i * 3);
        const rz = this._srand(cx, cz, i * 3 + 1);
        const pick = this._srand(cx, cz, i * 3 + 2);
        const lx = (rx - 0.5) * this.CHUNK_SIZE;
        const lz = (rz - 0.5) * this.CHUNK_SIZE;
        const wx = cxW + lx;
        const wz = czW + lz;

        const r2 = wx * wx + wz * wz;
        if (r2 < 240 * 240) continue;

        const h = this.getHeight(wx, wz);
        if (h < this.WATER_LEVEL + 0.5) continue;

        const hN = this.getHeight(wx + 6, wz);
        const hE = this.getHeight(wx, wz + 6);
        const slope = (Math.abs(hN - h) + Math.abs(hE - h)) * 0.05;
        if (slope > 0.44) continue;

        d.position.set(lx, h, lz);
        d.rotation.set(0, this._srand(cx, cz, i + 800) * Math.PI * 2, 0);

        if (this.currentBiome.hasCactus && pick < 0.35 && nCactus < CAP_CACTUS) {
          const s = 0.72 + this._srand(cx, cz, i + 900) * 0.92;
          d.scale.set(s, s, s);
          d.updateMatrix();
          cacti.setMatrixAt(nCactus++, d.matrix);
        } else if (pick < this.currentBiome.shrubChance && nShrub < CAP_SHRUB) {
          const s = 0.55 + this._srand(cx, cz, i + 1000) * 0.72;
          d.scale.set(s, s, s);
          d.updateMatrix();
          shrubs.setMatrixAt(nShrub++, d.matrix);
        }

        if (pick < this.currentBiome.pineChance && nPine < CAP_PINE) {
          const s = 0.68 + this._srand(cx, cz, i + 1100) * 1.5;
          d.scale.set(s, s * (0.85 + this._srand(cx, cz, i + 1200) * 0.3), s);
          d.updateMatrix();
          pines.setMatrixAt(nPine++, d.matrix);
        } else if (pick < 0.08 && nBoulder < CAP_BOULDER) {
          const s = 0.8 + this._srand(cx, cz, i + 1300) * 3.4;
          d.position.y -= s * 0.28;
          d.rotation.set(
            this._srand(cx, cz, i + 1400) * Math.PI,
            this._srand(cx, cz, i + 1500) * Math.PI * 2,
            this._srand(cx, cz, i + 1600) * Math.PI
          );
          d.scale.set(s, s * (0.6 + this._srand(cx, cz, i + 1700) * 0.5), s);
          d.updateMatrix();
          boulders.setMatrixAt(nBoulder++, d.matrix);
        }
      }

      pines.count = nPine;
      cacti.count = nCactus;
      shrubs.count = nShrub;
      boulders.count = nBoulder;

      pines.instanceMatrix.needsUpdate = true;
      cacti.instanceMatrix.needsUpdate = true;
      shrubs.instanceMatrix.needsUpdate = true;
      boulders.instanceMatrix.needsUpdate = true;
      for (const inst of [pines, cacti, shrubs, boulders]) {
        inst.castShadow = true;
        inst.receiveShadow = true;
      }

      if (nPine > 0) group.add(pines);
      if (nCactus > 0) group.add(cacti);
      if (nShrub > 0) group.add(shrubs);
      if (nBoulder > 0) group.add(boulders);

      this.scene.add(group);

      return { group, geo, mesh };
    },

    // --- Far LOD Chunks ---
    _makeFarChunk(cx, cz) {
      const cxW = (cx + 0.5) * this.FAR_CHUNK_SIZE;
      const czW = (cz + 0.5) * this.FAR_CHUNK_SIZE;

      const group = new THREE.Group();
      group.position.set(cxW, 0, czW);

      const lowPoly = this.styleMode === 'lowpoly';
      const sandM = lowPoly ? this.sandMatLowPoly : this.terrainMat;

      const geo = new THREE.PlaneGeometry(this.FAR_CHUNK_SIZE, this.FAR_CHUNK_SIZE, this.FAR_CHUNK_RES, this.FAR_CHUNK_RES);
      geo.rotateX(-Math.PI / 2);

      const pos = geo.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      const tmp = new THREE.Color();

      for (let i = 0; i < pos.count; i++) {
        const lx = pos.getX(i);
        const lz = pos.getZ(i);
        const wx = cxW + lx;
        const wz = czW + lz;
        const h = this.getHeight(wx, wz);
        pos.setY(i, h);

        this._strataColor(h, tmp);

        const hN = this.getHeight(wx + 12, wz);
        const hE = this.getHeight(wx, wz + 12);
        const slope = Math.min(1, (Math.abs(hN - h) + Math.abs(hE - h)) * 0.018);
        if (slope > 0.1) {
          tmp.lerp(this.CLIFF_TINT, (slope - 0.1) * 0.65);
        }

        colors[i * 3] = tmp.r;
        colors[i * 3 + 1] = tmp.g;
        colors[i * 3 + 2] = tmp.b;
      }

      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.computeVertexNormals();

      const mesh = new THREE.Mesh(geo, sandM);
      mesh.position.set(0, 0, 0);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      group.add(mesh);

      this.scene.add(group);
      return { group, geo, mesh };
    },

    // --- Chunk Queue Routing ---
    _queueChunkBuild(list, set, map, cx, cz, priority) {
      const key = `${cx},${cz}`;
      if (set.has(key) || map.has(key)) return;
      set.add(key);
      list.push({ key, cx, cz, priority });
    },

    _trimPendingChunkBuilds(list, set, wanted) {
      for (let i = list.length - 1; i >= 0; i--) {
        if (wanted.has(list[i].key)) continue;
        set.delete(list[i].key);
        list.splice(i, 1);
      }
    },

    _processChunkBuildQueues(nearBudget = 1, farBudget = 1) {
      if (this.pendingChunkBuilds.length > 1) {
        this.pendingChunkBuilds.sort((a, b) => a.priority - b.priority);
      }
      while (nearBudget-- > 0 && this.pendingChunkBuilds.length) {
        const job = this.pendingChunkBuilds.shift();
        this.pendingChunkKeys.delete(job.key);
        if (!this.chunks.has(job.key)) {
          this.chunks.set(job.key, this._makeChunk(job.cx, job.cz));
        }
      }

      if (this.pendingFarChunkBuilds.length > 1) {
        this.pendingFarChunkBuilds.sort((a, b) => a.priority - b.priority);
      }
      while (farBudget-- > 0 && this.pendingFarChunkBuilds.length) {
        const job = this.pendingFarChunkBuilds.shift();
        this.pendingFarChunkKeys.delete(job.key);
        if (!this.farChunks.has(job.key)) {
          this.farChunks.set(job.key, this._makeFarChunk(job.cx, job.cz));
        }
      }
    },
  });
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
