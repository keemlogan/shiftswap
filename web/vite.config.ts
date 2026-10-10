import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The static site is written to system/ at the repository root and served from a sub-path
// (https://keemlogan.github.io/shiftswap/system/), so every asset URL is relative.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: '../system',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: { react: ['react', 'react-dom', 'react-router-dom'], supabase: ['@supabase/supabase-js'] },
      },
    },
  },
});
