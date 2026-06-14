---
layout: home

hero:
  name: Weevil
  text: Know exactly what GitHub Copilot is costing you.
  image:
    src: /logo.svg
    alt: Weevil
  tagline: A live instrument for your Copilot spend — parsed from local OTel logs into a dashboard of cost, model usage, and where it all goes. No sign-in required for the core features.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/RedPandaMC/Weevil

features:
  - icon:
      src: /brand/codicons/graph.svg
      width: 28
      height: 28
    title: Live dashboard
    details: A 30-day bar chart, model breakdown, spend by cost type, and a model-to-surface flow, all computed on the host and updated within seconds of new log entries.
  - icon:
      src: /brand/codicons/pulse.svg
      width: 28
      height: 28
    title: Simple alerts
    details: Set a monthly budget, a daily credit threshold, and a spending-velocity alert in the dashboard. No JSON rule schemas.
  - icon:
      src: /brand/codicons/beaker.svg
      width: 28
      height: 28
    title: Automatic pricing
    details: Credit multipliers are bundled and refreshed daily from the repo, so pricing changes never require a settings change.
  - icon:
      src: /brand/codicons/shield.svg
      width: 28
      height: 28
    title: Stays local
    details: Reads only the log files Copilot already writes to your machine. No network requests for your usage data. GitHub billing reconciliation is optional.
---

<div class="wv-palette-wrap">

## Instrument palette

<div class="wv-palette">
  <div class="wv-swatch" style="--c:#2f9be8"><span class="wv-swatch-chip"></span><b>Probe</b><code>#2F9BE8</code><small>today</small></div>
  <div class="wv-swatch" style="--c:#4fc23a"><span class="wv-swatch-chip"></span><b>Live</b><code>#4FC23A</code><small>on track</small></div>
  <div class="wv-swatch" style="--c:#ffc400"><span class="wv-swatch-chip"></span><b>Forage</b><code>#FFC400</code><small>month-to-date</small></div>
  <div class="wv-swatch" style="--c:#ff453a"><span class="wv-swatch-chip"></span><b>Bore</b><code>#FF453A</code><small>projected</small></div>
  <div class="wv-swatch" style="--c:#fe5000"><span class="wv-swatch-chip"></span><b>Alert</b><code>#FE5000</code><small>action</small></div>
  <div class="wv-swatch" style="--c:#eceae4"><span class="wv-swatch-chip"></span><b>Signal</b><code>#ECEAE4</code><small>readout</small></div>
</div>

</div>
