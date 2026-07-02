  // -------- late boot (deferred forward-ref-safe calls) --------
  // Calls relocated here from earlier modules whose original top-level
  // position (valid under the single-script build's hoisting) now runs before
  // their dependencies' modules have loaded. Running them once at the end —
  // after every module is defined — reproduces the original behaviour.

  // Was at module 02 top level; reaches syncCloudPopulation/clouds (module 23).
  // Guarded internally (no-op until clouds exist), so an extra end-of-load
  // sync is safe and idempotent.
  applyCloudSettings();

  // Render-settings panel wiring (module 21). Was an IIFE that ran at module
  // load and reached forward into module 27 (syncPlanetUnderlayToggle) and
  // syncAiSettings. Runs identically here, after every module is defined.
  setupRenderSettings();

  // Material sliders are persisted before the app boots, but the actual
  // colour/wear pass used to run only after the user moved a control. Apply it
  // once now so saved wear-and-tear is visible on first render.
  if (typeof applyPersistedMaterialSettingsOnBoot === 'function') {
    applyPersistedMaterialSettingsOnBoot();
  }

  // Build the cloud sea now if it was left enabled in a previous session
  // (default is off, so this is usually a no-op).
  if (typeof setCloudSeaEnabled === 'function' && typeof renderCloudSea !== 'undefined') {
    setCloudSeaEnabled(renderCloudSea);
  }

  // Apply persisted cloud style (voxel vs soft sprite clouds). Default 'voxel'
  // is a no-op; 'soft' hides the voxel clouds and builds the sprite clumps.
  if (typeof setCloudStyle === 'function' && typeof renderCloudStyle !== 'undefined') {
    setCloudStyle(renderCloudStyle);
  }

  if (typeof applyStarlitAtmosphereSettings === 'function') {
    applyStarlitAtmosphereSettings();
  }

  // Wire the global "Building windows" controls (Settings -> Materials) and
  // apply any persisted window defaults. Runs after the settings DOM + the
  // WINDOW config exist.
  if (typeof setupWindowGlobalSettings === 'function') {
    setupWindowGlobalSettings();
  }
