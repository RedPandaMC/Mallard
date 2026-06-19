<script setup lang="ts">
const features = [
  ['01', 'Live dashboard', 'A 30-day chart, model breakdown, spend by cost type, and a model→surface flow — computed locally.'],
  ['02', 'Simple alerts', 'Set a monthly budget, daily threshold, and velocity warning from the dashboard. No JSON schemas.'],
  ['03', 'Automatic pricing', 'Credit multipliers ship with the extension and refresh daily — never touch a settings file.'],
  ['04', 'Stays local', 'Reads only the log files Copilot already writes to your machine. No network requests.'],
];
</script>

<template>
  <div class="ml">
    <!-- hero · Swiss grid -->
    <section class="ml-hero">
      <div class="ml-hero-l">
        <div class="ml-eyebrow">
          <span class="ml-num">01</span><span class="ml-rule"></span><span>Copilot spend tracker · VS&nbsp;Code</span>
        </div>
        <h1 class="ml-h1">Get your<br />Copilot spend<br />all in a <span class="ml-red">row</span>.</h1>
        <p class="ml-sub">Mallard reads Copilot's local usage logs and shows a live dashboard of spend, model usage, and where every credit goes. No sign-in, no telemetry.</p>
        <div class="ml-cta">
          <a class="ml-btn ml-btn-primary" href="/guide/getting-started">Get started</a>
          <a class="ml-btn ml-btn-ghost" href="https://github.com/RedPandaMC/Weevil">View on GitHub</a>
        </div>
        <div class="ml-install">
          <span class="ml-install-cmd"><span class="ml-red">$</span> code --install-extension mallard</span>
          <span class="ml-install-copy">copy</span>
        </div>
      </div>
      <div class="ml-hero-r">
        <div class="ml-sum-head"><span>This month</span><span class="ml-red ml-live">● Live</span></div>
        <div class="ml-sum-big">$38.56</div>
        <div class="ml-sum-meta">4,820 credits · 62% of $50 budget</div>
        <div class="ml-bar"><i style="width:50%" class="ml-bar-fg"></i><i style="width:12%" class="ml-bar-acc"></i><i class="ml-bar-rest"></i></div>
        <div class="ml-bar-scale"><span>$0</span><span>budget $50</span></div>
        <div class="ml-rows">
          <div class="ml-row"><span>Today</span><span class="ml-fg">$6.42</span></div>
          <div class="ml-row"><span>Projected</span><span class="ml-red">$61.40</span></div>
          <div class="ml-row ml-row-last"><span>Top model</span><span class="ml-fg">sonnet-4.5</span></div>
        </div>
      </div>
    </section>

    <!-- index · four points -->
    <section class="ml-why">
      <div class="ml-why-head"><span>Why Mallard</span><span>Four points</span></div>
      <div class="ml-why-grid">
        <div v-for="f in features" :key="f[0]" class="ml-card">
          <div class="ml-num">{{ f[0] }}</div>
          <div class="ml-card-t">{{ f[1] }}</div>
          <p class="ml-card-p">{{ f[2] }}</p>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.ml { max-width: 1152px; margin: 0 auto; padding: 0 24px 64px; font-family: var(--vp-font-family-base); }
.ml-num { font-family: var(--vp-font-family-mono); color: var(--ml-accent); font-weight: 600; }
.ml-red { color: var(--ml-accent); }
.ml-fg { color: var(--vp-c-text-1); }

