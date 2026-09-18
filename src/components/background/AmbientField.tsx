import { useEffect, useRef } from "react";
import * as THREE from "three";
import { subscribeScroll } from "@/lib/scroll";
import { ambientFragmentShader, ambientVertexShader } from "./ambient-shaders";
import { CUBE_COUNT, CubeField } from "./CubeField";
import { cubeEdgeFormation, fitVoxelWord, heroFormation, type Formation } from "./cube-formations";

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
/**
 * Drawing-buffer size relative to CSS pixels.
 *
 * Full resolution: the shader alone would happily run at half and nobody would
 * see it, but the cube field shares this canvas and soft-edged cubes look like
 * a mistake. The health check below is what protects weak hardware instead.
 */
const RESOLUTION_SCALE = 1;
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

/**
 * Palette for the cubes, read with the NORMAL conversion.
 *
 * The opposite of `readTones`: the cubes are lit geometry going through the
 * standard pipeline, so their colours do need converting into the linear
 * working space. Reusing the shader's unconverted values would wash them out.
 */
function readCubePalette() {
  const styles = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) =>
    new THREE.Color(styles.getPropertyValue(name).trim() || fallback);
  return {
    paper: read("--webgl-paper", "rgb(239, 238, 232)"),
    peach: read("--webgl-peach", "rgb(209, 192, 165)"),
    red: read("--webgl-red", "rgb(249, 36, 36)"),
    ink: read("--webgl-ink", "rgb(60, 0, 22)"),
    green: read("--webgl-voxel-green", "rgb(61, 255, 110)"),
  };
}

type CubePalette = ReturnType<typeof readCubePalette>;

/**
 * Keeps a shape of half-extent `halfSpan` fully inside a frame `halfWidth` wide.
 *
 * Formations are placed off to one side on a wide screen, where there is room
 * beside the copy. On a narrow one there is no such room, so the intended
 * offset is pulled back to whatever still fits — otherwise the shape sits
 * outside the frustum and the section looks like it has no cubes at all.
 */
function withinFrame(offset: number, halfSpan: number, halfWidth: number) {
  const limit = Math.max(0, halfWidth - halfSpan);
  return THREE.MathUtils.clamp(offset, -limit, limit);
}

/** No cubes at all — the field parks every one of them out of sight. */
const emptyFormation: Formation = {
  points: [],
  cell: 0.1,
  presence: 0,
  drift: 0,
  spin: 0,
  jitter: 0,
};

/** Half the horizontal extent of a set of points. */
function halfSpanOf(points: { x: number }[]) {
  return points.reduce((widest, point) => Math.max(widest, Math.abs(point.x)), 0);
}

