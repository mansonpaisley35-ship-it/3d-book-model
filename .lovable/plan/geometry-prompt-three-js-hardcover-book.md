# Geometry-only prompt: Three.js hardcover book (v2)

Copy everything below the line into ChatGPT.

---

Build a photoreal hardcover book in Three.js (react-three-fiber or plain three.js). **Geometry and structure only** — no artwork, no text, no image textures, no lighting rig, no UI. Units: 1 unit ≈ 25 mm. No CSG/booleans. Every dimension and every smoothness/divot behaviour must be driven by a named config value so it stays editable later.

## Non-negotiable structure: four independent meshes

`frontBoard`, `backBoard`, `spineBridge`, `textBlock`. Each is its own `BufferGeometry` + `Mesh` with its own material and transform, and can be hidden independently.

Two failure modes to avoid explicitly (they come from a previous attempt where the mesh was reconstructed from a single photo of the front cover):

1. **No part of a cover board may belong to the spine mesh, and no part of the spine may belong to a board.** The boundary is exact: the board ends at its spine-side tip, just under the joint groove; the spine shell starts there and tucks *under* that tip. They overlap in space by a hair, never share vertices, and are never one welded shell.
2. **Both boards must carry the joint groove, mirrored.** Build the board loft once and render it twice — the back board is the same geometry with `rotation = [Math.PI, 0, 0]`. Never displace vertices of a scanned mesh to fake a groove on one side only, and never make the groove a vertex-displacement bump on a flat plate: it must be part of the profile that is lofted.

The *look* of the front cover in the reference is correct: a flat cloth board, a rounded fore-edge, and one narrow, shallow groove parallel to the spine that melts into the flat cover on one side and into the rounded spine shell on the other, with a small scooped divot where it reaches the head and the tail. The *construction* must be as specified below.

## Config

One config object drives everything:

`width` (spine to fore-edge), `height`, `pageDepth`, `boardThickness`, `cornerRadius`, `edgeRound`, `grooveOffset`, `grooveWidth`, `grooveDepth`, `spineBuckle`, `marginTop`, `marginBottom`, `marginFore`.

Smoothness / divot controls (all editable):

- `grooveBlend` (0..1, default 0.65) — how far the groove walls flare into the flat cover before flattening. Higher = softer, wider blend.
- `grooveSegments` (default 48) — samples across the groove cross-section.
- `capSegments` (default 14) — slices used to round each of the head and tail.
- `divot` (0..1, default 0.8) — how strongly the groove deepens at head and tail.
- `capEase` (default 2.2) — exponent of the head/tail rounding falloff; higher = flatter top with a tighter roll at the very edge.

Derived:

```text
T       = pageDepth + 2 * boardThickness    // total case thickness
hingeX  = -width / 2 + grooveOffset         // joint centre line
hingeW  = grooveWidth / 2
out     = T / 2                             // outer face of a board
inn     = T / 2 - boardThickness            // inner face of a board
ER      = min(edgeRound, boardThickness * 0.9, height / 20)
D       = min(grooveDepth, boardThickness * 0.7)
R       = min(cornerRadius, boardThickness * 0.45)
```

## The groove is a smooth C2 valley, not two quads

Sample the groove analytically so the cover surface enters and leaves it with matching tangents:

```js
const bump = (u) => {                        // 1 at the centre, 0 with zero slope at the rim
  const a = 1 - Math.min(1, Math.abs(u));
  return a * a * a * (a * (a * 6 - 15) + 10); // quintic smootherstep -> C2 at both ends
};
const grooveY = (x, depth) =>
  out - depth * bump((x - hingeX) / (hingeW * (1 + grooveBlend)));
```

Zero first and second derivative at `u = ±1` means the groove melts into the flat cover with no crease line, and on the spine side melts into the lip where the board meets the spine shell. Never approximate it with two `quadraticCurveTo` calls — that is what makes the joint look faceted.

## Board profile: a function of the slice

`boardProfile(depthScale, inset)` returns an ordered 2D polyline, where `depthScale` scales groove depth for that slice (1 mid-book, larger at head/tail) and `inset` shrinks the profile along its own normals for the rounded cap.

```text
tip = hingeX - hingeW        // spine-side end of the board
lip = out - D * 0.2          // where the board meets the spine shell
```

Points in order:

