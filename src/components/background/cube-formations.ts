import * as THREE from "three";

/**
 * Where the cubes go in each section, and what colour each one is.
 *
 * Everything here is built on a grid. Words are rasterised into cells and then
 * extruded into real voxel blocks — the cubes sit on exact lattice positions,
 * axis-aligned, touching. They are not a swarm approximating a letterform.
 */

export type FormationPoint = {
  x: number;
  y: number;
  z: number;
  color: THREE.Color;
};

export type Formation = {
  points: FormationPoint[];
  /** Lattice spacing in world units. Cube size is derived from this. */
  cell: number;
  /** 0..1 overall visibility; dense sections keep the field quiet. */
  presence: number;
  /** Idle wander. 0 locks the lattice, which is what voxel text needs. */
  drift: number;
  /** Per-cube tumble. 0 keeps every cube square to the grid. */
  spin: number;
  /** Per-cube size variation. 0 makes the block read as one solid mass. */
  jitter: number;
  /** Moves the whole shape, for formations that sit beside copy. */
  offset?: THREE.Vector3;
  /** Axis the entire formation revolves around, e.g. a cube on its diagonal. */
  spinAxis?: THREE.Vector3;
  /** Radians per second about `spinAxis`. */
  spinSpeed?: number;
};

/** Deterministic hash → 0..1, so layouts are identical on every load. */
function noise(seed: number) {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}

/* ---------------------------------------------------------------- rasterer */

type VoxelGrid = { filled: Set<string>; columns: number; rows: number };

const GRID_CACHE = new Map<string, VoxelGrid>();

const voxelFont = (size: number) => `800 ${size}px ui-sans-serif, system-ui, sans-serif`;

/**
 * Rasterises a word at a given glyph height in cells, cropped to its own ink.
 *
 * Cropping is the important part. Rasterising into a box shaped like the world
 * rectangle leaves the glyphs sitting in a fraction of the grid, so the word
 * ends up drawn at a handful of cells with one-cell strokes — which is how a
 * voxel word turns back into a scatter of dots. Here the grid IS the word, and
 * the caller scales it to the space it has.
 */
function rasterWord(text: string, fontCells: number): VoxelGrid {
  const key = `${text}|${fontCells}`;
  const cached = GRID_CACHE.get(key);
  if (cached) return cached;

  const empty: VoxelGrid = { filled: new Set(), columns: 0, rows: 0 };
  if (typeof document === "undefined") return empty;

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return empty;

  const lines = text.split("\n");
  const lineHeight = Math.max(1, Math.round(fontCells * 1.18));

  context.font = voxelFont(fontCells);
  const widest = Math.max(1, ...lines.map((line) => context.measureText(line).width));

  // Two cells of margin, so no glyph is clipped by the canvas edge.
  canvas.width = Math.ceil(widest) + 4;
  canvas.height = lineHeight * lines.length + 4;

  // Resizing a canvas resets its context, so the state is set again here.
  context.font = voxelFont(fontCells);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "#000";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#fff";
  lines.forEach((line, index) =>
    context.fillText(line, canvas.width / 2, 2 + lineHeight * (index + 0.5)),
  );

  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  const ink: Array<[number, number]> = [];
  let minColumn = canvas.width;
  let maxColumn = -1;
  let minRow = canvas.height;
  let maxRow = -1;

  for (let row = 0; row < canvas.height; row += 1) {
    for (let column = 0; column < canvas.width; column += 1) {
      if ((data[(row * canvas.width + column) * 4] ?? 0) < 128) continue;
      ink.push([column, row]);
      if (column < minColumn) minColumn = column;
      if (column > maxColumn) maxColumn = column;
      if (row < minRow) minRow = row;
      if (row > maxRow) maxRow = row;
    }
  }
  if (ink.length === 0) return empty;

  const filled = new Set<string>();
  for (const [column, row] of ink) filled.add(`${column - minColumn},${row - minRow}`);

  const grid: VoxelGrid = {
    filled,
    columns: maxColumn - minColumn + 1,
    rows: maxRow - minRow + 1,
  };
  GRID_CACHE.set(key, grid);
  return grid;
}

/* -------------------------------------------------------------- voxel word */

export type VoxelWordOptions = {
  /** World width the word is allowed to span. */
  width: number;
  /** World height the word is allowed to span. */
  height: number;
  centerColor: THREE.Color;
  borderColor: THREE.Color;
  /** Cells deep the interior is extruded. */
  centerDepth?: number;
  /** Cells deep the outline is extruded — half the centre gives the relief. */
  borderDepth?: number;
  /** Largest glyph height, in cells, worth trying. */
  maxFontCells?: number;
};

/** Splits a grid into its outline cells and the cells enclosed by them. */
function splitOutline(grid: VoxelGrid) {
  const border: Array<[number, number]> = [];
  const interior: Array<[number, number]> = [];

  for (const key of grid.filled) {
    const [columnRaw, rowRaw] = key.split(",");
    const column = Number(columnRaw);
    const row = Number(rowRaw);
    const isBorder =
      !grid.filled.has(`${column - 1},${row}`) ||
      !grid.filled.has(`${column + 1},${row}`) ||
      !grid.filled.has(`${column},${row - 1}`) ||
      !grid.filled.has(`${column},${row + 1}`);
    (isBorder ? border : interior).push([column, row]);
  }

  return { border, interior };
}

