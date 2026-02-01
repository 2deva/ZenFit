import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 5173,
      proxy: {
        '/api': 'http://localhost:3001',
      },
    },
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.SUPABASE_URL': JSON.stringify(env.VITE_SUPABASE_URL),
      'process.env.SUPABASE_ANON_KEY': JSON.stringify(env.VITE_SUPABASE_ANON_KEY),
      // Opik tracing (workspace default: zenfit)
      'process.env.OPIK_API_KEY': JSON.stringify(env.VITE_OPIK_API_KEY || env.OPIK_API_KEY || ''),
      'process.env.OPIK_PROJECT_NAME': JSON.stringify(env.VITE_OPIK_PROJECT_NAME || env.OPIK_PROJECT_NAME || 'zenfit'),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});
