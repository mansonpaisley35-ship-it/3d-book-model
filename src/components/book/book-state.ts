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
import { clamp01, springSettled, stepCriticalSpring } from "./page-rig-math";

export type TurnDir = -1 | 1;

export type BookMotion = {
  /** 0 = closed, 1 = fully open */
  open: number;
  openTarget: number;
  openVelocity: number;
  /** progress of the leaf currently turning, 0..1 */
  turn: number;
  turnTarget: number;
  turnVelocity: number;
  /** set while the user is dragging a page by hand */
  dragging: boolean;
  queued: number;
};

export function useBookMotion(spreadCount: number, enabled: boolean) {
  const motion = useRef<BookMotion>({
    open: 0,
    openTarget: 0,
    openVelocity: 0,
    turn: 0,
    turnTarget: 0,
    turnVelocity: 0,
    dragging: false,
    queued: 0,
  });
  const [open, setOpen] = useState(false);
  const [spread, setSpread] = useState(0);
  const [turnDir, setTurnDir] = useState<TurnDir | null>(null);
  const spreadRef = useRef(0);
  const turnDirRef = useRef<TurnDir | null>(null);
  const queue = useRef<TurnDir[]>([]);
  const closing = useRef(false);

  const lastSpread = Math.max(0, spreadCount - 1);

  // keep the spread in range when a new (shorter) document is imported
  useEffect(() => {
    setSpread((s) => {
      const next = Math.min(s, lastSpread);
      spreadRef.current = next;
      return next;
    });
  }, [lastSpread]);

  useEffect(() => {
    if (enabled) return;
    setOpen(false);
    setTurnDir(null);
    turnDirRef.current = null;
    spreadRef.current = 0;
    setSpread(0);
    queue.current = [];
    closing.current = false;
    motion.current.openTarget = 0;
    motion.current.openVelocity = 0;
    motion.current.turn = 0;
    motion.current.turnTarget = 0;
    motion.current.turnVelocity = 0;
    motion.current.dragging = false;
    motion.current.queued = 0;
  }, [enabled]);

  const toggleOpen = useCallback(() => {
    if (!enabled) return;
    if (motion.current.openTarget > 0.5 || open) {
      closing.current = true;
      queue.current = [];
      motion.current.queued = 0;
      if (!turnDirRef.current && spreadRef.current > 0) queue.current.push(-1);
      if (spreadRef.current === 0 && !turnDirRef.current) {
        motion.current.openTarget = 0;
      }
      return;
    }
    closing.current = false;
    motion.current.openTarget = 1;
    setOpen(true);
  }, [enabled]);

  const beginTurn = useCallback((dir: TurnDir, drag: boolean) => {
    const currentSpread = spreadRef.current;
    if (dir > 0 && currentSpread >= lastSpread) return false;
    if (dir < 0 && currentSpread <= 0) return false;
    const m = motion.current;
    m.turn = 0;
    m.turnTarget = drag ? 0 : 1;
    m.turnVelocity = 0;
    m.dragging = drag;
    turnDirRef.current = dir;
    setTurnDir(dir);
    return true;
  }, [lastSpread]);

  /** Start one leaf or queue it behind the current flight. */
  const turn = useCallback(
    (dir: TurnDir, drag = false) => {
      if (!enabled || closing.current) return false;
      if (turnDirRef.current || motion.current.open < 0.985) {
        if (drag || queue.current.length >= 2) return false;
        queue.current.push(dir);
        motion.current.queued = queue.current.length;
        motion.current.openTarget = 1;
        setOpen(true);
        return true;
      }
      return beginTurn(dir, drag);
    },
    [beginTurn, enabled],
  );

  /** Called every frame from the scene. */
  const step = useCallback(
    (dt: number) => {
      const m = motion.current;
      const safeDt = Math.min(dt, 1 / 30);
      const opened = stepCriticalSpring(
        { value: m.open, velocity: m.openVelocity },
        m.openTarget,
        5.2,
        safeDt,
      );
      m.open = opened.value;
      m.openVelocity = opened.velocity;
      if (springSettled(opened, m.openTarget, 8e-4, 4e-3)) {
        m.open = m.openTarget;
        m.openVelocity = 0;
        if (m.openTarget === 0) setOpen(false);
      }

      const activeDirection = turnDirRef.current;
      if (activeDirection && !m.dragging) {
        const omega = closing.current ? 13 : 8.5;
        const turned = stepCriticalSpring(
          { value: m.turn, velocity: m.turnVelocity },
          m.turnTarget,
          omega,
          safeDt,
        );
        m.turn = clamp01(turned.value);
        m.turnVelocity = turned.velocity;
        if (springSettled(turned, m.turnTarget, 8e-4, 4e-3)) {
          const completed = m.turnTarget === 1;
          if (completed) {
            const nextSpread = Math.min(lastSpread, Math.max(0, spreadRef.current + activeDirection));
            spreadRef.current = nextSpread;
            setSpread(nextSpread);
          }
          m.turn = 0;
          m.turnTarget = 0;
          m.turnVelocity = 0;
          turnDirRef.current = null;
          setTurnDir(null);
        }
      }

      if (!turnDirRef.current && m.open >= 0.985) {
        if (closing.current && spreadRef.current > 0 && queue.current.length === 0) {
          queue.current.push(-1);
        }
        const next = queue.current.shift();
        m.queued = queue.current.length;
        if (next) beginTurn(next, false);
        else if (closing.current && spreadRef.current === 0) {
          closing.current = false;
          m.openTarget = 0;
          setOpen(false);
        }
      }
    },
    [beginTurn, lastSpread],
  );

  /** Hand-drag keeps its estimated velocity so release has no discontinuity. */
  const setDrag = useCallback((progress: number, velocity = 0) => {
    motion.current.turn = clamp01(progress);
    motion.current.turnVelocity += (velocity - motion.current.turnVelocity) * 0.35;
  }, []);

  /** Let go of a dragged leaf: it either completes the turn or springs back. */
  const releaseDrag = useCallback(() => {
    const m = motion.current;
    if (!m.dragging) return;
    m.dragging = false;
    m.turnTarget = m.turn > 0.38 || m.turnVelocity > 1.1 ? 1 : 0;
  }, []);

  // keyboard: previous / next page
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "ArrowRight") turn(1);
      else if (e.code === "ArrowLeft") turn(-1);
      else if (e.code === "Space" || e.code === "Enter") toggleOpen();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, toggleOpen, turn]);

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
