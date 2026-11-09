import { defineConfig } from 'vite';

// base './' so the same build works on GitHub Pages (sub-path) and inside the Android app.
export default defineConfig({
  base: './',
  build: { target: 'es2022', outDir: 'dist', assetsInlineLimit: 0, chunkSizeWarningLimit: 2000 },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  server: { port: 5173, strictPort: true },
});
