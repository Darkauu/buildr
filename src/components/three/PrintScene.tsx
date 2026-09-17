import { Environment, Lightformer } from "@react-three/drei";
import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import printerAsset from "@/assets/creality-ender-3-pro.glb.asset.json";

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

const MODEL_URL = printerAsset.url;
const TARGET_HEIGHT = 5.4;
const LAYER_COUNT = 32;
const PRINTER_OFFSET = new THREE.Vector3(-1.05, -0.15, 0);

const VASE_PROFILE: Array<[number, number]> = [
  [0, 0.42],
  [0.08, 0.6],
  [0.22, 0.8],
  [0.38, 0.87],
  [0.54, 0.78],
  [0.7, 0.58],
  [0.86, 0.44],
  [1, 0.5],
];

function vaseRadius(t: number) {
  const clamped = THREE.MathUtils.clamp(t, 0, 1);
  for (let i = 1; i < VASE_PROFILE.length; i += 1) {
    const prev = VASE_PROFILE[i - 1]!;
    const next = VASE_PROFILE[i]!;
    if (clamped <= next[0]) {
      const span = next[0] - prev[0] || 1;
      return THREE.MathUtils.lerp(prev[1], next[1], (clamped - prev[0]) / span);
    }
  }
  return VASE_PROFILE[VASE_PROFILE.length - 1]![1];
}

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
};

