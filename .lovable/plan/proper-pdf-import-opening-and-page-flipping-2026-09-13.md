# Proper PDF import, opening and page flipping

## What you'll get

- Import a PDF and see the real book: the PDF's own pages become the pages of the book, with the first page on the front cover and the last on the back.
- Click the book to open it; click again to close it. The covers swing, the spine flexes, and the stack splits into a left and right half.
- Turn pages: tap the left or right half of an open spread, use the arrow keys, or drag a page edge across to turn it by hand with a curling page.
- Long PDFs stay smooth — pages are drawn only as they come into view, so a 600-page book behaves like a short one.
- The book keeps its current place, size and camera framing in the preview. Nothing about the existing position, lighting or Build panel changes.

## How it works

Two pieces are ported and adapted from the referenced project, rather than dropping its whole viewer in (its viewer owns its own camera and staging, which would move the book).

### 1. Lazy PDF page source (replaces the current eager renderer)

New `src/components/book/pdf-source.ts`, adapted from the reference `PdfBookSource`:

- Opens the PDF, reads page count (capped at 600) and page aspect from page 1.
- Renders a page to a `<canvas>` only when asked, keeping a 24-page LRU cache; failed pages stay blank instead of breaking the book.
- Notifies on render so the affected page's texture can be refreshed.

`src/components/book/pdf.ts` (render-everything-up-front) is removed; `BookScene` keeps its existing "Import a PDF" control, name, progress and clear behaviour, wired to the new source.

### 2. Skinned, bendable page blocks with an open/flip state machine

`src/components/book/PageBlock.tsx` is rebuilt around the reference's technique:

- Each half of the book is a `SkinnedMesh` whose box geometry is bound to a chain of bones running from spine to fore-edge, so the block can curve.
- Seven parts, sized from the existing `BookConfig` metrics: left cover, left endpaper, left page half, centre turning page, right page half, right endpaper, right cover, plus the flexing spine strip.
- Materials per part carry left-side and right-side page textures pulled from the PDF source for the current page number.
- New `src/components/book/book-state.ts` holds the animation state: `closed` / `open`, current page, turn target, drag progress; per-frame easing drives cover angles, block thicknesses, page curl and the turning page's arc.

### Interaction

Added to the existing R3F scene (no new canvas, no camera changes):

- Click the book: open or close.
- Click the left/right half when open: turn one page back/forward.
- Drag from a page edge: hand-turn, releasing snaps forward or back.
- Left/right arrow keys: previous/next page.
- Existing quill edit buttons stay for the artwork slots; when a PDF is loaded its own pages take over the covers.

### Notes

- With no PDF loaded the book behaves as it does today (solid block, closed) so the configurator experience is unchanged.
- Design export gains nothing new; PDFs are still not part of a saved design.
