import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const version = process.env.APP_VERSION || pkg.version;

/**
 * Emits sw.js with a precache list of every built file, so the web (PWA)
 * version works fully offline after the first visit. The Android app does
 * not register it: there everything is already bundled inside the APK.
 */
function serviceWorker(): Plugin {
  return {
    name: 'logbook-sw',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map') && f !== 'index.html');
      const extra = ['manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png'];
      const assets = ['./', ...files.map((f) => './' + f), ...extra.map((f) => './' + f)];
      const source = readFileSync(new URL('./src/sw-template.js', import.meta.url), 'utf8')
        .replace('__ASSETS__', JSON.stringify(assets))
        .replace('__VERSION__', JSON.stringify(`${version}-${Date.now().toString(36)}`));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig(({ mode }) => {
  const demo = mode === 'demo';
  return {
    base: './',
    plugins: [react(), demo ? viteSingleFile() : serviceWorker()],
    define: {
      __APP_VERSION__: JSON.stringify(version),
    },
    build: {
      outDir: demo ? 'dist-demo' : 'dist',
      target: 'es2020',
      assetsInlineLimit: demo ? 100_000_000 : 4096,
      cssCodeSplit: !demo,
      reportCompressedSize: false,
    },
  };
});
