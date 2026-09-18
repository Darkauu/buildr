import { animate, stagger } from "animejs";
import { useEffect } from "react";
import { whenIntroDone } from "@/lib/intro";
import { scrollToElement, stickyProgress, subscribeScroll } from "@/lib/scroll";

/**
 * Page choreography outside the 3D scene.
 *
 * Everything scroll-driven here runs off the shared engine in `lib/scroll`
 * rather than its own listener, so the hero parallax, the header state, the
 * service scrub and the ambient background all read the same frame.
 *
 * The first-paint entrance waits for the splash to clear (`lib/intro`), so the
 * headline never animates behind a cover panel.
 */

const HEADER_OFFSET = 72;

export function KineticMotion() {
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cleanups: Array<() => void> = [];

    if (!reduced) {
      cleanups.push(
        whenIntroDone(() => {
          animate("[data-kinetic-word]", {
            opacity: [0, 1],
            translateY: [80, 0],
            delay: stagger(90),
            duration: 1050,
            ease: "out(4)",
          });
          animate(".hero-line > span", {
            opacity: [0, 1],
            translateY: ["105%", "0%"],
            delay: stagger(110),
            duration: 1150,
            ease: "out(4)",
          });
        }),
      );

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
      cleanups.push(() => observer.disconnect());
    }

    // Scroll-linked state. One subscription, one frame, all of it written to
    // CSS custom properties and data attributes so nothing re-renders React.
    const hero = document.querySelector<HTMLElement>("[data-kinetic-hero]");
    const header = document.querySelector<HTMLElement>("[data-site-header]");
    const scrubs = Array.from(document.querySelectorAll<HTMLElement>("[data-scrub]"));

    cleanups.push(
      subscribeScroll(({ viewport }) => {
        if (hero) {
          const rect = hero.getBoundingClientRect();
          hero.style.setProperty("--hero-progress", stickyProgress(rect, viewport).toFixed(3));
          // The header flips to its solid state once the dark hero is behind it.
          if (header) {
            header.dataset["header"] = rect.bottom - HEADER_OFFSET > 0 ? "top" : "pinned";
          }
        }

        for (const node of scrubs) {
          const rect = node.getBoundingClientRect();
          if (rect.bottom < -viewport || rect.top > viewport * 2) continue;
          // -1 above the viewport, 0 centred, 1 below it.
          const centre = (rect.top + rect.height / 2 - viewport / 2) / viewport;
          node.style.setProperty("--scrub", Math.max(-1, Math.min(1, centre)).toFixed(3));
        }
      }),
    );

    // In-page links go through the engine so anchors ease like everything else.
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
      const link = (event.target as Element | null)?.closest?.('a[href^="#"]');
      const href = link?.getAttribute("href");
      if (!href || href === "#") return;
      const target = document.querySelector(href);
      if (!target) return;
      event.preventDefault();
      // Deliberately no history.replaceState: writing the hash hands the
      // router's scroll restoration a reason to jump, which fights the eased
      // scroll we just started.
      scrollToElement(target, HEADER_OFFSET);
    };
    document.addEventListener("click", onClick);
    cleanups.push(() => document.removeEventListener("click", onClick));

    return () => cleanups.forEach((cleanup) => cleanup());
  }, []);

  return null;
}