/* hero */
.ml-hero { display: grid; grid-template-columns: 1.35fr 1fr; border: 1px solid var(--ml-line); border-bottom: none; }
.ml-hero-l { padding: 64px 48px; border-right: 1px solid var(--ml-line); }
.ml-hero-r { padding: 64px 48px; display: flex; flex-direction: column; justify-content: center; }
.ml-eyebrow { display: flex; align-items: center; gap: 14px; margin-bottom: 32px; font-family: var(--vp-font-family-mono); font-size: 11.5px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--ml-mut); }
.ml-rule { width: 30px; height: 1px; background: var(--vp-c-text-1); }
.ml-h1 { font-family: var(--ml-display); font-weight: 800; font-size: 72px; line-height: 0.94; letter-spacing: -0.035em; margin: 0; color: var(--vp-c-text-1); }
.ml-sub { font-size: 18px; line-height: 1.55; max-width: 42ch; margin: 28px 0 0; color: var(--ml-mut2); }
.ml-cta { display: flex; margin-top: 34px; }
.ml-btn { font-family: var(--ml-display); font-weight: 700; font-size: 14px; padding: 14px 28px; text-decoration: none; display: inline-flex; align-items: center; }
.ml-btn-primary { background: var(--ml-accent); color: var(--ml-on-accent); }
.ml-btn-ghost { color: var(--vp-c-text-1); border: 1px solid var(--ml-line); border-left: none; }
.ml-install { display: flex; align-items: center; margin-top: 22px; max-width: 420px; border: 1px solid var(--ml-line); }
.ml-install-cmd { flex: 1; font-family: var(--vp-font-family-mono); font-size: 13px; padding: 12px 16px; background: var(--ml-panel2); color: var(--vp-c-text-1); }
.ml-install-copy { font-family: var(--vp-font-family-mono); font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ml-mut); padding: 12px 15px; border-left: 1px solid var(--ml-line); }

/* summary panel */
.ml-sum-head { display: flex; align-items: baseline; justify-content: space-between; font-family: var(--vp-font-family-mono); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ml-mut); border-bottom: 1px solid var(--vp-c-text-1); padding-bottom: 12px; }
.ml-live { font-weight: 600; }
.ml-sum-big { font-family: var(--ml-display); font-weight: 800; font-size: 66px; line-height: 1; letter-spacing: -0.03em; margin: 18px 0 6px; color: var(--vp-c-text-1); }
.ml-sum-meta { font-size: 14px; color: var(--ml-mut2); }
.ml-bar { display: flex; height: 12px; margin-top: 20px; border: 1px solid var(--ml-line); }
.ml-bar-fg { background: var(--vp-c-text-1); }
.ml-bar-acc { background: var(--ml-accent); }
.ml-bar-rest { flex: 1; background: var(--ml-panel2); }
.ml-bar-scale { display: flex; justify-content: space-between; font-family: var(--vp-font-family-mono); font-size: 10px; color: var(--ml-mut); margin-top: 8px; }
.ml-rows { margin-top: 26px; border-top: 1px solid var(--ml-line); }
.ml-row { display: flex; justify-content: space-between; padding: 13px 0; border-bottom: 1px solid var(--ml-line); font-family: var(--vp-font-family-mono); font-size: 12.5px; color: var(--ml-mut); }
.ml-row-last { border-bottom: none; }

/* why */
.ml-why { border: 1px solid var(--ml-line); }
.ml-why-head { display: flex; align-items: baseline; justify-content: space-between; padding: 22px 24px; border-bottom: 1px solid var(--ml-line); font-family: var(--vp-font-family-mono); font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--ml-mut); }
.ml-why-grid { display: grid; grid-template-columns: repeat(4, 1fr); }
.ml-card { padding: 30px 26px; border-right: 1px solid var(--ml-line); }
.ml-card:last-child { border-right: none; }
.ml-card .ml-num { display: block; font-size: 13px; margin-bottom: 18px; }
.ml-card-t { font-family: var(--ml-display); font-weight: 700; font-size: 17px; letter-spacing: -0.01em; margin-bottom: 10px; color: var(--vp-c-text-1); }
.ml-card-p { margin: 0; font-size: 13.5px; line-height: 1.55; color: var(--ml-mut2); }

@media (max-width: 860px) {
  .ml-hero { grid-template-columns: 1fr; }
  .ml-hero-l { border-right: none; border-bottom: 1px solid var(--ml-line); padding: 40px 28px; }
  .ml-hero-r { padding: 40px 28px; }
  .ml-h1 { font-size: 52px; }
  .ml-why-grid { grid-template-columns: 1fr 1fr; }
  .ml-card:nth-child(2) { border-right: none; }
  .ml-card:nth-child(1), .ml-card:nth-child(2) { border-bottom: 1px solid var(--ml-line); }
}
@media (max-width: 520px) {
  .ml-why-grid { grid-template-columns: 1fr; }
  .ml-card { border-right: none; border-bottom: 1px solid var(--ml-line); }
}
</style>
