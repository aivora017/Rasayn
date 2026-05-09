// Playwright config for pharmacare-pro desktop pre-pilot smoke gate.
// Browser-mode (chromium) against the vite dev server; the IPC stub
// (e2e/utils/ipc-stub.ts) installs a deterministic in-page handler so
// the React app boots without Tauri.
//
// Tauri-driver upgrade is post-pilot — see e2e/README.md.

import { defineConfig, devices } from "@playwright/test";

const PORT = 1420; // matches vite.config.ts strictPort
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 5_000,
    navigationTimeout: 30_000,
  },
  webServer: {
    // npm/turbo-friendly. The brief mentioned pnpm but the repo is npm.
    command: "npm run dev --workspace=@pharmacare/desktop",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
