# Geometry-only prompt: Three.js hardcover book

Copy the block below into ChatGPT. It describes the book's geometry and structure — no artwork, textures, lighting rig, or UI. Every feature is driven by a named config value so it stays editable later.

---

Build a photoreal hardcover book in Three.js (react-three-fiber is fine, plain three.js also works). Geometry and structure only: no artwork, no text, no image textures. Units: 1 unit is about 25 mm. No CSG or boolean operations. The case parts are built as **lofted sweeps of a 2D profile**, so the joint groove stays tangent-continuous where it blends into the cover and spine, and it carves a real divot into the rounded head and tail of each board.

## Config

A single config object drives everything:

`width` (spine to fore-edge), `height`, `pageDepth`, `boardThickness`, `cornerRadius`, `edgeRound`, `grooveOffset`, `grooveWidth`, `grooveDepth`, `spineBuckle`, `marginTop`, `marginBottom`, `marginFore`.

Smoothness / divot controls (all editable):

- `grooveBlend` (0..1, default 0.65) — how far the groove's walls flare out into the flat cover before they flatten. Higher = softer, wider blend.
- `grooveSegments` (default 48) — samples across the groove cross-section.
- `capSegments` (default 14) — slices used to round each of the head and tail.
- `divot` (0..1, default 0.8) — how strongly the groove pulls inward at the head and tail, i.e. how pronounced the divot is.
- `capEase` (default 2.2) — exponent of the head/tail rounding falloff; higher = flatter top with a tighter roll at the very edge.

Derived values:

```text
T       = pageDepth + 2 * boardThickness    // total case thickness
hingeX  = -width / 2 + grooveOffset         // joint centre line
hingeW  = grooveWidth / 2
out     = T / 2                             // outer face of a board
inn     = T / 2 - boardThickness            // inner face of a board
ER      = min(edgeRound, boardThickness * 0.9, height / 20)
```

## The groove must be a smooth C1 curve, not two quads

Model the groove as a smooth valley function, sampled analytically, so the cover surface enters and leaves it with matching tangents. Define, for a signed distance `u = (x - hingeX) / (hingeW * (1 + grooveBlend))` clamped to `-1..1`:

```js
// smoothstep-based valley: value 1 at the groove centre, 0 (with zero slope) at the rim
const bump = (u) => {
  const a = 1 - Math.min(1, Math.abs(u));
  return a * a * a * (a * (a * 6 - 15) + 10); // quintic smootherstep -> C2 at both ends
};
const grooveY = (x, depth) => out - depth * bump((x - hingeX) / (hingeW * (1 + grooveBlend)));
```

Because `bump` has zero first and second derivative at `u = ±1`, the groove melts into the flat cover with no visible crease line, and on the spine side it melts into the lip where the board meets the spine shell. Never approximate this with two `quadraticCurveTo` calls — that is what makes the joint look faceted.

## Board profile (a function of the slice, not a fixed shape)

Write a function `boardProfile(depthScale, inset)` returning an ordered list of 2D points, where:

- `depthScale` scales the groove depth for this slice (1 in the middle of the book, more at head/tail — see the divot section),
- `inset` shrinks the profile perpendicular to its surface for the rounded head/tail cap.

```text
D   = min(grooveDepth, boardThickness * 0.7)
R   = min(cornerRadius, boardThickness * 0.45)
tip = hingeX - hingeW                 // spine-side end of the board
lip = out - D * 0.2                   // where the board meets the spine shell
```

Points, in order:

1. Outer face from the fore-edge inward: start at `(width/2 - R, out)`, walk x from `width/2 - R` down to `tip` in `grooveSegments` steps, emitting `(x, grooveY(x, D * depthScale))`. The flat part comes out flat automatically because `bump` is 0 there; the groove and its blend come out smooth.
2. Ease the last few samples toward `lip` so the spine-side end of the board rises into the spine joint rather than stopping abruptly.
3. Spine-side end cap: `(tip, inn)`.
4. Inner face: `(width/2, inn)`, then `(width/2, out - R)`.
5. Fore-edge round: quarter arc from `(width/2, out - R)` to `(width/2 - R, out)`, sampled (do not use a single quad).

Then offset every point inward along its 2D normal by `inset`. Offsetting the sampled polyline is what makes the head/tail cap follow the groove instead of ignoring it.

## Head and tail: the divot comes from the cap loft

Do **not** use `ExtrudeGeometry`'s `bevelEnabled` for the head and tail. A uniform bevel rounds the edge but flattens the groove there, which is exactly the detail that reads as wrong. Instead loft the board along Y:

