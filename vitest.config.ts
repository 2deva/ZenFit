import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    exclude: ['node_modules/**', 'e2e/**', 'tools/opik-mcp/**', 'dist*/**'],
    setupFiles: ['./__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html', 'lcov'],
      include: ['services/**/*.{ts,tsx}', 'hooks/**/*.{ts,tsx}', 'utils/**/*.ts', 'api/**/*.ts', 'components/**/*.{ts,tsx}', 'contexts/**/*.{ts,tsx}', 'supabaseConfig.ts', 'firebaseConfig.ts'],
      exclude: ['**/__tests__/**', '**/*.d.ts'],
      // Global figures include untested source; higher gates protect the tested core.
      thresholds: {
        lines: 50, functions: 50, branches: 38, statements: 50,
        'services/sessionGeneratorService.ts': { lines: 50, functions: 50, statements: 50 },
        'services/guidance/**': { lines: 85, functions: 90, branches: 75, statements: 85 },
        'services/guidanceScheduler.ts': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'utils/validation.ts': { lines: 90, functions: 100, branches: 90, statements: 90 },
      },
    },
  },
  resolve: { alias: { '@': path.resolve(import.meta.dirname, '.') } },
});
