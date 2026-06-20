import esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const hostConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  // DuckDB ships a native (N-API) binding that cannot be bundled; load it from
  // node_modules at runtime. N-API is ABI-stable across Node and Electron.
  external: ['vscode', '@duckdb/node-api'],
  outfile: 'dist/extension.js',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const webviewConfig = {
  entryPoints: ['webview/main.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  outfile: 'dist/webview/main.js',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
  loader: { '.css': 'css', '.ttf': 'file', '.woff': 'file', '.woff2': 'file' },
};

async function main() {
  if (watch) {
    const ctxHost = await esbuild.context(hostConfig);
    const ctxWeb = await esbuild.context(webviewConfig);
    await Promise.all([ctxHost.watch(), ctxWeb.watch()]);
    console.log('[mallard] watching host + webview bundles...');
  } else {
    await Promise.all([
      esbuild.build(hostConfig),
      esbuild.build(webviewConfig),
    ]);
    console.log('[mallard] build complete.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
