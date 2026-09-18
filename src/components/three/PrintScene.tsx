import { Environment, Lightformer, useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { printerModelUrl } from "@/lib/assets";
import {
  AXIS_LIMITS,
  createAxisState,
  createPrintTimeline,
  createTuneTimeline,
} from "./printer-axes";
import {
  createControlPoints,
  createEdgeGeometry,
  createSliceGeometry,
  createVaseGeometry,
  vaseRadius,
  VASE_DEFAULTS,
} from "./vase-geometry";

type Palette = {
  ink: string;
  paper: string;
  coral: string;
  tech: string;
  surface: string;
};

type PrintSceneProps = {
  phase: number;
  palette: Palette;
  reducedMotion: boolean;
};

const MODEL_URL = printerModelUrl;
const TARGET_HEIGHT = 5.4;
const SLICE_LAYERS = 34;
const PRINTER_OFFSET = new THREE.Vector3(-1.05, -0.15, 0);
/**
 * World units per model-local unit, before the group scale.
 *
 * Measured from the glTF: nudging any carriage by 1 local unit moves it 0.0254
 * in the model's own space (the file is authored in inches).
 */
const LOCAL_UNIT = 0.0254;

useGLTF.preload(MODEL_URL, false);

function damp(current: number, target: number, speed: number, delta: number) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-speed * delta));
}

type PrinterModel = {
  root: THREE.Object3D;
  scale: number;
  offset: THREE.Vector3;
  anchor: THREE.Vector3;
  materials: THREE.MeshStandardMaterial[];
  gantry: THREE.Object3D | null;
  extruder: THREE.Object3D | null;
  bed: THREE.Object3D | null;
  /** Home positions, captured before anything animates them. */
  rest: { gantryZ: number; extruderX: number; bedY: number };
};

function usePrinterModel(palette: Palette): PrinterModel {
  const { scene } = useGLTF(MODEL_URL, false);

  return useMemo<PrinterModel>(() => {
    const root = scene;
    const materials = new Set<THREE.MeshStandardMaterial>();

    root.traverse((object: THREE.Object3D) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      list.forEach((item) => {
        if (!(item instanceof THREE.MeshStandardMaterial)) return;
        if (!item.userData["strata"]) {
          item.userData["strata"] = true;
          switch (item.name) {
            case "silver":
              item.color.setRGB(0.68, 0.69, 0.71);
              item.roughness = 0.3;
              item.metalness = 0.88;
              break;
            case "green":
              item.color.setRGB(0.09, 0.1, 0.1);
              item.roughness = 0.62;
              item.metalness = 0.2;
              break;
            case "yellow":
              item.color.set(palette.coral);
              item.roughness = 0.42;
              item.metalness = 0.2;
              break;
            case "blue":
              item.color.setRGB(0.09, 0.28, 0.42);
              item.roughness = 0.35;
              item.metalness = 0.15;
              break;
            default:
              item.color.setRGB(0.062, 0.062, 0.066);
              item.roughness = 0.5;
              item.metalness = 0.45;
          }
          item.depthWrite = true;
          item.userData["baseColor"] = item.color.clone();
        }
        materials.add(item);
      });
    });

    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const scale = TARGET_HEIGHT / Math.max(size.y, 0.0001);
    const offset = new THREE.Vector3(-center.x, -box.min.y, -center.z);

    const plate = root.getObjectByName("Build_Plate") ?? root.getObjectByName("Bed");
    const plateBox = plate ? new THREE.Box3().setFromObject(plate) : box;
    const plateCenter = plateBox.getCenter(new THREE.Vector3());
    const anchor = new THREE.Vector3(
      (plateCenter.x + offset.x) * scale,
      (plateBox.max.y + offset.y) * scale,
      (plateCenter.z + offset.z) * scale,
    ).add(PRINTER_OFFSET);

    const gantry = root.getObjectByName("Gantry") ?? null;
    const extruder = root.getObjectByName("Extruder_Assembly") ?? null;
    // `Bed` carries the plate, the mat and the four levelling knobs, so moving
    // it takes the whole Y carriage with it.
    const bed = root.getObjectByName("Bed") ?? null;

    return {
      root,
      scale,
      offset,
      anchor,
      materials: Array.from(materials),
      gantry,
      extruder,
      bed,
      rest: {
        gantryZ: gantry?.position.z ?? 0,
        extruderX: extruder?.position.x ?? 0,
        bedY: bed?.position.y ?? 0,
      },
    };
  }, [palette, scene]);
}

