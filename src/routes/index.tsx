import { createFileRoute } from "@tanstack/react-router";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { PrintProcess } from "../components/PrintProcess";
import { KineticMotion, LayerAssembly } from "../components/KineticMotion";
import printerMacro from "../assets/strata-printer-macro.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "STRATA — Impresión 3D y diseño a medida" },
      {
        name: "description",
        content: "Fabricación bajo demanda y diseño 3D a medida, con un proceso claro desde la calibración hasta la pieza final.",
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
    <main className="min-h-screen overflow-clip bg-background text-foreground">
      <KineticMotion />
      <header className="fixed left-0 right-0 top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-5 py-3 sm:px-8">
          <a href="#inicio" className="flex items-baseline gap-2" aria-label="STRATA, inicio">
            <span className="text-lg font-extrabold">STRATA</span>
            <span className="font-mono text-[10px] uppercase text-muted-foreground">/ taller</span>
          </a>
          <nav className="hidden items-center gap-7 font-mono text-[11px] uppercase text-muted-foreground md:flex" aria-label="Navegación principal">
            <a href="#proceso" className="transition-colors hover:text-foreground">Proceso</a>
            <a href="#servicios" className="transition-colors hover:text-foreground">Servicios</a>
            <a href="#contacto" className="transition-colors hover:text-foreground">Contacto</a>
          </nav>
          <a href="#contacto" className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5">
            Iniciar proyecto <ArrowUpRight size={15} aria-hidden="true" />
          </a>
        </div>
      </header>

      <section id="inicio" data-kinetic-hero className="kinetic-hero relative min-h-[175svh] border-b border-border">
        <div className="sticky top-0 h-svh overflow-hidden">
          <LayerAssembly />
          <figure className="hero-macro" aria-hidden="true">
            <img src={printerMacro} width={1024} height={1280} fetchPriority="high" alt="" />
          </figure>
          <div className="hero-copy absolute inset-0 mx-auto flex max-w-[1400px] flex-col justify-center px-5 pt-16 sm:px-8">
            <p data-kinetic-word className="mb-5 font-mono text-[10px] uppercase text-muted-foreground">Taller de fabricación digital / Panamá</p>
            <h1 className="max-w-[11ch] text-[clamp(3.7rem,10.5vw,9.4rem)] font-extrabold leading-[0.79]">
              <span className="hero-line"><span data-kinetic-word>Ideas que</span></span>
              <span className="hero-line hero-line-shift"><span data-kinetic-word>toman <em>forma</em></span></span>
              <span className="hero-line"><span data-kinetic-word>capa a capa.</span></span>
            </h1>
            <div data-kinetic-word className="mt-8 flex max-w-[880px] items-end justify-between gap-6">
              <p className="max-w-[40ch] text-base leading-relaxed text-muted-foreground sm:text-lg">Piezas funcionales, prototipos y objetos de autor construidos con precisión técnica.</p>
              <a href="#proceso" className="hero-scroll-link inline-flex shrink-0 items-center gap-3 font-mono text-[10px] uppercase">Explorar proceso <ArrowDownRight size={18} /></a>
            </div>
          </div>
          <div className="hero-index font-mono text-[9px] uppercase text-muted-foreground">FDM / 0.20 mm<br />Scroll para construir</div>
        </div>
      </section>

      <PrintProcess />

      <section id="servicios" className="kinetic-services border-b border-border bg-foreground text-background">
        <div className="mx-auto max-w-[1400px] px-5 py-20 sm:px-8 lg:py-28">
          <div data-reveal className="services-heading mb-16 lg:mb-24">
            <p data-reveal-line className="font-mono text-[10px] uppercase text-tech">Oferta inicial / 02 caminos</p>
            <h2 data-reveal-line className="mt-4 text-[clamp(3.5rem,9vw,8rem)] font-extrabold leading-[0.82]">Hacemos<br /><span>lo complejo</span><br />tangible.</h2>
          </div>
          <div className="service-sequence">
            <article data-reveal className="kinetic-service kinetic-service-coral">
              <div className="service-number" aria-hidden="true">01</div>
              <div className="service-content">
                <span data-reveal-line className="font-mono text-[10px] uppercase">Archivo listo / producir</span>
                <h3 data-reveal-line>Fabricación<br />bajo demanda</h3>
                <p data-reveal-line>Piezas funcionales y lotes cortos a partir de tu archivo, con material y acabado seleccionados para el uso real.</p>
                <div data-reveal-line className="service-tags">{['PLA', 'PETG', 'Lote corto'].map((tag) => <span key={tag}>{tag}</span>)}</div>
              </div>
            </article>
            <article data-reveal className="kinetic-service kinetic-service-tech">
              <div className="service-number" aria-hidden="true">02</div>
              <div className="service-content">
                <span data-reveal-line className="font-mono text-[10px] uppercase">Idea inicial / resolver</span>
                <h3 data-reveal-line>Diseño<br />a medida</h3>
                <p data-reveal-line>Del boceto al modelo imprimible: proporción, tolerancias y estrategia de impresión resueltas desde el inicio.</p>
                <div data-reveal-line className="service-tags">{['Modelado', 'Tolerancias', 'Prototipo'].map((tag) => <span key={tag}>{tag}</span>)}</div>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section id="contacto" className="kinetic-contact bg-coral text-coral-foreground">
        <div data-reveal className="mx-auto max-w-[1400px] px-5 py-24 sm:px-8 lg:py-36">
          <p data-reveal-line className="font-mono text-[10px] uppercase">Contacto / próxima pieza</p>
          <h2 data-reveal-line className="mt-8 text-[clamp(4rem,12vw,10rem)] font-extrabold leading-[0.78]">Tu idea.<br /><span>En físico.</span></h2>
          <div data-reveal-line className="contact-row mt-14 border-t border-current pt-6">
            <p className="max-w-[44ch] text-lg">Cuéntanos qué necesitas fabricar. Revisaremos la idea, el archivo y el material adecuado contigo.</p>
            <a href="mailto:hola@strata.taller" className="contact-link inline-flex items-center gap-3 text-xl font-semibold sm:text-2xl">hola@strata.taller <ArrowUpRight size={24} /></a>
          </div>
          <p data-reveal-line className="mt-5 font-mono text-[9px] uppercase opacity-60">Correo provisional para el MVP</p>
        </div>
        <footer className="border-t border-current/20">
          <div className="mx-auto flex max-w-[1400px] flex-col justify-between gap-2 px-5 py-5 font-mono text-[9px] uppercase opacity-60 sm:flex-row sm:px-8">
            <span>STRATA · Taller de impresión 3D</span>
            <span>Servicios hoy · Cursos y comunidad después</span>
          </div>
        </footer>
      </section>
    </main>
  );
}
