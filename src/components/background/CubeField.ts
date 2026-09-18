import * as THREE from "three";
import { heroFormation, safeFormation, type Formation } from "./cube-formations";

/**
 * The cubes that travel the length of the page.
 *
 * One InstancedMesh, one set of cubes, reused from the hero to the contact
 * section: they scatter as tetrominoes behind the headline, gather into the
 * title of whichever process phase is on screen, and finally settle into
 * STRATA in pixel art beside the closing line. Because it is always the same
 * cubes being re-targeted, the page reads as one continuous object rather than
 * a series of separate effects.
 *
 * It renders into the background canvas that `AmbientField` owns, on a second
 * pass with its own perspective camera, so the whole page background still
 * costs exactly one WebGL context and one animation loop.
 */

export const CUBE_COUNT = 240;
/** Edge length of the cube geometry; instance scale is measured against it. */
const BASE_CUBE = 0.26;
/** How close the cursor has to be, in world units, to disturb a cube. */
const HOVER_RADIUS = 1.05;
/** How far a cube is pushed at the centre of that radius. */
const HOVER_PUSH = 0.55;
/** Material opacity at full presence. */
const BASE_OPACITY = 0.58;

export type CubePaletteInput = {
  paper: THREE.Color;
  peach: THREE.Color;
  red: THREE.Color;
};

type Pointer = { x: number; y: number };

