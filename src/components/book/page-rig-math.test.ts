import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  leafCurve,
  restingCurve,
  simulateFlipQueue,
  springSettled,
  stepCriticalSpring,
} from "./page-rig-math";

const distance = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);

describe("open-book rig math", () => {
  test("leaf endpoints exactly match both resting stacks in both directions", () => {
    for (const leftLeaves of [0.3, 1, 9, 47]) {
      for (const rightLeaves of [0.3, 2, 17, 53]) {
        const left = restingCurve(0, -0.4, 3.2, leftLeaves * 0.006, 1, -1).points;
        const right = restingCurve(0, -0.4, 3.2, rightLeaves * 0.006, 1, 1).points;
        for (const direction of [-1, 1] as const) {
          const source = direction > 0 ? right : left;
          const target = direction > 0 ? left : right;
          assert.ok(Math.max(...leafCurve(right, left, 0, 0.4, direction).map((p, i) => distance(p, source[i]!))) < 1e-9);
          assert.ok(Math.max(...leafCurve(right, left, 1, 0.4, direction).map((p, i) => distance(p, target[i]!))) < 1e-9);
        }
      }
    }
  });

  test("the gutter root never moves in x", () => {
    const left = restingCurve(-1.25, -0.4, 3.2, 0.18, 1, -1).points;
    const right = restingCurve(-1.25, -0.4, 3.2, 0.34, 1, 1).points;
    for (let i = 0; i <= 200; i += 1) {
      assert.equal(leafCurve(right, left, i / 200, 0.4, 1)[0]?.x, -1.25);
    }
  });

  test("the flying leaf remains above the lower resting envelope", () => {
    const left = restingCurve(0, -0.4, 3.2, 0.18, 1, -1).points;
    const right = restingCurve(0, -0.4, 3.2, 0.34, 1, 1).points;
    for (const lag of [0.18, 0.4, 0.6]) {
      for (let i = 0; i <= 200; i += 1) {
        const leaf = leafCurve(right, left, i / 200, lag, 1);
        for (let j = 0; j < leaf.length; j += 1) {
          const floor = Math.min(left[j]?.z ?? -Infinity, right[j]?.z ?? -Infinity);
          assert.ok((leaf[j]?.z ?? floor) - floor >= -1e-6);
        }
      }
    }
  });

  test("60fps leaf displacement stays under the teleport threshold", () => {
    const left = restingCurve(0, -0.4, 3.2, 0.18, 1, -1).points;
    const right = restingCurve(0, -0.4, 3.2, 0.34, 1, 1).points;
    let previous = leafCurve(right, left, 0, 0.4, 1);
    let maximum = 0;
    for (let frame = 1; frame <= 120; frame += 1) {
      const current = leafCurve(right, left, frame / 120, 0.4, 1);
      maximum = Math.max(maximum, ...current.map((point, index) => distance(point, previous[index]!)));
      previous = current;
    }
    assert.ok(maximum < 0.12);
  });

  test("critical spring does not overshoot and settles within 1.2 seconds", () => {
    let state = { value: 0, velocity: 0 };
    for (let frame = 0; frame < 72; frame += 1) {
      state = stepCriticalSpring(state, 1, 8.5, 1 / 60);
      assert.ok(state.value <= 1 + 1e-12);
    }
    assert.equal(springSettled(state, 1, 8e-4, 4e-3), true);
  });

  test("rapid alternating input drains and remains in range", () => {
    const input = Array.from({ length: 200 }, (_, index) => (index % 2 ? -1 : 1) as -1 | 1);
    const result = simulateFlipQueue(input, 18, 9);
    assert.equal(result.active, false);
    assert.equal(result.queue.length, 0);
    assert.ok(result.spread >= 0);
    assert.ok(result.spread <= 18);
  });
});