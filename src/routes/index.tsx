import { createFileRoute } from "@tanstack/react-router";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { AmbientField } from "../components/background/AmbientField";
import { KineticMotion, LayerAssembly } from "../components/KineticMotion";
import { PrintProcess } from "../components/PrintProcess";
import { Splash } from "../components/Splash";
import { printerMacroUrl, printerModelUrl } from "../lib/assets";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "STRATA — Impresión 3D y diseño a medida" },
      {
        name: "description",
        content:
          "Fabricación bajo demanda y diseño 3D a medida, con un proceso claro desde la calibración hasta la pieza final.",
      },
      { property: "og:title", content: "STRATA — Impresión 3D y diseño a medida" },
      {
        property: "og:description",
        content: "Descubre cómo una idea se convierte en una pieza 3D, capa por capa.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <>
      <Splash modelUrl={printerModelUrl} imageUrl={printerMacroUrl} />
      <AmbientField />

      <main className="page-shell min-h-screen overflow-clip text-foreground">
        <KineticMotion />

        <header data-site-header data-header="top" className="site-header">
          <div className="mx-auto flex max-w-[1400px] items-center justify-between px-5 py-3 sm:px-8">
            <a href="#inicio" className="flex items-baseline gap-2" aria-label="STRATA, inicio">
              <span className="text-lg font-extrabold">STRATA</span>
              <span className="font-mono text-[10px] uppercase opacity-60">/ taller</span>
            </a>
            <nav
              className="header-nav hidden items-center gap-7 font-mono text-[11px] uppercase md:flex"
              aria-label="Navegación principal"
            >
              <a href="#proceso" className="transition-colors">
                Proceso
              </a>
              <a href="#servicios" className="transition-colors">
                Servicios
              </a>
              <a href="#contacto" className="transition-colors">
                Contacto
              </a>
            </nav>
            <a
              href="#contacto"
              className="header-cta inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-transform hover:-translate-y-0.5"
            >
              Iniciar proyecto <ArrowUpRight size={15} aria-hidden="true" />
            </a>
          </div>
        </header>

        <section
          id="inicio"
          data-kinetic-hero
          data-tone="charcoal"
          className="kinetic-hero tone-charcoal relative min-h-[175svh]"
        >
          <div className="sticky top-0 h-svh overflow-hidden">
            <LayerAssembly />
            <figure className="hero-macro" aria-hidden="true">
              <img src={printerMacroUrl} width={1024} height={1280} fetchPriority="high" alt="" />
            </figure>
            <div className="hero-copy absolute inset-0 mx-auto flex max-w-[1400px] flex-col justify-center px-5 pt-16 sm:px-8">
              <p data-kinetic-word className="hero-eyebrow mb-5 font-mono text-[10px] uppercase">
                Taller de fabricación digital / Panamá
              </p>
              <h1 className="max-w-[11ch] text-[clamp(3.7rem,10.5vw,9.4rem)] font-extrabold leading-[0.79]">
                <span className="hero-line">
                  <span>Ideas que</span>
                </span>
                <span className="hero-line hero-line-shift">
                  <span>
                    toman <em>forma</em>
                  </span>
                </span>
                <span className="hero-line">
                  <span>capa a capa.</span>
                </span>
              </h1>
              <div
                data-kinetic-word
                className="mt-8 flex max-w-[880px] items-end justify-between gap-6"
              >
                <p className="max-w-[40ch] text-base leading-relaxed text-muted-on-dark sm:text-lg">
                  Piezas funcionales, prototipos y objetos de autor construidos con precisión
                  técnica.
                </p>
                <a
                  href="#proceso"
                  className="hero-scroll-link inline-flex shrink-0 items-center gap-3 font-mono text-[10px] uppercase"
                >
                  Explorar proceso <ArrowDownRight size={18} />
                </a>
              </div>
            </div>
            <div className="hero-index font-mono text-[9px] uppercase">
              FDM / 0.20 mm
              <br />
              Scroll para construir
            </div>
          </div>
        </section>

        <PrintProcess />

        <section
          id="servicios"
          data-tone="charcoal"
          className="kinetic-services tone-charcoal border-b border-border"
        >
          <div className="mx-auto max-w-[1400px] px-5 py-20 sm:px-8 lg:py-28">
            <div data-reveal className="services-heading mb-16 lg:mb-24">
              <p data-reveal-line className="font-mono text-[10px] uppercase text-tech">
                Oferta inicial / 02 caminos
              </p>
              <h2
                data-reveal-line
                className="mt-4 text-[clamp(3.5rem,9vw,8rem)] font-extrabold leading-[0.82]"
              >
                Hacemos
                <br />
                <span>lo complejo</span>
                <br />
                tangible.
              </h2>
            </div>
            <div className="service-sequence">
              <article data-reveal data-scrub className="kinetic-service kinetic-service-coral">
                <div className="service-number" aria-hidden="true">
                  01
                </div>
                <div className="service-content">
                  <span data-reveal-line className="font-mono text-[10px] uppercase">
                    Archivo listo / producir
                  </span>
                  <h3 data-reveal-line>
                    Fabricación
                    <br />
                    bajo demanda
                  </h3>
                  <p data-reveal-line>
                    Piezas funcionales y lotes cortos a partir de tu archivo, con material y acabado
                    seleccionados para el uso real.
                  </p>
                  <div data-reveal-line className="service-tags">
                    {["PLA", "PETG", "Lote corto"].map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                </div>
              </article>
              <article data-reveal data-scrub className="kinetic-service kinetic-service-tech">
                <div className="service-number" aria-hidden="true">
                  02
                </div>
                <div className="service-content">
                  <span data-reveal-line className="font-mono text-[10px] uppercase">
                    Idea inicial / resolver
                  </span>
                  <h3 data-reveal-line>
                    Diseño
                    <br />a medida
                  </h3>
                  <p data-reveal-line>
                    Del boceto al modelo imprimible: proporción, tolerancias y estrategia de
                    impresión resueltas desde el inicio.
                  </p>
                  <div data-reveal-line className="service-tags">
                    {["Modelado", "Tolerancias", "Prototipo"].map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section id="contacto" data-tone="red" className="kinetic-contact tone-red">
          <div
            data-reveal
            data-scrub
            className="mx-auto max-w-[1400px] px-5 py-24 sm:px-8 lg:py-36"
          >
            <p data-reveal-line className="contact-meta font-mono text-[10px] uppercase">
              Contacto / próxima pieza
            </p>
            <h2
              data-reveal-line
              className="contact-title mt-8 text-[clamp(4rem,12vw,10rem)] font-extrabold leading-[0.78]"
            >
              Tu idea.
              <br />
              <span>En físico.</span>
            </h2>
            <div data-reveal-line className="contact-row mt-14 border-t border-current pt-6">
              <p className="max-w-[44ch] text-lg">
                Cuéntanos qué necesitas fabricar. Revisaremos la idea, el archivo y el material
                adecuado contigo.
              </p>
              <a
                href="mailto:hola@strata.taller"
                className="contact-link inline-flex items-center gap-3 text-xl font-semibold sm:text-2xl"
              >
                hola@strata.taller <ArrowUpRight size={24} />
              </a>
            </div>
            <p data-reveal-line className="contact-meta mt-5 font-mono text-[9px] uppercase">
              Correo provisional para el MVP
            </p>
          </div>
          <footer className="border-t border-current/20">
            <div className="contact-meta mx-auto flex max-w-[1400px] flex-col justify-between gap-2 px-5 py-5 font-mono text-[9px] uppercase sm:flex-row sm:px-8">
              <span>STRATA · Taller de impresión 3D</span>
              <span>Servicios hoy · Cursos y comunidad después</span>
            </div>
          </footer>
        </section>
      </main>
    </>
  );
}
