import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import "dotenv/config";

// Each Playwright invocation creates a separate private directory.
// Concurrent Playwright processes cannot overwrite each other's tokens.
const authDir = mkdtempSync(path.join(tmpdir(), "constructpro-e2e-auth-"));

process.env.E2E_AUTH_DIR = authDir;

const chromium = devices["Desktop Chrome"];

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,

  workers: process.env.CI ? 1 : undefined,

  reporter: process.env.CI
    ? [["line"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],

  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: process.env.FRONTEND_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "auth-root",
      testMatch: "**/auth.setup.ts",
      grep: /^prepare root authentication$/,
      use: { ...chromium },
    },
    {
      name: "auth-projects",
      testMatch: "**/auth.setup.ts",
      grep: /^prepare projects authentication$/,
      use: { ...chromium },
    },
    {
      name: "auth-quotations",
      testMatch: "**/auth.setup.ts",
      grep: /^prepare quotations authentication$/,
      use: { ...chromium },
    },
    {
      name: "root",
      testMatch: "**/*.spec.ts",
      testIgnore: ["**/projects/**", "**/quotations/**"],
      dependencies: ["auth-root"],
      use: {
        ...chromium,
        storageState: path.join(authDir, "root-admin.json"),
      },
    },
    {
      name: "projects",
      testMatch: "**/projects/*.spec.ts",
      dependencies: ["auth-projects"],
      use: {
        ...chromium,
        storageState: path.join(authDir, "projects-admin.json"),
      },
    },
    {
      name: "quotations",
      testMatch: "**/quotations/*.spec.ts",
      dependencies: ["auth-quotations"],
      use: {
        ...chromium,
        storageState: path.join(authDir, "quotations-admin.json"),
      },
    },
  ],

  globalTeardown: "./e2e/auth.cleanup.ts",
  outputDir: "test-results",
});