/**
 * Drives the carriages from the anime.js timelines in `printer-axes`.
 *
 * The timelines write into a plain object; this only reads it, so no React
 * state changes per frame. Which timeline runs is decided by the integer phase
 * rather than the damped value, so the switch is clean instead of smeared
 * across the transition.
 */
function Printer({
  model,
  palette,
  phase,
  phaseValue,
  reducedMotion,
}: {
  model: PrinterModel;
  palette: Palette;
  phase: number;
  phaseValue: MutableRefObject<number>;
  reducedMotion: boolean;
}) {
  const opacityRef = useRef(1);
  const paperColor = useMemo(() => new THREE.Color(palette.paper), [palette.paper]);
  const rest = model.rest;

  const axes = useMemo(createAxisState, []);

  useEffect(() => {
    if (reducedMotion) {
      axes.x = 0;
      axes.y = 0;
      axes.z = 0;
      return;
    }

    // Only ever build the timeline this phase needs.
    //
    // Creating both and pausing one looks harmless but is not: anime.js
    // composes animations with `replace` by default, so the print timeline —
    // which owns x and y — cancelled the tune timeline's x and y tweens the
    // moment it was constructed. Z survived because print never touches it,
    // which is why the tune up moved on one axis only.
    const timeline =
      phase === 0 ? createTuneTimeline(axes) : phase === 3 ? createPrintTimeline(axes) : null;
    timeline?.play();

    return () => {
      timeline?.revert();
    };
  }, [axes, phase, reducedMotion]);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const value = phaseValue.current;

    // The machine steps back while the design and the file are the subject.
    const focus = value < 0.7 || value > 2.4 ? 1 : 0.22;
    opacityRef.current = damp(opacityRef.current, focus, 4.5, delta);
    const opacity = opacityRef.current;
    model.materials.forEach((material) => {
      const base = material.userData["baseColor"] as THREE.Color | undefined;
      material.transparent = opacity < 0.985;
      material.opacity = 0.5 + opacity * 0.5;
      if (base) material.color.copy(base).lerp(paperColor, (1 - opacity) * 0.72);
    });

    // Between the two animated phases the carriages ease back to rest rather
    // than freezing wherever the timeline happened to stop.
    const idle = phase !== 0 && phase !== 3;
    const printProgress = THREE.MathUtils.clamp((value - 2.5) * 2, 0, 1);
    const targetX = idle ? 0 : axes.x * AXIS_LIMITS.x;
    const targetY = idle ? 0 : axes.y * AXIS_LIMITS.y;
    // While printing the gantry climbs with the piece, the way a real machine
    // does: the nozzle stays just above the last layer instead of sitting at a
    // fixed height and ending up inside the finished vase.
    const targetZ =
      phase === 3
        ? -AXIS_LIMITS.printZ * (1 - printProgress)
        : idle
          ? 0
          : -axes.z * AXIS_LIMITS.zDescent;

    if (model.extruder) {
      model.extruder.position.x = damp(
        model.extruder.position.x,
        rest.extruderX + targetX,
        14,
        delta,
      );
    }
    if (model.bed) {
      model.bed.position.y = damp(model.bed.position.y, rest.bedY + targetY, 14, delta);
    }
    if (model.gantry) {
      model.gantry.position.z = damp(model.gantry.position.z, rest.gantryZ + targetZ, 8, delta);
    }
  });

  return (
    <group position={PRINTER_OFFSET.toArray()} scale={model.scale}>
      <primitive object={model.root} position={model.offset.toArray()} />
    </group>
  );
}

