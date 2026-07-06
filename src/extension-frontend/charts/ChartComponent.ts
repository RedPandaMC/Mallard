import { initChart } from './echarts';
import type { EChartsOption } from './echarts';
import type { UsageSnapshot } from '../../extension-backend/domain/types';

type EChartsInstance = ReturnType<typeof initChart>;

/**
 * Abstract base for ECharts panels. Subclasses implement hasData() and
 * buildOption(), and the base handles the clear-vs-render decision and
 * the notMerge/lazyUpdate defaults uniformly.
 */
export abstract class ChartComponent {
  protected chart: EChartsInstance;
  protected readonly el: HTMLElement;

  /** Override to false in subclasses that accumulate series across updates. */
  protected notMerge = true;

  constructor(el: HTMLElement) {
    this.el = el;
    this.chart = initChart(el);
  }

  /** Return true when snapshot has renderable data for this chart. */
  protected abstract hasData(s: UsageSnapshot): boolean;

  /** Build and return an ECharts option object. Called only when hasData() is true. */
  protected abstract buildOption(s: UsageSnapshot): object;

  /** Called when hasData() returns false (after chart.clear()). Default no-op. */
  protected onHide(): void {}

  /** Called when hasData() returns true (before setOption). Default no-op. */
  protected onShow(): void {}

  update(s: UsageSnapshot): void {
    if (!this.hasData(s)) {
      this.chart.clear();
      this.onHide();
      return;
    }
    this.onShow();
    this.chart.setOption(this.buildOption(s) as EChartsOption, { notMerge: this.notMerge, lazyUpdate: true });
  }

  resize(): void {
    this.chart.resize();
  }

  /**
   * Dispose and recreate the underlying ECharts instance so it picks up the
   * theme most recently registered by applyTheme(). ECharts snapshots the
   * theme object by reference at init() time — re-registering a theme name
   * has no effect on instances created before the re-registration, so a
   * plain setOption() after a light/dark switch would leave chrome (axis
   * lines, background, tooltip) stuck on the old theme. Callers must
   * re-render (call update()) immediately after this to repaint.
   */
  reinit(): void {
    this.chart.dispose();
    this.chart = initChart(this.el);
  }
}
