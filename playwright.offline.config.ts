import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({
  ...base,
  webServer: undefined,
  testIgnore: [],
  testMatch: '**/offline.spec.ts',
  outputDir: 'test-results/offline',
});
