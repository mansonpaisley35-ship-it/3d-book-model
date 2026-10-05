# Rebuild the open-book rig around continuous curved paper

## Goal
Replace only the open-state motion and page geometry so the existing hardcover opens as one continuous case, stacks remain naturally curved and volume-preserving, and every leaf leaves and lands exactly on those stack surfaces.

## Scope

### 1. Pure, tested page-rig mathematics
- Add a Three.js-free math module for smoothstep/smootherstep, curved stack angle solving, chain integration, lagged leaf interpolation, and critically damped springs.
- Model both resting stacks from one shared gutter and continuous fractional leaf counts.
- Guarantee the turning leaf uses the right/left resting curves at its endpoints and pins its root to the gutter.
- Add unit tests for endpoint identity in both directions, pinned root, clearance, frame-to-frame displacement, spring settling, and rapid queued-flip invariants.

### 2. Continuous opening in `Book.tsx`
- Remove the `recentre` wrapper and the closed/open visibility cutoff.
- Drive the open pose entirely from `motion.open`: front-board pivot translation and rotation, rig centring/tilt/fit, and page-stack openness.
- Cache the existing spine mesh’s rest positions and CPU-deform that same geometry from its closed shell into the flat open strip; do not change the shell builder or joint contract.
- Keep `frontBoard`, `backBoard`, `spine`, and `closedBlock` names unchanged. The closed page block follows the same curved-stack path rather than switching abruptly.

### 3. Curved stacks and ribbon leaf in `OpenBook.tsx`
- Replace flat extruded page boxes with 26-segment volume-preserving stack prisms and textured surface ribbons.
- Keep both stacks present from the first spread, using fractional leaf transfer during a flip to eliminate mounting pops.
- Replace the rigidly rotated skinned leaf with two dynamically updated ribbons whose centreline blends between the exact resting curves with speed-dependent tip lag and free-corner twist.
- Recompute the moving leaf bounds after each update and keep the gutter root fixed.

### 4. Spring dynamics and interaction in `book-state.ts`
- Use critically damped springs for opening and flipping, preserving velocity through drag release.
- Add target selection, velocity estimation, a two-flip queue, open-before-flip behavior, and sequential rewind before closing.
- Preserve click, horizontal drag, pointer cancellation, keyboard arrows, and Space/Enter toggle behavior; suppress click after a 7px drag.
- Expose page-grab state so orbiting is disabled only during an active page grab.

### 5. Validation
- Run the new pure-math unit tests and the project’s type checks.
- Import a multi-page PDF and verify in desktop and mobile browser views: opening/closing, forward/backward drag and click turns, rapid alternating input, first/last spread, gutter continuity, no stack pop, no hinge wedge, and no runtime errors.
- Compare screenshots at closed, mid-open, open, mid-turn, and settled states.

## Protected areas
No changes to `buildBoardGeometry`, `buildSpineGeometry`, `joint()`, `metrics()`, `config.ts`, materials, lighting, camera, export, PDF loading/caching, or the canonical case part names. The requested camera-near and shadow-bias adjustments are intentionally excluded because those systems were explicitly marked immutable.

## Technical details
- The new page surface is generated as indexed `BufferGeometry`; geometry data updates only when a quantized `(open, leftLeaves, rightLeaves)` key changes.
- The active leaf updates mutable position buffers per frame without React re-renders or object churn.
- All motion is delta-time based with clamped time steps and exact endpoint snapping.
- The existing case geometries remain authoritative; opening deforms only a runtime clone/buffer of the already-built spine mesh.
