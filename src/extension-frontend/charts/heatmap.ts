/**
 * Day-activity heatmap — a GitHub contribution-graph-style grid (month
 * labels across the top, weekday rows down the left, discrete "Less → More"
 * color buckets) built from plain DOM/CSS rather than ECharts' generic
 * `calendar` coordinate system. Consumes pre-computed HeatmapData from the
 * host. Only rendered when there is at least one non-zero day.
 */
import { UsageSnapshot } from '../../extension-backend/domain/types';
import { formatCredits } from '../../extension-backend/domain/format';

export interface HeatmapHandle {
  update(snapshot: UsageSnapshot): void;
  resize(): void;
  reinit(): void;
}

const WEEKDAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const BUCKET_COUNT = 4; // non-zero intensity levels, plus a 0 = "no activity" bucket

function bucketOf(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  const ratio = value / max;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

/** Parses a "YYYY-MM-DD" cell date as a LOCAL calendar date (not UTC) —
 *  the same local-date convention buildHeatmapData now uses when labeling
 *  cells, so weekday/month derived here always match the label. */
function parseLocalDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00`);
}

class HeatmapGrid implements HeatmapHandle {
  private readonly el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
  }

  update(s: UsageSnapshot): void {
    const { cells, max } = s.chartData.heatmap;
    if (max <= 0 || cells.length === 0) {
      this.el.innerHTML = '';
      this.el.style.display = 'none';
      return;
    }
    this.el.style.display = '';
    this.render(cells, max);
  }

  resize(): void {}
  /** Colors are plain CSS var() references, so a theme change repaints
   *  automatically via the cascade — no re-render needed. */
  reinit(): void {}

  private render(cells: ReadonlyArray<{ date: string; value: number }>, max: number): void {
    const first = parseLocalDate(cells[0]!.date);
    const firstWeekday = first.getDay(); // 0 = Sunday
    const columns = Math.ceil((firstWeekday + cells.length) / 7);

    const grid = document.createElement('div');
    grid.className = 'wv-heatmap-grid';
    grid.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
    grid.style.gridTemplateRows = 'repeat(7, 1fr)';

    const monthRow = document.createElement('div');
    monthRow.className = 'wv-heatmap-months';
    monthRow.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
    let lastMonth = -1;

    cells.forEach((c, i) => {
      const pos = firstWeekday + i;
      const col = Math.floor(pos / 7);
      const row = (pos % 7) + 1;
      const date = parseLocalDate(c.date);

      if (date.getMonth() !== lastMonth) {
        lastMonth = date.getMonth();
        const label = document.createElement('span');
        label.className = 'wv-heatmap-month-label';
        label.style.gridColumnStart = String(col + 1);
        label.textContent = MONTH_NAMES[lastMonth] ?? '';
        monthRow.appendChild(label);
      }

      const cell = document.createElement('div');
      const bucket = bucketOf(c.value, max);
      cell.className = `wv-heatmap-cell wv-heatmap-cell--${bucket}`;
      cell.style.gridColumnStart = String(col + 1);
      cell.style.gridRowStart = String(row);
      cell.title = `${c.date}: ${formatCredits(c.value)} cr`;
      grid.appendChild(cell);
    });

    const weekdayLabels = document.createElement('div');
    weekdayLabels.className = 'wv-heatmap-weekday-labels';
    for (const label of WEEKDAY_LABELS) {
      const span = document.createElement('span');
      span.textContent = label;
      weekdayLabels.appendChild(span);
    }

    const body = document.createElement('div');
    body.className = 'wv-heatmap-body';
    body.appendChild(weekdayLabels);
    body.appendChild(grid);

    const scroll = document.createElement('div');
    scroll.className = 'wv-heatmap-scroll';
    scroll.appendChild(monthRow);
    scroll.appendChild(body);

    const legend = document.createElement('div');
    legend.className = 'wv-heatmap-legend';
    const lessLabel = document.createElement('span');
    lessLabel.textContent = 'Less';
    legend.appendChild(lessLabel);
    for (let b = 0; b <= BUCKET_COUNT; b++) {
      const swatch = document.createElement('i');
      swatch.className = `wv-heatmap-cell wv-heatmap-cell--${b} wv-heatmap-legend-swatch`;
      legend.appendChild(swatch);
    }
    const moreLabel = document.createElement('span');
    moreLabel.textContent = 'More';
    legend.appendChild(moreLabel);

    this.el.innerHTML = '';
    this.el.classList.add('wv-heatmap');
    this.el.appendChild(scroll);
    this.el.appendChild(legend);
  }
}

export function mountHeatmap(el: HTMLElement): HeatmapHandle {
  return new HeatmapGrid(el);
}
