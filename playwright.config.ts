import { defineConfig, devices } from "@playwright/test";

const port = 5173;

// Browser tests run against the Vite dev server, which also serves the dev
// variant of the QOJ userscript. Live-network tests are tagged @live and only
// run with `--grep @live`.
export default defineConfig({
  testDir: "tests/e2e",
  grepInvert: process.env.E2E_LIVE ? undefined : /@live/,
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: `npm run dev --prefix web -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
