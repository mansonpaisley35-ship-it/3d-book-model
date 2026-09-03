# Geometry-only prompt: Three.js hardcover book

Copy the block below into ChatGPT. It describes the book's geometry and structure exactly as built here — no artwork, textures, lighting rig, or UI.

---

Build a photoreal hardcover book in Three.js (react-three-fiber is fine, plain three.js also works). Geometry and structure only: no artwork, no text, no image textures. Units: 1 unit is about 25 mm. No CSG or boolean operations — every part is an extruded 2D profile.

## Config

A single config object drives everything:
`width` (spine to fore-edge), `height`, `pageDepth`, `boardThickness`, `cornerRadius`, `edgeRound`, `grooveOffset`, `grooveWidth`, `grooveDepth`, `spineBuckle`, `marginTop`, `marginBottom`, `marginFore`.

Derived values:

```text
T       = pageDepth + 2 * boardThickness    // total case thickness
hingeX  = -width / 2 + grooveOffset         // joint centre line
hingeW  = grooveWidth / 2
out     = T / 2                             // outer face of a board
inn     = T / 2 - boardThickness            // inner face of a board
```

## Shared extruder

Given a `THREE.Shape` drawn in XY, extrude along the book's height:

```js
const ER = Math.min(edgeRound, boardThickness * 0.9, height / 20);
const depth = height - ER * 2;
const geo = new THREE.ExtrudeGeometry(shape, {
  depth,
  curveSegments: 64,
  bevelEnabled: true,
  bevelThickness: ER,
  bevelSize: ER * 0.85,
  bevelOffset: -ER * 0.85,
  bevelSegments: 5,
});
geo.rotateX(Math.PI / 2);      // extrusion axis becomes the book's height (Y)
geo.translate(0, depth / 2, 0);
geo.computeVertexNormals();
```

The bevel is what rounds the head and tail of the case. Do not skip it.

## Cover board — one shape, rendered twice

```js
const D   = Math.min(grooveDepth, boardThickness * 0.7);
const R   = Math.min(cornerRadius, boardThickness * 0.45);
const tip = hingeX - hingeW;   // spine-side end of the board
const lip = out - D * 0.2;     // where the board meets the spine shell

s.moveTo(width / 2 - R, out);
s.lineTo(hingeX + hingeW, out);
s.quadraticCurveTo(hingeX + hingeW * 0.4, out, hingeX, out - D);   // groove dip
s.quadraticCurveTo(hingeX - hingeW * 0.4, out - D, tip, lip);      // groove rise
s.lineTo(tip, inn);            // spine-side end cap
s.lineTo(width / 2, inn);      // inner face back to the fore-edge
s.lineTo(width / 2, out - R);
s.quadraticCurveTo(width / 2, out, width / 2 - R, out);            // fore-edge round
```

Render this one geometry twice: as-is for the front board, and with `rotation = [Math.PI, 0, 0]` for the back board. Reusing the same mesh flipped is what guarantees front and back carry identical, mirrored joint grooves.

## Spine bridge — its own mesh

A rounded shell arcing from the front joint to the back joint, with an inner lining offset inward by the board thickness:

```js
const tipX  = hingeX - hingeW * 0.2;   // tucks slightly under the groove
const tipY  = T / 2 - D * 0.35;
const crown = -width / 2 - spineBuckle;

s.moveTo(tipX, tipY);
s.bezierCurveTo(crown, T * 0.42, crown, -T * 0.42, tipX, -tipY);   // outer face
s.lineTo(tipX, -tipY + boardThickness);
s.bezierCurveTo(
  crown + boardThickness * 1.15, -T * 0.36,
  crown + boardThickness * 1.15,  T * 0.36,
  tipX, tipY - boardThickness,                                     // inner lining
);
s.lineTo(tipX, tipY);
```

Extrude with the same function. The spine must be a separate mesh with its own material, and its tips must tuck under the grooves rather than butting flush against the board edges — that is the purpose of the `-hingeW * 0.2` and `-D * 0.35` insets.

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
```

Example trim: `width 3.35`, `height 5.0`, `pageDepth` from `leaves * mmPerLeaf / 25` (standard stock is 0.1 mm per leaf), clamped to `0.28..2.6`.

## Structure summary

Four independent meshes: front board, back board (same geometry, flipped), spine bridge, text block. No shared geometry between the case and the pages, no booleans, and every dimension traceable back to the config.
