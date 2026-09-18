import { createTimeline, type Timeline } from "animejs";

/**
 * Axis choreography for the printer.
 *
 * The three carriages move one at a time, the way a real machine homes and
 * levels — never all together, which is what made the old loop read as a
 * rattle rather than a calibration.
 *
 * Values here are in the model's LOCAL units, where 1 unit = 0.0254 world
 * units. The node-local axes do not line up with the world axes, so each
 * printer axis is driven through a different local component:
 *
 *   printer X (extruder along the beam) → `extruder.position.x`  → world +X
 *   printer Y (bed front/back)          → `bed.position.y`       → world −Z
 *   printer Z (gantry up/down)          → `gantry.position.z`    → world +Y
 *
 * Limits are measured from the model's bounding boxes, not guessed. The nozzle
 * sits at world y 0.36 and the bed top at y 0.11, so a descent of 7 local units
 * (0.178 world) leaves ~0.07 of clearance. The previous code drove it to −11,
 * which put the nozzle at y 0.08 — below the bed, which is why it clipped
 * straight through.
 */

export const AXIS_LIMITS = {
  /** Half-travel of the extruder along the beam. Keeps it clear of the uprights. */
  x: 2.6,
  /** Half-travel of the bed, front to back, inside the base footprint. */
  y: 2.4,
  /** Maximum gantry descent. Downward only — the rest pose is the ceiling. */
  zDescent: 7,
  /** Where the gantry parks while printing: low, but still clear of the piece. */
  printZ: 4.6,
} as const;

/** `x` and `y` run −1..1; `z` is a 0..1 descent fraction, never negative. */
export type AxisState = { x: number; y: number; z: number };

export function createAxisState(): AxisState {
  return { x: 0, y: 0, z: 0 };
}

const TUNE_MS = 2300;
const PRINT_MS = 700;
/** Amplitude 1, period .4 — the overshoot of a belt settling, not a spring toy. */
const AXIS_EASE = "inOutElastic(1, .4)";

/**
 * Tune up: X, then Y, then Z, then the same three back again.
 *
 * Six slots rather than three so the loop closes on itself — with three, every
 * repeat would snap each axis back to its start before moving.
 */
export function createTuneTimeline(state: AxisState): Timeline {
  return createTimeline({ loop: true, defaults: { duration: TUNE_MS, ease: AXIS_EASE } })
    .add(state, { x: [-1, 1] })
    .add(state, { y: [-1, 1] })
    .add(state, { z: [0, 1] })
    .add(state, { x: [1, -1] })
    .add(state, { y: [1, -1] })
    .add(state, { z: [1, 0] });
}

/**
 * Printing: the same gesture on X and Y only, and much faster. Z is held at the
 * print height by the scene, so the gantry stays put while the piece builds.
 */
export function createPrintTimeline(state: AxisState): Timeline {
  return createTimeline({ loop: true, defaults: { duration: PRINT_MS, ease: AXIS_EASE } })
    .add(state, { x: [-1, 1] })
    .add(state, { y: [-1, 1] })
    .add(state, { x: [1, -1] })
    .add(state, { y: [1, -1] });
}
