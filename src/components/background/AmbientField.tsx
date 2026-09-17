import { useEffect, useRef } from "react";
import * as THREE from "three";
import { subscribeScroll } from "@/lib/scroll";
import { ambientFragmentShader, ambientVertexShader } from "./ambient-shaders";

/**
 * Site-wide ambient background.
 *
 * One fixed fullscreen quad running a domain-warped noise field, drifting on
 * its own clock and displaced by scroll. It is the page's actual background:
 * once WebGL is live we mark `<html class="webgl-bg">` and the sections drop
 * their own background colours, so the field runs behind every section and the
 * type sits directly on it.
 *
 * Section colours are not lost in the process — each `[data-tone]` section
 * hands its palette to the shader as a band. Bands are split on the exact same
 * pixel row as the section edge, so the background changes tone precisely where
 * the text colour changes and contrast is never in-between.
 *
 * Without WebGL (or under reduced motion) nothing is mounted, the class is
 * never set, and the CSS section colours stand on their own.
 */

const MAX_BANDS = 4;
/** Drawing-buffer size relative to CSS pixels. See the setPixelRatio call. */
const RESOLUTION_SCALE = 0.5;
/** Frames slower than this (10 fps) count against the field's health budget. */
const SLOW_FRAME_MS = 100;
/** Net slow frames tolerated before the field gives up for good. */
const SLOW_FRAME_BUDGET = 40;
/** Frames ignored at startup, while shaders compile and the page settles. */
const WARMUP_FRAMES = 15;

/**
 * A tone is a base colour plus a *neighbouring* darker shade and one accent.
 *
 * The shade has to be a close neighbour of the base, not a shared ink: mixing a
 * dark section toward a bright accent lifts the whole band off its own colour,
 * and the charcoal turns maroon. Shading within the tone keeps every band
 * anchored on the exact CSS colour it replaces.
 */
type Tone = {
  base: THREE.Color;
  shade: THREE.Color;
  glow: THREE.Color;
};

function readTones(): Record<string, Tone> {
  const styles = getComputedStyle(document.documentElement);
  /**
   * Reads a palette variable WITHOUT colour conversion.
   *
   * The field replaces the sections' CSS background colours, so it has to
   * blend the way CSS does and land on exactly those values. Passing
   * LinearSRGBColorSpace tells three to take the sRGB numbers as-is instead of
   * converting them into its linear working space; the shader then writes them
   * straight out, with no encoding step. Converting both ways instead looks
   * plausible but blows out the accent in the dark tones, because a few percent
   * of red mixed into a near-black linear value becomes very visible once it is
   * encoded back to sRGB.
   */
  const read = (name: string, fallback: string) =>
    new THREE.Color().setStyle(
      styles.getPropertyValue(name).trim() || fallback,
      THREE.LinearSRGBColorSpace,
    );

  const paper = read("--webgl-paper", "rgb(239, 238, 232)");
  const charcoal = read("--webgl-ink", "rgb(60, 0, 22)");
  const red = read("--webgl-red", "rgb(249, 36, 36)");
  const peach = read("--webgl-peach", "rgb(209, 192, 165)");
  const surface = read("--webgl-surface", "rgb(229, 226, 216)");
  const paperShade = read("--webgl-paper-shade", "rgb(222, 216, 198)");
  const charcoalShade = read("--webgl-ink-shade", "rgb(42, 0, 16)");
  const redShade = read("--webgl-red-shade", "rgb(178, 18, 26)");

  return {
    paper: { base: paper, shade: paperShade, glow: peach },
    surface: { base: surface, shade: paperShade, glow: peach },
    charcoal: { base: charcoal, shade: charcoalShade, glow: red },
    red: { base: red, shade: redShade, glow: peach },
  };
}