/** Deterministic per-cube randomness, stable across reloads. */
function seeded(index: number, salt: number) {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

export class CubeField {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;

  private mesh: THREE.InstancedMesh;
  private geometry: THREE.BoxGeometry;
  private material: THREE.MeshPhysicalMaterial;

  private current = new Float32Array(CUBE_COUNT * 3);
  private target = new Float32Array(CUBE_COUNT * 3);
  private scale = new Float32Array(CUBE_COUNT);
  private targetScale = new Float32Array(CUBE_COUNT);
  private spin = new Float32Array(CUBE_COUNT * 3);

  private drift = 1;
  private elapsed = 0;
  private pointer: Pointer = { x: 0, y: 0 };
  private smoothPointer: Pointer = { x: 0, y: 0 };
  /** 0 in every section but the last, where the cubes react to the cursor. */
  private interactivity = 0;
  private formationKey = "";
  private presence = 1;
  private shownPresence = 1;

  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly position = new THREE.Vector3();
  private readonly scaleVector = new THREE.Vector3();
  private readonly hoverPoint = new THREE.Vector3();

  constructor(palette: CubePaletteInput) {
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 60);
    this.camera.position.set(0, 0, 7.4);

    this.geometry = new THREE.BoxGeometry(0.26, 0.26, 0.26);
    // Frosted rather than fully transmissive: real transmission needs an extra
    // render target per frame, which is not worth it for a background.
    this.material = new THREE.MeshPhysicalMaterial({
      transparent: true,
      opacity: BASE_OPACITY,
      roughness: 0.22,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.18,
      depthWrite: false,
      side: THREE.FrontSide,
    });

    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, CUBE_COUNT);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;

    const color = new THREE.Color();
    for (let i = 0; i < CUBE_COUNT; i += 1) {
      const pick = seeded(i, 3);
      // Mostly paper, with enough red and peach to tie the field to the palette.
      if (pick > 0.86) color.copy(palette.red);
      else if (pick > 0.62) color.copy(palette.peach);
      else color.copy(palette.paper);
      this.mesh.setColorAt(i, color);

      this.spin[i * 3] = (seeded(i, 7) - 0.5) * 0.6;
      this.spin[i * 3 + 1] = (seeded(i, 11) - 0.5) * 0.6;
      this.spin[i * 3 + 2] = (seeded(i, 13) - 0.5) * 0.6;

      // Start scattered so the first formation flies in rather than popping.
      this.current[i * 3] = (seeded(i, 17) - 0.5) * 14;
      this.current[i * 3 + 1] = (seeded(i, 19) - 0.5) * 9;
      this.current[i * 3 + 2] = (seeded(i, 23) - 0.5) * 6;
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;

    this.scene.add(this.mesh);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(3, 5, 6);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(palette.red.getHex(), 1.1);
    rim.position.set(-5, -2, 2);
    this.scene.add(rim);

    this.setFormation("hero", heroFormation());
  }

  /** Re-targets every cube. Extra cubes are parked and scaled to nothing. */
  setFormation(key: string, input: Formation) {
    if (key === this.formationKey) return;
    this.formationKey = key;

    const formation = safeFormation(input);
    const points = formation.points;
    this.drift = formation.drift;
    this.presence = formation.presence ?? 1;

    for (let i = 0; i < CUBE_COUNT; i += 1) {
      const point = points[i % Math.max(points.length, 1)];
      const used = i < points.length;

      if (point && used) {
        const offset = formation.offset;
        this.target[i * 3] = point.x + (offset?.x ?? 0);
        this.target[i * 3 + 1] = point.y + (offset?.y ?? 0);
        this.target[i * 3 + 2] =
          point.z + (offset?.z ?? 0) + (seeded(i, 29) - 0.5) * formation.depth;
        // Sized to the shape's own grid, with a little jitter so a block of
        // cubes still reads as individual pieces rather than a solid slab.
        const fit = formation.cell ? (formation.cell * 0.88) / BASE_CUBE : 1;
        this.targetScale[i] = fit * (0.88 + seeded(i, 31) * 0.24);
      } else {
        // Parked well outside the frustum, at zero size.
        this.target[i * 3] = (seeded(i, 37) - 0.5) * 18;
        this.target[i * 3 + 1] = (seeded(i, 41) - 0.5) * 12;
        this.target[i * 3 + 2] = -6 - seeded(i, 43) * 4;
        this.targetScale[i] = 0;
      }
    }
  }

  setPointer(x: number, y: number) {
    this.pointer.x = x;
    this.pointer.y = y;
  }

  /** 1 lets the cursor push the cubes around; 0 leaves the shape alone. */
  setInteractivity(value: number) {
    this.interactivity = value;
  }

  resize(width: number, height: number) {
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
  }

  update(delta: number, scrollVelocity: number) {
    this.elapsed += delta;

    // Eased rather than switched, so crossing a section boundary fades the
    // field instead of blinking it.
    this.shownPresence += (this.presence - this.shownPresence) * Math.min(1, delta * 2.2);
    this.material.opacity = BASE_OPACITY * this.shownPresence;

    // Parallax: the camera leans with the cursor, which is what gives the field
    // depth without moving the cubes themselves.
    this.smoothPointer.x += (this.pointer.x - this.smoothPointer.x) * Math.min(1, delta * 3);
    this.smoothPointer.y += (this.pointer.y - this.smoothPointer.y) * Math.min(1, delta * 3);
    this.camera.position.x = this.smoothPointer.x * 0.9;
    this.camera.position.y = this.smoothPointer.y * 0.55 - scrollVelocity * 0.12;
    this.camera.lookAt(0, 0, 0);

    // Cursor position on the z=0 plane, for the hover push in the last section.
    this.hoverPoint.set(this.smoothPointer.x * 4.2, this.smoothPointer.y * 2.4, 0);

    const approach = 1 - Math.exp(-2.6 * delta);

    for (let i = 0; i < CUBE_COUNT; i += 1) {
      const o = i * 3;
      const phase = seeded(i, 5) * Math.PI * 2;

      // Idle motion: strong in the hero scatter, barely there inside a shape.
      const wobble = this.drift * 0.16;
      const driftX = Math.sin(this.elapsed * 0.45 + phase) * wobble;
      const driftY = Math.cos(this.elapsed * 0.38 + phase * 1.3) * wobble;
      const driftZ = Math.sin(this.elapsed * 0.3 + phase * 0.7) * wobble * 1.6;

      let targetX = this.target[o]! + driftX;
      let targetY = this.target[o + 1]! + driftY;
      const targetZ = this.target[o + 2]! + driftZ;

      if (this.interactivity > 0) {
        const dx = this.current[o]! - this.hoverPoint.x;
        const dy = this.current[o + 1]! - this.hoverPoint.y;
        const distance = Math.hypot(dx, dy);
        if (distance < HOVER_RADIUS) {
          // Nudged aside, not blown away. A wide, strong push pulled the word
          // apart instead of reacting to the cursor within it.
          const push = (1 - distance / HOVER_RADIUS) ** 2 * this.interactivity * HOVER_PUSH;
          targetX += (dx / (distance || 1)) * push;
          targetY += (dy / (distance || 1)) * push;
        }
      }

      const cx = this.current[o]!;
      const cy = this.current[o + 1]!;
      const cz = this.current[o + 2]!;
      const cs = this.scale[i]!;
      this.current[o] = cx + (targetX - cx) * approach;
      this.current[o + 1] = cy + (targetY - cy) * approach;
      this.current[o + 2] = cz + (targetZ - cz) * approach;
      this.scale[i] = cs + (this.targetScale[i]! - cs) * approach;

      const spinRate = 0.25 + this.drift * 0.75;
      this.euler.set(
        this.spin[o]! * this.elapsed * spinRate + phase,
        this.spin[o + 1]! * this.elapsed * spinRate + phase,
        this.spin[o + 2]! * this.elapsed * spinRate,
      );
      this.quaternion.setFromEuler(this.euler);
      this.position.set(this.current[o]!, this.current[o + 1]!, this.current[o + 2]!);
      this.scaleVector.setScalar(this.scale[i]!);
      this.matrix.compose(this.position, this.quaternion, this.scaleVector);
      this.mesh.setMatrixAt(i, this.matrix);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
