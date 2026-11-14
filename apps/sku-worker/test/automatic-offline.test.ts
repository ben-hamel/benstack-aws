import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { offlineAutomaticDatabase } from "../src/automatic-config.ts";

const cli = fileURLToPath(new URL("../automatic/cli.ts", import.meta.url));
const env = { PATH: process.env.PATH, HOME: process.env.HOME };

test("automatic executable is disabled by default even with ambient live settings", () => {
  const child = spawnSync("bun", ["--no-env-file", cli], { env: { ...env, DATABASE_URL: "postgresql://secret@production.invalid/app", PRODUCT_RESEARCH_ADMISSION_ENABLED: "true", OPENAI_API_KEY: "must-not-use", SKU_WORKER_STATE_DIR: "/must-not-read-auth" }, encoding: "utf8" });
  assert.equal(child.status, 0); assert.match(child.stdout, /disabled by default/);
  assert.match(child.stdout, /No database or provider accessed/); assert.doesNotMatch(child.stdout + child.stderr, /must-not-use|secret@/);
});

test("automatic CLI rejects live flags and never falls back to app DATABASE_URL", () => {
  const live = spawnSync("bun", ["--no-env-file", cli, "--allow-live"], { env, encoding: "utf8" });
  assert.equal(live.status, 1);
  const appOnly = spawnSync("bun", ["--no-env-file", cli, "--enabled", "--organization", "fixture"], { env: { ...env, DATABASE_URL: "postgresql://secret@production.invalid/app" }, encoding: "utf8" });
  assert.equal(appOnly.status, 1); assert.match(appOnly.stderr, /RECEIPT_IMPORT_TEST_DATABASE_URL/);
  assert.doesNotMatch(appOnly.stderr, /secret@/);
});

test("offline automatic database guard rejects app, Neon and connection override URLs", () => {
  assert.match(offlineAutomaticDatabase("postgresql://fixture:fixture@127.0.0.1:55432/receipt_import_test_auto"), /55432/);
  for (const value of [undefined, "", "postgresql://fixture@localhost/benstack-aws", "postgresql://fixture@ep-dev.neon.tech/receipt_import_test", "postgresql://fixture@localhost/receipt_import_test?host=production.invalid", "postgresql://fixture@localhost/receipt_import_test?database=app", "postgresql://fixture@localhost/receipt_import_test-not-disposable", "http://localhost/receipt_import_test", "postgresql://fixture@localhost/receipt_import_test#override"]) {
    assert.throws(() => offlineAutomaticDatabase(value));
  }
});
