// Offline UI check build: esbuild bundle of src/main.jsx using locally available React.
// Used only because Vite cannot be installed in the sandbox. Output: .check/
import { build } from '/opt/npm-tools/node_modules/esbuild/lib/main.js';
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('.check', { recursive: true });
await build({
  entryPoints: ['src/main.jsx'],
  bundle: true,
  outfile: '.check/bundle.js',
  format: 'esm',
  jsx: 'automatic',
  nodePaths: ['/opt/npm-tools/node_modules'],
  define: { 'process.env.NODE_ENV': '"development"' },
  logLevel: 'warning',
});
writeFileSync('.check/index.html', `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>check</title><link rel="stylesheet" href="bundle.css"></head><body style="margin:0"><div id="root"></div><script type="module" src="bundle.js"></script></body></html>`);
console.log('bundled .check/');
