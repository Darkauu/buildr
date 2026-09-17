/**
 * Hand-off between the splash screen and the page entrance.
 *
 * The hero must not start animating while the splash still covers it, and it
 * must not sit invisible forever when there is no splash at all (repeat visit,
 * reduced motion, splash failure). Everything that animates on first paint
 * waits here, and the splash — or its absence — releases them exactly once.
 */

let done = false;
const waiters = new Set<() => void>();

export function isIntroDone() {
  return done;
}

export function markIntroDone() {
  if (done) return;
  done = true;
  waiters.forEach((waiter) => waiter());
  waiters.clear();
}

/** Runs `callback` once the splash is out of the way, or immediately if it already is. */
export function whenIntroDone(callback: () => void) {
  if (done) {
    callback();
    return () => {};
  }
  waiters.add(callback);
  return () => {
    waiters.delete(callback);
  };
}
