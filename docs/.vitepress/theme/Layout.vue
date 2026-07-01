<script setup lang="ts">
import DefaultTheme from 'vitepress/theme';

const { Layout } = DefaultTheme;
</script>

<template>
  <Layout>
    <!-- Instrument readout strip above the hero -->
    <template #home-hero-before>
      <div class="wv-catalogue">
        <span class="wv-tick">●</span>
        COPILOT SPEND · INSTRUMENT · <em>v0.2 · local-first</em>
      </div>
    </template>

    <!-- Footnote under the feature plates -->
    <template #home-features-after>
      <p class="wv-plate-note">
        Reads only the OTel logs Copilot already writes to your machine. No
        sign-in, and no network calls for your usage data.
      </p>
    </template>
  </Layout>
</template>
