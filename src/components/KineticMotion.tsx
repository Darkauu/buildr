import { animate, stagger } from "animejs";
import { useEffect } from "react";

const MODULES = Array.from({ length: 22 });

export function KineticMotion() {
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches) return;

    animate("[data-kinetic-word]", {
      opacity: [0, 1],
      translateY: [80, 0],
      delay: stagger(90),
      duration: 1050,
      ease: "out(4)",
    });
    animate("[data-module]", {
      opacity: [0, 1],
      scale: [0.25, 1],
      delay: stagger(24, { from: "center" }),
      duration: 850,
      ease: "out(3)",
    });

    const reveals = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const target = entry.target as HTMLElement;
          target.dataset["revealed"] = "true";
          animate(target.querySelectorAll("[data-reveal-line]"), {
            opacity: [0, 1],
            translateY: [52, 0],
            delay: stagger(85),
            duration: 850,
            ease: "out(4)",
          });
          observer.unobserve(target);
        });
      },
      { threshold: 0.18 },
    );
    reveals.forEach((node) => observer.observe(node));

    let frame = 0;
    const update = () => {
      frame = 0;
      const hero = document.querySelector<HTMLElement>("[data-kinetic-hero]");
      if (!hero) return;
      const rect = hero.getBoundingClientRect();
      const progress = Math.max(0, Math.min(1, -rect.top / Math.max(1, rect.height - window.innerHeight)));
      hero.style.setProperty("--hero-progress", progress.toFixed(3));
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    update();

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}

export function LayerAssembly() {
  return (
    <div className="layer-assembly" aria-hidden="true">
      {MODULES.map((_, index) => <i key={index} data-module />)}
    </div>
  );
}