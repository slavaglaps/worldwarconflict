---
name: tinyworld-lowpoly-world-prompt
description: Use when editing Tiny World Builder prompts, model-generated worlds, Auto suggestions, or any model behavior that should create coherent low-poly 3D board scenes.
---

# Tiny World Low-Poly World Prompting

The built-in model should act like a compact low-poly diorama designer, not a random tile filler.

Prompt principles:

- Generate should be text-only by default: use OpenAI `gpt-5.5` for validated
  world JSON and do not add an image-generation topology prepass unless the
  user explicitly asks for images again.
- Honour the selected generation board size. The Generate dialog can request
  any `HOME_GRID_OPTIONS` size, so prompts must include the requested
  `gridSize` and coordinate bounds instead of assuming 8x8.
- Floating chat prompts are additive patches by default. Unless the prompt
  explicitly asks to replace/reset/rebuild or starts with `/clear`, preserve the
  existing board and return only complete final-state cells that should be
  added or changed.
- Start from a readable scene concept: village, farm, canal, ridge, market, castle, garden, or mixed landmark.
- Use strong silhouettes: tall/short contrast, clustered houses, towers, hills, trees, walls, and clear negative space.
- Make terrain do composition work: paths lead the eye, water creates crossings, dirt groups crops, grass gives breathing room.
- Treat hills and mountains as elevation/height through `terrainFloors`, not
  as a field of rock objects. Rocks are sparse landmarks or boulders only.
- Use adjacency intentionally: house clusters merge, fences connect, bridges belong on water crossings, crops form fields.
- Avoid noise: do not fill every board cell; leave open cells and visible paths.
- Use `floors` as variation/intensity, including terrain stacking and object detail.
- Use forced `buildingType` only when a distinct one-cell variant is wanted; otherwise leave houses as `buildingType: null` so cluster logic can work.
- Keep output strictly machine-parseable JSON matching the schema.

Primitive assembly prompting:

- Tell models they cannot invent new object kinds, meshes, labels, or custom geometry in JSON.
- Ask them to translate broad environments into available primitives: terrain, raised terrainFloors, houses/building variants, fences/fenceSide, rocks, bridges, crops, tufts, and trees.
- Treat native primitives as scene components, not the creativity ceiling. If the user asks for a distinct object with no native kind, author it as a `customParts` voxel-build hero cell instead of reducing it to rocks, houses, or terrain.
- Include concrete decompositions for non-native requests:
  - skate park = path/dirt plaza + raised terrain ramps + rocks as obstacles + fences as rails/edges + tufts/trees as landscaping.
  - market = path plaza + cottage/manor stalls + fences as queue rails + crops/pumpkins as goods.
  - playground = path/dirt base + rocks as play forms + fences as boundary + trees/tufts for park context.
  - quarry = raised dirt/grass terraces + rocks of varied floors + path access road + sparse tufts.
- Emphasize legibility from the default isometric camera: 3–5 clear assembled features beats many scattered cells.

Voxel stamp prompting:

- For new text/image-to-voxel stamps, prefer semantic `customParts` first instead
  of raw voxel clouds. This preserves editable object structure and avoids
  low-quality broad blocks.
- Include the allowed material list, selected/source object intent, source
  parts when available, image reference when present, `allowedBounds`, and a
  quality target that calls out connected layered detail.
- For bespoke requests such as glass greenhouse, dome, vehicle, robot, or
  airship, require semantic colored parts and at least several material
  families. Native houses/fences/rocks are allowed only when they are actual
  components or surroundings, not substitutes for the requested model.
- Use `customParts` `kind: "cable"` for ropes, balloon basket lines, tethers,
  rigging, and mooring-style connections. Cable parts need `from`/`to`
  endpoints, radius, sag, and the usual compatibility `size`/`pos`/`scale`.
- Use `sphere`/`ellipsoid` custom parts for rounded envelopes, domes, tanks,
  and canopies. A hot-air balloon should have a rounded ellipsoid/sphere
  envelope with colored fabric panel bands, not a box body. Use
  `phiStart`/`phiLength` ellipsoid slices for curved balloon panels instead of
  flat rectangular plates.
- Keep first-pass generated custom models to sane board scale. Use
  `customFootprint` around 1.1-1.3 for compact props, bridges, decks, and
  docks; reserve 1.5-1.8 for clear hero objects such as balloons, airships,
  domes, and greenhouses. For bridges/decks that need to sit into water or
  terrain, prefer a small negative `transform.offsetY` instead of making the
  geometry oversized.
- Explicitly tell models not to default `customParts` to stone/rock unless the
  requested object is stone. Prefer TinyWorld material names such as `wood`,
  `brass`, `copper`, `metal`, `steel`, `glass`, `glassGreen`, `fabric`,
  `canvas`, `rope`, `cable`, and accent colors.
- Use raw `{x,y,z,color}` voxels after a seed exists and the user asks to
  reinterpret/upscale/refine density; keep returned voxels bounded and omit
  hidden interior fill.
- Do not let a reference image or prior Japanese stamp bias unrelated objects
  into pagodas, gardens, torii, sakura, or shrine motifs unless explicitly
  requested.

For Auto suggestions:

- Return candidate actions, not coordinates.
- Suggestions should be reusable across several placements.
- Include a varied ranked batch: one structural option, one terrain/path option, one nature/detail option, and one intensify/repeat option when useful.
