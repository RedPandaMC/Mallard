/**
 * Minimal vscode stub for unit tests.
 * Registered via mocharc `require` before any spec files load.
 * This allows importing VS Code extension files that transitively require('vscode').
 */
'use strict';

const Module = require('module');
const originalResolve = Module._resolveFilename;

// Intercept require.resolve('vscode') before Node throws "Cannot find module"
Module._resolveFilename = function (request, ...args) {
  if (request === 'vscode') return '__vscode_stub__';
  return originalResolve.call(this, request, ...args);
};

// Register the stub in the require cache under the fake resolved name
require.cache['__vscode_stub__'] = {
  id: '__vscode_stub__',
  filename: '__vscode_stub__',
  loaded: true,
  parent: null,
  children: [],
  paths: [],
  exports: {
    extensions: { getExtension: () => undefined },
    env: { machineId: 'test-machine-id' },
    authentication: {
      getSession: () => Promise.resolve(undefined),
      onDidChangeSessions: () => ({ dispose() {} }),
    },
    workspace: {
      workspaceFolders: undefined,
      getWorkspaceFolder: () => undefined,
      asRelativePath: (s) => (typeof s === 'string' ? s : s.fsPath ?? ''),
      // Tests override this per-case; the default answers every get() with
      // the provided fallback and accepts updates as no-ops.
      getConfiguration: () => ({
        get: (_key, fallback) => fallback,
        update: () => Promise.resolve(),
      }),
    },
    window: {
      activeTextEditor: undefined,
      showWarningMessage: () => Promise.resolve(undefined),
      showInformationMessage: () => Promise.resolve(undefined),
      showInputBox: () => Promise.resolve(undefined),
      showQuickPick: () => Promise.resolve(undefined),
    },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    Uri: {
      file: (p) => ({ fsPath: p, toString: () => `file://${p}` }),
      parse: (s) => ({ fsPath: s, toString: () => s }),
    },
    EventEmitter: class {
      constructor() { this._listeners = []; }
      get event() {
        return (listener) => ({ dispose: () => { this._listeners = this._listeners.filter(l => l !== listener); } });
      }
      fire(data) { for (const l of this._listeners) l(data); }
      dispose() { this._listeners = []; }
    },
  },
};
