import { defineConfig } from 'vitepress';

// NOTE: these URLs assume the GitHub repo has been renamed to "Mallard"
// (Pages then serves the site at /Mallard/). The rename happens right after
// this lands on main; until then the published docs link may 404 briefly.
const site = 'https://redpandamc.github.io/Mallard';
const ogImage = `${site}/brand/og-dark.png`;
const desc = "Mallard reads Copilot's local usage logs and shows a live dashboard of spend, model usage, and where every credit goes. No sign-in, no telemetry.";

export default defineConfig({
  title: 'Mallard',
  description: desc,
  base: '/Mallard/',

  appearance: true,
  cleanUrls: true,

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/Mallard/favicon.svg' }],
    ['link', { rel: 'alternate icon', href: '/Mallard/favicon.ico', sizes: 'any' }],
    ['meta', { name: 'theme-color', content: '#E5231B' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'Mallard — Copilot spend tracker' }],
    ['meta', { property: 'og:site_name', content: 'Mallard' }],
    ['meta', { property: 'og:url', content: `${site}/` }],
    ['meta', { property: 'og:description', content: desc }],
    ['meta', { property: 'og:image', content: ogImage }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: 'Mallard — Copilot spend tracker' }],
    ['meta', { name: 'twitter:description', content: desc }],
    ['meta', { name: 'twitter:image', content: ogImage }],
  ],

  themeConfig: {
    logo: '/icon.svg',
    siteTitle: 'MALLARD',

    nav: [
      { text: 'Features',        link: '/guide/features' },
      { text: 'Getting Started', link: '/guide/getting-started' },
      { text: 'Configuration',   link: '/guide/configuration' },
      { text: 'Self-hosted',     link: '/guide/self-hosting' },
      { text: 'Troubleshooting', link: '/guide/troubleshooting' },
      {
        text: 'Reference',
        items: [
          { text: 'Commands', link: '/reference/commands' },
          { text: 'Settings', link: '/reference/settings' },
        ],
      },
      { text: 'Changelog', link: '/changelog' },
    ],

    docFooter: {
      prev: '← Previous',
      next: 'Next →',
    },

    socialLinks: [{ icon: 'github', link: 'https://github.com/RedPandaMC/Mallard' }],

    footer: {
      message: 'Mallard · v2.0 — Built for VS Code · MIT License',
      copyright: 'Copyright © 2025 RedPandaMC',
    },
  },
});
