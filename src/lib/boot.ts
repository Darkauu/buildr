/**
 * Boot progress for the splash screen.
 *
 * Tracks the three things that actually make the first screen look wrong when
 * they are missing — the display fonts, the hero photograph and the 2.6 MB
 * printer model — and reports a single weighted 0..1 value. The splash is
 * gated on this, so the hero entrance never fires against unstyled text or a
 * still-downloading model.
 *
 * A hard timeout always releases the page: a stalled asset must never trap the
 * visitor behind a preloader.
 */

export type BootState = {
  /** Weighted load progress, 0..1. */
  progress: number;
  /** True once every task settled, or the timeout fired. */
  ready: boolean;
};

type BootTask = {
  weight: number;
  progress: number;
};

const TIMEOUT_MS = 9000;

const tasks: Record<string, BootTask> = {
  fonts: { weight: 0.15, progress: 0 },
  image: { weight: 0.15, progress: 0 },
  model: { weight: 0.7, progress: 0 },
};

const subscribers = new Set<(state: BootState) => void>();
let state: BootState = { progress: 0, ready: false };
let started = false;
let timeout: ReturnType<typeof setTimeout> | undefined;

function publish() {
  const progress = Object.values(tasks).reduce(
    (total, task) => total + task.weight * task.progress,
    0,
  );
  const ready = state.ready || progress >= 0.999;
  state = { progress: Math.min(1, progress), ready };
  subscribers.forEach((subscriber) => subscriber(state));
  if (ready && timeout) {
    clearTimeout(timeout);
    timeout = undefined;
  }
}

function settle(name: keyof typeof tasks, value: number) {
  const task = tasks[name];
  if (!task) return;
  task.progress = Math.max(task.progress, Math.min(1, value));
  publish();
}

function trackFonts() {
  if (!("fonts" in document)) return settle("fonts", 1);
  document.fonts.ready.then(() => settle("fonts", 1)).catch(() => settle("fonts", 1));
}

function trackImage(url: string) {
  const image = new Image();
  image.onload = () => settle("image", 1);
  image.onerror = () => settle("image", 1);
  image.src = url;
  if (image.complete) settle("image", 1);
}

/**
 * Streams the model so the counter reflects real bytes. This only warms the
 * HTTP cache — react-three/drei re-requests the same URL and is served from it,
 * which keeps the loader and the cache-warming decoupled.
 */
async function trackModel(url: string) {
  try {
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok || !response.body) return settle("model", 1);

    const total = Number(response.headers.get("content-length") ?? 0);
    if (!total) {
      await response.arrayBuffer();
      return settle("model", 1);
    }

    const reader = response.body.getReader();
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value?.length ?? 0;
      settle("model", received / total);
    }
    settle("model", 1);
  } catch {
    settle("model", 1);
  }
}

/** Idempotent — safe to call from an effect that may re-run. */
export function startBoot(assets: { modelUrl: string; imageUrl: string }) {
  if (started || typeof window === "undefined") return;
  started = true;

  timeout = setTimeout(() => {
    state = { progress: 1, ready: true };
    subscribers.forEach((subscriber) => subscriber(state));
  }, TIMEOUT_MS);

  trackFonts();
  trackImage(assets.imageUrl);
  void trackModel(assets.modelUrl);
}

export function subscribeBoot(callback: (state: BootState) => void) {
  subscribers.add(callback);
  callback(state);
  return () => {
    subscribers.delete(callback);
  };
}
