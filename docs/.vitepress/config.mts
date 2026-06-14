import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Weevil',
  description: 'Know exactly what GitHub Copilot is costing you.',
  // Must match the repository name's case: GitHub Pages serves this project
  // site at /Weevil/, and asset URLs are case-sensitive.
  base: '/Weevil/',

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/Weevil/favicon.svg' }],
    ['meta', { name: 'theme-color', content: '#818CF8' }],
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
      message: 'MIT License',
      copyright: 'Copyright © 2025 RedPandaMC',
    },
  },
});
