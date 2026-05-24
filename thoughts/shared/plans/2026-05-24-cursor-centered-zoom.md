# Cursor-Centered Zoom Implementation Plan

## Overview

Zoom (Ctrl+scroll and pinch-to-zoom) currently zooms around the screen center. It should zoom around the cursor/finger position so content under the pointer stays fixed — standard behavior in Figma, maps, etc.

## Current State Analysis

### Coordinate system

- `offset` = frame-space point that maps to screen center `(w/2, h/2)`
- `screenToFrame(v)` = `(v.x - w/2) / zoom + offset.x`
- `frameToScreen(v)` = `(v.x - offset.x) * zoom + w/2`

### Why zoom is off-center today

`handleWheel` (Ctrl+scroll) only calls `setZoom(newZoom)`. `offset` stays unchanged, so screen center stays pinned to the same frame point — not the cursor.

Pinch-to-zoom (`handlePointerMove`, two-pointer branch) similarly calls `setZoom` then adjusts offset via a separate pan delta from `panOrigin`. The zoom component is still screen-center-anchored.

### Key files

- `client/controller.ts` — `handleWheel` (line ~332), `handlePointerMove` pinch block (line ~271)
- `client/store/canvas.ts` — `setZoom`, `setOffset` (independent, each call `notify()`)
- `client/view.tsx` — `screenToFrame`, `frameToScreen` (lines 274–291)

## Desired End State

- Ctrl+scroll: point under cursor stays fixed on screen while zoom changes.
- Pinch-to-zoom: point under two-finger midpoint stays fixed (pan + zoom unified).
- All other behavior unchanged (zoom limits, `snapZoom`, scroll-to-pan, undo/redo, etc).

### Verification

Open asciiflow, draw some content, then:
1. Hover cursor over a character and Ctrl+scroll — that character should stay under the cursor.
2. On touch device / trackpad, pinch — content should scale around finger midpoint.

## What We're NOT Doing

- Not changing zoom limits (0.2–5), snap behavior, or keyboard shortcuts.
- Not changing pan behavior (plain scroll, middle-mouse drag, two-finger pan without zoom).
- Not refactoring `CanvasStore` zoom/offset API (no batching needed; double-notify is already the pattern).
- Not touching `resetZoom` / `recenter` toolbar buttons.

## Implementation Approach

Two targeted edits in `client/controller.ts`. No store changes needed.

### Math derivation

Invariant: the frame point `P` under cursor position `(cx, cy)` must be the same before and after zoom.

```
P = (cx - w/2) / oldZoom + oldOffset.x          # before
P = (cx - w/2) / newZoom + newOffset.x           # after (must equal above)
```

Solving:
```
newOffset.x = oldOffset.x + (cx - w/2) * (1/oldZoom - 1/newZoom)
newOffset.y = oldOffset.y + (cy - h/2) * (1/oldZoom - 1/newZoom)
```

For pinch, the unified formula (anchor = `panOrigin`, current midpoint = `mid`):
```
newOffset.x = (panOrigin.x - w/2)/pinchStartZoom + panOriginOffset.x - (mid.x - w/2)/newZoom
newOffset.y = (panOrigin.y - h/2)/pinchStartZoom + panOriginOffset.y - (mid.y - h/2)/newZoom
```

This collapses into the plain-pan formula when zoom doesn't change, so it replaces both the zoom and pan blocks in the pinch handler cleanly.

---

## Phase 1: Fix Ctrl+Scroll Wheel Zoom

### Overview

In `handleWheel`, after computing `newZoom`, also compute and set the new offset using the cursor position from the wheel event.

### Changes Required

**File**: `client/controller.ts`

**Current code** (inside `handleWheel`, zoom branch):
```ts
const rawZoom = store.currentCanvas.zoom * (delta > 0 ? 1.1 : 0.9);
const newZoom = snapZoom(Math.max(Math.min(rawZoom, 5), 0.2));
store.currentCanvas.setZoom(newZoom);
```

**Replace with**:
```ts
const oldZoom = store.currentCanvas.zoom;
const rawZoom = oldZoom * (delta > 0 ? 1.1 : 0.9);
const newZoom = snapZoom(Math.max(Math.min(rawZoom, 5), 0.2));
const w = document.documentElement.clientWidth;
const h = document.documentElement.clientHeight;
const offset = store.currentCanvas.offset;
const newOffset = new Vector(
  offset.x + (e.clientX - w / 2) * (1 / oldZoom - 1 / newZoom),
  offset.y + (e.clientY - h / 2) * (1 / oldZoom - 1 / newZoom)
);
store.currentCanvas.setZoom(newZoom);
store.currentCanvas.setOffset(newOffset);
```

