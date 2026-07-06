/**
 * jsdom + echarts stub setup for frontend unit tests.
 * Loaded BEFORE vscode-mock.cjs so DOM globals exist when frontend modules import.
 */
'use strict';

const Module = require('module');
const { JSDOM } = require('jsdom');

// ── jsdom globals ───────────────────────────────────────────────────────────
const dom = new JSDOM('<!DOCTYPE html><html><head></head><body class="vscode-dark"></body></html>', {
  pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Element = dom.window.Element;
globalThis.Node = dom.window.Node;
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
// jsdom doesn't implement matchMedia; stub it so prefers-reduced-motion/
// prefers-color-scheme checks in frontend code don't throw under test.
const matchMediaStub = (query) => ({
  matches: false,
  media: query,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent() { return false; },
});
globalThis.matchMedia = matchMediaStub;
dom.window.matchMedia = matchMediaStub;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.Event = dom.window.Event;
globalThis.DOMParser = dom.window.DOMParser;

// ── VS Code webview API stub ────────────────────────────────────────────────
// Frontend modules call acquireVsCodeApi() at import time; provide a stub
// whose postMessage captures messages for assertions.
globalThis.__postedMessages = [];
globalThis.acquireVsCodeApi = () => ({
  postMessage(msg) { globalThis.__postedMessages.push(msg); },
});

// ── echarts stub ────────────────────────────────────────────────────────────
// The real echarts needs canvas rendering; in jsdom we stub it so chart tests
// capture the EChartsOption passed to setOption() instead of rendering pixels.
const echartsStub = {
  init: (_el, _theme, _opts) => ({
    setOption(option, _opts2) {
      this._lastOption = option;
      // Execute tooltip/axisLabel formatters so their code is covered.
      // ECharts would call these during rendering; the stub simulates that
      // by invoking them with mock params.
      const tryFmt = (fn, ...args) => { try { fn(...args); } catch { /* mock params may cause throws */ } };
      try {
        const fmt = option?.tooltip?.formatter;
        if (typeof fmt === 'function') {
          // Pass both array and object shapes — each in its own try/catch so
          // one throwing doesn't prevent the others from executing.
          tryFmt(fmt, [{ dataIndex: 0, name: 'test', value: 10, seriesIndex: 0 }], 'item');
          tryFmt(fmt, { dataType: 'edge', name: 'test', value: 10, data: { source: 'a', target: 'b', value: 10 } }, 'item');
          tryFmt(fmt, { name: 'test', value: 10, percent: 50, dataIndex: 0 }, 'item');
          tryFmt(fmt, { value: ['2026-01-01', 10] }, 'item');
        }
        // Series label formatters
        for (const s of option?.series ?? []) {
          if (typeof s?.label?.formatter === 'function') tryFmt(s.label.formatter, { name: 'x', value: 1 });
          if (typeof s?.labelLine?.formatter === 'function') tryFmt(s.labelLine.formatter, { name: 'x' });
        }
        // AxisLabel formatters + color callbacks
        for (const ax of [option?.xAxis, option?.yAxis].flat()) {
          if (typeof ax?.axisLabel?.formatter === 'function') tryFmt(ax.axisLabel.formatter, 'test', 0);
          if (typeof ax?.axisLabel?.color === 'function') tryFmt(ax.axisLabel.color, 'test', 0);
        }
      } catch { /* formatters may throw on mock data — that's fine */ }
    },
    clear() { this._lastOption = null; },
    resize() {},
    dispose() {},
    on(event, cb) {
      // Fire click callbacks immediately with mock params so chart event
      // handlers (e.g. modelBreakdown onModelClick) execute during tests.
      if (event === 'click' && typeof cb === 'function') {
        try { cb({ name: 'gpt-4o' }); } catch { /* mock params */ }
      }
    },
    off() {},
    _lastOption: null,
  }),
  use() {},
  registerTheme() {},
  connect() {},
  disconnect() {},
  dispose() {},
};

// Intercept echarts module resolution so frontend imports get the stub.
const originalResolve = Module._resolveFilename;
const echartsModules = new Set([
  'echarts/core', 'echarts/charts', 'echarts/components', 'echarts/renderers', 'echarts',
]);
Module._resolveFilename = function (request, ...args) {
  if (echartsModules.has(request)) return '__echarts_stub__';
  return originalResolve.call(this, request, ...args);
};

require.cache['__echarts_stub__'] = {
  id: '__echarts_stub__',
  filename: '__echarts_stub__',
  loaded: true,
  parent: null,
  children: [],
  paths: [],
  exports: echartsStub,
};

// Re-export the stub for charts/components/renderers sub-packages.
for (const sub of ['echarts/charts', 'echarts/components', 'echarts/renderers']) {
  require.cache[`__echarts_${sub.replace(/\//g, '_')}__`] = {
    id: `__echarts_${sub.replace(/\//g, '_')}__`,
    filename: `__echarts_${sub.replace(/\//g, '_')}__`,
    loaded: true,
    parent: null,
    children: [],
    paths: [],
    // Each sub-export is a set of no-op objects keyed by their export name.
    exports: new Proxy({}, { get: () => ({}) }),
  };
}

// Fix the echartsModules set to resolve sub-packages to their own cache entries.
Module._resolveFilename = function (request, ...args) {
  if (request === 'echarts/core' || request === 'echarts') return '__echarts_stub__';
  if (request === 'echarts/charts') return '__echarts_echarts_charts__';
  if (request === 'echarts/components') return '__echarts_echarts_components__';
  if (request === 'echarts/renderers') return '__echarts_echarts_renderers__';
  return originalResolve.call(this, request, ...args);
};
