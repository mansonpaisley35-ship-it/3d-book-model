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
    const previous = output[j] ?? output[0]!;
    const sourceStart = source[j] ?? previous;
    const sourceEnd = source[j + 1] ?? previous;
    const targetStart = target[j] ?? previous;
    const targetEnd = target[j + 1] ?? previous;
    const sourceAngle = angleBetween(sourceStart, sourceEnd);
    let targetAngle = angleBetween(targetStart, targetEnd);
    if (direction > 0) {
      while (targetAngle < sourceAngle) targetAngle += Math.PI * 2;
    } else {
      while (targetAngle > sourceAngle) targetAngle -= Math.PI * 2;
    }
    const angle = sourceAngle + (targetAngle - sourceAngle) * weight;
    const length = Math.hypot(sourceEnd.x - sourceStart.x, sourceEnd.z - sourceStart.z);
    const lift = Math.sin(Math.PI * weight) * 0.075 * Math.sin(Math.PI * u);
    const candidate = {
      x: previous.x + length * Math.cos(angle),
      z: previous.z + length * Math.sin(angle) + lift,
    };
    const floor = Math.min(source[j + 1]?.z ?? candidate.z, target[j + 1]?.z ?? candidate.z);
    candidate.z = Math.max(candidate.z, floor);
    output.push(candidate);
  }
  return output;
}

/**
 * The left stack follows the opening cover. It rotates about a hinge raised
 * `pivotLift` above its root, so at open=0 it lies face-down on top of the
 * right stack (a closed block) and at open=1 it rests on the spine backing.
 */
export function openingCurve(points: readonly Point2[], open: number, pivotLift = 0) {
  const base = points[0] ?? { x: 0, z: 0 };
  const root = { x: base.x, z: base.z + pivotLift };
  const angle = Math.PI * (1 - clamp01(open));
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return points.map((point) => {
    const dx = point.x - root.x;
    const dz = point.z - root.z;
    return {
      x: root.x + cosine * dx + sine * dz,
      z: root.z - sine * dx + cosine * dz,
    };
  });
}

/**
 * Option A profile: the crest is strongest when the leaves are lopsided
 * (first/last spreads) and relaxes toward a flat reading profile in the middle.
 */
export function flatteningFactor(leftLeaves: number, rightLeaves: number) {
  const total = Math.max(1e-6, leftLeaves + rightLeaves);
  const balance = Math.abs(leftLeaves - rightLeaves) / total;
  return 1 - 0.75 * (1 - balance);
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