export function AmbientField() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const canvas = document.createElement("canvas");
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        alpha: false,
        powerPreference: "low-power",
        // The field is the page background; nothing reads it back.
        preserveDrawingBuffer: false,
      });
    } catch {
      return; // No WebGL — CSS section colours remain in charge.
    }

    // The field is soft by design, so it is rendered well below display
    // resolution and stretched by CSS. Nothing in it has an edge sharp enough
    // to give that away, and it cuts the per-pixel noise cost by ~4x.
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, coarse ? 1 : 1.5) * RESOLUTION_SCALE);
    host.appendChild(canvas);
    document.documentElement.classList.add("webgl-bg");

    const tones = readTones();
    const fallbackTone = tones["paper"]!;

    const uniforms = {
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uScroll: { value: 0 },
      uVelocity: { value: 0 },
      uIntensity: { value: 1 },
      uBandCount: { value: 1 },
      uBandEdge: { value: Array.from({ length: MAX_BANDS }, () => 0) },
      uBandBase: { value: Array.from({ length: MAX_BANDS }, () => new THREE.Color()) },
      uBandShade: { value: Array.from({ length: MAX_BANDS }, () => new THREE.Color()) },
      uBandGlow: { value: Array.from({ length: MAX_BANDS }, () => new THREE.Color()) },
    };

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        vertexShader: ambientVertexShader,
        fragmentShader: ambientFragmentShader,
        uniforms,
        depthTest: false,
        depthWrite: false,
      }),
    );
    scene.add(quad);

    const resize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight, false);
      // gl_FragCoord is in drawing-buffer pixels, not CSS pixels. On a 2x
      // display those differ by the pixel ratio, and feeding the CSS size in
      // would push the band edges off-screen.
      const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
      uniforms.uResolution.value.copy(buffer);
    };
    resize();

    /**
     * Rebuilds the band list from the sections currently crossing the viewport.
     * Edges are normalised 0..1 from the top of the viewport, matching the
     * shader's screen-space coordinate.
     */
    const syncBands = () => {
      const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-tone]"));
      const height = window.innerHeight;
      let count = 0;

      for (const section of sections) {
        if (count >= MAX_BANDS) break;
        const rect = section.getBoundingClientRect();
        if (rect.bottom <= 0 || rect.top >= height) continue;
        const tone = tones[section.dataset["tone"] ?? "paper"] ?? fallbackTone;
        uniforms.uBandEdge.value[count] = count === 0 ? -1 : rect.top / height;
        uniforms.uBandBase.value[count]!.copy(tone.base);
        uniforms.uBandShade.value[count]!.copy(tone.shade);
        uniforms.uBandGlow.value[count]!.copy(tone.glow);
        count += 1;
      }

      if (count === 0) {
        uniforms.uBandEdge.value[0] = -1;
        uniforms.uBandBase.value[0]!.copy(fallbackTone.base);
        uniforms.uBandShade.value[0]!.copy(fallbackTone.shade);
        uniforms.uBandGlow.value[0]!.copy(fallbackTone.glow);
        count = 1;
      }
      uniforms.uBandCount.value = count;
    };

    let frame = 0;
    let running = true;
    let renderedFrames = 0;
    let slowFrames = 0;
    // Own clock rather than THREE.Clock (deprecated in r186), and it must not
    // accumulate while the tab is hidden or the field jumps on return.
    let elapsed = 0;
    let last = performance.now();

    const unsubscribe = subscribeScroll((snapshot) => {
      if (!running) return; // The field gave up; stop measuring sections for it.
      uniforms.uScroll.value = snapshot.progress;
      uniforms.uVelocity.value = THREE.MathUtils.clamp(snapshot.velocity / 90, -1, 1);
      syncBands();
    });

    const render = (now: number) => {
      frame = requestAnimationFrame(render);
      const rawDelta = now - last;
      last = now;
      if (!running) return;

      elapsed += Math.min(rawDelta / 1000, 0.05);
      uniforms.uTime.value = elapsed;
      renderer.render(scene, camera);

      // A field that cannot keep up is worse than no field at all: the canvas
      // holds a stale frame, and a section whose text is light ends up on a
      // light band. Rather than risk that, give up and hand the page back to
      // the CSS section colours, which are always correct.
      renderedFrames += 1;
      if (renderedFrames <= WARMUP_FRAMES) return;
      slowFrames = rawDelta > SLOW_FRAME_MS ? slowFrames + 1 : Math.max(0, slowFrames - 1);
      if (slowFrames > SLOW_FRAME_BUDGET) disable();
    };
    frame = requestAnimationFrame(render);

    const onVisibility = () => {
      running = !document.hidden;
      last = performance.now();
    };
    const onResize = () => {
      resize();
      syncBands();
    };
    /** Stops the field and restores the CSS section colours. */
    const disable = () => {
      running = false;
      cancelAnimationFrame(frame);
      frame = 0;
      document.documentElement.classList.remove("webgl-bg");
      canvas.remove();
    };

    const onContextLost = (event: Event) => {
      event.preventDefault();
      disable();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("resize", onResize);
    canvas.addEventListener("webglcontextlost", onContextLost);

    return () => {
      cancelAnimationFrame(frame);
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      document.documentElement.classList.remove("webgl-bg");
      quad.geometry.dispose();
      (quad.material as THREE.ShaderMaterial).dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, []);

  return <div ref={hostRef} className="ambient-field" aria-hidden="true" />;
}
