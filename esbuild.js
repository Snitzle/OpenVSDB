// Bundles the webview front-end assets (which import npm packages like
// Tabulator) into ./dist. The extension host code is compiled separately by
// `tsc`. Run with `--watch` for incremental rebuilds during development.
const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['media/tablePanel.js', 'media/main.js'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  outdir: 'dist',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  logLevel: 'info',
  loader: {
    '.css': 'css',
    '.png': 'dataurl',
    '.svg': 'dataurl',
    '.gif': 'dataurl',
    '.woff': 'dataurl',
    '.woff2': 'dataurl',
    '.ttf': 'dataurl',
  },
};

async function main() {
  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log('[esbuild] watching webview assets...');
  } else {
    await esbuild.build(options);
    console.log('[esbuild] webview assets built.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
