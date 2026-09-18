import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { createEdgeGeometry, createVaseGeometry } from "./vase-geometry";

/**
 * The piece inside a service frame.
 *
 * Both services show the same vase the process section builds — finished for
 * "Fabricación bajo demanda", still a cage for "Diseño a medida". Using one
 * object in two states says more about the difference between the services
 * than two unrelated photographs would, and it costs no image assets.
 */

export type ServiceVariant = "print" | "design";

const fallbackPalette = { coral: "rgb(249, 36, 36)", tech: "rgb(209, 192, 165)" };

function Piece({ variant, palette }: { variant: ServiceVariant; palette: typeof fallbackPalette }) {
  const groupRef = useRef<THREE.Group>(null);
  const build = useMemo(() => createVaseGeometry({ heightSegments: 64, radialSegments: 48 }), []);
  const ringGeometry = useMemo(() => createEdgeGeometry(build.positions, build.ringEdges), [build]);
  const columnGeometry = useMemo(
    () => createEdgeGeometry(build.positions, build.columnEdges),
    [build],
  );

  useFrame((_, delta) => {
    if (groupRef.current) groupRef.current.rotation.y += Math.min(delta, 0.05) * 0.42;
  });

  return (
    <group ref={groupRef} position={[0, -1.35, 0]}>
      {variant === "print" ? (
        <mesh geometry={build.geometry} castShadow>
          <meshStandardMaterial
            color={palette.coral}
            roughness={0.58}
            metalness={0.05}
            side={THREE.DoubleSide}
          />
        </mesh>
      ) : (
        <>
          <lineSegments geometry={ringGeometry}>
            <lineBasicMaterial color={palette.coral} transparent opacity={0.9} />
          </lineSegments>
          <lineSegments geometry={columnGeometry}>
            <lineBasicMaterial color={palette.tech} transparent opacity={0.55} />
          </lineSegments>
        </>
      )}
    </group>
  );
}

export default function ServiceObject({ variant }: { variant: ServiceVariant }) {
  const [palette, setPalette] = useState(fallbackPalette);

  useEffect(() => {
    const styles = getComputedStyle(document.documentElement);
    setPalette({
      coral: styles.getPropertyValue("--webgl-red").trim() || fallbackPalette.coral,
      tech: styles.getPropertyValue("--webgl-peach").trim() || fallbackPalette.tech,
    });
  }, []);

  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{ position: [0, 0.4, 5.2], fov: 32 }}
      gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
    >
      <ambientLight intensity={1.1} />
      <directionalLight position={[3, 5, 4]} intensity={2.4} />
      <directionalLight position={[-4, 1, -3]} intensity={0.6} color={palette.tech} />
      <Piece variant={variant} palette={palette} />
    </Canvas>
  );
}
