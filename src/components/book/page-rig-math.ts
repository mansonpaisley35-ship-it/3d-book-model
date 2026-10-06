export const PAGE_SEGMENTS = 26;

export type Point2 = { x: number; z: number };

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function smoothstep(value: number) {
  const x = clamp01(value);
  return x * x * (3 - 2 * x);
}

export function smootherstep5(value: number) {
  const x = clamp01(value);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/** Tangents for a page-stack top, solved to create a gutter crest without changing its fore-edge height. */
export function stackAngles(count: number, height: number, segment: number, amount: number) {
  const n = Math.max(1, Math.floor(count));
  const g = Array.from({ length: n }, (_, j) => {
    const u = (j + 0.5) / n;
    return 1 - smoothstep(u / 0.5) - 0.12 * smoothstep((u - 0.5) / 0.5);
  });
  const target = 0.55 * Math.max(0, height) * clamp01(amount);
  let amplitude = Math.min(1.2, target / Math.max(segment, 1e-9));
  for (let iteration = 0; iteration < 4; iteration += 1) {
    let f = -target;
    let derivative = 0;
    for (const value of g) {
      f += segment * Math.sin(amplitude * value);
      derivative += segment * value * Math.cos(amplitude * value);
    }
    if (Math.abs(derivative) < 1e-9) break;
    amplitude = Math.min(1.2, Math.max(0, amplitude - f / derivative));
  }
  return g.map((value) => amplitude * value);
}

/** Integrate a stack surface and shift it so its fore edge lands at the true stack height. */
export function stackChain(
  gutterX: number,
  baseZ: number,
  segment: number,
  angles: readonly number[],
  height: number,
  direction: -1 | 1,
) {
  const points: Point2[] = [{ x: gutterX, z: baseZ }];
  let x = gutterX;
  let z = baseZ;
  for (const angle of angles) {
    x += direction * segment * Math.cos(angle);
    z += segment * Math.sin(angle);
    points.push({ x, z });
  }
  const shift = baseZ + Math.max(0, height) - (points.at(-1)?.z ?? baseZ);
  for (const point of points) point.z += shift;
  return points;
}

export function restingCurve(
  gutterX: number,
  baseZ: number,
  width: number,
  height: number,
  amount: number,
  direction: -1 | 1,
  segments = PAGE_SEGMENTS,
) {
  const segment = width / segments;
  const angles = stackAngles(segments, height, segment, amount);
  return {
    angles,
    points: stackChain(gutterX, baseZ, segment, angles, height, direction),
  };
}

function angleBetween(a: Point2, b: Point2) {
  return Math.atan2(b.z - a.z, b.x - a.x);
}

/**
 * Lag-driven centreline. Endpoints are copied, rather than re-integrated, so
 * lift-off and landing are bit-for-bit identical to their resting surfaces.
 */
export function leafCurve(
  right: readonly Point2[],
  left: readonly Point2[],
  progress: number,
  lag: number,
  direction: -1 | 1,
) {
  const t = clamp01(progress);
  const source = direction > 0 ? right : left;
  const target = direction > 0 ? left : right;
  if (t === 0) return source.map((point) => ({ ...point }));
  if (t === 1) return target.map((point) => ({ ...point }));

  const segmentCount = Math.min(source.length, target.length) - 1;
  if (segmentCount < 1) return [];
  const output: Point2[] = [];
  const rootWeight = smootherstep5(t * (1 + lag));
  output.push({
    x: source[0]?.x ?? 0,
    z: (source[0]?.z ?? 0) + ((target[0]?.z ?? 0) - (source[0]?.z ?? 0)) * rootWeight,
  });

  for (let j = 0; j < segmentCount; j += 1) {
    const u = (j + 0.5) / segmentCount;
    const weight = smootherstep5(t * (1 + lag) - lag * u);
    const sourceEnd = source[j + 1] ?? candidate;
    const targetEnd = target[j + 1] ?? candidate;
    const lift = Math.sin(Math.PI * weight) * 0.2 * Math.sin(Math.PI * u);
    const candidate = {
      x: sourceEnd.x + (targetEnd.x - sourceEnd.x) * weight,
      z: sourceEnd.z + (targetEnd.z - sourceEnd.z) * weight + lift,
    };
    const floor = Math.min(source[j + 1]?.z ?? candidate.z, target[j + 1]?.z ?? candidate.z);
    candidate.z = Math.max(candidate.z, floor);
    output.push(candidate);
  }
  return output;
}

export type SpringState = { value: number; velocity: number };

/** Stable analytic step for a critically damped spring. */
export function stepCriticalSpring(state: SpringState, target: number, omega: number, dt: number) {
  const safeDt = Math.min(Math.max(dt, 0), 1 / 30);
  const displacement = state.value - target;
  const decay = Math.exp(-omega * safeDt);
  const nextDisplacement = (displacement + (state.velocity + omega * displacement) * safeDt) * decay;
  const nextVelocity =
    (state.velocity - omega * (state.velocity + omega * displacement) * safeDt) * decay;
  return { value: target + nextDisplacement, velocity: nextVelocity };
}

export function springSettled(state: SpringState, target: number, positionEpsilon: number, speedEpsilon: number) {
  return Math.abs(state.value - target) < positionEpsilon && Math.abs(state.velocity) < speedEpsilon;
}

/** Pure queue model used to stress the same two-item bounds as the UI state machine. */
export function simulateFlipQueue(inputs: readonly (-1 | 1)[], lastSpread: number, initialSpread = 0) {
  let spread = Math.min(lastSpread, Math.max(0, initialSpread));
  const queue: (-1 | 1)[] = [];
  for (const direction of inputs) {
    if (queue.length < 2) queue.push(direction);
    while (queue.length) {
      const next = queue.shift();
      if (next) spread = Math.min(lastSpread, Math.max(0, spread + next));
    }
  }
  return { spread, active: false, queue };
}