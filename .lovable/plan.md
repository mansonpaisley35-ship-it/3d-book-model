# Gutenberg-style page-turn refinement

## Goal
Improve page turning with the attached fixed-spine approach while preserving PDF textures, page numbering, controls, and the existing hardcover geometry.

## Changes
- Keep each turning leaf rooted at one fixed spine pivot instead of sliding it between page-stack heights.
- Let the parent pivot perform the reversible 180° sweep.
- Use the skin only for a narrow crease that travels from gutter to fore-edge, with a subtle gutter roll and flat start/end states.
- Mirror the same behavior for forward and backward turns.
- Leave the opening motion, book positioning, imported-book storage, and spine construction unchanged.

## Validation
- Check the project compiles cleanly.
- Import a sample PDF and verify forward and backward turns visually.
- Confirm the page root remains at the spine and both resting states are flat.

## Technical details
- Replace the current full-turn tangent deformation with local neighboring-angle differences around a moving crease.
- Increase the skin resolution to 32 bones and four height subdivisions.
- Avoid child-bone Z translation and keep motion progress as the single source of truth.
