---
layout: home

hero:
  name: Weevil
  text: Know exactly what GitHub Copilot is costing you.
  image:
    src: /logo.svg
    alt: Weevil
  tagline: Weevil parses Copilot's local OTel logs and shows a live dashboard of spend, model usage, and where it goes. No sign-in required for the core features.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/RedPandaMC/weevil

features:
  - title: Live dashboard
    details: A 30-day bar chart, model breakdown, spend by cost type, and a model-to-surface flow, all computed on the host and updated within seconds of new log entries.
  - title: Simple alerts
    details: Set a monthly budget, a daily credit threshold, and a spending-velocity alert in the dashboard. No JSON rule schemas.
  - title: Automatic pricing
    details: Credit multipliers are bundled and refreshed daily from the repo, so pricing changes never require a settings change.
  - title: Stays local
    details: Reads only the log files Copilot already writes to your machine. No network requests for your usage data. GitHub billing reconciliation is optional.
---
