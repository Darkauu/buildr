import { animate, stagger } from "animejs";
import { useEffect, useRef, useState } from "react";
import { startBoot, subscribeBoot } from "@/lib/boot";
import { markIntroDone } from "@/lib/intro";

/**
 * Splash screen.
 *
 * Gated on real load progress from `lib/boot` — fonts, the hero photograph and
 * the printer model — so the counter means something and the hero entrance
 * never fires against unstyled text or a half-loaded model.
 *
 * The exit is the site's thesis in one gesture: the panel leaves as a stack of
 * layers peeling off the build plate, bottom to top.
 *
 * Shown once per session. Reduced motion skips it entirely; so does a second
 * navigation within the session.
 */

const SESSION_KEY = "strata:splash-shown";
const MIN_VISIBLE_MS = 900;
const PEEL_LAYERS = 14;

type SplashProps = {
  modelUrl: string;
  imageUrl: string;
};

export function Splash({ modelUrl, imageUrl }: SplashProps) {
  // Rendered during SSR so the very first paint is the splash rather than a
  // hero whose text is still at opacity 0. Repeat visits and reduced-motion
  // never see it: an inline script in the document head sets
  // data-splash="skip" before paint, and CSS hides it on the first frame.
  const [visible, setVisible] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const counterRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let seen = false;
    try {
      seen = sessionStorage.getItem(SESSION_KEY) === "1";
    } catch {
      seen = false; // Private mode: treat as a first visit rather than failing.
    }

    if (reduced || seen) {
      setVisible(false);
      markIntroDone();
      return;
    }

    startBoot({ modelUrl, imageUrl });
  }, [imageUrl, modelUrl]);

  useEffect(() => {
    if (!visible) return;
    // The skip effect above unmounts on its own, but it does so a render later.
    // Without this guard the panel would briefly lock scrolling and animate
    // elements that are already display:none.
    if (document.documentElement.dataset["splash"] === "skip") return;

    const root = rootRef.current;
    if (!root) return;

    const shownAt = performance.now();
    // The counter chases real progress instead of snapping to it, so a model
    // that arrives in two big chunks still reads as a continuous climb.
    let displayed = 0;
    let actual = 0;
    let ready = false;
    let frame = 0;
    let exiting = false;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    animate(root.querySelectorAll("[data-splash-letter]"), {
      opacity: [0, 1],
      translateY: ["0.6em", "0em"],
      delay: stagger(55),
      duration: 700,
      ease: "out(3)",
    });
    animate(root.querySelectorAll("[data-splash-meta]"), {
      opacity: [0, 1],
      duration: 600,
      delay: 260,
      ease: "out(2)",
    });

    const exit = () => {
      if (exiting) return;
      exiting = true;
      try {
        sessionStorage.setItem(SESSION_KEY, "1");
      } catch {
        // Nothing to do — the splash simply shows again next navigation.
      }

      animate(root.querySelectorAll("[data-splash-fade]"), {
        opacity: 0,
        translateY: -18,
        duration: 420,
        ease: "in(2)",
      });
      animate(root.querySelectorAll("[data-splash-peel]"), {
        scaleY: [1, 0],
        delay: stagger(42, { from: "last" }),
        duration: 620,
        ease: "inOut(3)",
        onComplete: () => {
          document.body.style.overflow = previousOverflow;
          markIntroDone();
          setVisible(false);
        },
      });
    };

    const tick = () => {
      frame = requestAnimationFrame(tick);
      displayed += (actual - displayed) * 0.12;
      if (ready && actual - displayed < 0.005) displayed = actual;

      const percent = Math.round(displayed * 100);
      if (counterRef.current) counterRef.current.textContent = String(percent).padStart(3, "0");
      if (barRef.current) barRef.current.style.transform = `scaleX(${displayed.toFixed(4)})`;

      if (ready && percent >= 100 && performance.now() - shownAt >= MIN_VISIBLE_MS) {
        cancelAnimationFrame(frame);
        frame = 0;
        exit();
      }
    };
    frame = requestAnimationFrame(tick);

    const unsubscribe = subscribeBoot((state) => {
      actual = state.progress;
      ready = state.ready;
    });

    return () => {
      unsubscribe();
      if (frame) cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      // A teardown before the exit ran (navigation, hot reload) must not leave
      // the rest of the page waiting on a signal that is no longer coming.
      markIntroDone();
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      ref={rootRef}
      className="splash"
      role="status"
      aria-live="polite"
      aria-label="Cargando STRATA"
    >
      <div className="splash-peel" aria-hidden="true">
        {Array.from({ length: PEEL_LAYERS }, (_, index) => (
          <span key={index} data-splash-peel />
        ))}
      </div>

      <div className="splash-inner">
        <p className="splash-wordmark" aria-hidden="true">
          {"STRATA".split("").map((letter, index) => (
            <span key={index} data-splash-letter>
              {letter}
            </span>
          ))}
        </p>
        <p data-splash-meta data-splash-fade className="splash-tagline">
          Taller de fabricación digital
        </p>
      </div>

      <div data-splash-fade className="splash-progress">
        <div className="splash-progress-row">
          <span data-splash-meta>Preparando taller</span>
          <span>
            <span ref={counterRef}>000</span>
            <span aria-hidden="true">%</span>
          </span>
        </div>
        <span className="splash-bar" aria-hidden="true">
          <span ref={barRef} />
        </span>
      </div>
    </div>
  );
}
