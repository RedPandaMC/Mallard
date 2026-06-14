import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import '@vscode/codicons/dist/codicon.css';
import './custom.css';
import Layout from './Layout.vue';

export default {
  extends: DefaultTheme,
  Layout,
} satisfies Theme;
