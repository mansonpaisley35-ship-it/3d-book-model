<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->
- Imported books (PDF, cover images, look, pose) are stored in browser IndexedDB via src/components/book/library.ts — user chose browser-only storage, no sign-in.
- The supplied seven-file rig is immutable and drives case, stacks and leaves from one Flip ref; preserve original case meshes and bridge row-major matrices through an imperative renderer to avoid per-frame React work.
