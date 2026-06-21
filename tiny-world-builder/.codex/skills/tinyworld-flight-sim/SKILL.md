# tinyworld-flight-sim

Flyable plane flight, ported from the standalone `ships/flight-sim3.html` arcade
model. **The plane is NOT a bespoke tool or object kind** — it is the existing
crop-duster / stunt-plane that the codebase already ships as a **model-stamp**
(`models/stunt_plane.glb`, stamp id `stunt-plane`, label "Stunt Plane"), placed
through the **Stamps** system. The placed cell is therefore
`kind: 'model-stamp'` with `appearance.modelStampId === 'stunt-plane'`.

Do not reintroduce a separate `plane` tool/kind — that was a wrong turn. Flight
attaches to whatever model-stamp the player already placed, detected by signature.

## Where it lives
- `engine/world/34-flight-sim.js` — the whole system: trimmed physics, chase cam,
  `enterFlight`/`exitFlight`, `tickFlight`, HUD, Enter/Fly menu, key capture, and
  `isFlyableStampCell(cell)` (the detector). Loaded between `33-radial-menu.js`
  and `99-late-boot.js`.
- `isFlyableStampCell(cell)` returns true when `cell.kind === 'model-stamp'` and
  the resolved `getModelStamp(appearance.modelStampId)` signature matches
  `/plane|aircraft|airplane|stunt|crop-?duster|jet/`. Exposed as
  `window.isFlyableStampCell`.
- Wiring hooks:
  - `20-input-place-erase.js` — `applyTool` gains `if (window.__flightActive) return;`.
    In the `pointerup` click-resolution block, a **plain (unmodified) click on a
    flyable stamp opens the Enter/Fly menu regardless of the active tool** (you
    still erase it with the eraser). This runs BEFORE the place/select branches so
    a click never stacks/replaces the plane. NOTE: a plain Select click resolves
    here, NOT in `applyTool` (`applyTool` is only reached by non-select tools).
  - `25-animation-loop-schema.js` — `if (window.tickFlight) window.tickFlight(dt);`
    right before `renderScene()`.
  - `styles/tiny-world.css` — `.flight-hud`, `.flight-menu`, `.flight-menu-btn`,
    `body.flight-active`.

## The scale trick (do not "fix" this)
The ships model is tuned for a kilometre-scale world (cruise ~77 m/s). Physics
runs untouched in **sim space**; the flown object (the placed stamp group) position
is mapped into the scene via a single **similarity transform**:
`scenePos = sceneOrigin + yawQuat * ((simPos - simOrigin) * FLIGHT_SIM_TO_SCENE)`
(`FLIGHT_SIM_TO_SCENE = 0.09`). `sceneOrigin`/yaw are captured from the parked
stamp at `enterFlight`. Ground is a flat sim plane at spawn height.
- **Camera is the exception**: the chase cam is framed in **scene units** (~3–5.5
  units behind, ~1.45 up — the plane is ~1.35 units wide), NOT run through the sim-scale
  transform. Running the camera offset through the sim scale parks it inside the
  tail (the original bug). Controls: arrows Up/Down = throttle, Left/Right = rudder.

## Flow
- Place the **Stunt Plane** from Stamps (it is a model-stamp).
- Plain-click the placed plane → `showFlightMenu` → "Enter / Fly" →
  `enterFlight(x,z)`: swaps the global `camera` to a `flightCam` (FOV 60), captures
  keys, and uses the placed stamp group as the flown mesh (`flightJet`); spins
  the named propeller mesh in place and adds the Dusty-style translucent strobe
  disc whose opacity flickers with throttle.
- Controls: W = nose down, S or X = nose up (pitch), A/D roll, Q/E yaw, Shift/Ctrl OR
  ArrowUp/ArrowDown = throttle, ArrowLeft/ArrowRight = rudder, B brake.
- Combat controls live in `41-flight-combat.js` while flying: left mouse or
  Space holds guns, `X` fires a missile, and right-click fires one missile via
  `window.__flightMissilePressed` / `window.__flightMissileHeld`. The pointer
  handler in `34-flight-sim.js` must prevent the context menu only while
  `flightActive` is true. Missile hits and destruction should use the pooled
  flight explosion sprites (`tw_flight_explosions`) plus smoke trails rather
  than adding DOM effects or build-mode controls.
- `Escape` → `exitFlight()`: restores the previous camera, calls `updateCamera()`,
  re-renders the cell to re-park the stamp.

## Gotchas
- Module 34 shares the global scope with every other `engine/world` module — all
  its top-level scratch globals are `_fl…`-prefixed to avoid the duplicate-
  identifier instantiation failure (see AGENTS.md "Project shape"). A duplicate
  top-level `const`/`let`/`function` name silently kills the whole module.
- The tool picker is a **search palette** (`#palette-search` → `#palette-results`),
  not a fixed toolbar; the stunt plane is found under Stamps, not a tool button.
- The stunt plane propeller mesh (`SM_Veh_Plane_Stunt_01_Prop`) already has its
  local origin at the hub. Match the crop-duster path by rotating that mesh in
  place around local Z; do not wrap it in a new AABB-centred pivot, or it orbits
  off-centre instead of spinning like the ambient dusting plane.
- The flight propeller must read like the ambient Dusty/crop-duster prop while
  borrowing the duplicate-island engine tint: high apparent RPM, a dark
  translucent disc, and mostly faded physical blades at cruise throttle. A solid
  blade screenshot means the visual balance is wrong even if the mesh is
  technically rotating.
- The blur shape should be a round camera-facing disc, not a projected oval from
  a tilted local mesh. Use the circular sprite treatment for flight-camera
  readability.
- Flight is arcade-scale for a tiny world: `enterFlight` launches the plane
  already cruising just above the board (initial forward speed + throttle 0.6)
  so there is no runway taxi phase. Collision and landing are checked in scene space against the
  TinyWorld board surface plus object bounds, then converted back to sim-space Y.
  The collision hot path must stay candidate-based: collect the small 3x3-ish
  cell window around the plane in home/world coordinates plus the matching local
  window for each editable island, then test only those rendered `cellMeshes`
  entries. Do not return to splitting and scanning every `cellMeshes` key per
  frame. Shallow, upright touchdowns become `ROLLING` / `LANDED`; hard terrain
  strikes or object hits stop the plane and show a collision/hard-landing status.
  Tuning lives in `FCFG`, `FLIGHT_SIM_TO_SCENE` (0.09), and the
  `FLIGHT_SCENE_*` collision constants.

## Verify (real app, real pointer pipeline — not synthetic shortcuts)
`npm run dev`, then via agent-browser `eval`:
1. Place: `setCell(x,z,{terrain:'grass',terrainFloors:1,kind:'model-stamp',floors:1,appearance:{modelStampId:'stunt-plane'}})`;
   `isFlyableStampCell(getWorldCell(x,z))` is true once the GLB loads.
2. Find a screen point where `pickTile(px,py)` resolves to the plane cell (project +
   search a small window — projecting the centre alone misses, terrain raycast is
   angled), then dispatch real `pointerdown`/`pointerup` there → `.flight-menu` appears.
3. Click `.flight-menu-btn` → `camera.fov === 60`, `window.__flightActive === true`.
4. Dispatch `keydown` ShiftLeft+KeyW, run ~2.5s → the stamp's world position moves.
5. `Escape` → `camera.fov === 28`, `__flightActive === false`, stamp re-parked.
