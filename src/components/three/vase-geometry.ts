import * as THREE from "three";

/**
 * The vase, as one parametric surface reused by every phase of the journey.
 *
 * A single grid of vertices backs all three presentations, which is what lets
 * them read as the same object at different stages rather than three props:
 *
 *   Model & Design  → quad wireframe + control points (an editable mesh)
 *   Digitalización  → the same rings, isolated as slice contours
 *   Printing        → the solid surface, revealed bottom-up by a clip plane
 *
 * The silhouette is a spline through a handful of profile points, with a twist
 * and a ribbed radius — the shape a spiral-mode print actually produces, and
 * the reason the layer lines read as a spiral rather than stacked circles.
 */

export type VaseOptions = {
  height: number;
  /** Rings up the profile. Also the slice count in the Digitalización phase. */
  heightSegments: number;
  /** Vertices around each ring. */
  radialSegments: number;
  /** Total rotation from foot to lip, in radians. */
  twist: number;
  /** Number of vertical ribs. */
  ribCount: number;
  /** Rib depth as a fraction of the radius. */
  ribDepth: number;
};

export const VASE_DEFAULTS: VaseOptions = {
  height: 2.6,
  heightSegments: 96,
  radialSegments: 72,
  twist: Math.PI * 0.55,
  ribCount: 9,
  ribDepth: 0.055,
};

/**
 * Profile control points as (radius, normalised height).
 *
 * Foot, shoulder, waist, flared lip — a silhouette with two inflections, which
 * is what keeps it from reading as a plant pot.
 */
const PROFILE_POINTS: Array<[number, number]> = [
  [0.34, 0.0],
  [0.52, 0.05],
  [0.78, 0.16],
  [0.92, 0.33],
  [0.84, 0.5],
  [0.62, 0.68],
  [0.53, 0.82],
  [0.63, 0.94],
  [0.7, 1.0],
];

function profileCurve() {
  return new THREE.SplineCurve(PROFILE_POINTS.map(([r, t]) => new THREE.Vector2(r, t)));
}

/** Radius at normalised height `t`, before ribbing. */
export function vaseRadius(t: number, curve = profileCurve()) {
  return curve.getPoint(THREE.MathUtils.clamp(t, 0, 1)).x;
}

function ribbedRadius(radius: number, theta: number, options: VaseOptions) {
  // Ribs follow theta, which already carries the twist, so they spiral.
  return radius * (1 + options.ribDepth * Math.cos(options.ribCount * theta));
}

/**
 * Builds the surface plus the index buffers the other presentations need.
 *
 * `ringEdges` and `columnEdges` are kept separate from a plain wireframe: a
 * `wireframe: true` material draws triangle diagonals, which looks like a
 * render artefact rather than a modelling cage.
 */
export function createVaseGeometry(overrides: Partial<VaseOptions> = {}) {
  const options = { ...VASE_DEFAULTS, ...overrides };
  const { height, heightSegments, radialSegments, twist } = options;
  const curve = profileCurve();

  const positions: number[] = [];
  const indices: number[] = [];
  const ringEdges: number[] = [];
  const columnEdges: number[] = [];

  const stride = radialSegments + 1; // duplicate seam column, so normals wrap cleanly

  for (let i = 0; i <= heightSegments; i += 1) {
    const t = i / heightSegments;
    const point = curve.getPoint(t);
    const y = t * height;
    const twistAngle = twist * t;

    for (let j = 0; j <= radialSegments; j += 1) {
      const theta = (j / radialSegments) * Math.PI * 2 + twistAngle;
      const radius = ribbedRadius(point.x, theta, options);
      positions.push(Math.cos(theta) * radius, y, Math.sin(theta) * radius);
    }
  }

  for (let i = 0; i < heightSegments; i += 1) {
    for (let j = 0; j < radialSegments; j += 1) {
      const a = i * stride + j;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  // Cage lines: every ring, and a subset of columns so the mesh stays readable.
  const ringStep = Math.max(1, Math.round(heightSegments / 24));
  const columnStep = Math.max(1, Math.round(radialSegments / 18));

  for (let i = 0; i <= heightSegments; i += ringStep) {
    for (let j = 0; j < radialSegments; j += 1) {
      ringEdges.push(i * stride + j, i * stride + j + 1);
    }
  }
  for (let j = 0; j <= radialSegments; j += columnStep) {
    for (let i = 0; i < heightSegments; i += 1) {
      columnEdges.push(i * stride + j, (i + 1) * stride + j);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();

  return { geometry, positions, ringEdges, columnEdges, options, stride };
}

/** A LineSegments geometry sharing the surface's vertices, for the cage. */
export function createEdgeGeometry(positions: number[], edges: number[]) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(edges);
  return geometry;
}

/**
 * Sparse grid intersections, used as the draggable-looking control points of
 * the Model & Design phase. Returned as a flat transform list for an
 * InstancedMesh.
 */
export function createControlPoints(
  positions: number[],
  options: VaseOptions,
  stride: number,
  ringDivisions = 7,
  columnDivisions = 8,
) {
  const points: THREE.Vector3[] = [];
  for (let r = 0; r <= ringDivisions; r += 1) {
    const i = Math.round((r / ringDivisions) * options.heightSegments);
    for (let c = 0; c < columnDivisions; c += 1) {
      const j = Math.round((c / columnDivisions) * options.radialSegments);
      const index = (i * stride + j) * 3;
      points.push(
        new THREE.Vector3(
          positions[index] ?? 0,
          positions[index + 1] ?? 0,
          positions[index + 2] ?? 0,
        ),
      );
    }
  }
  return points;
}

/**
 * Horizontal slice rings at print-layer heights — the Digitalización phase.
 * Deliberately coarser than the surface so individual layers are countable.
 */
export function createSliceGeometry(layers: number, options: VaseOptions) {
  const curve = profileCurve();
  const positions: number[] = [];
  const indices: number[] = [];
  const segments = 64;
  let offset = 0;

  for (let l = 0; l < layers; l += 1) {
    const t = l / (layers - 1);
    const y = t * options.height;
    const radius = curve.getPoint(t).x;
    const twistAngle = options.twist * t;

    for (let j = 0; j <= segments; j += 1) {
      const theta = (j / segments) * Math.PI * 2 + twistAngle;
      const r = ribbedRadius(radius, theta, options);
      positions.push(Math.cos(theta) * r, y, Math.sin(theta) * r);
      if (j < segments) indices.push(offset + j, offset + j + 1);
    }
    offset += segments + 1;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}
