import { defineConfig, devices } from '@playwright/test';

const PW_INTERACTIVE = process.env.PW_INTERACTIVE === '1';
const E2E_TZ = process.env.E2E_TZ ?? 'America/Argentina/Buenos_Aires';


/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// import path from 'path';
// dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * See https://playwright.dev/docs/test-configuration.
 */
const authProjects = [
  { name: 'logged-out', use: { storageState: undefined } },
  { name: 'user-noonboarding', use: { storageState: 'e2e/.auth/user.noonboarding.json' } },
  { name: 'user', use: { storageState: 'e2e/.auth/user.json' } },
  { name: 'organizer', use: { storageState: 'e2e/.auth/organizer.json' } },
  { name: 'admin', use: { storageState: 'e2e/.auth/admin.json' } },
];

const browsers = [
      {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },

    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
];


export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('')`. */
     baseURL: 'http://localhost:3000',
     timezoneId: E2E_TZ,
     locale: 'en-US',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: PW_INTERACTIVE ? 'on' : 'on-first-retry',
    video: PW_INTERACTIVE ? 'on' : 'retain-on-failure',
    screenshot: PW_INTERACTIVE ? 'on' : 'only-on-failure',
    contextOptions: { reducedMotion: 'reduce' },
  },

  /* Configure projects for major browsers */
  projects: authProjects.flatMap((auth) =>
    browsers.map((browser) => ({
      name: `${browser.name} - ${auth.name}`,
      use: { ...browser.use, storageState: auth.use.storageState },
    }))
  ),

  /* Run your local dev server before starting the tests */
   webServer: {
     command: process.env.CI
      ? 'npm run build && npm run start'
      : 'npm run build && npm run start',
     url: 'http://localhost:3000',
     reuseExistingServer: !process.env.CI,
     timeout: 120_000,
     env: {
      TZ: E2E_TZ,
      E2E_TZ,
     },
   },
});
