import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../apps/web/', import.meta.url));
const result = await build({
  configFile: false,
  root,
  base: './',
  mode: 'offline',
  plugins: [react()],
  resolve: {
    alias: {
      'node:crypto': fileURLToPath(new URL('../apps/web/src/preview/crypto.ts', import.meta.url)),
    },
  },
  build: {
    write: false,
    modulePreload: false,
    cssCodeSplit: false,
    rollupOptions: { input: `${root}/preview.html`, output: { inlineDynamicImports: true } },
  },
});
const output = (Array.isArray(result) ? result[0] : result).output;
const htmlAsset = output.find((item) => item.type === 'asset' && item.fileName.endsWith('.html'));
const script = output.find((item) => item.type === 'chunk');
const css = output.find((item) => item.type === 'asset' && item.fileName.endsWith('.css'));
if (!htmlAsset || !script || !css) throw new Error('Missing preview build output');
if (script.imports.length || script.dynamicImports.length)
  throw new Error('Preview must be self-contained');
let html = String(htmlAsset.source);
html = html.replace(
  /<script\b[^>]*src="[^"]+"[^>]*><\/script>/,
  () => `<script type="module">${script.code.replace(/<\/script/gi, '<\\/script')}</script>`,
);
html = html.replace(/<link\b[^>]*rel="stylesheet"[^>]*>/, () => `<style>${css.source}</style>`);
const artifact = new URL('../artifacts/fx-battler-preview.html', import.meta.url);
await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
await writeFile(artifact, html);
console.log(`Offline preview: ${fileURLToPath(artifact)} (${Buffer.byteLength(html)} bytes)`);
