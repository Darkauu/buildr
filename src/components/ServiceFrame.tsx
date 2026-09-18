import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { ServiceVariant } from "./three/ServiceObject";

const ServiceObject = lazy(() => import("./three/ServiceObject"));

/**
 * The framed piece that replaced the flat number tile in each service.
 *
 * The frame is CSS — a boxed plinth in perspective — and the piece inside is a
 * live 3D object rather than a photograph. The number moves to the frame's
 * corner, where it labels the frame instead of competing with it.
 *
 * The canvas is only mounted once the frame is near the viewport: two extra
 * WebGL contexts that spin up on page load would be paid for by everyone,
 * including visitors who never scroll this far.
 */
export function ServiceFrame({ variant, number }: { variant: ServiceVariant; number: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setActive(true);
          observer.disconnect();
        }
      },
      { rootMargin: "35% 0px" },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={hostRef} className="service-frame" aria-hidden="true">
      <div className="service-frame-plinth">
        <div className="service-frame-stage">
          {active ? (
            <Suspense fallback={null}>
              <ServiceObject variant={variant} />
            </Suspense>
          ) : null}
        </div>
      </div>
      <span className="service-frame-number">{number}</span>
    </div>
  );
}
