import { useCallback, useEffect, useRef, useState } from "react";
import { makeFlip, step as stepFlip, click, goTo } from "./rig/flip";
import { leavesFor } from "./rig/adapter";
import type { PdfBookSource } from "./pdf-source";

export function useBookMotion(source: PdfBookSource | null, enabled: boolean) {
  const N = source ? leavesFor(source.pageCount) : 0;
  const flip = useRef(makeFlip(N, -1));
  const initialized = useRef(false);
  if (!initialized.current) {
    // makeFlip clamps its initial s to zero; the supplied reference resets it.
    flip.current.s = -1;
    initialized.current = true;
  }
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  useEffect(() => {
    const f = flip.current;
    f.max = N; f.s = -1; f.v = 0; f.target = null; f.drag = null; f.hold = false;
    openRef.current = false;
    setOpen(false);
  }, [enabled, source, N]);
  const toggleOpen = useCallback(() => {
    if (!enabled) return;
    const f = flip.current;
    if (f.s <= -1 + 1e-3) click(f, 1);
    else goTo(f, -1);
  }, [enabled]);
  const step = useCallback((dt: number) => {
    if (enabled) stepFlip(flip.current, Math.min(dt, 1 / 20));
    const next = flip.current.s > -1 + 1e-3;
    if (next !== openRef.current) {
      openRef.current = next;
      setOpen(next);
    }
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) return;
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        click(flip.current, e.key === "ArrowRight" ? 1 : -1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
  return { flip, open, toggleOpen, step };
}