`Vector` is already imported at top of file.

### Success Criteria

#### Automated Verification:
- [ ] TypeScript compiles: `bazel build client:bundle`
- [ ] Unit tests pass: `bazel test //client:all`

#### Manual Verification:
- [ ] Hover cursor over a specific character, Ctrl+scroll in — character stays under cursor
- [ ] Hover cursor over edge of canvas, Ctrl+scroll out — edge point stays under cursor
- [ ] Plain scroll (no Ctrl) still pans normally
- [ ] Zoom limits (min/max) still enforced

---

## Phase 2: Fix Pinch-to-Zoom

### Overview

Replace the separate zoom + pan blocks in the two-pointer branch of `handlePointerMove` with the unified formula that centers zoom on the current finger midpoint.

### Changes Required

**File**: `client/controller.ts`

**Current code** (inside `handlePointerMove`, `pointers.size >= 2` branch):
```ts
// Pinch-to-zoom.
const currentLength = a.subtract(b).length();
if (this.pinchStartLength > 0) {
  let newZoom = (this.pinchStartZoom * currentLength) / this.pinchStartLength;
  newZoom = snapZoom(Math.max(Math.min(newZoom, 5), 0.2));
  store.currentCanvas.setZoom(newZoom);
}
// Two-finger pan.
if (this.panOrigin) {
  const midpoint = new Vector((a.x + b.x) / 2, (a.y + b.y) / 2);
  const delta = this.panOrigin.subtract(midpoint).scale(1 / store.currentCanvas.zoom);
  store.currentCanvas.setOffset(this.panOriginOffset.add(delta));
}
```

**Replace with**:
```ts
const currentLength = a.subtract(b).length();
const midpoint = new Vector((a.x + b.x) / 2, (a.y + b.y) / 2);
if (this.pinchStartLength > 0 && this.panOrigin) {
  let newZoom = (this.pinchStartZoom * currentLength) / this.pinchStartLength;
  newZoom = snapZoom(Math.max(Math.min(newZoom, 5), 0.2));
  const w = document.documentElement.clientWidth;
  const h = document.documentElement.clientHeight;
  // Unified formula: keeps the point originally under panOrigin
  // pinned under the current midpoint as zoom and pan happen simultaneously.
  const newOffset = new Vector(
    (this.panOrigin.x - w / 2) / this.pinchStartZoom + this.panOriginOffset.x - (midpoint.x - w / 2) / newZoom,
    (this.panOrigin.y - h / 2) / this.pinchStartZoom + this.panOriginOffset.y - (midpoint.y - h / 2) / newZoom
  );
  store.currentCanvas.setZoom(newZoom);
  store.currentCanvas.setOffset(newOffset);
}
```

### Success Criteria

#### Automated Verification:
- [ ] TypeScript compiles: `bazel build client:bundle`
- [ ] Unit tests pass: `bazel test //client:all`

#### Manual Verification:
- [ ] Pinch on touch device / trackpad: content under finger midpoint stays fixed
- [ ] Two-finger pan without pinch (equal finger distance) still pans correctly
- [ ] Pinch + simultaneous pan works smoothly (combined gesture)

---

## Testing Strategy

### Unit Tests

No new unit tests strictly required (no new pure functions). Existing `store.spec.ts` zoom tests continue to pass.

If desired, add a test to `store.spec.ts` verifying the offset math formula in isolation (pure arithmetic, no DOM).

### Manual Testing Steps

1. `bazel build client:bundle && open dist/index.html` (or dev server)
2. Draw a recognizable pattern near the edges of the canvas
3. Ctrl+scroll over each edge — verify the hovered point stays fixed
4. Ctrl+scroll from extreme zoom-in to zoom-out continuously — verify smooth movement
5. On trackpad: pinch open and close — verify finger-center stability
6. On trackpad: two-finger pan without pinch — verify pan still correct

## References

- `client/controller.ts` — `handleWheel`, `handlePointerMove`
- `client/view.tsx:274` — `screenToFrame` (coordinate math reference)
- `client/store/canvas.ts:100` — `setZoom`, `setOffset`
