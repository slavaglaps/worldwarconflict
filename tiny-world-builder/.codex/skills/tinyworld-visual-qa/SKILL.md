---
name: tinyworld-visual-qa
description: Use when visually testing Tiny World Builder UI, camera, ghost opacity, buildings, tile geometry, or frontend polish in the browser.
---

# Tiny World Visual QA

Use the browser route `http://localhost:3000/tiny-world-builder` when available.

Checks:

- Console has no app errors.
- Toolbar shortcuts still work: `0`, `1`-`9`, letter tools, `E`.
- Left-click places only on the editable home board.
- Right-drag and Space+drag pan smoothly.
- Dragging/clicking the minimap canvas pans the camera target while dragging the minimap chrome/footer still moves the widget.
- Minimap colours should track live scene materials plus time/weather theme tint, not a stale fixed palette.
- Orbit still works with normal left-drag.
- Ghost boards do not become editable.
- The opacity torch is smooth and does not reveal square board seams.
- Tilt-shift overlays have `pointer-events: none`, stay below UI controls, and remain visible during pan/orbit/zoom movement.
- Cloud shadow at 0% / low values should reduce ground shadow strength without hiding visible cloud puffs.
- At night/dusk, the star vault should appear behind the world without covering
  objects or UI, cloud rim lighting should warm cloud edges, and accent lights
  should brighten nearby foreground objects without adding shadow-map cost.
- Lamp/spotlight stamps should show a blurred warm haze plus a ground spill at
  night. The spotlight spill must be narrow at the fixture and wider/fainter in
  front of it; window spill decals should not render through buildings or lose
  their additive material during fade/reveal.
- Blast shield QA: open `?shield=1`, confirm `window.VoxelShield` exposes the
  supplied class/API names, has 4 keystones and 32 panels, blue rune faces point
  outward, `open()` / `close()` / `toggle()` / `setProgress()` work, and the
  bottom toolbar Home and Shield buttons sit side by side with Shield reflecting
  raised/lowered state.
- Garden Fence should be selectable from the Infra group, render with dark
  posts/vine/fruit accents, persist through export/import, and batch contiguous
  same-style runs as one span anchor.
- Building details should be believable: manor portico columns stay entry-scale, windows have frames/crossbars, and tall buildings do not stretch entry features unrealistically.
- Toolbar flyouts should sit clear of the toolbar (about 10px), avoid vertical clipping, and reduce empty thumbnail air via camera/frustum framing rather than negative CSS margins inside scrollable flyout containers.
- The Stamps panel should open as a compact floating canvas panel, stay open while placing items, drag by its header, avoid AI/create/enhance controls, and keep darker thumbnail previews readable.
- Dialog titles should use the shared Fraunces `.modal-head strong` treatment, with explanatory body copy in `.modal-copy` / `.confirm-copy` and readable darker muted text.
- Selection preview in the floating agent panel should show useful property chips for the primary selected kind. Supported properties (e.g. tower Top/Body colour, building Shape, Size) should apply immediately through `setCell`; unsupported creative edits can fall back to prompts.
- Selection preview must render the same object/stamp factory as the world view. Voxel-build/custom objects should not fall back to a generic blue cube.
- Selection preview markup and wiring must stay connected: `selection-preview-canvas`, `selection-preview-actions`, and the Preview/Details tabs should exist in the panel, and `renderSelection()` should call `updateSelectionPreview()` as the selected target changes.
- Selection colour controls should offer a broad palette for supported object parts, not just 3-4 legacy swatches.
- Planet-underlay visual proof should use deterministic proof URLs such as `http://localhost:3000/tiny-world-builder?planet=desert&planetStyle=lowpoly&planetDrop=60&seed=skytest&planetProof=1` and `http://localhost:3000/tiny-world-builder?planet=desert&planetStyle=realistic&planetDrop=60&seed=skytest&planetProof=1`: they hide non-canvas chrome, dismiss the welcome modal, widen the perspective camera, apply the underlay horizon haze and between-layer atmosphere sheets, and leave a small proof badge. Prefer this over judging one-shot screenshots where normal UI panels or default camera framing obscure the underlay.

Useful browser probes:

```js
pickTile(window.innerWidth / 2, window.innerHeight / 2)
```

```js
getComputedStyle(document.body, '::before').pointerEvents
getComputedStyle(document.body, '::after').pointerEvents
```
