# Universal prompt: turn a rough GLB + reference photos into clean parametric Three.js geometry

Copy everything below the line into ChatGPT (or any coding agent). Replace the bracketed parts.

---

You are rebuilding a 3D object in Three.js. I will give you:

1. **A rough source mesh** (GLB/OBJ) — usually AI-generated from a single photo. Treat it as a *shape reference only*. Its topology is wrong: parts are welded that should be separate, details that exist on the photographed side are missing on the unseen sides, and surfaces are faceted where they should be continuous.
2. **Reference photographs** of the real object from several angles.

Object: **[NAME OF OBJECT]**. References: [list images / what each shows].

Your output is **geometry and structure only** — no artwork, no image textures, no text, no lighting rig, no UI — built as parametric code that regenerates the object from a config object. Do not import, decimate, or vertex-displace the source mesh. Rebuild it.

## Step 1 — Read the source mesh, then discard it

State, in a short list before writing code:

- Which visible features are **correct in appearance** and must be reproduced (silhouette, proportions, the specific details that make the object recognisable).
- Which are **construction errors** to avoid: welded parts that are really separate components; features present only on the side the photo showed; faceting from too-coarse sampling; bevels that flatten a detail instead of carrying it through.
- Symmetries the source violated but the real object has (mirror, radial, repeat).

## Step 2 — Component decomposition (non-negotiable)

Decompose the object into the smallest set of parts that a manufacturer or nature would build separately. Each part is its own `BufferGeometry` + `Mesh`, with its own material, transform, and independent visibility toggle.

Rules:

- **No part may own geometry that belongs to another part.** Where two parts meet, they may overlap in space by a hair, but they never share or weld vertices.
- **Reuse before duplicating.** If two parts are mirrors or rotations of each other, build the geometry once and render it transformed. This is what guarantees a detail present on the front is also present, correctly mirrored, on the back — the single most common failure of photo-derived meshes.
- Name the parts explicitly and list them before coding: `[partA, partB, ...]`.

## Step 3 — Parameterise everything

One `config` object drives every dimension, and every dimension is either a config value or derived from config values by a named formula. No magic numbers in geometry code. Include:

- **Primary dimensions** the user actually thinks in (overall size, thickness, count).
- **Derived dimensions** with the formula written out, so the object scales plausibly at any size.
- **Smoothness / quality controls**, each editable: segment counts per curved region, blend widths, easing exponents, and a strength control for every characteristic detail.
- Provide a `suggestConfig(aspects)` that produces a good default set from a handful of high-level choices, so the object is never wrong out of the box.

## Step 4 — Continuity: how the parts blend

This is what separates a rough mesh from a real one. For every transition — a detail meeting a flat surface, one part meeting another, a surface wrapping around an edge — apply:

1. **Analytic C2 profiles, not stitched primitives.** Sample a smooth function; never approximate a soft valley or fillet with two `quadraticCurveTo` calls or a couple of quads — that is exactly what reads as faceted. Use a quintic smootherstep so first and second derivatives vanish at the boundary:

   ```js
   const bump = (u) => { const a = 1 - Math.min(1, Math.abs(u)); return a*a*a*(a*(a*6-15)+10); };
   ```

2. **A shared boundary contract between neighbouring parts.** Where part A ends and part B begins, compute *one* boundary point and *one* boundary tangent from config, and have both parts consume it. Then the seam stays invisible at every configuration value, not just the default. Never hand-tune two independent numbers to line up.

3. **Details must survive the rounded edges.** Do not round an edge with a uniform bevel (`ExtrudeGeometry`'s `bevelEnabled` and friends) when a detail crosses that edge — a uniform bevel flattens the detail exactly where it should read most strongly. Instead **loft**: write `profile(detailScale, inset)` returning a sampled 2D polyline, and sweep it along the edge with a schedule such as

   ```text
   inset       = ER * (1 - Math.sin(t * Math.PI/2))     // rounding
   position    = ER * (1 - Math.cos(t * Math.PI/2))     // traces a quarter circle
   detailScale = 1 + strength * Math.pow(1 - t, k)      // detail deepens toward the edge
   ```

   Offset profile points along their own 2D normals (offset the *sampled* polyline, so the offset follows the detail rather than ignoring it). Stitch equal-length slices into an index grid, cap the extremes with a fan, round coordinates to ~1e-5 and weld before `computeVertexNormals()` so the loft shades as one surface.

4. **Sampling density that hides the polygons.** Curved cross-sections ≥ 48 samples, edge lofts ≥ 12 slices, exposed as config.

## Step 5 — Verify against the references, not against plausibility

Render and compare each reference angle. For each one, check specifically:

- The silhouette matches the photo at that angle.
- Every characteristic detail appears on **all** faces where the real object has it, not just the photographed one.
- No visible crease, seam, or facet where the real object is continuous; no gap or z-fight where parts meet.
- Changing any config value keeps all of the above true — test the extremes of each slider, not just defaults.

Iterate until those hold. Report what you changed after each pass.

## Step 6 — Hygiene

Rebuild geometry only when config changes (memoise on the config), dispose old buffers, keep each part's build in its own pure function `buildX(config): BufferGeometry`, and keep the config type exported and documented.

## Deliverable

- `config.ts` — the config type, presets, `suggestConfig`, derived-value formulas.
- `geometry.ts` — one pure builder per part, plus the shared profile/boundary helpers.
- One component that assembles the parts as separate meshes.
- A short note listing the parts, the shared boundary contracts, and every editable smoothness parameter.