function CalibrationPoints({
  palette,
  phaseValue,
  anchor,
}: {
  palette: Palette;
  phaseValue: MutableRefObject<number>;
  anchor: THREE.Vector3;
}) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(({ clock }, rawDelta) => {
    const group = groupRef.current;
    if (!group) return;
    const delta = Math.min(rawDelta, 0.05);
    const focus = phaseValue.current < 0.8 ? 1 : 0;
    group.children.forEach((child, index) => {
      const mesh = child as THREE.Mesh;
      const material = mesh.material as THREE.MeshBasicMaterial;
      const pulse = 0.4 + Math.abs(Math.sin(clock.elapsedTime * 2.2 + index * 0.8)) * 0.6;
      material.opacity = damp(material.opacity, focus * pulse, 8, delta);
      mesh.scale.setScalar(damp(mesh.scale.x, 0.7 + focus * 0.5, 6, delta));
    });
  });

  return (
    <group ref={groupRef}>
      {(
        [
          [-0.82, -0.82],
          [0.82, -0.82],
          [-0.82, 0.82],
          [0.82, 0.82],
        ] as Array<[number, number]>
      ).map(([x, z], index) => (
        <mesh
          key={index}
          position={[anchor.x + x, anchor.y + 0.04, anchor.z + z]}
          rotation-x={-Math.PI / 2}
        >
          <ringGeometry args={[0.1, 0.17, 20]} />
          <meshBasicMaterial color={palette.tech} transparent opacity={0} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * The vase, in its three presentations.
 *
 * All of them are the same parametric surface: the cage, the slice contours and
 * the solid share one geometry, so the object visibly survives the journey
 * instead of being swapped for a different prop at each step.
 */
function Vase({
  palette,
  phaseValue,
  model,
}: {
  palette: Palette;
  phaseValue: MutableRefObject<number>;
  model: PrinterModel;
}) {
  const anchor = model.anchor;
  const groupRef = useRef<THREE.Group>(null);
  const solidRef = useRef<THREE.MeshStandardMaterial>(null);
  const ringMaterial = useRef<THREE.LineBasicMaterial>(null);
  const columnMaterial = useRef<THREE.LineBasicMaterial>(null);
  const sliceMaterial = useRef<THREE.LineBasicMaterial>(null);
  const pointsRef = useRef<THREE.InstancedMesh>(null);
  const sweepRef = useRef<THREE.Mesh>(null);
  const sweepMaterial = useRef<THREE.MeshBasicMaterial>(null);

  const build = useMemo(() => createVaseGeometry(), []);
  const ringGeometry = useMemo(() => createEdgeGeometry(build.positions, build.ringEdges), [build]);
  const columnGeometry = useMemo(
    () => createEdgeGeometry(build.positions, build.columnEdges),
    [build],
  );
  const sliceGeometry = useMemo(() => createSliceGeometry(SLICE_LAYERS, build.options), [build]);
  const controlPoints = useMemo(
    () => createControlPoints(build.positions, build.options, build.stride),
    [build],
  );

  // Reveals the solid bottom-up. Updated per frame; the renderer has local
  // clipping switched on in PrintCanvas.
  const clipPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, -1, 0), 0), []);
  const showcase = useMemo(() => new THREE.Vector3(anchor.x + 3.5, 1.5, anchor.z + 0.4), [anchor]);

  useEffect(() => {
    const mesh = pointsRef.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    controlPoints.forEach((point, index) => {
      matrix.makeTranslation(point.x, point.y, point.z);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [controlPoints]);

  useFrame(({ clock }, rawDelta) => {
    const group = groupRef.current;
    if (!group) return;
    const delta = Math.min(rawDelta, 0.05);
    const value = phaseValue.current;

    const designFocus = Math.max(0, 1 - Math.abs(value - 1) * 1.15);
    const sliceFocus = Math.max(0, 1 - Math.abs(value - 2) * 1.05);
    // Phase 3 settles at value 3, so the span 2.5..3 has to cover the whole
    // build — without the doubling the vase stops half printed, forever.
    const printProgress = THREE.MathUtils.clamp((value - 2.5) * 2, 0, 1);
    const onBed = value > 2.5;

    // On the plate the piece is carried by the bed, so it has to travel with
    // the Y carriage — it is sitting on it. Bed-local +y maps to world −Z.
    const bedOffset = model.bed ? model.bed.position.y - model.rest.bedY : 0;
    const bedWorldZ = -bedOffset * LOCAL_UNIT * model.scale;

    const targetX = onBed ? anchor.x : showcase.x;
    const targetY = onBed ? anchor.y : showcase.y;
    const targetZ = onBed ? anchor.z + bedWorldZ : showcase.z;
    group.position.x = damp(group.position.x, targetX, 4.5, delta);
    group.position.y = damp(group.position.y, targetY, 4.5, delta);
    // Stiffer than the others: a piece that lags its own bed looks unglued.
    group.position.z = damp(group.position.z, targetZ, onBed ? 16 : 4.5, delta);
    group.rotation.y += delta * (0.14 + designFocus * 0.4);
    group.scale.setScalar(
      damp(group.scale.x, onBed ? 0.62 : 0.74 + designFocus * 0.12, 4.5, delta),
    );

    const scale = group.scale.x;
    const height = build.options.height;

    if (ringMaterial.current) {
      ringMaterial.current.opacity = damp(
        ringMaterial.current.opacity,
        designFocus * 0.85,
        7,
        delta,
      );
    }
    if (columnMaterial.current) {
      columnMaterial.current.opacity = damp(
        columnMaterial.current.opacity,
        designFocus * 0.5,
        7,
        delta,
      );
    }
    if (pointsRef.current) {
      const material = pointsRef.current.material as THREE.MeshBasicMaterial;
      material.opacity = damp(material.opacity, designFocus, 7, delta);
      const pulse = 1 + Math.sin(clock.elapsedTime * 2.4) * 0.12 * designFocus;
      pointsRef.current.scale.setScalar(pulse);
    }
    if (sliceMaterial.current) {
      sliceMaterial.current.opacity = damp(
        sliceMaterial.current.opacity,
        sliceFocus * 0.9,
        7,
        delta,
      );
    }

    // Solid surface, clipped to the height printed so far.
    if (solidRef.current) {
      solidRef.current.opacity = damp(
        solidRef.current.opacity,
        printProgress > 0.01 ? 1 : 0,
        7,
        delta,
      );
      clipPlane.constant = group.position.y + printProgress * height * scale;
    }

    // One bright ring marking the active plane: the slicer's cut, then the
    // layer being laid down.
    if (sweepRef.current && sweepMaterial.current) {
      const sweep = sliceFocus > 0.02 ? (clock.elapsedTime * 0.28) % 1 : printProgress;
      const radius = vaseRadius(sweep) * 1.04;
      sweepRef.current.position.y = sweep * height;
      sweepRef.current.scale.setScalar(Math.max(radius, 0.001));
      sweepMaterial.current.opacity = damp(
        sweepMaterial.current.opacity,
        Math.max(sliceFocus, printProgress > 0.01 && printProgress < 0.99 ? 0.9 : 0),
        7,
        delta,
      );
    }
  });

  return (
    <group ref={groupRef} position={showcase.toArray()}>
      {/* Model & Design: the editable cage. */}
      <lineSegments geometry={ringGeometry}>
        <lineBasicMaterial ref={ringMaterial} color={palette.coral} transparent opacity={0} />
      </lineSegments>
      <lineSegments geometry={columnGeometry}>
        <lineBasicMaterial ref={columnMaterial} color={palette.tech} transparent opacity={0} />
      </lineSegments>
      <instancedMesh ref={pointsRef} args={[undefined, undefined, controlPoints.length]}>
        <octahedronGeometry args={[0.045, 0]} />
        <meshBasicMaterial color={palette.tech} transparent opacity={0} />
      </instancedMesh>

      {/* Digitalización: the same surface read as slice contours. */}
      <lineSegments geometry={sliceGeometry}>
        <lineBasicMaterial ref={sliceMaterial} color={palette.coral} transparent opacity={0} />
      </lineSegments>

      {/* Printing: the solid, revealed bottom-up. */}
      <mesh geometry={build.geometry} castShadow>
        <meshStandardMaterial
          ref={solidRef}
          color={palette.coral}
          roughness={0.62}
          metalness={0.05}
          side={THREE.DoubleSide}
          transparent
          opacity={0}
          clippingPlanes={[clipPlane]}
        />
      </mesh>

      <mesh ref={sweepRef} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.97, 1.03, 64]} />
        <meshBasicMaterial
          ref={sweepMaterial}
          color={palette.tech}
          transparent
          opacity={0}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

function FileTransfer({
  palette,
  phaseValue,
  anchor,
}: {
  palette: Palette;
  phaseValue: MutableRefObject<number>;
  anchor: THREE.Vector3;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const packetRefs = useRef<Array<THREE.Mesh | null>>([]);
  // Clear of the vase: the showcase piece tops out around y 3.3, so the sheet
  // starts above that instead of sharing the same volume.
  const home = useMemo(() => new THREE.Vector3(anchor.x + 4.7, 4.5, anchor.z + 0.5), [anchor]);

  useFrame(({ clock }, rawDelta) => {
    const group = groupRef.current;
    if (!group) return;
    const delta = Math.min(rawDelta, 0.05);
    const value = phaseValue.current;
    const focus = Math.max(0, 1 - Math.abs(value - 2) * 1.25);
    const transfer = THREE.MathUtils.clamp(1 - Math.abs(value - 2.5) * 1.6, 0, 1);
    group.scale.setScalar(damp(group.scale.x, 0.62 + focus * 0.3, 6, delta));
    group.position.y = damp(group.position.y, home.y + focus * 0.18, 6, delta);
    group.traverse((object: THREE.Object3D) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material as THREE.Material & { opacity: number };
      material.transparent = true;
      material.opacity = damp(material.opacity, Math.max(focus, transfer * 0.6), 7, delta);
    });
    packetRefs.current.forEach((packet, index) => {
      if (!packet) return;
      const progress = (clock.elapsedTime * 0.38 + index * 0.24) % 1;
      packet.position.x = -progress * (home.x - anchor.x);
      packet.position.y = Math.sin(progress * Math.PI) * 0.5 - progress * (home.y - anchor.y - 1.4);
    });
  });

  return (
    <group ref={groupRef} position={home.toArray()}>
      <mesh>
        <boxGeometry args={[1.28, 1.6, 0.12]} />
        <meshStandardMaterial color={palette.paper} transparent opacity={0} roughness={0.78} />
      </mesh>
      <mesh position={[0.27, 0.5, 0.09]}>
        <boxGeometry args={[0.54, 0.12, 0.04]} />
        <meshBasicMaterial color={palette.coral} transparent opacity={0} />
      </mesh>
      {[0, 1, 2, 3, 4].map((index) => (
        <mesh key={index} position={[0, 0.22 - index * 0.2, 0.09]}>
          <boxGeometry args={[0.82 - (index % 2) * 0.18, 0.045, 0.04]} />
          <meshBasicMaterial
            color={index === 3 ? palette.tech : palette.ink}
            transparent
            opacity={0}
          />
        </mesh>
      ))}
      {[0, 1, 2, 3].map((index) => (
        <mesh
          key={`packet-${index}`}
          ref={(node) => {
            packetRefs.current[index] = node;
          }}
          position={[0, 0, 0.1]}
        >
          <boxGeometry args={[0.14, 0.14, 0.14]} />
          <meshBasicMaterial color={palette.tech} transparent opacity={0} />
        </mesh>
      ))}
    </group>
  );
}

export function PrintScene({ phase, palette, reducedMotion }: PrintSceneProps) {
  const phaseValue = useRef(phase);
  const { invalidate } = useThree();
  const model = usePrinterModel(palette);

  useEffect(() => {
    if (reducedMotion) phaseValue.current = phase;
    invalidate();
  }, [invalidate, phase, reducedMotion]);

  useFrame((_, rawDelta) => {
    if (reducedMotion) return;
    const delta = Math.min(rawDelta, 0.05);
    phaseValue.current = damp(phaseValue.current, phase, 4.5, delta);
  });

  return (
    <>
      <ambientLight intensity={0.65} />
      <directionalLight
        position={[5, 9, 6]}
        intensity={2.4}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <directionalLight position={[-6, 4, -4]} intensity={0.3} color={palette.paper} />
      <Environment>
        <Lightformer intensity={2.6} position={[0, 6, 3]} scale={[10, 8, 1]} />
        <Lightformer
          intensity={0.5}
          color={palette.tech}
          position={[-7, 2, 1]}
          rotation-y={Math.PI / 2}
          scale={[9, 4, 1]}
        />
        <Lightformer
          intensity={0.7}
          color={palette.coral}
          position={[6, 3, 2]}
          rotation-y={-Math.PI / 3}
          scale={[7, 4, 1]}
        />
      </Environment>
      <Printer
        model={model}
        palette={palette}
        phase={phase}
        phaseValue={phaseValue}
        reducedMotion={reducedMotion}
      />
      <CalibrationPoints palette={palette} phaseValue={phaseValue} anchor={model.anchor} />
      <Vase palette={palette} phaseValue={phaseValue} model={model} />
      <FileTransfer palette={palette} phaseValue={phaseValue} anchor={model.anchor} />
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.2, 0]} receiveShadow>
        <planeGeometry args={[18, 14, 18, 14]} />
        <meshStandardMaterial color={palette.surface} wireframe roughness={0.9} />
      </mesh>
    </>
  );
}

export { VASE_DEFAULTS };
