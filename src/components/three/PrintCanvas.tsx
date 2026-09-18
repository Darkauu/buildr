import { Canvas } from "@react-three/fiber";
import { useEffect, useState } from "react";
import { PrintScene } from "./PrintScene";

type PrintCanvasProps = {
  phase: number;
  isVisible: boolean;
  reducedMotion: boolean;
};

const fallbackPalette = {
  ink: "rgb(23, 23, 23)",
  paper: "rgb(244, 241, 232)",
  coral: "rgb(255, 90, 54)",
  tech: "rgb(57, 217, 138)",
  surface: "rgb(232, 228, 216)",
};

export default function PrintCanvas({ phase, isVisible, reducedMotion }: PrintCanvasProps) {
  const [palette, setPalette] = useState(fallbackPalette);

  useEffect(() => {
    const styles = getComputedStyle(document.documentElement);
    setPalette({
      ink: styles.getPropertyValue("--webgl-ink").trim() || fallbackPalette.ink,
      paper: styles.getPropertyValue("--webgl-paper").trim() || fallbackPalette.paper,
      coral: styles.getPropertyValue("--webgl-coral").trim() || fallbackPalette.coral,
      tech: styles.getPropertyValue("--webgl-tech").trim() || fallbackPalette.tech,
      surface: styles.getPropertyValue("--webgl-surface").trim() || fallbackPalette.surface,
    });
  }, []);

  return (
    <Canvas
      dpr={[1, 1.5]}
      frameloop={isVisible && !reducedMotion ? "always" : "demand"}
      camera={{ position: [8.6, 5.4, 10.8], fov: 34, near: 0.1, far: 80 }}
      shadows
      gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
      onCreated={({ camera, gl }) => {
        camera.lookAt(0, 2.7, 0);
        // The printed vase is revealed by a clipping plane on its material.
        gl.localClippingEnabled = true;
      }}
    >
      <PrintScene phase={phase} palette={palette} reducedMotion={reducedMotion} />
    </Canvas>
  );
}
