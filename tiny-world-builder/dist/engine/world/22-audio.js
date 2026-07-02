  // -------- audio --------
  // Music: random sessions pick from the Horizon themes only. Rising stays in
  // the picker as a deliberate manual choice. Music can't auto-play before a
  // user gesture, so we defer the first .play() to the next pointerdown/keydown.
  //
  // SFX: small pools of foley clips. playSfx(group) clones the chosen node
  // so overlapping plays don't truncate each other. A per-group min-gap
  // prevents drag-painting from machine-gunning sounds.
  const AUDIO_LS = {
    music:        'tinyworld:audio:music',
    sfx:          'tinyworld:audio:sfx',
    ambient:      'tinyworld:audio:ambient',
    engines:      'tinyworld:audio:engines',
    musicMuted:   'tinyworld:audio:music-muted',
    sfxMuted:     'tinyworld:audio:sfx-muted',
    ambientMuted: 'tinyworld:audio:ambient-muted',
    enginesMuted: 'tinyworld:audio:engines-muted',
    musicTrack:   'tinyworld:audio:music-track',
    musicMode:    'tinyworld:audio:music-mode',
    ambientRange: 'tinyworld:audio:ambient-range',
    enginesRange: 'tinyworld:audio:engines-range',
  };
  function storedAudio(key, fallback, min, max) {
    const v = parseFloat(localStorage.getItem(key));
    if (!isFinite(v)) return fallback;
    return Math.max(min, Math.min(max, v));
  }
  let audioMusicVolume   = storedAudio(AUDIO_LS.music,   0.20, 0, 1);
  let audioSfxVolume     = storedAudio(AUDIO_LS.sfx,     0.7,  0, 1);
  let audioAmbientVolume = storedAudio(AUDIO_LS.ambient, 0.6,  0, 1);
  let audioEnginesVolume = storedAudio(AUDIO_LS.engines, 0.55, 0, 1);
  let audioMusicMuted    = localStorage.getItem(AUDIO_LS.musicMuted)    === '1';
  let audioSfxMuted      = localStorage.getItem(AUDIO_LS.sfxMuted)      === '1';
  let audioAmbientMuted  = localStorage.getItem(AUDIO_LS.ambientMuted)  === '1';
  let audioEnginesMuted  = localStorage.getItem(AUDIO_LS.enginesMuted)  === '1';

  const SOUNDS_BASE = 'sounds/';
  const MUSIC_TRACKS = [
    'music-horizon-1.mp3',
    'music-horizon-2.mp3',
    'music-horizon-3.mp3',
    'music-horizon-4.mp3',
    'music-horizon-5.mp3',
    'music-horizon-6.mp3',
    'music-rising-1.mp3',
  ];
  const MUSIC_RANDOM_TRACKS = MUSIC_TRACKS.filter(name => /^music-horizon-\d+\.mp3$/i.test(name));
  const SFX_GROUPS = {
    rustle: ['foley-rustle-1.mp3', 'foley-rustle-2.mp3', 'foley-rustle-3.mp3'],
    knock:  ['foley-knock-jingle-1.mp3', 'foley-knock-jingle-2.mp3'],
    whoosh: ['foley-whoosh-1.mp3', 'foley-whoosh-2.mp3'],
    ripple: ['foley-digital ripple activity.mp3'],
    // 'land' reuses the rustle pool but has its own clock + a longer gap,
    // so cascade landings (boot/reset/clear) thin out instead of forming
    // a wall of foley over the rustle channel.
    land:   ['foley-rustle-1.mp3', 'foley-rustle-2.mp3', 'foley-rustle-3.mp3'],
  };
  // Minimum time (ms) between two plays of the same group. Drag-painting
  // tiles must not produce a machine-gun of identical foley.
  const SFX_MIN_GAP = { rustle: 70, knock: 90, whoosh: 110, ripple: 240, land: 180 };
  const sfxPool = {};
  for (const g of Object.keys(SFX_GROUPS)) {
    sfxPool[g] = SFX_GROUPS[g].map(name => {
      const a = new Audio(SOUNDS_BASE + encodeURIComponent(name));
      a.preload = 'auto';
      a.crossOrigin = 'anonymous';
      return a;
    });
  }
  const sfxLastPlay = { rustle: 0, knock: 0, whoosh: 0, ripple: 0, land: 0 };

  function playSfx(group, scale) {
    if (audioSfxMuted) return;
    const now = performance.now();
    if (now - (sfxLastPlay[group] || 0) < (SFX_MIN_GAP[group] || 80)) return;
    sfxLastPlay[group] = now;
    const pool = sfxPool[group];
    if (!pool || !pool.length) return;
    const base = pool[Math.floor(Math.random() * pool.length)];
    // cloneNode keeps the preloaded src reference; cheaper than `new Audio`.
    const node = base.cloneNode();
    node.volume = Math.max(0, Math.min(1, audioSfxVolume * (scale || 1)));
    // Drop the clone after it finishes so we don't leak HTMLAudioElements.
    node.addEventListener('ended', () => { node.src = ''; }, { once: true });
    const p = node.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }

  function playSfxForTool(tool) {
    if (!tool || tool.auto) return;
    if (tool.erase) { playSfx('whoosh'); return; }
    if (tool.kind === 'house' || tool.kind === 'fence' || tool.kind === 'model-stamp') { playSfx('knock'); return; }
    if (tool.kind || tool.terrain) { playSfx('rustle'); return; }
  }

  let musicAudio = null;
  let musicStarted = false;
  let musicPickedTrack = null;
  function randomMusicTrack() {
    const pool = MUSIC_RANDOM_TRACKS.length ? MUSIC_RANDOM_TRACKS : MUSIC_TRACKS;
    return pool[Math.floor(Math.random() * pool.length)];
  }
  function manualMusicTrack() {
    const mode = localStorage.getItem(AUDIO_LS.musicMode);
    const savedTrack = localStorage.getItem(AUDIO_LS.musicTrack);
    return mode === 'manual' && savedTrack && MUSIC_TRACKS.includes(savedTrack) ? savedTrack : null;
  }
  function startMusicIfNeeded() {
    if (musicStarted || audioMusicMuted) return;
    musicStarted = true;
    musicPickedTrack = manualMusicTrack() || musicPickedTrack || randomMusicTrack();
    musicAudio = new Audio(SOUNDS_BASE + musicPickedTrack);
    musicAudio.loop = true;
    musicAudio.volume = audioMusicVolume;
    musicAudio.crossOrigin = 'anonymous';
    const p = musicAudio.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        // Autoplay still blocked — let the next gesture try again.
        musicStarted = false;
        musicAudio = null;
      });
    }
  }
  // Lazily start music on the first user gesture (any pointer or key event).
  function armMusicAutostart() {
    const handler = () => {
      window.removeEventListener('pointerdown', handler);
      window.removeEventListener('keydown', handler);
      startMusicIfNeeded();
    };
    window.addEventListener('pointerdown', handler, { passive: true });
    window.addEventListener('keydown', handler);
  }
  armMusicAutostart();

  function applyAudioState() {
    if (musicAudio) musicAudio.volume = audioMusicMuted ? 0 : audioMusicVolume;
    // SFX volume is applied per-play; nothing to update here.
    // Positional buses (ambient/engines) are updated by the tick loop.
    if (typeof updatePositionalBusGains === 'function') updatePositionalBusGains();
    try {
      localStorage.setItem(AUDIO_LS.music,    String(audioMusicVolume));
      localStorage.setItem(AUDIO_LS.sfx,      String(audioSfxVolume));
      localStorage.setItem(AUDIO_LS.ambient,  String(audioAmbientVolume));
      localStorage.setItem(AUDIO_LS.engines,  String(audioEnginesVolume));
      localStorage.setItem(AUDIO_LS.musicMuted,    audioMusicMuted    ? '1' : '0');
      localStorage.setItem(AUDIO_LS.sfxMuted,      audioSfxMuted      ? '1' : '0');
      localStorage.setItem(AUDIO_LS.ambientMuted,  audioAmbientMuted  ? '1' : '0');
      localStorage.setItem(AUDIO_LS.enginesMuted,  audioEnginesMuted  ? '1' : '0');
    } catch (_) {}
  }
  function setMusicVolume(v) {
    audioMusicVolume = Math.max(0, Math.min(1, v));
    if (!audioMusicMuted && !musicStarted) startMusicIfNeeded();
    applyAudioState();
  }
  function setSfxVolume(v) {
    audioSfxVolume = Math.max(0, Math.min(1, v));
    applyAudioState();
  }
  function setMusicMuted(m) {
    audioMusicMuted = !!m;
    if (audioMusicMuted && musicAudio) {
      musicAudio.pause();
    } else if (!audioMusicMuted) {
      if (!musicStarted) startMusicIfNeeded();
      else if (musicAudio) musicAudio.play().catch(() => {});
    }
    applyAudioState();
  }
  function setSfxMuted(m) {
    audioSfxMuted = !!m;
    applyAudioState();
  }
  function setAmbientVolume(v) {
    audioAmbientVolume = Math.max(0, Math.min(1, v));
    applyAudioState();
  }
  function setEnginesVolume(v) {
    audioEnginesVolume = Math.max(0, Math.min(1, v));
    applyAudioState();
  }
  function setAmbientMuted(m) {
    audioAmbientMuted = !!m;
    applyAudioState();
  }
  function setEnginesMuted(m) {
    audioEnginesMuted = !!m;
    applyAudioState();
  }
  // Switch the playing music track on the fly. Persists user choice.
  function setMusicTrack(name) {
    if (typeof name !== 'string' || !MUSIC_TRACKS.includes(name)) return;
    try { localStorage.setItem(AUDIO_LS.musicTrack, name); } catch (_) {}
    try { localStorage.setItem(AUDIO_LS.musicMode, 'manual'); } catch (_) {}
    musicPickedTrack = name;
    // Restart playback so the new track takes over immediately if music is on.
    if (musicAudio) {
      try { musicAudio.pause(); } catch (_) {}
      try { musicAudio.src = ''; } catch (_) {}
    }
    musicAudio = null;
    musicStarted = false;
    if (!audioMusicMuted) startMusicIfNeeded();
  }
  function setMusicRandomTrack() {
    try { localStorage.removeItem(AUDIO_LS.musicTrack); } catch (_) {}
    try { localStorage.removeItem(AUDIO_LS.musicMode); } catch (_) {}
    musicPickedTrack = randomMusicTrack();
    if (musicAudio) {
      try { musicAudio.pause(); } catch (_) {}
      try { musicAudio.src = ''; } catch (_) {}
    }
    musicAudio = null;
    musicStarted = false;
    if (!audioMusicMuted) startMusicIfNeeded();
  }
  function currentMusicTrack() {
    return musicPickedTrack || manualMusicTrack() || MUSIC_RANDOM_TRACKS[0] || MUSIC_TRACKS[0];
  }

  // -------- positional audio (water + engines) --------
  // Web Audio sources placed at world positions. Each is a looped buffer
  // routed through Gain → StereoPanner → master. Per-frame we compute
  // distance-based volume and L/R pan from the camera so sounds rise and
  // fall as you move around the world. Two overlapping variants per
  // location with random start offsets mask the loop point.
  let _audioCtx = null;
  let _audioMaster = null;
  const _audioBufferCache = new Map();           // url -> Promise<AudioBuffer>
  const _positionalSources = [];                 // active source descriptors
  const WATER_FOLEY = ['foley-water-1.mp3','foley-water-2.mp3','foley-water-3.mp3','foley-water-4.mp3'];
  const ENGINE_FOLEY = ['foley-rocket-engines-1.mp3','foley-rocket-engines-2.mp3','foley-rocket-engines-3.mp3','foley-rocket-engines-4.mp3'];

  function ensureAudioCtx() {
    if (_audioCtx) return _audioCtx;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    try {
      _audioCtx = new Ctor();
      _audioMaster = _audioCtx.createGain();
      _audioMaster.gain.value = 1.0;
      _audioMaster.connect(_audioCtx.destination);
    } catch (_) { _audioCtx = null; }
    return _audioCtx;
  }

  function resumeAudioCtxIfNeeded() {
    if (!_audioCtx) return;
    if (_audioCtx.state === 'suspended') {
      _audioCtx.resume().catch(() => {});
    }
  }

  function loadAudioBuffer(url) {
    const ctx = ensureAudioCtx();
    if (!ctx) return Promise.resolve(null);
    if (_audioBufferCache.has(url)) return _audioBufferCache.get(url);
    const p = fetch(SOUNDS_BASE + url)
      .then(r => r.arrayBuffer())
      .then(buf => new Promise((resolve, reject) => {
        // Some browsers expect callback form; promise form fails silently.
        try {
          const ret = ctx.decodeAudioData(buf, resolve, reject);
          if (ret && typeof ret.then === 'function') ret.then(resolve, reject);
        } catch (err) { reject(err); }
      }))
      .catch(() => null);
    _audioBufferCache.set(url, p);
    return p;
  }

  // bus: 'ambient' (water) or 'engines' (planes)
  async function spawnPositionalSource(url, getPos, bus, baseVolume = 1.0, startOffsetSec = null) {
    const ctx = ensureAudioCtx();
    if (!ctx) return null;
    const buf = await loadAudioBuffer(url);
    if (!buf) return null;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const panner = ctx.createStereoPanner();
    src.connect(gain).connect(panner).connect(_audioMaster);
    // Random start offset so two variants don't sync up + the loop seam
    // doesn't always land at the same world moment.
    const offset = (startOffsetSec == null)
      ? Math.random() * Math.max(0.1, buf.duration - 0.1)
      : Math.max(0, Math.min(buf.duration - 0.05, startOffsetSec));
    try { src.start(0, offset); } catch (_) {}
    const entry = { src, gain, panner, getPos, bus, baseVolume, alive: true };
    _positionalSources.push(entry);
    return entry;
  }

  function disposePositionalSource(entry) {
    if (!entry || !entry.alive) return;
    entry.alive = false;
    try { entry.src.stop(); } catch (_) {}
    try { entry.src.disconnect(); } catch (_) {}
    try { entry.gain.disconnect(); } catch (_) {}
    try { entry.panner.disconnect(); } catch (_) {}
    const idx = _positionalSources.indexOf(entry);
    if (idx >= 0) _positionalSources.splice(idx, 1);
  }

  // Distance falloff curve. Audible from ~3m, silent past ~35m.
  const POSITIONAL_NEAR = 3.0;
  const POSITIONAL_FAR  = 35.0;

  const _camFwd = new THREE.Vector3();
  const _camRight = new THREE.Vector3();
  const _camUp = new THREE.Vector3();
  function tickPositionalAudio() {
    if (!_audioCtx || _positionalSources.length === 0) return;
    if (_audioCtx.state === 'suspended') return;
    // Camera basis vectors for stereo panning. We project the source's
    // horizontal offset onto the camera-right axis and divide by distance
    // to get a -1..+1 pan value.
    camera.getWorldDirection(_camFwd);
    _camUp.set(0, 1, 0);
    _camRight.copy(_camFwd).cross(_camUp).normalize();
    const cam = camera.position;
    const now = _audioCtx.currentTime;
    for (let i = _positionalSources.length - 1; i >= 0; i--) {
      const e = _positionalSources[i];
      let pos = null;
      try { pos = e.getPos(); } catch (_) { pos = null; }
      let finalVol = 0;
      let pan = 0;
      if (pos) {
        const dx = pos.x - cam.x;
        const dy = pos.y - cam.y;
        const dz = pos.z - cam.z;
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
        // Falloff — tight per bus so each sound is only audible when really
        // near its source. Without this, an "ambient" source at the river
        // bleeds across the whole island.
        let near = POSITIONAL_NEAR, far = POSITIONAL_FAR;
        let curveExp = 2; // quadratic by default
        if (e.bus === 'engines') {
          // Planes fly past at offscreen distance ~26 + camera radius ~35,
          // so peak distance is comfortably under 80. Use a wider range
          // with linear-ish curve so you hear the approach and fade.
          near = 4; far = 90; curveExp = 1.2;
        } else if (e.bus === 'ambient') {
          near = 1.5; far = 11; curveExp = 2;
        }
        const t = Math.max(0, Math.min(1, (dist - near) / Math.max(0.001, far - near)));
        const vol = Math.pow(1 - t, curveExp) * e.baseVolume;
        // Pan: horizontal offset projected onto camera-right.
        const px = dx * _camRight.x + dz * _camRight.z;
        const norm = dist > 0.5 ? px / dist : 0;
        pan = Math.max(-1, Math.min(1, norm * 1.3));
        const busOn = e.bus === 'engines' ? !audioEnginesMuted : !audioAmbientMuted;
        const busLvl = e.bus === 'engines' ? audioEnginesVolume : audioAmbientVolume;
        finalVol = busOn ? vol * busLvl : 0;
      }
      try {
        e.gain.gain.setTargetAtTime(finalVol, now, 0.08);
        e.panner.pan.setTargetAtTime(pan, now, 0.08);
      } catch (_) {}
    }
  }

  // Master volume bus update — re-applied by applyAudioState through this
  // shim. Pure no-op when context not yet built.
  function updatePositionalBusGains() {
    if (!_audioCtx) return;
    // Per-source gains get updated in the next tick anyway.
  }

  // --- water sources -----------------------------------------------------
  // Pick a few cluster centres from the home water cells and place two
  // overlapping variants per cluster. Re-evaluated when the world changes.
  const _waterSources = [];
  function clearWaterSources() {
    for (const e of _waterSources.splice(0)) disposePositionalSource(e);
  }
  function collectWaterClusterCenters() {
    const cells = [];
    if (typeof world === 'undefined' || !world) return cells;
    for (let x = 0; x < GRID; x++) {
      const col = world[x];
      if (!col) continue;
      for (let z = 0; z < GRID; z++) {
        const c = col[z];
        if (c && c.terrain === 'water') {
          const p = (typeof tilePos === 'function') ? tilePos(x, z) : { x: x - GRID/2 + 0.5, z: z - GRID/2 + 0.5 };
          cells.push({ x: p.x, z: p.z });
        }
      }
    }
    if (!cells.length) return [];
    // Single cluster: use centroid. Good enough for the typical river layout.
    let cx = 0, cz = 0;
    for (const p of cells) { cx += p.x; cz += p.z; }
    cx /= cells.length; cz /= cells.length;
    return [{ x: cx, y: 0, z: cz }];
  }
  async function rebuildWaterSources() {
    clearWaterSources();
    if (!ensureAudioCtx()) return;
    const centers = collectWaterClusterCenters();
    if (!centers.length) return;
    for (const c of centers) {
      const v1 = WATER_FOLEY[Math.floor(Math.random() * WATER_FOLEY.length)];
      let v2 = WATER_FOLEY[Math.floor(Math.random() * WATER_FOLEY.length)];
      if (v2 === v1) v2 = WATER_FOLEY[(WATER_FOLEY.indexOf(v2) + 1) % WATER_FOLEY.length];
      const getPos = () => c;
      const a = await spawnPositionalSource(v1, getPos, 'ambient', 0.85);
      const b = await spawnPositionalSource(v2, getPos, 'ambient', 0.55);
      if (a) _waterSources.push(a);
      if (b) _waterSources.push(b);
    }
  }

  // --- engine sources ----------------------------------------------------
  // One looped rocket-engine source per plane. The plane's world position
  // drives the panner each frame. Silent when the plane is hidden.
  const _engineSources = [];
  async function setupEngineSources() {
    if (!ensureAudioCtx()) return;
    if (_engineSources.length || typeof planes === 'undefined' || !planes) return;
    for (let i = 0; i < planes.length; i++) {
      const plane = planes[i];
      const variant = ENGINE_FOLEY[i % ENGINE_FOLEY.length];
      const getPos = (() => {
        const wp = new THREE.Vector3();
        return () => {
          if (!plane || !plane.group || !plane.group.visible) return null;
          plane.group.getWorldPosition(wp);
          return wp;
        };
      })();
      const entry = await spawnPositionalSource(variant, getPos, 'engines', 1.0);
      if (entry) _engineSources.push(entry);
    }
  }

  // First-gesture initialiser — Web Audio contexts can't start until the
  // page has been interacted with. We piggy-back the existing music
  // autostart by listening for the same first gesture.
  let _positionalAudioBooted = false;
  function bootPositionalAudio() {
    if (_positionalAudioBooted) return;
    _positionalAudioBooted = true;
    ensureAudioCtx();
    resumeAudioCtxIfNeeded();
    // Water sources need the world to exist. Defer one tick so the initial
    // scene has populated `world[][]`.
    setTimeout(() => { rebuildWaterSources(); }, 50);
    setTimeout(() => { setupEngineSources(); }, 100);
  }
  (function armPositionalAudioAutostart() {
    const handler = () => {
      window.removeEventListener('pointerdown', handler);
      window.removeEventListener('keydown', handler);
      bootPositionalAudio();
    };
    window.addEventListener('pointerdown', handler, { passive: true });
    window.addEventListener('keydown', handler);
  })();

  // Expose so external code (setCell, world load, reset) can refresh water
  // sources when the river layout changes.
  window.__tinyworldRefreshWaterAudio = () => {
    if (_positionalAudioBooted) rebuildWaterSources();
  };

  // Sound panel wiring — single icon toggles a floating panel with the
  // music track picker plus volume sliders for music, sfx, ambient, engines.
  (function setupSoundPanel() {
    const icon = document.getElementById('sound-icon');
    const panel = document.getElementById('sound-panel');
    const closeBtn = document.getElementById('sound-panel-close');
    const musicVol = document.getElementById('snd-music-vol');
    const sfxVol   = document.getElementById('snd-sfx-vol');
    const ambientVol = document.getElementById('snd-ambient-vol');
    const enginesVol = document.getElementById('snd-engines-vol');
    const musicMute   = document.getElementById('snd-music-mute');
    const sfxMute     = document.getElementById('snd-sfx-mute');
    const ambientMute = document.getElementById('snd-ambient-mute');
    const enginesMute = document.getElementById('snd-engines-mute');
    const trackList = document.getElementById('snd-music-tracks');
    if (!icon || !panel || !musicVol) return;

    // Renderable name from the file name (drop extension and clean up).
    function prettyTrackName(file) {
      return file.replace(/\.mp3$/i, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    function renderTracks() {
      if (!trackList) return;
      const active = currentMusicTrack();
      const manualTrack = manualMusicTrack();
      trackList.innerHTML = '';
      const randomBtn = document.createElement('button');
      randomBtn.type = 'button';
      randomBtn.className = 'sound-track-item' + (!manualTrack ? ' active' : '');
      randomBtn.setAttribute('role', 'option');
      randomBtn.setAttribute('aria-selected', !manualTrack ? 'true' : 'false');
      const randomDot = document.createElement('span');
      randomDot.className = 'track-dot';
      randomDot.setAttribute('aria-hidden', 'true');
      const randomLabel = document.createElement('span');
      randomLabel.textContent = 'Random Horizon';
      randomBtn.appendChild(randomDot);
      randomBtn.appendChild(randomLabel);
      randomBtn.addEventListener('click', () => {
        setMusicRandomTrack();
        renderTracks();
      });
      trackList.appendChild(randomBtn);
      MUSIC_TRACKS.forEach(name => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sound-track-item' + (manualTrack && name === active ? ' active' : '');
        btn.setAttribute('role', 'option');
        btn.setAttribute('aria-selected', manualTrack && name === active ? 'true' : 'false');
        const dot = document.createElement('span');
        dot.className = 'track-dot';
        dot.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.textContent = prettyTrackName(name);
        btn.appendChild(dot);
        btn.appendChild(label);
        btn.addEventListener('click', () => {
          setMusicTrack(name);
          renderTracks();
        });
        trackList.appendChild(btn);
      });
    }

    function syncMuteUi() {
      musicMute.classList.toggle('muted', audioMusicMuted);
      sfxMute.classList.toggle('muted', audioSfxMuted);
      ambientMute.classList.toggle('muted', audioAmbientMuted);
      enginesMute.classList.toggle('muted', audioEnginesMuted);
      // The launcher icon is "muted" when everything is muted.
      const allMuted = audioMusicMuted && audioSfxMuted && audioAmbientMuted && audioEnginesMuted;
      icon.classList.toggle('muted', allMuted);
    }
    function syncValues() {
      musicVol.value   = Math.round(audioMusicVolume   * 100);
      sfxVol.value     = Math.round(audioSfxVolume     * 100);
      ambientVol.value = Math.round(audioAmbientVolume * 100);
      enginesVol.value = Math.round(audioEnginesVolume * 100);
      syncMuteUi();
    }
    syncValues();
    renderTracks();

    function openPanel() {
      panel.hidden = false;
      icon.setAttribute('aria-expanded', 'true');
      icon.classList.add('open');
      renderTracks();
    }
    function closePanel() {
      panel.hidden = true;
      icon.setAttribute('aria-expanded', 'false');
      icon.classList.remove('open');
    }
    icon.addEventListener('click', () => {
      if (panel.hidden) openPanel(); else closePanel();
    });
    if (closeBtn) closeBtn.addEventListener('click', closePanel);

    // Click outside to close.
    document.addEventListener('pointerdown', e => {
      if (panel.hidden) return;
      if (panel.contains(e.target) || icon.contains(e.target)) return;
      closePanel();
    });
    // Escape to close.
    document.addEventListener('keydown', e => {
      if (!panel.hidden && e.key === 'Escape') closePanel();
    });

    musicVol.addEventListener('input', () => {
      setMusicVolume(parseFloat(musicVol.value) / 100);
      if (audioMusicVolume > 0 && audioMusicMuted) { setMusicMuted(false); syncMuteUi(); }
    });
    sfxVol.addEventListener('input', () => {
      setSfxVolume(parseFloat(sfxVol.value) / 100);
      if (audioSfxVolume > 0 && audioSfxMuted) { setSfxMuted(false); syncMuteUi(); }
    });
    sfxVol.addEventListener('change', () => {
      if (!audioSfxMuted) playSfx('rustle');
    });
    ambientVol.addEventListener('input', () => {
      setAmbientVolume(parseFloat(ambientVol.value) / 100);
      if (audioAmbientVolume > 0 && audioAmbientMuted) { setAmbientMuted(false); syncMuteUi(); }
    });
    enginesVol.addEventListener('input', () => {
      setEnginesVolume(parseFloat(enginesVol.value) / 100);
      if (audioEnginesVolume > 0 && audioEnginesMuted) { setEnginesMuted(false); syncMuteUi(); }
    });

    musicMute.addEventListener('click', () => { setMusicMuted(!audioMusicMuted); syncMuteUi(); });
    sfxMute.addEventListener('click',   () => { setSfxMuted(!audioSfxMuted);     syncMuteUi(); });
    ambientMute.addEventListener('click', () => { setAmbientMuted(!audioAmbientMuted); syncMuteUi(); });
    enginesMute.addEventListener('click', () => { setEnginesMuted(!audioEnginesMuted); syncMuteUi(); });
  })();

