---
name: tinyworld-auto-batching
description: Use when changing Tiny World Builder Auto palette behavior, model inference, suggestions, or provider/model/API-key logic.
---

# Tiny World Auto Batching

Auto should not call the model on every placement.

Current intended model:

- Capture the current home board as sparse 8x8 JSON using `snapshotCells()`.
- Ask the model for a ranked batch of candidate tile actions matching `AUTO_SUGGESTIONS_SCHEMA`.
- Spend `autoSuggestionQueue` locally for multiple Auto placements.
- Refresh after `AUTO_REFRESH_EVERY` Auto placements or when the queue runs out.
- Auto still places on the clicked cell. The model suggests tile/action definitions, not coordinates.

Implementation guardrails:

- Keep provider/model/key state shared with the Generate modal via `AI_LS`.
- Use `normalizeAutoAction` before applying model output.
- Use `adaptAutoSuggestionToCell(action, x, z)` so same-kind clicks increase local intensity.
- If no API key exists, open the Generate modal with the Auto key message.
- Do not add a backend or new dependency.

Validation:

- Stub `generateAutoSuggestions` in browser eval and verify two Auto suggestions only call the stub once.
- Verify no network call is needed while spending cached suggestions.
