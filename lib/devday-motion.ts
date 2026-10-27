// Finite attention and the authored Motion Studio audience wink.
// Geometry belongs to devday-glyphs; these samplers only supply face motion.
export type WinkSide = "left" | "right";
export const DEVDAY_LOOK_DURATION = 5.2;
export const DEVDAY_WINK_PEAK = 3.3;
export const clampMotion = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
export function settleMotion(value: number) {
  const p = clampMotion(value);
  return p * p * p * (p * (p * 6 - 15) + 10);
}
function response(age: number, frequency = 13, damping = 0.8) {
  if (age <= 0) return 0;
  const wd = frequency * Math.sqrt(1 - damping * damping);
  return 1 - Math.exp(-damping * frequency * age) *
    (Math.cos(wd * age) + damping * frequency / wd * Math.sin(wd * age));
}

/** Left, a readable hold, right, then audience eye contact. Exact rest at both ends. */
export function sampleDevDayLook(age: number, reducedMotion = false) {
  if (reducedMotion || !Number.isFinite(age) || age <= 0 || age >= DEVDAY_LOOK_DURATION) {
    return { x: 0, y: 0 };
  }
  const release = 1 - settleMotion((age - 4.6) / 0.6);
  const x = (-0.92 * response(age - 0.18) + 1.84 * response(age - 1.35)
    - 0.92 * response(age - 2.52)) * release;
  const y = -0.035 * (response(age - 0.18) - response(age - 2.52)) * release;
  const length = Math.max(1, Math.hypot(x, y));
  return { x: x / length, y: y / length };
}

/** Peak closure is age zero: anticipate, quick straight-dash closure, soft recovery. */
export function sampleDevDayWink(age: number, side: WinkSide = "left", reducedMotion = false) {
  const rest = { closure: 0, nod: 0, depth: 0, roll: 0 };
  if (reducedMotion || !Number.isFinite(age) || age <= -0.48 || age >= 1.2) return rest;
  const tail = 1 - settleMotion((age - 0.7) / 0.5);
  const nod = clampMotion(response(age + 0.48, 12, 0.76) - response(age - 0.19, 12, 0.76), -0.025, 1.06) * tail;
  return {
    closure: Math.exp(-((age / (age < 0 ? 0.075 : 0.13)) ** 4)),
    nod,
    depth: 0.08 * nod,
    roll: (side === "right" ? 0.07 : -0.07) * nod,
  };
}

export function sampleDevDayBlink(age: number) {
  if (age < 0 || age >= 0.24) return 0;
  if (age < 0.075) return settleMotion(age / 0.075);
  if (age < 0.1) return 1;
  return 1 - settleMotion((age - 0.1) / 0.14);
}
