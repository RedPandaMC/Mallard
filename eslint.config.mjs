import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import security from 'eslint-plugin-security';

export default tseslint.config(
  { ignores: ['dist/', 'out/', 'node_modules/', '.vscode-test/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  security.configs.recommended,
  {
    rules: {
      // TypeScript's type system already covers bracket-access injection; too noisy.
      'security/detect-object-injection': 'off',
      // VS Code extensions use variable paths by design; too noisy.
      'security/detect-non-literal-fs-filename': 'off',
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // domain/ is framework-free: pure types and logic, bundleable into the
    // webview. No vscode, no Node builtins, no util/ escapes beyond the pure
    // time/lang helpers.
    files: ['src/extension-backend/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'vscode', message: 'domain/ is framework-free — move vscode-coupled code to app/ or ui/.' },
          ],
          patterns: [
            {
              group: ['node:*', 'fs', 'path', 'os', 'child_process', 'crypto', 'http', 'https', 'net'],
              message: 'domain/ is framework-free — no Node builtins.',
            },
            {
              group: ['**/util/*', '!**/util/time', '!**/util/lang'],
              message: 'domain/ may only use the pure util/time and util/lang helpers.',
            },
          ],
        },
      ],
    },
  },
  {
    // The webview bundle may only reach into the host via pure domain modules
    // and the shared message contract — anything else drags Node/vscode code
    // into the browser bundle.
    files: ['src/extension-frontend/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'vscode', message: 'The webview cannot import vscode.' },
          ],
          patterns: [
            {
              group: [
                '**/extension-backend/app/**',
                '**/extension-backend/store/**',
                '**/extension-backend/ingest/**',
                '**/extension-backend/export/**',
                '**/extension-backend/billing/**',
                '**/extension-backend/pricing/**',
                '**/extension-backend/onboarding/**',
                '**/extension-backend/container',
                '**/extension-backend/config',
                '**/extension-backend/extension',
                '**/extension-backend/ui/*',
                '!**/extension-backend/ui/messaging',
                '**/extension-backend/util/*',
                '!**/extension-backend/util/time',
                '!**/extension-backend/util/lang',
              ],
              message: 'The webview may only import domain modules, ui/messaging, and pure util helpers.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      globals: {
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        globalThis: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
