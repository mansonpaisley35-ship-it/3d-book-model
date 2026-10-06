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
- The open-book rig is analytic: curved stack polylines and a lagged ribbon leaf share an exact fixed gutter, while critically damped springs preserve opening and drag-release velocity.
- The existing board, spine-shell, joint, metrics, materials, lighting, camera, PDF source, and export systems are immutable inputs to open-state animation.
