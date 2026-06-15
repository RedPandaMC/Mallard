# Weevil — Design Spec (for design review)

A working inventory of **graph types** and **UI components** across Weevil's two
surfaces, written to brief a design specialist. It deliberately describes
*function and data*, not implementation, so a stylistic direction can be layered
on top cleanly.

Weevil is a VS Code extension that reads GitHub Copilot's local usage logs and
shows what you're spending. Two surfaces:

1. **Dashboard** — a webview rendered inside VS Code (editor tab + sidebar).
2. **Docs site** — a VitePress static site (GitHub Pages).

## The one hard constraint

The **dashboard chrome** (page background, cards, body text, borders) must take
its colors from the user's active **VS Code theme** so it looks native in any
theme, light or dark. Self-contained "display" elements (e.g. a black readout
panel) may break from the theme, but the surrounding shell may not. The **docs
site** has no such constraint — it is free-standing.

Current chosen direction (open to the specialist's refinement): a *Teenage
Engineering OP-1/OP-Z instrument* language — black readout "screens", flat
saturated primary colors, large numeric readouts, color-coded parameters, and
simple geometric pictograms.

---

## 1. Graph / data-visualisation types

All six already exist and are theme-driven. Each is computed on the host; the
view only renders. Listed by **data shape** so a designer can reason about them.

| # | Name | Chart type | Data it shows | Notable needs |
|---|------|-----------|---------------|---------------|
| G1 | Daily usage | **Vertical bar** + 2 horizontal **threshold lines** | 30 days of spend; a *budget* line and a *projected-pace* line overlaid | bars color-coded by state; two distinct line styles; hover tooltip |
| G2 | Activity | **Calendar heatmap** (12 weeks) | per-day intensity | low→high color ramp; compact cells |
| G3 | Model breakdown | **Ranked horizontal bar** | top models by credits / cost / tokens | switches metric live; value labels on bars |
| G4 | Model → surface flow | **Sankey / flow** | which models feed chat·inline·agent·edit | node + link coloring; only shown with ≥2×2 data |
| G5 | Cost-type split | **Donut / part-to-whole** | input vs output (vs tool/thinking) | legend; % in tooltip |
| G6 | Budget gauge | **Radial / linear progress** | % of included credits used + severity | 3 severity states (ok/warn/over) |

**Candidate future viz (not built — for discussion):**

- **Euclidean dot-ring** — a circular sequence of dots (OP-Z "length/pulses"
  motif) as an alternate form for G6 or a 30-day overview.
- **ADSR-style envelope** — a flat color-segmented area shape as a playful
  "spend shape over the month" graphic.
- **KPI sparklines** — tiny inline trend lines inside the numeric readout cards.
- **Loading / empty / no-data** variants for every graph above.

**Cross-cutting graph concerns for the spec:** a shared **data color palette**
(how many series colors, and their meaning), axis/label typography, gridline
treatment, tooltip style, legend style, and behavior on **light vs dark**.

---

## 2. UI component inventory

Grouped by role. "Current" = exists today. "Needed" = identified gap.

### A. Identity & chrome
- **Header / title block** — product mark, wordmark, one-line descriptor. *Current.*
- **Brand mark / app icon** — square icon (marketplace + favicon + nav). *Current.*
- **Live status indicator** — "tracking / idle" dot. *Current.*

### B. Readouts (display, non-interactive)
- **KPI numeric cards ×4** — large value + label + sub-line + index code
  (today / month-to-date / projected / top model). *Current.*
- **Budget gauge** — see G6. *Current; form under review.*
- **Status / severity badges** — small outlined labels (ok/warn/over). *Current.*
- **Legend dots / chips** — color key for surfaces & series. *Current.*

### C. Controls (interactive)
- **Date-range presets** — segmented control (Today / 7d / 30d / Month / All). *Current.*
- **Metric toggle** — segmented (cost / credits / tokens). *Current.*
- **Repository selector** — dropdown. *Current.*
- **Model filter** — multi-select dropdown. *Current.*
- **Surface chips** — toggle chips with color dots (chat/inline/agent/edit). *Current.*
- **Buttons** — primary (action), secondary, icon-only. *Current.*
- **Edit-mode panel tools** — drag handle, width toggle, hide/show per panel. *Current; light styling.*

### D. Feedback & states
- **Status banner** — single-line state strip. *Current.*
- **Restriction banner** — 3 states (grace / active / override) with actions. *Current; needs design pass.*
- **GitHub billing strip** — sign-in CTA / verified amount / divergence warning. *Current; needs design pass.*
- **Empty state** — "no data yet" with steps + actions. *Current.*
- **Loading / skeleton state** — **Needed.**
- **Error state** (log path not found, parse error) — **Needed (currently text only).**

### E. Forms (budget & alerts config)
- **Number inputs** (budget, included credits, thresholds). *Current; minimal.*
- **Checkboxes / toggles** (enable alerts). *Current; minimal.*
- **Embedded JSON editor** (Monaco) + **live preview** panel. *Current; needs design pass.*

### F. Layout primitives
- **Card / panel** (with header + body). *Current.*
- **Section header** + **divider / ruler**. *Current.*
- **Responsive grid** (KPI grid; 1–2 column chart grid). *Current.*

### G. Docs-site components
- **Hero** (mark, wordmark, tagline, CTA buttons). *Current.*
- **Feature cards** (icon + title + body). *Current.*
- **Color-palette board** (named swatches + hex). *Current.*
- **Top nav / sidebar / footer**. *Current.*
- **Code blocks, tables, callout containers** (tip/warning/danger). *Current; callouts untested in palette.*
- **Content pages** — getting-started, configuration, commands, settings, changelog. *Current; **no screenshots/diagrams yet**.*
- **Social / OG image + favicon**. *Current.*

### Shared assets still needed
- **Marketplace gallery screenshots** (the VS Code store shows 1–5 images). **Needed** — requires running the extension.
- **Short demo loop / GIF**. **Needed.**
- **Diagrams** for the "how it works" docs page. **Needed.**

---

## 3. Style vocabulary already in play (for the specialist to accept / revise)

- **Data palette:** four flat primaries (blue / green / yellow / red) used to
  color-code parameters and series.
- **Action accent:** a single bold "live/primary" color, used sparingly.
- **Status:** ok / warn / over (kept semantic, separate from data palette).
- **Surface + text:** from the VS Code theme on the dashboard; free on docs.
- **Type:** a geometric grotesque for display/numerals; a monospace for labels,
  axis ticks, codes.
- **Recurring motifs:** black readout "screens", channel/index codes (01–04),
  a four-color accent bar, color-coded group chips, registration ticks, and the
  geometric pictograms above (dot-ring, ADSR envelope).

---

## 4. Open questions for the design specialist

1. **Gauge form** — keep a linear/radial progress bar, or move to the dot-ring?
2. **Chart palette** — apply the flat-primary palette to *all* six graphs, or
   keep some theme-native for legibility on light editor themes?
3. **Black "screens" on light themes** — acceptable contrast move (OP-1 white
   body / black display), or should readouts follow the theme?
4. **Density** — the dashboard is data-dense; how much negative space vs. how
   many readouts per view?
5. **Motion** — any animation on live updates / state changes, or fully static?
6. **Iconography** — VS Code's codicon set is used for control icons; should
   data/feature pictograms be a separate bespoke flat set?
