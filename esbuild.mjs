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
  external: ['vscode', 'better-sqlite3'],
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
  loader: { '.css': 'css' },
};

async function main() {
  if (watch) {
    const ctxHost = await esbuild.context(hostConfig);
    const ctxWeb = await esbuild.context(webviewConfig);
    await Promise.all([ctxHost.watch(), ctxWeb.watch()]);
    console.log('[weevil] watching host + webview bundles...');
  } else {
    await Promise.all([esbuild.build(hostConfig), esbuild.build(webviewConfig)]);
    console.log('[weevil] build complete.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
