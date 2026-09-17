import { animate } from "animejs";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { phases } from "./print-phases";

const PrintCanvas = lazy(() => import("./three/PrintCanvas"));

export function PrintProcess() {
  const sectionRef = useRef<HTMLElement>(null);
  const visualRef = useRef<HTMLDivElement>(null);
  const [activePhase, setActivePhase] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setIsMounted(true);
    setReducedMotion(motionQuery.matches);
    const handleMotionChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    motionQuery.addEventListener("change", handleMotionChange);

    const phaseNodes = Array.from(section.querySelectorAll<HTMLElement>("[data-phase]"));
    let frame = 0;
    const updatePhase = () => {
      frame = 0;
      const line = window.innerHeight * 0.55;
      let best = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      phaseNodes.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        const distance = Math.abs(rect.top + rect.height / 2 - line);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      });
      setActivePhase(best);
    };
    const handleScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(updatePhase);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll);
    updatePhase();

    const visibilityObserver = new IntersectionObserver(
      ([entry]) => setIsVisible(entry?.isIntersecting ?? false),
      { rootMargin: "20% 0px 20% 0px" },
    );

    visibilityObserver.observe(section);

    if (!motionQuery.matches && visualRef.current) {
      animate(visualRef.current, {
        opacity: [0, 1],
        translateY: [36, 0],
        duration: 900,
        ease: "out(3)",
      });
    }

    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
      if (frame) window.cancelAnimationFrame(frame);
      visibilityObserver.disconnect();
      motionQuery.removeEventListener("change", handleMotionChange);
    };
  }, []);

  useEffect(() => {
    if (reducedMotion) return;
    const activeCopy = sectionRef.current?.querySelector<HTMLElement>(`[data-phase="${activePhase}"] [data-copy]`);
    if (!activeCopy) return;
    animate(activeCopy, {
      opacity: [0.45, 1],
      translateY: [18, 0],
      duration: 620,
      ease: "out(4)",
    });
  }, [activePhase, reducedMotion]);

  return (
    <section ref={sectionRef} id="proceso" className="border-b border-border bg-background">
      <div className="mx-auto max-w-[1400px] px-5 py-20 sm:px-8 lg:py-28">
        <div className="mb-12 flex items-end justify-between border-b border-border pb-5">
          <div>
            <p className="font-mono text-[11px] uppercase text-coral">Proceso / Procedural</p>
            <h2 className="mt-3 text-4xl font-extrabold sm:text-5xl">El recorrido</h2>
          </div>
          <span className="hidden font-mono text-[11px] uppercase text-muted-foreground sm:block">
            04 fases · scroll para construir
          </span>
        </div>

        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,.65fr)] lg:gap-16">
          <div ref={visualRef} className="top-20 h-fit lg:sticky" aria-label={`Vista 3D del proceso: ${phases[activePhase]?.title ?? "ajuste de impresora"}`}>
            <div className="process-scene relative h-[52svh] min-h-[360px] overflow-hidden border-y border-border bg-surface sm:h-[64svh] lg:h-[calc(100svh-9rem)] lg:max-h-[760px]">
              <div className="pointer-events-none absolute left-4 top-4 z-10 font-mono text-[10px] uppercase text-muted-foreground sm:left-6 sm:top-6">
                STRATA / flujo físico-digital
              </div>
              <div className="pointer-events-none absolute right-4 top-4 z-10 text-right font-mono text-[10px] uppercase text-coral sm:right-6 sm:top-6">
                {phases[activePhase]?.label ?? "Tune up / activo"}
              </div>
              {isMounted ? (
                <Suspense fallback={<div className="h-full w-full animate-pulse bg-surface" />}>
                  <PrintCanvas phase={activePhase} isVisible={isVisible} reducedMotion={reducedMotion} />
                </Suspense>
              ) : null}
              <div className="pointer-events-none absolute bottom-4 left-4 right-4 z-10 flex items-center justify-between font-mono text-[10px] uppercase text-muted-foreground sm:bottom-6 sm:left-6 sm:right-6">
                <span>PRN_01 / VASE_A</span>
                <span>{String(activePhase + 1).padStart(2, "0")} / 04</span>
              </div>
            </div>
          </div>

          <ol>
            {phases.map((phase, index) => (
              <li
                key={phase.number}
                data-phase={index}
                className={`phase-copy flex min-h-[48vh] flex-col justify-center border-t border-border py-12 transition-opacity duration-300 last:border-b lg:min-h-[68vh] ${
                  activePhase === index ? "opacity-100" : "opacity-35"
                }`}
              >
                <div data-copy>
                  <div className="mb-8 flex items-center justify-between font-mono text-xs">
                    <span className="text-coral">{phase.number}</span>
                    <span className="uppercase text-muted-foreground">{phase.label}</span>
                  </div>
                  <h3 className="text-4xl font-bold sm:text-5xl">{phase.title}</h3>
                  <p className="mt-5 max-w-[42ch] text-lg leading-relaxed text-muted-foreground">
                    {phase.description}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}