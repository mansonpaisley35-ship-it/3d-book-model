/*
 * Opening / page-turning state for the book.
 *
 * The continuous parts of the animation (how far the covers are open, how far
 * the current leaf has swung) live in a mutable ref that is eased every frame,
 * so React never re-renders per frame. Only the discrete parts — is the book
 * open, which spread is showing, which way a leaf is turning — are React state,
 * because they decide which page textures are needed.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type TurnDir = -1 | 1;

export type BookMotion = {
  /** 0 = closed, 1 = fully open */
  open: number;
  openTarget: number;
  /** progress of the leaf currently turning, 0..1 */
  turn: number;
  /** set while the user is dragging a page by hand */
  dragging: boolean;
};

export function useBookMotion(spreadCount: number, enabled: boolean) {
  const motion = useRef<BookMotion>({ open: 0, openTarget: 0, turn: 0, dragging: false });
  const [open, setOpen] = useState(false);
  const [spread, setSpread] = useState(0);
  const [turnDir, setTurnDir] = useState<TurnDir | null>(null);

  const lastSpread = Math.max(0, spreadCount - 1);

  // keep the spread in range when a new (shorter) document is imported
  useEffect(() => {
    setSpread((s) => Math.min(s, lastSpread));
  }, [lastSpread]);

  useEffect(() => {
    if (enabled) return;
    setOpen(false);
    setTurnDir(null);
    motion.current.openTarget = 0;
    motion.current.turn = 0;
  }, [enabled]);

  const toggleOpen = useCallback(() => {
    if (!enabled) return;
    setOpen((v) => {
      motion.current.openTarget = v ? 0 : 1;
      return !v;
    });
  }, [enabled]);

  /** Start turning one leaf. Ignored while another turn is in flight. */
  const turn = useCallback(
    (dir: TurnDir, drag = false) => {
      if (!enabled || turnDir) return false;
      if (dir > 0 && spread >= lastSpread) return false;
      if (dir < 0 && spread <= 0) return false;
      if (!open) {
        motion.current.openTarget = 1;
        setOpen(true);
      }
      motion.current.turn = 0;
      motion.current.dragging = drag;
      setTurnDir(dir);
      return true;
    },
    [enabled, turnDir, spread, lastSpread, open],
  );

  /** Called every frame from the scene. */
  const step = useCallback(
    (dt: number) => {
      const m = motion.current;
      const k = Math.min(1, dt * 3.2);
      m.open += (m.openTarget - m.open) * k;

      if (turnDir && !m.dragging) {
        m.turn = Math.min(1, m.turn + dt * 1.5);
        if (m.turn >= 1) {
          m.turn = 0;
          setSpread((s) => Math.min(lastSpread, Math.max(0, s + turnDir)));
          setTurnDir(null);
        }
      }
    },
    [turnDir, lastSpread],
  );

  /** Hand-drag: 0..1 along the sweep of the turning leaf. */
  const setDrag = useCallback((progress: number) => {
    motion.current.turn = Math.min(1, Math.max(0, progress));
  }, []);

  /** Let go of a dragged leaf: it either completes the turn or springs back. */
  const releaseDrag = useCallback(() => {
    const m = motion.current;
    if (!m.dragging) return;
    m.dragging = false;
    if (m.turn < 0.4) {
      m.turn = 0;
      setTurnDir(null);
    }
  }, []);

  // keyboard: previous / next page
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") turn(1);
      else if (e.key === "ArrowLeft") turn(-1);
      else if (e.key === " " || e.key === "Enter") return;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, turn]);

  return {
    motion,
    open,
    spread,
    turnDir,
    lastSpread,
    toggleOpen,
    turn,
    step,
    setDrag,
    releaseDrag,
  };
}
