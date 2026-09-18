import * as THREE from "three";

/**
 * Where the cubes go in each section.
 *
 * Every formation returns points in the same space — roughly x ∈ [-4.2, 4.2],
 * y ∈ [-2.3, 2.3], z ∈ [-1.4, 1.4] — which is what the field's camera frames.
 * A formation may return fewer points than there are cubes; the field parks the
 * remainder off-stage rather than padding the shape with strays.
 */

export type Formation = {
  points: THREE.Vector3[];
  /** How much idle drift to apply on top of the target. 0 holds the shape crisply. */
  drift: number;
  /** Depth spread, so a flat shape still reads as dimensional. */
  depth: number;
  /** Shifts the whole shape, for formations that sit beside copy rather than behind it. */
  offset?: THREE.Vector3;
  /**
   * Grid spacing the shape was built on, in world units.
   *
   * The field sizes each cube to this. Without it every shape is drawn with
   * cubes far larger than its own grid, and the letterforms fill in solid.
   */
  cell?: number;
  /**
   * How present the cubes are, 0..1.
   *
   * Sections with room to spare (the hero, the contact close) carry the field
   * at full strength. Over dense copy it has to recede to a watermark, or it
   * stops being a background and becomes litter on top of the text.
   */
  presence?: number;
};

/** Deterministic hash → 0..1. Keeps layouts stable across reloads and SSR. */
function noise(seed: number) {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}

/* ------------------------------------------------------------------ text */

const RASTER_CACHE = new Map<string, THREE.Vector3[]>();

/**
 * Rasterises text into a grid of cube positions.
 *
 * Draws the string into a small offscreen canvas, reads back the filled cells
 * and keeps every one — the grid resolution, not a sampling step, is what
 * controls the cube count, so letterforms never lose strokes to thinning.
 */
export function textPoints(
  text: string,
  options: { columns?: number; width?: number; height?: number; weight?: number } = {},
): THREE.Vector3[] {
  const columns = options.columns ?? 46;
  const width = options.width ?? 7.2;
  const height = options.height ?? 2.1;
  const key = `${text}|${columns}|${width}|${height}`;
  const cached = RASTER_CACHE.get(key);
  if (cached) return cached;

  if (typeof document === "undefined") return [];

  const rows = Math.max(5, Math.round((columns * height) / width));
  const canvas = document.createElement("canvas");
  canvas.width = columns;
  canvas.height = rows;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [];

  context.fillStyle = "#000";
  context.fillRect(0, 0, columns, rows);
  context.fillStyle = "#fff";
  context.textAlign = "center";
  context.textBaseline = "middle";

  // Grow the size until the string just fits the grid, so short and long
  // strings both fill the available width.
  let size = rows;
  for (; size > 3; size -= 1) {
    context.font = `800 ${size}px ui-sans-serif, system-ui, sans-serif`;
    if (context.measureText(text).width <= columns * 0.94) break;
  }
  context.font = `800 ${size}px ui-sans-serif, system-ui, sans-serif`;
  context.fillText(text, columns / 2, rows / 2);

  const { data } = context.getImageData(0, 0, columns, rows);
  const points: THREE.Vector3[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const alpha = data[(row * columns + column) * 4] ?? 0;
      if (alpha < 128) continue;
      points.push(
        new THREE.Vector3(
          (column / (columns - 1) - 0.5) * width,
          (0.5 - row / (rows - 1)) * height,
          0,
        ),
      );
    }
  }

  RASTER_CACHE.set(key, points);
  return points;
}

/** The world-space distance between neighbouring cells of a raster. */
export function rasterCell(columns: number, width: number) {
  return width / Math.max(columns - 1, 1);
}

/* ------------------------------------------------------------- tetrominoes */

/** The seven tetrominoes, as cell offsets. */
const TETROMINOES: Array<Array<[number, number]>> = [
  [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
  ], // I
  [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ], // O
  [
    [0, 0],
    [1, 0],
    [2, 0],
    [1, 1],
  ], // T
  [
    [1, 0],
    [2, 0],
    [0, 1],
    [1, 1],
  ], // S
  [
    [0, 0],
    [1, 0],
    [1, 1],
    [2, 1],
  ], // Z
  [
    [0, 0],
    [0, 1],
    [1, 1],
    [2, 1],
  ], // J
  [
    [2, 0],
    [0, 1],
    [1, 1],
    [2, 1],
  ], // L
];

/**
 * The hero: loose tetrominoes scattered in depth.
 *
 * Pieces are placed on a ring rather than at random so they never clump in
 * front of the headline, and each is nudged outward from centre — the middle of
 * the screen belongs to the type.
 */
export function tetrisPoints(pieceCount = 16, spread = 4.4): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  const cell = 0.34;

  for (let piece = 0; piece < pieceCount; piece += 1) {
    const shape = TETROMINOES[piece % TETROMINOES.length]!;
    const angle = (piece / pieceCount) * Math.PI * 2 + noise(piece) * 0.6;
    const radius = spread * (0.52 + noise(piece + 40) * 0.62);
    const originX = Math.cos(angle) * radius;
    const originY = Math.sin(angle) * radius * 0.52;
    const originZ = (noise(piece + 90) - 0.5) * 2.4;
    const rotated = noise(piece + 120) > 0.5;

    for (const [cx, cy] of shape) {
      const localX = (rotated ? cy : cx) * cell;
      const localY = (rotated ? cx : cy) * cell;
      points.push(new THREE.Vector3(originX + localX, originY + localY, originZ));
    }
  }
  return points;
}

/* -------------------------------------------------------------- formations */

export function heroFormation(): Formation {
  return { points: tetrisPoints(), drift: 1, depth: 1, cell: 0.34, presence: 1 };
}

/**
 * Rasterises at whichever grid resolution lands closest to `target` cubes
 * without exceeding it.
 *
 * The cube count is fixed for the whole page — the same cubes travel from
 * section to section — so each shape has to be fitted to that budget rather
 * than the other way round.
 */
export function fitTextPoints(
  text: string,
  target: number,
  options: Parameters<typeof textPoints>[1] & { maxColumns?: number } = {},
): { points: THREE.Vector3[]; columns: number } {
  let best: THREE.Vector3[] = [];
  let bestColumns = 18;
  const limit = options.maxColumns ?? 72;
  for (let columns = 16; columns <= limit; columns += 2) {
    const points = textPoints(text, { ...options, columns });
    if (points.length > target) break;
    if (points.length > best.length) {
      best = points;
      bestColumns = columns;
    }
  }
  return { points: best, columns: bestColumns };
}

export function textFormation(
  text: string,
  options?: Parameters<typeof textPoints>[1] & {
    drift?: number;
    depth?: number;
    target?: number;
    maxColumns?: number;
    presence?: number;
    offset?: THREE.Vector3;
  },
): Formation {
  const width = options?.width ?? 7.2;
  const fitted = fitTextPoints(text, options?.target ?? 240, options);
  return {
    points: fitted.points,
    presence: options?.presence ?? 1,
    drift: options?.drift ?? 0.12,
    depth: options?.depth ?? 0.34,
    cell: rasterCell(fitted.columns, width),
    ...(options?.offset ? { offset: options.offset } : {}),
  };
}

/** Falls back to the hero scatter when a text raster comes back empty. */
export function safeFormation(formation: Formation): Formation {
  return formation.points.length > 0 ? formation : heroFormation();
}
