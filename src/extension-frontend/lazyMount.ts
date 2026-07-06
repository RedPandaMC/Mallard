/**
 * Defers expensive chart initialisation until the element scrolls into view.
 *
 * Charts below the fold (and inside hidden sections) are not initialised on
 * load; the latest render callback is stashed and replayed the first time the
 * element intersects the viewport. This keeps the initial snapshot -> DOM paint
 * cheap: only light DOM (KPI cards, gauge) renders synchronously.
 */
export interface LazyChart<H extends { resize(): void; reinit(): void }> {
  /** Provide a render closure; replayed on init and applied immediately if ready. */
  render(fn: (handle: H) => void): void;
  resize(): void;
  /**
   * Disposes and recreates the underlying chart (so it picks up colors from
   * a theme registered after the chart was first mounted) and replays the
   * last render closure immediately. No-op if the chart hasn't been mounted
   * yet — an unmounted chart will pick up the current theme naturally on
   * its first real init.
   */
  rerenderForTheme(): void;
}

export function lazyChart<H extends { resize(): void; reinit(): void }>(
  el: HTMLElement,
  factory: () => H,
): LazyChart<H> {
  let inner: H | null = null;
  let lastRender: ((handle: H) => void) | null = null;

  const ensure = (): void => {
    if (inner) return;
    inner = factory();
    if (lastRender) lastRender(inner);
  };

  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      ensure();
      io.disconnect();
    }
  });
  io.observe(el);

  return {
    render(fn) {
      lastRender = fn;
      if (inner) fn(inner);
    },
    resize() {
      inner?.resize();
    },
    rerenderForTheme() {
      if (!inner) return;
      inner.reinit();
      if (lastRender) lastRender(inner);
    },
  };
}
