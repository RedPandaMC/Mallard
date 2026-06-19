import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import './custom.css';
import MallardLanding from './MallardLanding.vue';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('MallardLanding', MallardLanding);
  },
} satisfies Theme;
