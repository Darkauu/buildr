/**
 * Shared scroll engine.
 *
 * Two jobs, one rAF loop:
 *
 * 1. Inertia. Wheel input is intercepted and the page is driven with an eased
 *    `window.scrollTo` instead of jumping. Native scroll position stays the
 *    source of truth, so `position: sticky` keeps working — unlike the
 *    transform-a-wrapper approach, which would break both sticky sections.
 * 2. Distribution. Every scroll-driven piece of the page (hero parallax, the
 *    3D phase tracker, the ambient background) subscribes here instead of
 *    registering its own listener and its own rAF.
 *
 * Inertia is skipped for touch, coarse pointers and reduced-motion; those get
 * plain native scrolling while still receiving snapshots.
 */

export type ScrollSnapshot = {
  /** Current scroll position in px. */
  y: number;
  /** Scroll position the page is easing toward. */
  target: number;
  /** Signed px moved on the last frame. */
  velocity: number;
  /** Largest reachable scroll position. */
  max: number;
  /** `y / max`, clamped to 0..1. */
  progress: number;
  /** Viewport height in px. */
  viewport: number;
  /** Viewport width in px. */
  width: number;
};

type Subscriber = (snapshot: ScrollSnapshot) => void;

const LERP = 8.2;
/** Below this the easing has visually settled; stop the loop and idle. */
const SETTLE_EPSILON = 0.08;

let engine: Engine | null = null;

class Engine {
  private subscribers = new Set<Subscriber>();
  private frame = 0;
  private target = 0;
  private current = 0;
  private velocity = 0;
  private lastTime = 0;
  /** True only while easing toward a target we own. */
  private driving = false;
  /** The last position we wrote, used to recognise our own scroll events. */
  private expected = 0;
  private inertia: boolean;
  private snapshot: ScrollSnapshot;

  constructor() {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = window.matchMedia("(hover: none), (pointer: coarse)").matches;
    this.inertia = !reduced && !coarse;

    this.current = window.scrollY;
    this.target = this.current;
    this.snapshot = this.read();

    window.addEventListener("scroll", this.onScroll, { passive: true });
    window.addEventListener("resize", this.onResize, { passive: true });
    if (this.inertia) {
      window.addEventListener("wheel", this.onWheel, { passive: false });
    }
  }

  destroy() {
    window.removeEventListener("scroll", this.onScroll);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("wheel", this.onWheel);
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.subscribers.clear();
  }

  subscribe(callback: Subscriber) {
    this.subscribers.add(callback);
    callback(this.snapshot);
    this.wake();
    return () => {
      this.subscribers.delete(callback);
    };
  }

  get latest() {
    return this.snapshot;
  }

  /** Eases the page to an absolute offset. Used by in-page anchor links. */
  scrollTo(position: number) {
    const clamped = clamp(position, 0, this.maxScroll());
    if (!this.inertia) {
      window.scrollTo({ top: clamped, behavior: "smooth" });
      return;
    }
    this.target = clamped;
    this.driving = true;
    this.wake();
  }

  private maxScroll() {
    return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  }

  private read(): ScrollSnapshot {
    const max = this.maxScroll();
    return {
      y: this.current,
      target: this.target,
      velocity: this.velocity,
      max,
      progress: max > 0 ? clamp(this.current / max, 0, 1) : 0,
      viewport: window.innerHeight,
      width: window.innerWidth,
    };
  }

  private onScroll = () => {
    const y = window.scrollY;
    // Our own writes echo back as scroll events a frame later; those match the
    // position we just set and must not be treated as input.
    if (this.driving && Math.abs(y - this.expected) < 2) return;
    // Anything else that moved the page — keyboard, scrollbar drag, find-in-page,
    // focus, browser restore, a programmatic scroll — wins immediately.
    this.driving = false;
    this.current = y;
    this.target = y;
    this.wake();
  };

  private onResize = () => {
    this.target = clamp(this.target, 0, this.maxScroll());
    this.wake();
  };

  private onWheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.defaultPrevented) return; // pinch-zoom, or handled elsewhere
    if (isInsideScrollable(event.target)) return;
    event.preventDefault();
    this.target = clamp(this.target + normalizeDelta(event), 0, this.maxScroll());
    this.driving = true;
    this.wake();
  };

  private wake() {
    if (this.frame) return;
    this.lastTime = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }

  private tick = (time: number) => {
    this.frame = 0;
    const delta = Math.min((time - this.lastTime) / 1000, 0.05);
    this.lastTime = time;

    const previous = this.current;
    if (this.inertia && this.driving) {
      this.current = damp(this.current, this.target, LERP, delta);
      if (Math.abs(this.target - this.current) < SETTLE_EPSILON) {
        this.current = this.target;
        this.driving = false;
      }
      this.expected = this.current;
      window.scrollTo(0, this.current);
    } else {
      // Not easing: the page owns its own position and we only observe it.
      this.current = window.scrollY;
      this.target = this.current;
    }
    this.velocity = this.current - previous;
    this.snapshot = this.read();

    this.subscribers.forEach((subscriber) => subscriber(this.snapshot));

    // Keep spinning while easing, or while the page is still moving under us;
    // otherwise go idle until the next input.
    if (this.driving || Math.abs(this.velocity) > SETTLE_EPSILON) this.wake();
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function damp(current: number, target: number, speed: number, delta: number) {
  return current + (target - current) * (1 - Math.exp(-speed * delta));
}

function normalizeDelta(event: WheelEvent) {
  if (event.deltaMode === 1) return event.deltaY * 16; // lines
  if (event.deltaMode === 2) return event.deltaY * window.innerHeight; // pages
  return event.deltaY;
}

/** Lets nested scrollers (code blocks, selects, dialogs) keep native wheel. */
function isInsideScrollable(target: EventTarget | null) {
  let node = target instanceof Element ? target : null;
  while (node && node !== document.body && node !== document.documentElement) {
    const style = getComputedStyle(node);
    const scrollable = /(auto|scroll|overlay)/.test(style.overflowY);
    if (scrollable && node.scrollHeight > node.clientHeight + 1) return true;
    node = node.parentElement;
  }
  return false;
}

function getEngine() {
  if (typeof window === "undefined") return null;
  if (!engine) engine = new Engine();
  return engine;
}

/** Subscribes to the shared loop. Fires immediately with the current state. */
export function subscribeScroll(callback: Subscriber) {
  const instance = getEngine();
  if (!instance) return () => {};
  return instance.subscribe(callback);
}

export function getScrollSnapshot(): ScrollSnapshot | null {
  return getEngine()?.latest ?? null;
}

/** Eased scroll to an element top, offset by the fixed header. */
export function scrollToElement(element: Element, offset = 0) {
  const instance = getEngine();
  if (!instance) return;
  instance.scrollTo(element.getBoundingClientRect().top + window.scrollY - offset);
}

/**
 * Maps an element's travel through the viewport to 0..1.
 * 0 when its top hits the bottom of the viewport, 1 when its bottom leaves the top.
 */
export function elementProgress(rect: DOMRect, viewport: number) {
  const span = rect.height + viewport;
  if (span <= 0) return 0;
  return clamp((viewport - rect.top) / span, 0, 1);
}

/** Progress across a sticky section: 0 at its top, 1 once it has scrolled through. */
export function stickyProgress(rect: DOMRect, viewport: number) {
  const span = Math.max(1, rect.height - viewport);
  return clamp(-rect.top / span, 0, 1);
}
