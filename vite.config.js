import { defineConfig } from 'vite';

// Relative base so the build works on Vercel, GitHub Pages, or any static host.
export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      output: {
        // Split the Three.js runtime into its own chunk so engine code and the
        // (rarely-changing) library cache separately — better first paint and
        // long-term caching as the game code grows.
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
});
