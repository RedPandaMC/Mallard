import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Weevil',
  description: 'Know exactly what GitHub Copilot is costing you.',
  base: '/weevil/',

  head: [['link', { rel: 'icon', href: '/weevil/favicon.ico' }]],

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

    socialLinks: [{ icon: 'github', link: 'https://github.com/RedPandaMC/weevil' }],

    footer: {
      message: 'MIT License',
      copyright: 'Copyright © 2025 RedPandaMC',
    },
  },
});
