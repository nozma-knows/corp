import { build } from 'esbuild';
await build({
  entryPoints: ['src/client/app.ts', 'src/client/login.ts'],
  outdir: 'public',
  bundle: true,
  format: 'esm',
  target: 'es2022',
  sourcemap: true,
});
