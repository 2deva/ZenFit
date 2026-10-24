import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, strictPort: true, proxy: { '/api/evaluation': process.env.EVALUATION_API_TARGET || 'http://127.0.0.1:3002' } },
  build: { outDir: 'dist-evaluation', rollupOptions: { input: 'evaluation.html' } },
});
