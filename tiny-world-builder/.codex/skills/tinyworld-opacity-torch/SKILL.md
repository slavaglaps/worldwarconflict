---
name: tinyworld-opacity-torch
description: Use when changing ghost boards, multiplayer preview boards, panning, ghost visibility, jigsaw reveal, or any visibility behavior around the active Tiny World board.
---

# Tiny World Visibility — Sticky Preview Reveal

The opacity *torch* is gone. The home board is always fully rendered;
Preview cells reveal one-by-one as the camera pans into them, and stay
revealed forever after that (a breadcrumb trail behind the user).

Mental model:

- Every user has one editable home board (size `GRID`, default 8).
- The home `GRID x GRID` region is **always** at full opacity, full
  color, full scale — never fades, never pops.
- Preview boards surround the home board and preview other users' content.
- Nothing is rendered in grayscale — all tiles use their full color.
- A Preview cell is hidden until it enters the visible square around
  `target.x/z` (`renderVisibleSize` wide). Once revealed, the cell is
  *sticky*: `root.userData.revealed = true` and it stays revealed for
  the rest of the session. Its final display opacity is controlled by the
  user-facing Preview opacity / floors / objects sliders.

Reveal rules:

- `opacityAtWorldPosition(x, z)` returns:
  - `1` inside the home GRID square,
  - `1` inside the visible window around the camera target,
  - `0` otherwise.
- `revealOpacityFor(root)` wraps `opacityAtWorldPosition` and adds
  stickiness. Once it sees a positive opacity for a root it sets
  `userData.revealed = true` and returns `1` from then on. Per-frame
  update loops (`updateGhostRenderBubble`, `updateHomeBoardFade`) call
  this instead of `opacityAtWorldPosition` directly so revealed cells
  don't disappear when the camera moves away.
- `updateHomeBoardFade` short-circuits in-grid cells to opacity `1` —
  they never go through the reveal path.
- `tickOpacityTransitions(dt)` eases each root's `currentOpacity` toward
  `targetOpacity` at rate `dt * 20` for a snappy snap-in.
- During the transition, root scale follows
  `0.6 + 0.4 * currentOpacity`, so revealed tiles grow from 60 % to
  full size in <200 ms. At opacity 1 the scale is exactly 1 — static
  home tiles and previously-revealed cells stay untouched.
- `userData.landing` (drop-in animator) takes priority — skip the scale
  pop while landing.
- `desaturateMaterial()` is now a no-op; all Preview / out-of-bounds tiles
  render in full color.

Interaction rules:

- Left-click edits only the central home board through `pickTile`.
- Preview board meshes must not set `userData.gx/gz` on their tile/object
  roots in a way that lets them be edited.
- Right-drag pans. Space+drag pans. Left-drag orbits.
- Panning is **unrestricted**: `clampTargetToHomeBoard()` is no longer called
  from the pan paths (`panCameraByPixels`/`panCameraByCells` in
  `02-cameras-lighting.js`) or the minimap click-to-go (`30-ui-boot-wiring.js`),
  so the camera target can move anywhere regardless of Autoexpand. The clamp
  helper is retained only for the explicit Autoexpand-OFF reset (which recenters
  to the home board). Note: with Autoexpand off, panning beyond the home board
  shows empty water/sky because `maybeEnsureGhostBoardsAroundTarget` early-returns
  when `renderAutoExpand` is false — turn Autoexpand on to reveal preview boards.

The home board has a thin dark ground-line border (see
`buildHomeBorder()` in the *home board border* section) so the user can
always see where the editable region ends, regardless of how much of
the Preview world has been revealed around it.

- Preview distance/window auto-scale from `GRID` on first load and whenever
  board size changes: small boards can preview farther; large boards keep
  neighbour preload distance/window tighter for performance. Users can still
  override those settings from Settings → World.
- Landscape-mode ghost-board suppression must be scoped to an actually active
  `isLandscapeMeshActive()` engine. If the user leaves terrain/landscape mode,
  normal Autoexpand should immediately restore classic Preview ghost boards.
- Preview objects must always stay full-fidelity. Do not render ghost-board
  houses/trees/crops/rocks/animals as cheap proxy boxes, cones, or pyramids at
  any zoom level. If a grid size is too expensive for full Preview boards,
  reduce/disable preview rings through `renderBudgetForGrid()` instead.

Validation:

- The home `GRID x GRID` board never fades and never scale-pops.
- Panning forward should reveal new Preview pieces one cell at a time
  with a tiny scale-up pop.
- Panning back over previously-revealed territory should keep that
  territory at full opacity (no re-fade, no re-pop).
- Out-of-range cells the camera has never seen should be
  `root.visible = false`.
- No tile should appear washed-out / desaturated.
- `pickTile()` over a Preview board should still return `null`.
- Home board outline should remain visible at every grid size
  (8 / 12 / 16 / 20).

## Continuous Landscape Mode Visibility & Panning

When `landscapeMeshMode` is active (procedural Canyon landscape style):
- **Clipped Diorama**: If the user has not panned the camera yet, the landscape is clipped strictly to the home board (`GRID` size) to present a clean, sliced diorama look.
- **Dynamic Panning**: Unlike standard mode (which clamps camera panning to the home board), landscape mode allows the camera to pan freely.
- **Dynamic Clip Bounds**: On the first camera pan, `hasUserPanned` is set to `true`, and the landscape clipping radius expands to `renderVisibleSize` within the 20x20 home-board cap and centers on the camera target. This allows continuous terrain chunks to generate and "paint in" dynamically as the user explores the surrounding landscape, while the 8x8 home grid remains centered and intact.
- **Reset to Diorama**: When a new scene is generated, loaded, or reset, `hasUserPanned` is reset to `false`, restoring the clean sliced diorama look centered on `0, 0` until the user starts panning again.
- **Pixel Outline Clipping**: During normal/depth outline passes, the active clipping planes are copied to `pixelState.normalMaterial.clippingPlanes` to prevent out-of-bounds clipped mesh segments from rendering outline "ghosts".
