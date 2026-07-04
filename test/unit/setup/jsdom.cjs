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
    setOption(option, _opts2) { this._lastOption = option; },
    clear() { this._lastOption = null; },
    resize() {},
    dispose() {},
    on() {},
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