/**
 * Builds the chunkiest voxel word that still fits the cube budget.
 *
 * The page has a fixed number of cubes travelling through it, so glyph
 * resolution is chosen against that number: the largest raster whose extruded
 * cell count fits wins, which keeps letter strokes at least a couple of cubes
 * thick instead of one. The result is then scaled to whichever of width or
 * height runs out first, so a three-line stack shrinks to fit its band rather
 * than overflowing it.
 */
export function fitVoxelWord(
  text: string,
  budget: number,
  options: VoxelWordOptions,
): { points: FormationPoint[]; cell: number } {
  const centerDepth = options.centerDepth ?? 2;
  const borderDepth = options.borderDepth ?? 1;
  const maxFontCells = options.maxFontCells ?? 30;

  let chosen: { grid: VoxelGrid; parts: ReturnType<typeof splitOutline> } | null = null;
  for (let fontCells = 6; fontCells <= maxFontCells; fontCells += 1) {
    const grid = rasterWord(text, fontCells);
    if (grid.filled.size === 0) continue;
    const parts = splitOutline(grid);
    const count = parts.border.length * borderDepth + parts.interior.length * centerDepth;
    if (count > budget) break;
    chosen = { grid, parts };
  }
  if (!chosen) return { points: [], cell: 0.1 };

  const { grid, parts } = chosen;
  const cell = Math.min(options.width / grid.columns, options.height / grid.rows);
  const points: FormationPoint[] = [];

  const place = (cells: Array<[number, number]>, depth: number, color: THREE.Color) => {
    for (const [column, row] of cells) {
      const x = (column - (grid.columns - 1) / 2) * cell;
      const y = ((grid.rows - 1) / 2 - row) * cell;
      for (let layer = 0; layer < depth; layer += 1) {
        points.push({ x, y, z: layer * cell, color });
      }
    }
  };

  place(parts.border, borderDepth, options.borderColor);
  place(parts.interior, centerDepth, options.centerColor);

  return { points, cell };
}

/* ------------------------------------------------------------- tetrominoes */

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
 * The hero: tetrominoes on a ring, so the middle of the screen stays clear for
 * the headline.
 */
export function heroFormation(palette: {
  paper: THREE.Color;
  peach: THREE.Color;
  red: THREE.Color;
}): Formation {
  const points: FormationPoint[] = [];
  const cell = 0.36;
  const pieceCount = 18;

  for (let piece = 0; piece < pieceCount; piece += 1) {
    const shape = TETROMINOES[piece % TETROMINOES.length]!;
    const angle = (piece / pieceCount) * Math.PI * 2 + noise(piece) * 0.6;
    const radius = 4.4 * (0.72 + noise(piece + 40) * 0.5);
    const originX = Math.cos(angle) * radius;
    const originY = Math.sin(angle) * radius * 0.52;
    const originZ = (noise(piece + 90) - 0.5) * 2.4;
    const rotated = noise(piece + 120) > 0.5;
    const pick = noise(piece + 200);
    const color = pick > 0.82 ? palette.red : pick > 0.55 ? palette.peach : palette.paper;

    for (const [cx, cy] of shape) {
      points.push({
        x: originX + (rotated ? cy : cx) * cell,
        y: originY + (rotated ? cx : cy) * cell,
        z: originZ,
        color,
      });
    }
  }

  return { points, cell, presence: 1, drift: 1, spin: 1, jitter: 0.2 };
}

/* ------------------------------------------------------------- cube outline */

/**
 * The twelve edges of a cube, drawn in cubes.
 *
 * Revolved around its own body diagonal so it turns on a vertex rather than a
 * face, which is what makes it read as a solid in space.
 */
export function cubeEdgeFormation(options: {
  size: number;
  perEdge: number;
  color: THREE.Color;
  accent: THREE.Color;
  presence?: number;
  offset?: THREE.Vector3;
}): Formation {
  const { size, perEdge, color, accent } = options;
  const half = size / 2;
  const corners: Array<[number, number, number]> = [];
  for (const x of [-half, half]) {
    for (const y of [-half, half]) {
      for (const z of [-half, half]) corners.push([x, y, z]);
    }
  }

  // A pair of corners forms an edge when they differ on exactly one axis.
  const seen = new Set<string>();
  const points: FormationPoint[] = [];

  for (let a = 0; a < corners.length; a += 1) {
    for (let b = a + 1; b < corners.length; b += 1) {
      const start = corners[a]!;
      const end = corners[b]!;
      const differing = start.reduce(
        (count, value, axis) => count + (value !== end[axis] ? 1 : 0),
        0,
      );
      if (differing !== 1) continue;

      for (let step = 0; step < perEdge; step += 1) {
        const t = step / (perEdge - 1);
        const x = start[0] + (end[0] - start[0]) * t;
        const y = start[1] + (end[1] - start[1]) * t;
        const z = start[2] + (end[2] - start[2]) * t;
        const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
        if (seen.has(key)) continue; // corners are shared by three edges
        seen.add(key);
        // Corners in the accent, so the eye can follow the rotation.
        const isCorner = step === 0 || step === perEdge - 1;
        points.push({ x, y, z, color: isCorner ? accent : color });
      }
    }
  }

  return {
    points,
    cell: size / (perEdge - 1),
    presence: options.presence ?? 1,
    drift: 0,
    spin: 0,
    jitter: 0,
    spinAxis: new THREE.Vector3(1, 1, 1).normalize(),
    spinSpeed: 0.42,
    ...(options.offset ? { offset: options.offset } : {}),
  };
}

/** Falls back to something valid if a raster comes back empty. */
export function safeFormation(formation: Formation, fallback: Formation): Formation {
  return formation.points.length > 0 ? formation : fallback;
}
