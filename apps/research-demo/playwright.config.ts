import { defineConfig } from "@playwright/test";
import { cleanDemoEnvironment } from "./src/start";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Optional user-local shared libraries for minimal Fedora hosts. These are used
// only by the test browser, never by the demo/API process or normal app runtime.
const browserEnv = cleanDemoEnvironment(process.env);
const libraries = process.env.RESEARCH_DEMO_BROWSER_LIB_DIR ?? join(homedir(), ".cache/benstack-browser-libs/root/usr/lib64");
if (existsSync(libraries)) browserEnv.LD_LIBRARY_PATH = libraries;
const fontConfig = join(homedir(), ".cache/benstack-browser-libs/fonts.conf");
if (existsSync(fontConfig)) browserEnv.FONTCONFIG_FILE = fontConfig;

export default defineConfig({
  testDir: "test/browser", fullyParallel: false, workers: 1, timeout: 60_000,
  expect: { timeout: 20_000 }, reporter: "list", outputDir: "test-results",
  use: { baseURL: "http://127.0.0.1:4175", browserName: "chromium", headless: true,
    launchOptions: { env: browserEnv },
    trace: "retain-on-failure", screenshot: "only-on-failure", viewport: { width: 1280, height: 900 },
  },
  webServer: { command: "bun --no-env-file src/start.ts --port 4175", url: "http://127.0.0.1:4175/api/demo/info",
    reuseExistingServer: false, timeout: 120_000, stdout: "pipe", stderr: "pipe" },
});