```text
For t in 0..1 across capSegments (t = 0 at the very head edge, t = 1 where the cap ends):
  e          = 1 - Math.pow(1 - t, capEase)        // eased rounding
  inset      = ER * (1 - e)                        // full inset at the edge, 0 at the cap end
  depthScale = 1 + divot * Math.pow(1 - t, 1.6)    // groove digs deeper toward the edge
  y          = -height/2 + ER * (1 - Math.cos(t * Math.PI / 2)) ... (see below)
```

Slice Y positions: place cap slices so they trace a quarter-circle of radius `ER`, i.e. slice `i` sits at `y = ER * (1 - cos(t * PI/2))` measured from the head plane, with the corresponding `inset = ER * (1 - sin(t * PI/2))`. Use the same schedule mirrored at the tail. Between the two caps insert two identical mid slices with `inset = 0`, `depthScale = 1`.

Build the mesh by stitching consecutive slices into quads (each slice has the same point count, so indices are a simple grid), then cap the two extreme slices with a triangle fan or `THREE.ShapeGeometry` of the fully inset profile. Call `computeVertexNormals()`, and weld/round coordinates to ~1e-5 before computing normals so the loft shades as one continuous surface.

The result: the rounded head and tail carry the groove through them, and because `depthScale` grows toward the edge the groove opens into a shallow scooped divot right at the head and tail of each board — the notch visible on the real book.

## Cover board — one loft, rendered twice

Build the loft once. Render it as-is for the front board, and with `rotation = [Math.PI, 0, 0]` for the back board. Reusing the same geometry flipped is what guarantees front and back carry identical, mirrored joints and divots.

## Spine bridge — its own mesh, tangent to the boards

A rounded shell arcing from the front joint to the back joint, with an inner lining offset inward by the board thickness. Sample it as a curve, not two beziers with mismatched tangents at the tips:

```text
tipX  = hingeX - hingeW * 0.2      // tucks slightly under the groove
tipY  = T / 2 - D * 0.35
crown = -width / 2 - spineBuckle
```

Outer face: cubic bezier from `(tipX, tipY)` with control points `(crown, T*0.42)` and `(crown, -T*0.42)` to `(tipX, -tipY)`, sampled at `grooveSegments * 2` steps. Inner lining: the same curve with controls pulled in by `boardThickness * 1.15`, running back, ending `boardThickness` inside each tip. Close the two short end walls.

Loft this profile along Y with the **same** cap schedule (`capSegments`, `ER`, `capEase`) used for the boards, so the spine's head and tail round off in step with the covers and the divot reads continuously across the joint. Keep the spine a separate mesh with its own material. Its tips must tuck under the grooves rather than butting flush against the board edges — that is the purpose of the `-hingeW * 0.2` and `-D * 0.35` insets. The board's spine-side end tangent (step 2 above) and the spine tip tangent should point the same way; matching them is what removes the hard seam.

## Text block

```text
pageSpineX = hingeX + hingeW / 2
pageForeX  = width / 2 - marginFore
pw = pageForeX - pageSpineX
ph = height - marginTop - marginBottom
pt = pageDepth - 0.04
position = [ (pageForeX + pageSpineX) / 2, (marginBottom - marginTop) / 2, 0 ]
```

A `BoxGeometry(pw, ph, pt)` at that position. Optionally replace it with a stack of thin leaf boxes: put each leaf in a group whose pivot is at the leaf's spine edge (`group.position.x = -pw / 2`, mesh offset `+pw / 2`) so a single `rotation.y` sweeps a page open. Leaves stack along Z from the front face inward; any leftover thickness is filled by the solid block behind them.

## Suggested proportions

So the joint scales correctly on both thin and thick books:

```text
boardThickness = 0.075 + pageDepth * 0.012
cornerRadius   = min(0.075, width * 0.016)
edgeRound      = min(0.05,  T * 0.035)
grooveWidth    = width * 0.014 + T * 0.02
grooveDepth    = min(boardThickness * 0.55, width * 0.007)
grooveOffset   = width * 0.028 + T * 0.06
spineBuckle    = T * 0.055
marginTop      = marginBottom = height * 0.016
marginFore     = width * 0.021
grooveBlend    = 0.65
divot          = 0.8
capEase        = 2.2
grooveSegments = 48
capSegments    = 14
```

Example trim: `width 3.35`, `height 5.0`, `pageDepth` from `leaves * mmPerLeaf / 25` (standard stock is 0.1 mm per leaf), clamped to `0.28..2.6`.

## Structure summary

Four independent meshes: front board, back board (same loft, flipped), spine bridge, text block. No booleans, no `ExtrudeGeometry` bevels on the case, every dimension traceable back to the config, and every smoothness/divot behaviour exposed as `grooveBlend`, `grooveSegments`, `capSegments`, `divot`, `capEase` so it can be tuned from a UI later. Rebuild geometry only when the config changes, and dispose the old buffers.
