import { defineConfig } from 'vitepress';

// NOTE: the GitHub repo is still named "Weevil"; Pages serves the site at
// /Weevil/. After the repo is renamed to "Mallard", flip `base` and the
// absolute URLs below to /Mallard/ in one commit.
const site = 'https://redpandamc.github.io/Weevil';
const ogImage = `${site}/brand/og-dark.png`;
const desc = "Mallard reads Copilot's local usage logs and shows a live dashboard of spend, model usage, and where every credit goes. No sign-in, no telemetry.";

export default defineConfig({
  title: 'Mallard',
  description: desc,
  base: '/Weevil/',

  appearance: true,
  cleanUrls: true,

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/Weevil/favicon.svg' }],
    ['link', { rel: 'alternate icon', href: '/Weevil/favicon.ico', sizes: 'any' }],
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
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Reference', link: '/reference/commands' },
      { text: 'Changelog', link: '/changelog' },
    ],

    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting Started', link: '/guide/getting-started' },
          { text: 'Configuration', link: '/guide/configuration' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Commands', link: '/reference/commands' },
          { text: 'Settings', link: '/reference/settings' },
        ],
      },
      { text: 'Changelog', link: '/changelog' },
    ],

    socialLinks: [{ icon: 'github', link: 'https://github.com/RedPandaMC/Weevil' }],

    footer: {
      message: 'Mallard · v2.0 — Built for VS Code · MIT License',
      copyright: 'Copyright © 2025 RedPandaMC',
    },
  },
});
