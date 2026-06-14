import { defineConfig } from 'vitepress';

const site = 'https://redpandamc.github.io/Weevil';
const ogImage = `${site}/brand/og-dark.png`;

export default defineConfig({
  title: 'Weevil',
  description: 'Know exactly what GitHub Copilot is costing you.',
  // Must match the repository name's case: GitHub Pages serves this project
  // site at /Weevil/, and asset URLs are case-sensitive.
  base: '/Weevil/',

  // Dark "darkroom" by default; the appearance toggle still offers light "paper".
  appearance: 'dark',
  cleanUrls: true,

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/Weevil/favicon.svg' }],
    ['link', { rel: 'alternate icon', href: '/Weevil/favicon.ico', sizes: 'any' }],
    ['meta', { name: 'theme-color', content: '#B45CFF' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'Weevil' }],
    ['meta', { property: 'og:site_name', content: 'Weevil' }],
    ['meta', { property: 'og:url', content: `${site}/` }],
    ['meta', { property: 'og:description', content: 'Know exactly what GitHub Copilot is costing you.' }],
    ['meta', { property: 'og:image', content: ogImage }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: 'Weevil' }],
    ['meta', { name: 'twitter:description', content: 'Know exactly what GitHub Copilot is costing you.' }],
    ['meta', { name: 'twitter:image', content: ogImage }],
  ],

  themeConfig: {
    logo: '/logo.svg',
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
      message: 'Copilot spend · instrument — local-first · MIT License',
      copyright: 'Copyright © 2025 RedPandaMC',
    },
  },
});
