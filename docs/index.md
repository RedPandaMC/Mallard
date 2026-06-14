---
layout: home

hero:
  name: Weevil
  text: Know exactly what GitHub Copilot is costing you.
  image:
    src: /logo.svg
    alt: Weevil
  tagline: A field guide to your Copilot spend — parsed from local OTel logs into a live dashboard of cost, model usage, and where it all goes. No sign-in required for the core features.
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
