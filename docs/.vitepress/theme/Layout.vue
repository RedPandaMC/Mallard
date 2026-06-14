<script setup lang="ts">
import DefaultTheme from 'vitepress/theme';

const { Layout } = DefaultTheme;
</script>

<template>
  <Layout>
    <!-- Field-guide catalogue line above the hero -->
    <template #home-hero-before>
      <div class="wv-catalogue">
        <span class="wv-tick">＋</span>
        FIELD SPECIMEN · No.001 — <em>Curculionoidea copiloti</em>
        <span class="wv-tick">＋</span>
      </div>
    </template>

    <!-- Specimen footnote under the feature plates -->
    <template #home-features-after>
      <p class="wv-plate-note">
        fig. — Weevil reads only the OTel logs Copilot already writes to your
        machine. No sign-in, and no network calls for your usage data.
      </p>
    </template>
  </Layout>
</template>