function usePrinterModel(palette: Palette): PrinterModel {
  const { scene } = useGLTF(MODEL_URL, false);

  return useMemo<PrinterModel>(() => {
    const root = scene;
    const materials = new Set<THREE.MeshStandardMaterial>();

    root.traverse((object) => {
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

    return {
      root,
      scale,
      offset,
      anchor,
      materials: Array.from(materials),
      gantry: root.getObjectByName("Gantry") ?? null,
      extruder: root.getObjectByName("Extruder_Assembly") ?? null,
      bed: root.getObjectByName("Bed") ?? null,
    };
  }, [palette, scene]);
}

function Printer({
  model,
  palette,
  phaseValue,
  reducedMotion,
}: {
  model: PrinterModel;
  palette: Palette;
  phaseValue: MutableRefObject<number>;
  reducedMotion: boolean;
}) {
  const opacityRef = useRef(1);
  const paperColor = useMemo(() => new THREE.Color(palette.paper), [palette.paper]);
  const rest = useMemo(
    () => ({
      gantryZ: model.gantry?.position.z ?? 0,
      extruderX: model.extruder?.position.x ?? 0,
      bedY: model.bed?.position.y ?? 0,
    }),
    [model],
  );

  useFrame(({ clock }, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const value = phaseValue.current;
    const time = reducedMotion ? 0 : clock.elapsedTime;

    const focus = value < 0.7 || value > 2.4 ? 1 : 0.22;
    opacityRef.current = damp(opacityRef.current, focus, 4.5, delta);
    const opacity = opacityRef.current;
    model.materials.forEach((material) => {
      const base = material.userData["baseColor"] as THREE.Color | undefined;
      material.transparent = opacity < 0.985;
      material.opacity = 0.5 + opacity * 0.5;
      if (base) material.color.copy(base).lerp(paperColor, (1 - opacity) * 0.72);
    });

    const tune = value < 0.8;
    const printProgress = THREE.MathUtils.clamp(value - 2.5, 0, 1);
    const printing = printProgress > 0.02;

    if (model.extruder) {
      const target = tune
        ? Math.sin(time * 1.35) * 3.6
        : printing
          ? Math.sin(time * 2.4) * 2.6
          : 0;
      model.extruder.position.x = damp(model.extruder.position.x, rest.extruderX + target, 6, delta);
    }
    if (model.bed) {
      const target = tune
        ? Math.cos(time * 1.05) * 3.2
        : printing
          ? Math.cos(time * 1.85) * 2.1
          : 0;
      model.bed.position.y = damp(model.bed.position.y, rest.bedY + target, 6, delta);
    }
    if (model.gantry) {
      const target = tune
        ? -9.5 + Math.sin(time * 0.9) * 1.6
        : printing
          ? -11 + printProgress * 9.5
          : -1.5;
      model.gantry.position.z = damp(model.gantry.position.z, rest.gantryZ + target, 3.5, delta);
    }
  });

  return (
    <group position={PRINTER_OFFSET.toArray()} scale={model.scale}>
      <primitive object={model.root} position={model.offset.toArray()} />
    </group>
  );
}

function CalibrationPoints({ palette, phaseValue, anchor }: { palette: Palette; phaseValue: MutableRefObject<number>; anchor: THREE.Vector3 }) {
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
      {([
        [-0.82, -0.82],
        [0.82, -0.82],
        [-0.82, 0.82],
        [0.82, 0.82],
      ] as Array<[number, number]>).map(([x, z], index) => (
        <mesh key={index} position={[anchor.x + x, anchor.y + 0.04, anchor.z + z]} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[0.1, 0.17, 20]} />
          <meshBasicMaterial color={palette.tech} transparent opacity={0} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

function Vase({ palette, phaseValue, anchor }: { palette: Palette; phaseValue: MutableRefObject<number>; anchor: THREE.Vector3 }) {
  const designRef = useRef<THREE.Group>(null);
  const designMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
  const layerRefs = useRef<Array<THREE.Mesh | null>>([]);
  const points = useMemo(
    () =>
      Array.from({ length: 30 }, (_, index) => {
        const y = index / 29;
        return new THREE.Vector2(vaseRadius(y), y * 2.55);
      }),
    [],
  );
  const showcase = useMemo(() => new THREE.Vector3(anchor.x + 3.6, 1.55, anchor.z + 0.4), [anchor]);

  useFrame(({ clock }, rawDelta) => {
    const design = designRef.current;
    if (!design) return;
    const delta = Math.min(rawDelta, 0.05);
    const value = phaseValue.current;
    const designFocus = Math.max(0, 1 - Math.abs(value - 1) * 1.15);
    const fileFocus = Math.max(0, 1 - Math.abs(value - 2) * 1.05);
    const printFocus = THREE.MathUtils.clamp(value - 2.5, 0, 1);
    const onBed = value > 2.5;

    const targetX = onBed ? anchor.x : showcase.x - (value < 1.55 ? 0 : 0.7);
    const targetY = onBed ? anchor.y : showcase.y;
    const targetZ = onBed ? anchor.z : showcase.z;
    design.position.x = damp(design.position.x, targetX, 4.5, delta);
    design.position.y = damp(design.position.y, targetY, 4.5, delta);
    design.position.z = damp(design.position.z, targetZ, 4.5, delta);
    design.rotation.y += delta * (0.18 + designFocus * 0.45);
    design.scale.setScalar(damp(design.scale.x, onBed ? 0.6 : 0.72 + designFocus * 0.16, 4.5, delta));

    if (designMaterialRef.current) {
      const targetOpacity = value < 0.55 ? 0 : value < 1.55 ? 0.3 + designFocus * 0.6 : Math.max(0, 0.4 - printFocus);
      designMaterialRef.current.opacity = damp(designMaterialRef.current.opacity, targetOpacity, 7, delta);
    }

    layerRefs.current.forEach((layer, index) => {
      if (!layer) return;
      const threshold = index / LAYER_COUNT;
      const digital = value >= 1.55 && value < 2.5 ? 0.35 + fileFocus * 0.55 : 0;
      const printed = printFocus > threshold ? 1 : 0;
      const targetOpacity = Math.min(1, Math.max(digital, printed));
      const material = layer.material;
      if (material instanceof THREE.MeshStandardMaterial) {
        material.opacity = damp(material.opacity, targetOpacity, 8, delta);
      }
      layer.position.y =
        index * 0.078 + (value >= 1.55 && value < 2.5 ? Math.sin(clock.elapsedTime * 1.6 + index * 0.45) * 0.03 : 0);
    });
  });

  return (
    <group ref={designRef} position={showcase.toArray()}>
      <mesh castShadow>
        <latheGeometry args={[points, 48]} />
        <meshStandardMaterial ref={designMaterialRef} color={palette.coral} wireframe transparent opacity={0} roughness={0.46} />
      </mesh>
      {Array.from({ length: LAYER_COUNT }, (_, index) => {
        const y = index / (LAYER_COUNT - 1);
        const radius = vaseRadius(y);
        return (
          <mesh
            key={index}
            ref={(node) => {
              layerRefs.current[index] = node;
            }}
            position={[0, index * 0.078, 0]}
            rotation-x={Math.PI / 2}
            castShadow
          >
            <torusGeometry args={[radius, 0.045, 6, 44]} />
            <meshStandardMaterial color={index % 5 === 0 ? palette.tech : palette.coral} transparent opacity={0} roughness={0.55} />
          </mesh>
        );
      })}
    </group>
  );
}

function FileTransfer({ palette, phaseValue, anchor }: { palette: Palette; phaseValue: MutableRefObject<number>; anchor: THREE.Vector3 }) {
  const groupRef = useRef<THREE.Group>(null);
  const packetRefs = useRef<Array<THREE.Mesh | null>>([]);
  const home = useMemo(() => new THREE.Vector3(anchor.x + 3.9, 3.5, anchor.z + 0.6), [anchor]);

  useFrame(({ clock }, rawDelta) => {
    const group = groupRef.current;
    if (!group) return;
    const delta = Math.min(rawDelta, 0.05);
    const value = phaseValue.current;
    const focus = Math.max(0, 1 - Math.abs(value - 2) * 1.25);
    const transfer = THREE.MathUtils.clamp(1 - Math.abs(value - 2.5) * 1.6, 0, 1);
    group.scale.setScalar(damp(group.scale.x, 0.62 + focus * 0.3, 6, delta));
    group.position.y = damp(group.position.y, home.y + focus * 0.18, 6, delta);
    group.traverse((object) => {
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
          <meshBasicMaterial color={index === 3 ? palette.tech : palette.ink} transparent opacity={0} />
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
        <Lightformer intensity={0.5} color={palette.tech} position={[-7, 2, 1]} rotation-y={Math.PI / 2} scale={[9, 4, 1]} />
        <Lightformer intensity={0.7} color={palette.coral} position={[6, 3, 2]} rotation-y={-Math.PI / 3} scale={[7, 4, 1]} />
      </Environment>
      <Printer model={model} palette={palette} phaseValue={phaseValue} reducedMotion={reducedMotion} />
      <CalibrationPoints palette={palette} phaseValue={phaseValue} anchor={model.anchor} />
      <Vase palette={palette} phaseValue={phaseValue} anchor={model.anchor} />
      <FileTransfer palette={palette} phaseValue={phaseValue} anchor={model.anchor} />
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.2, 0]} receiveShadow>
        <planeGeometry args={[18, 14, 18, 14]} />
        <meshStandardMaterial color={palette.surface} wireframe roughness={0.9} />
      </mesh>
    </>
  );
}