1. Outer face, fore-edge inward: from `(width/2 - R, out)`, walk x down to `tip` in `grooveSegments` steps emitting `(x, grooveY(x, D * depthScale))`. The flat region comes out flat automatically (`bump` is 0 there).
2. Ease the last few samples toward `lip`, so the spine-side end rises into the joint rather than stopping abruptly.
3. Spine-side end cap: `(tip, inn)`.
4. Inner face: `(width/2, inn)`, then `(width/2, out - R)`.
5. Fore-edge round: quarter arc from `(width/2, out - R)` to `(width/2 - R, out)`, sampled (not one quad).

Then offset every point inward along its 2D normal by `inset`. Offsetting the *sampled* polyline is what makes the cap follow the groove instead of ignoring it.

## Head and tail: the divot comes from the cap loft

Do **not** use `ExtrudeGeometry`'s `bevelEnabled` here. A uniform bevel rounds the edge but flattens the groove exactly where the divot should be. Loft the board along Y instead:

```text
for t in 0..1 across capSegments (t = 0 at the head edge, t = 1 where the cap ends):
  inset      = ER * (1 - Math.sin(t * Math.PI / 2))
  y          = -height/2 + ER * (1 - Math.cos(t * Math.PI / 2))
  depthScale = 1 + divot * Math.pow(1 - t, 1.6)
```

Apply `capEase` to the rounding falloff (`e = 1 - (1 - t) ** capEase`) so the profile flattens gradually. Mirror the same schedule at the tail. Between the caps insert two identical mid slices with `inset = 0`, `depthScale = 1`.

Stitch consecutive slices into quads (equal point counts → a plain index grid), cap the two extreme slices with a triangle fan over the fully inset profile, round coordinates to ~1e-5 and weld before `computeVertexNormals()` so the loft shades as one continuous surface.

Result: the rounded head and tail carry the groove through them, and because `depthScale` grows toward the edge the groove opens into a shallow scooped divot at the head and tail of each board — the notch visible on the real book.

## Spine bridge: its own mesh, tangent to the boards

A rounded shell arcing from the front joint to the back joint, with an inner lining offset inward by `boardThickness`. Sample it as one curve, not two beziers with mismatched tangents at the tips:

```text
tipX  = hingeX - hingeW * 0.2      // tucks slightly under the groove
tipY  = T / 2 - D * 0.35
crown = -width / 2 - spineBuckle
```

Outer face: cubic bezier from `(tipX, tipY)` with controls `(crown, T*0.42)` and `(crown, -T*0.42)` to `(tipX, -tipY)`, sampled at `grooveSegments * 2` steps. Inner lining: same curve with controls pulled in by `boardThickness * 1.15`, running back, ending `boardThickness` inside each tip. Close the two short end walls.

Loft this profile along Y with the **same** cap schedule (`capSegments`, `ER`, `capEase`) as the boards, so the spine's head and tail round off in step with the covers and the divot reads continuously across the joint. The spine tip tangent and the board's spine-side end tangent (step 2) must point the same way — that is what removes the hard seam. The tips tuck under the grooves rather than butting flush; that is the purpose of the `-hingeW * 0.2` and `-D * 0.35` insets.

## Text block

```text
pageSpineX = hingeX + hingeW / 2
pageForeX  = width / 2 - marginFore
pw = pageForeX - pageSpineX
ph = height - marginTop - marginBottom
pt = pageDepth - 0.04
position = [ (pageForeX + pageSpineX) / 2, (marginBottom - marginTop) / 2, 0 ]
```

A `BoxGeometry(pw, ph, pt)` at that position. Optionally a stack of thin leaf boxes instead: each leaf in a group whose pivot is at its spine edge (`group.position.x = -pw/2`, mesh offset `+pw/2`) so one `rotation.y` sweeps a page open; leaves stack along Z from the front face inward, leftover thickness filled by the solid block behind them.

## Suggested proportions

So the joint scales correctly on thin and thick books:

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

Example trim: `width 3.35`, `height 5.0`, `pageDepth = leaves * 0.1mm / 25`, clamped to `0.28..2.6`.

## Summary of invariants

Four independent meshes; no booleans; no `ExtrudeGeometry` bevels on the case; the groove is a C2 sampled valley present on **both** boards (one loft rendered twice, flipped); cover and spine never share geometry; head/tail rounding is a loft that carries the groove into a divot; every dimension and smoothness value traceable to config; rebuild geometry only when config changes and dispose old buffers.
