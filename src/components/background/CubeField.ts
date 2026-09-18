import * as THREE from "three";
import { safeFormation, type Formation } from "./cube-formations";

/**
 * The cubes that travel the length of the page.
 *
 * One InstancedMesh re-targeted section by section, so the page reads as one
 * object moving through it rather than four separate effects. Cubes are solid,
 * lit and opaque — no transparency anywhere, which is what keeps the voxel
 * words reading as blocks rather than as glass.
 *
 * It renders into the background canvas that `AmbientField` owns, on a second
 * pass with its own perspective camera, so the whole page background still
 * costs exactly one WebGL context and one animation loop.
 */

export const CUBE_COUNT = 460;
/** How close the cursor has to be, in world units, to disturb a cube. */
const HOVER_RADIUS = 1.05;
/** How far a cube is pushed at the centre of that radius. */
const HOVER_PUSH = 0.55;

type Pointer = { x: number; y: number };

/** Deterministic per-cube randomness, stable across reloads. */
function seeded(index: number, salt: number) {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

export class CubeField {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;

  private group = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private geometry: THREE.BoxGeometry;
  private material: THREE.MeshStandardMaterial;

  private current = new Float32Array(CUBE_COUNT * 3);
  private target = new Float32Array(CUBE_COUNT * 3);
  private scale = new Float32Array(CUBE_COUNT);
  private targetScale = new Float32Array(CUBE_COUNT);
  private spin = new Float32Array(CUBE_COUNT * 3);

  private drift = 1;
  private spinAmount = 1;
  private presence = 1;
  private shownPresence = 1;
  private elapsed = 0;
  private pointer: Pointer = { x: 0, y: 0 };
  private smoothPointer: Pointer = { x: 0, y: 0 };
  private interactivity = 0;
  private formationKey = "";
  private spinAxis: THREE.Vector3 | null = null;
  private spinSpeed = 0;

  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly identity = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly position = new THREE.Vector3();
  private readonly scaleVector = new THREE.Vector3();
  private readonly hoverPoint = new THREE.Vector3();

  constructor(initial: Formation) {
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 60);
    this.camera.position.set(0, 0, 7.4);

    // Unit cube, so an instance scale is exactly the world size we want.
    this.geometry = new THREE.BoxGeometry(1, 1, 1);
    this.material = new THREE.MeshStandardMaterial({
      roughness: 0.52,
      metalness: 0.04,
      transparent: false,
      depthWrite: true,
    });

    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, CUBE_COUNT);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;

    for (let i = 0; i < CUBE_COUNT; i += 1) {
      this.spin[i * 3] = (seeded(i, 7) - 0.5) * 0.6;
      this.spin[i * 3 + 1] = (seeded(i, 11) - 0.5) * 0.6;
      this.spin[i * 3 + 2] = (seeded(i, 13) - 0.5) * 0.6;
      // Start scattered, so the first formation flies in rather than popping.
      this.current[i * 3] = (seeded(i, 17) - 0.5) * 14;
      this.current[i * 3 + 1] = (seeded(i, 19) - 0.5) * 9;
      this.current[i * 3 + 2] = (seeded(i, 23) - 0.5) * 6;
    }

    this.group.add(this.mesh);
    this.scene.add(this.group);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(3, 5, 6);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.7);
    fill.position.set(-5, -2, 3);
    this.scene.add(fill);

    this.setFormation("initial", initial);
  }

  /** Re-targets and re-colours every cube. Extras are parked at zero size. */
  setFormation(key: string, input: Formation) {
    if (key === this.formationKey) return;
    this.formationKey = key;

    const formation = safeFormation(input, input);
    const { points, cell } = formation;
    this.drift = formation.drift;
    this.spinAmount = formation.spin;
    this.presence = formation.presence;
    this.spinAxis = formation.spinAxis ?? null;
    this.spinSpeed = formation.spinSpeed ?? 0;
    if (!this.spinAxis) this.group.quaternion.copy(this.identity);

    // Voxel blocks butt up against each other; loose formations breathe.
    const fill = formation.jitter === 0 && formation.drift === 0 ? 0.97 : 0.66;
    const offset = formation.offset;

    for (let i = 0; i < CUBE_COUNT; i += 1) {
      const point = points[i];
      if (point) {
        this.target[i * 3] = point.x + (offset?.x ?? 0);
        this.target[i * 3 + 1] = point.y + (offset?.y ?? 0);
        this.target[i * 3 + 2] = point.z + (offset?.z ?? 0);
        this.targetScale[i] = cell * fill * (1 + (seeded(i, 31) - 0.5) * formation.jitter);
        this.mesh.setColorAt(i, point.color);
      } else {
        // Cubes this formation has no room for collapse into its centre rather
        // than scattering across the viewport. They are on their way to zero
        // size either way, but sending them outward strews shrinking cubes
        // over the copy for the whole of the transition.
        this.target[i * 3] = offset?.x ?? 0;
        this.target[i * 3 + 1] = offset?.y ?? 0;
        this.target[i * 3 + 2] = (offset?.z ?? 0) - 1.5;
        this.targetScale[i] = 0;
      }
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
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

  /**
   * Half the width of the frame at z = 0, in world units.
   *
   * Formations are laid out in world units, so without this a shape sized for
   * a desktop frame simply falls outside a phone's and is never seen.
   */
  get halfWidth() {
    const halfHeight =
      Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * this.camera.position.z;
    return halfHeight * this.camera.aspect;
  }

  update(delta: number, scrollVelocity: number) {
    this.elapsed += delta;

    // Presence is carried by size, not opacity: with solid cubes there is no
    // alpha to fade, and scaling away avoids any sorting artefacts.
    this.shownPresence += (this.presence - this.shownPresence) * Math.min(1, delta * 2.2);

    this.smoothPointer.x += (this.pointer.x - this.smoothPointer.x) * Math.min(1, delta * 3);
    this.smoothPointer.y += (this.pointer.y - this.smoothPointer.y) * Math.min(1, delta * 3);
    this.camera.position.x = this.smoothPointer.x * 0.9;
    this.camera.position.y = this.smoothPointer.y * 0.55 - scrollVelocity * 0.12;
    this.camera.lookAt(0, 0, 0);

    // A formation may revolve as a whole — the services cube turns on its
    // body diagonal, so it pivots about a vertex rather than a face.
    if (this.spinAxis) {
      this.group.quaternion.setFromAxisAngle(this.spinAxis, this.elapsed * this.spinSpeed);
    }

    this.hoverPoint.set(this.smoothPointer.x * 4.2, this.smoothPointer.y * 2.4, 0);
    const approach = 1 - Math.exp(-3.1 * delta);

    for (let i = 0; i < CUBE_COUNT; i += 1) {
      const o = i * 3;
      const phase = seeded(i, 5) * Math.PI * 2;

      const wobble = this.drift * 0.16;
      let targetX = this.target[o]! + Math.sin(this.elapsed * 0.45 + phase) * wobble;
      let targetY = this.target[o + 1]! + Math.cos(this.elapsed * 0.38 + phase * 1.3) * wobble;
      const targetZ =
        this.target[o + 2]! + Math.sin(this.elapsed * 0.3 + phase * 0.7) * wobble * 1.6;

      if (this.interactivity > 0) {
        const dx = this.current[o]! - this.hoverPoint.x;
        const dy = this.current[o + 1]! - this.hoverPoint.y;
        const distance = Math.hypot(dx, dy);
        if (distance < HOVER_RADIUS) {
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
      this.scale[i] = cs + (this.targetScale[i]! * this.shownPresence - cs) * approach;

      if (this.spinAmount > 0) {
        const rate = this.spinAmount * 0.75;
        this.euler.set(
          this.spin[o]! * this.elapsed * rate + phase,
          this.spin[o + 1]! * this.elapsed * rate + phase,
          this.spin[o + 2]! * this.elapsed * rate,
        );
        this.quaternion.setFromEuler(this.euler);
      } else {
        // Square to the lattice: voxels must not tumble.
        this.quaternion.copy(this.identity);
      }

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
