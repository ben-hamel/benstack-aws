import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

test("obsolete retry fails before authentication, network discovery, or opening saved jobs", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "benstack-cli-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [cli, "retry", "old-job", "13"], {
    env: { ...process.env, SKU_WORKER_STATE_DIR: directory }, encoding: "utf8", timeout: 5_000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no longer parks tasks or supports task retry/);
  assert.match(result.stderr, /resume <job-id>/);
  assert.equal(result.stdout, "");
  assert.deepEqual(await readdir(directory), [], "no credentials, locks, or job state should be touched");
});

test("CLI help describes 1.5.0 recovery without advertising removed task retry", () => {
  const result = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8", timeout: 5_000 });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Terminated jobs stay saved/);
  assert.doesNotMatch(result.stdout, /sku retry|unparks/);
});