/** Which shape the cubes hold, based on the section under the viewport centre. */
function formationFor(
  section: HTMLElement | null,
  palette: CubePalette,
  halfWidth: number,
): { key: string; formation: Formation } {
  const id = section?.id ?? "inicio";

  if (id === "proceso") {
    // PrintProcess writes the word for the active phase onto the section.
    const word = section?.dataset["cubeWord"] ?? "Proceso";
    const stacked = word.includes("\n");

    // On a narrow frame the section is a single column of copy with the visual
    // stuck to the top of it, and there is nowhere left for a word this size to
    // sit that is not directly behind running text. It is dropped rather than
    // shrunk: a voxel word small enough to fit between the paragraphs stops
    // being legible as one.
    if (halfWidth < 2.2) {
      return { key: "proceso:none", formation: emptyFormation };
    }

    // One flat layer of solid green: the phase words are meant to read as
    // retro screen pixels, so every cell is the same colour and depth.
    //
    // Presence stays at 1 here. It is applied as instance scale, and anything
    // below 1 pulls the cubes back off each other — the lattice stops touching
    // and the word falls apart into confetti. A voxel word has to be full size;
    // it is kept out of the way by where it sits, not by how big it is.
    const fitted = fitVoxelWord(word, CUBE_COUNT, {
      // Narrow enough that even the longest word stays inside the visual
      // column and never runs under the phase copy on the right — and never
      // wider than the frame itself, which is what decides it on a phone.
      width: Math.min(5.6, halfWidth * 1.8),
      height: stacked ? 2.2 : 1.7,
      centerColor: palette.green,
      borderColor: palette.green,
      centerDepth: 1,
      borderDepth: 1,
    });
    return {
      key: `proceso:${word}`,
      formation: {
        points: fitted.points,
        cell: fitted.cell,
        presence: 1,
        drift: 0,
        spin: 0,
        jitter: 0,
        // Never under the phase copy on the right. A single line lies along the
        // foot of the visual, where only the printer's base crosses it; a
        // stacked word is nearly square, so it goes out to the left margin
        // instead, where the machine leaves the most room.
        offset: new THREE.Vector3(
          withinFrame(stacked ? -3.2 : -1.35, halfSpanOf(fitted.points), halfWidth),
          stacked ? -0.15 : -1.6,
          -2.6,
        ),
      },
    };
  }

  if (id === "servicios") {
    // The twelve edges of a cube, turning on its own diagonal.
    //
    // Kept close to the section's own charcoal rather than paper white: the
    // field is fixed while the services scroll past it, so this shape passes
    // behind the headings as well as behind the frames, and a bright outline
    // there would eat the type. Only the corners carry real colour, which is
    // enough to follow the rotation.
    return {
      key: "servicios",
      formation: cubeEdgeFormation({
        size: 1.9,
        perEdge: 6,
        color: palette.ink.clone().lerp(palette.peach, 0.5),
        accent: palette.ink.clone().lerp(palette.red, 0.7),
        presence: 0.7,
        // 1.65 is the cube's half-diagonal, which is how far it reaches when
        // it turns onto a vertex.
        offset: new THREE.Vector3(withinFrame(2.95, 1.65, halfWidth), 0.35, -1.6),
      }),
    };
  }

  if (id === "contacto") {
    // Relief: the face of the word stands a cube proud of its own outline, so
    // the white border reads as a bevel around the dark charcoal centre.
    const fitted = fitVoxelWord("STRATA", CUBE_COUNT, {
      width: Math.min(5, halfWidth * 1.8),
      height: 1.05,
      centerColor: palette.ink,
      borderColor: palette.paper,
      centerDepth: 2,
      borderDepth: 1,
    });
    return {
      key: "contacto",
      formation: {
        points: fitted.points,
        cell: fitted.cell,
        presence: 1,
        drift: 0,
        spin: 0,
        jitter: 0,
        // The empty band between the closing paragraph and the footer rule,
        // pushed right of the two lines of small type that live in that corner.
        offset: new THREE.Vector3(withinFrame(-0.54, halfSpanOf(fitted.points), halfWidth), -2, 0),
      },
    };
  }

  return { key: "hero", formation: heroFormation(palette) };
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

    const coarse = window.matchMedia("(pointer: coarse)").matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, coarse ? 1 : 1.5) * RESOLUTION_SCALE);
    host.appendChild(canvas);
    document.documentElement.classList.add("webgl-bg");

    const tones = readTones();
    const fallbackTone = tones["paper"]!;
    const cubePalette = readCubePalette();
    const cubes = new CubeField(heroFormation(cubePalette));
    // Two passes share the canvas, so clearing has to be explicit.
    renderer.autoClear = false;

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
      cubes.resize(window.innerWidth, window.innerHeight);
      // gl_FragCoord is in drawing-buffer pixels, not CSS pixels. On a 2x
      // display those differ by the pixel ratio, and feeding the CSS size in
      // would push the band edges off-screen.
      const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
      uniforms.uResolution.value.copy(buffer);
    };
    resize();

    // The page's sections are fixed for the life of the field, so the list is
    // read once and shared by the two things that walk it every frame.
    const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-tone]"));

    /**
     * Rebuilds the band list from the sections currently crossing the viewport.
     * Edges are normalised 0..1 from the top of the viewport, matching the
     * shader's screen-space coordinate.
     */
    const syncBands = () => {
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
    let scrollVelocity = 0;

    /**
     * Picks the formation for whatever section is under the middle of the
     * viewport, every frame.
     *
     * It has to be every frame rather than on scroll alone: the active phase
     * is React state, so the word it writes onto the section lands after the
     * scroll that caused it. Driven by scroll events only, coming to rest on a
     * phase boundary leaves the previous phase's word standing.
     *
     * Building a formation rasterises a word, which is far too much work to
     * repeat sixty times a second, so the identity of the shape is checked
     * first and the formation is only built when it actually changes.
     */
    let formationKey = "";
    const syncFormation = () => {
      const middle = window.innerHeight / 2;
      const section =
        sections.find((node) => {
          const rect = node.getBoundingClientRect();
          return rect.top <= middle && rect.bottom >= middle;
        }) ?? null;

      // The frame width is part of the identity: a resize changes how much room
      // a shape has, and with it the shape itself.
      const halfWidth = cubes.halfWidth;
      const key = `${section?.id ?? "inicio"}:${section?.dataset["cubeWord"] ?? ""}:${halfWidth.toFixed(1)}`;
      if (key !== formationKey) {
        formationKey = key;
        cubes.setFormation(key, formationFor(section, cubePalette, halfWidth).formation);
      }
      cubes.setInteractivity(section?.id === "contacto" ? 1 : 0);
    };

    const unsubscribe = subscribeScroll((snapshot) => {
      if (!running) return; // The field gave up; stop measuring sections for it.
      uniforms.uScroll.value = snapshot.progress;
      uniforms.uVelocity.value = THREE.MathUtils.clamp(snapshot.velocity / 90, -1, 1);
      scrollVelocity = THREE.MathUtils.clamp(snapshot.velocity / 60, -1.5, 1.5);
      syncBands();
    });

    const render = (now: number) => {
      frame = requestAnimationFrame(render);
      const rawDelta = now - last;
      last = now;
      if (!running) return;

      const delta = Math.min(rawDelta / 1000, 0.05);
      elapsed += delta;
      uniforms.uTime.value = elapsed;
      syncFormation();

      cubes.update(delta, scrollVelocity);
      renderer.clear();
      renderer.render(scene, camera);
      // The quad writes no depth, so the cubes need a clean depth buffer to
      // sort against each other rather than against the background.
      renderer.clearDepth();
      renderer.render(cubes.scene, cubes.camera);

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

    const onPointerMove = (event: PointerEvent) => {
      cubes.setPointer(
        (event.clientX / window.innerWidth) * 2 - 1,
        -((event.clientY / window.innerHeight) * 2 - 1),
      );
    };

    const onVisibility = () => {
      running = !document.hidden;
      last = performance.now();
    };
    const onResize = () => {
      resize();
      syncBands();
      syncFormation();
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
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("resize", onResize);
    canvas.addEventListener("webglcontextlost", onContextLost);

    return () => {
      cancelAnimationFrame(frame);
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("resize", onResize);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      document.documentElement.classList.remove("webgl-bg");
      quad.geometry.dispose();
      (quad.material as THREE.ShaderMaterial).dispose();
      cubes.dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, []);

  return <div ref={hostRef} className="ambient-field" aria-hidden="true" />;
}
