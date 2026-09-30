// Build script (esbuild). `npm run build` -> dist/ ; `npm run dev` -> local server on :5173
import * as esbuild from 'esbuild';
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';

const serve = process.argv.includes('--serve');
mkdirSync('dist/assets', { recursive: true });

const opts = {
  entryPoints: ['src/main.tsx'],
  bundle: true,
  minify: !serve,
  sourcemap: serve,
  format: 'esm',
  target: ['es2020'],
  jsx: 'automatic',
  outdir: 'dist/assets',
  entryNames: 'app',
  loader: { '.json': 'json' },
  define: { 'process.env.NODE_ENV': serve ? '"development"' : '"production"' },
  logLevel: 'info',
};

const html = readFileSync('index.html', 'utf8');
writeFileSync('dist/index.html', html);
if (existsSync('public')) for (const f of readdirSync('public')) copyFileSync(`public/${f}`, `dist/${f}`);

if (serve) {
  const ctx = await esbuild.context(opts);
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: 'dist', port: 5173 });
  console.log(`HimUrja dev server: http://localhost:${port}`);
} else {
  await esbuild.build(opts);
  console.log('Build complete -> dist/');
}
