/**
 * Generates a standalone, printable HTML usage report from a UsageSnapshot.
 * No external dependencies — inline CSS only.
 */
import * as os from 'os';
import * as path from 'path';
import { formatCredits, formatMoney, formatTokens } from '../model/format';
import { UsageSnapshot } from '../model/types';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function fmtDateShort(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function percent(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function generateDailyTable(s: UsageSnapshot): string {
  const points = s.chartData.dailyBars.points;
  if (points.length === 0) return '<p class="muted">No daily data available.</p>';

  const rows = points.map((p) => {
    const colorClass = p.colorIndex === 2 ? 'over' : p.colorIndex === 1 ? 'warn' : '';
    return `<tr class="${colorClass}"><td>${esc(p.date)}</td><td class="num">${formatCredits(p.credits)}</td><td class="num">${formatMoney(p.cost, s.currency)}</td></tr>`;
  });

  return `
    <table>
      <thead><tr><th>Date</th><th>Credits</th><th>Cost</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>`;
}

function generateModelTable(s: UsageSnapshot): string {
  const { labels, credits, costs } = s.chartData.modelBreakdown;
  if (labels.length === 0) return '<p class="muted">No model data available.</p>';

  const totalCr = credits.reduce((a, b) => a + b, 0);
  const rows = labels.map((label, i) => {
    const cr = credits[i] ?? 0;
    const co = costs[i] ?? 0;
    const pct = totalCr > 0 ? cr / totalCr : 0;
    return `<tr><td>${esc(label)}</td><td class="num">${formatCredits(cr)}</td><td class="num">${formatMoney(co, s.currency)}</td><td class="num">${percent(pct)}</td></tr>`;
  });

  return `
    <table>
      <thead><tr><th>Model</th><th>Credits</th><th>Cost</th><th>Share</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>`;
}

function generateSuggestionsSection(s: UsageSnapshot): string {
  if (s.suggestions.length === 0) return '';

  const rows = s.suggestions.map((sg) =>
    `<tr>
      <td>${esc(sg.currentModel)}</td>
      <td>${esc(sg.suggestedModel)}</td>
      <td>${esc(sg.surface)}</td>
      <td class="num savings">~${formatMoney(sg.estimatedMonthlySaving, s.currency)}/mo</td>
      <td class="muted">${esc(sg.basis)}</td>
    </tr>`,
  );

  return `
    <section>
      <h2>Model Suggestions</h2>
      <p class="muted">Based on your usage patterns, switching these models could reduce costs.</p>
      <table>
        <thead><tr><th>Current Model</th><th>Suggested</th><th>Surface</th><th>Potential Saving</th><th>Basis</th></tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </section>`;
}

function generateGitHubSection(s: UsageSnapshot): string {
  if (!s.githubBilling) return '';

  const { quota, items, totalNetAmount } = s.githubBilling;
  const quotaHtml = quota
    ? `<p><strong>Plan:</strong> ${esc(quota.plan)} &nbsp;|&nbsp; <strong>Entitlement:</strong> ${formatCredits(quota.entitlement)} credits &nbsp;|&nbsp; <strong>Used:</strong> ${formatCredits(quota.used)} credits${quota.resetDate ? ` &nbsp;|&nbsp; <strong>Resets:</strong> ${fmtDate(quota.resetDate)}` : ''}</p>`
    : '';

  const itemRows = items.map((item) =>
    `<tr><td>${esc(item.model)}</td><td>${esc(item.sku)}</td><td class="num">${formatTokens(item.grossQuantity)}</td><td class="num">${formatMoney(item.grossAmount, s.currency)}</td><td class="num">${formatMoney(item.netAmount, s.currency)}</td></tr>`,
  );

  return `
    <section>
      <h2>GitHub Billing (Authoritative)</h2>
      ${quotaHtml}
      <p><strong>Total net charges:</strong> ${formatMoney(totalNetAmount, s.currency)}</p>
      <table>
        <thead><tr><th>Model</th><th>SKU</th><th>Quantity</th><th>Gross</th><th>Net</th></tr></thead>
        <tbody>${itemRows.join('')}</tbody>
      </table>
    </section>`;
}

export function generateReport(s: UsageSnapshot): string {
  const { budget, forecast, today } = s;
  const rangeLabel = `${fmtDateShort(s.range.start)} – ${fmtDateShort(s.range.end)}`;
  const generatedAt = new Date(s.generatedAt).toLocaleString();

  const forecastHtml =
    forecast.basis === 'insufficient-data'
      ? '<span class="muted">Insufficient data</span>'
      : `${formatMoney(forecast.projectedCost, s.currency)} <span class="muted">(${formatMoney(forecast.low, s.currency)}–${formatMoney(forecast.high, s.currency)})</span>`;

  const budgetHtml =
    budget.monthly === null
      ? '<span class="muted">No budget set</span>'
      : `${percent(budget.percentOfBudget)} of ${formatMoney(budget.monthly, s.currency)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Weevil Usage Report — ${esc(rangeLabel)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; line-height: 1.5; color: #1a1a1a; background: #fff; padding: 40px; max-width: 960px; margin: 0 auto; }
  @media print { body { padding: 0; } .no-print { display: none !important; } }
  h1 { font-size: 24px; font-weight: 700; margin-bottom: 4px; }
  h2 { font-size: 16px; font-weight: 600; margin: 32px 0 12px; padding-bottom: 6px; border-bottom: 2px solid #e5e7eb; color: #374151; }
  .subtitle { font-size: 13px; color: #6b7280; margin-bottom: 32px; }
  .kpi-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; margin-bottom: 8px; }
  .kpi { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; }
  .kpi-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280; margin-bottom: 4px; }
  .kpi-value { font-size: 22px; font-weight: 700; color: #111827; font-variant-numeric: tabular-nums; }
  .kpi-sub { font-size: 11px; color: #9ca3af; margin-top: 2px; }
  section { margin-bottom: 32px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; padding: 8px 10px; border-bottom: 2px solid #e5e7eb; }
  td { padding: 7px 10px; border-bottom: 1px solid #f3f4f6; }
  tr:last-child td { border-bottom: none; }
  tr.warn td { background: #fffbeb; }
  tr.over td { background: #fff1f2; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.savings { color: #16a34a; font-weight: 600; }
  .muted { color: #9ca3af; font-size: 12px; }
  .footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #9ca3af; }
</style>
</head>
<body>
<h1>Weevil Usage Report</h1>
<p class="subtitle">Period: ${esc(rangeLabel)} &nbsp;·&nbsp; Generated: ${esc(generatedAt)}</p>

<section>
  <h2>Summary</h2>
  <div class="kpi-grid">
    <div class="kpi">
      <div class="kpi-label">Today</div>
      <div class="kpi-value">${formatMoney(today.cost, s.currency)}</div>
      <div class="kpi-sub">${formatCredits(today.credits)} cr</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Month-to-date</div>
      <div class="kpi-value">${formatMoney(budget.usedCost, s.currency)}</div>
      <div class="kpi-sub">${formatCredits(budget.usedCredits)} cr</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Projected</div>
      <div class="kpi-value">${forecast.basis !== 'insufficient-data' ? formatMoney(forecast.projectedCost, s.currency) : '—'}</div>
      <div class="kpi-sub">${forecastHtml}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Budget</div>
      <div class="kpi-value">${budgetHtml}</div>
      <div class="kpi-sub">Included: ${formatCredits(budget.includedCredits)} cr</div>
    </div>
  </div>
</section>

<section>
  <h2>Daily Usage — Last 30 Days</h2>
  ${generateDailyTable(s)}
</section>

<section>
  <h2>Usage by Model</h2>
  ${generateModelTable(s)}
</section>

${generateGitHubSection(s)}
${generateSuggestionsSection(s)}

<div class="footer">
  Generated by Weevil · ${esc(generatedAt)} · Source: ${esc(s.source)}
</div>
</body>
</html>`;
}

export function defaultReportPath(): string {
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM
  return path.join(os.homedir(), 'Downloads', `weevil-report-${month}.html`);
}
