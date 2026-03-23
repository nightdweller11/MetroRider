import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 3000,
    open: true,
    proxy: {
      '/api/metrodreamin': {
        target: 'https://metrodreamin.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/metrodreamin/, ''),
      },
    },
  },
});
