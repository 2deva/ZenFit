import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
  if (typeof localStorage !== 'undefined') localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// jsdom does not implement viewport scrolling.
if (typeof HTMLElement !== 'undefined') HTMLElement.prototype.scrollIntoView = vi.fn();
