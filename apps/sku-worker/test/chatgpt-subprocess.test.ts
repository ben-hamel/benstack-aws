import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { chatGPTSubprocess } from "../pilot/subprocess.ts";

const claim = () => ({ requestId: randomUUID(), organizationId: "fixture-org", identityId: randomUUID(), sku: "118219", token: randomUUID() });
function result(sku: string) { return { schemaVersion: 1, sku, merchant: "costco", market: "CA", outcome: "unresolved", answerId: 1, model: "faux/faux-1", observedAt: new Date().toISOString(), evidenceStatus: "unresolved", fields: {}, sources: [], flags: ["Faux subprocess fixture; no live research."] }; }

test("automatic ChatGPT CLI defaults off and rejects an unverified endpoint", () => {
  const cli = fileURLToPath(new URL("../automatic/chatgpt.ts", import.meta.url));
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, DATABASE_URL: "postgresql://secret@production.invalid/app?sslmode=require", OPENAI_API_KEY: "must-not-use", PRODUCT_RESEARCH_ADMISSION_ENABLED: "true" };
  const disabled = spawnSync("bun", ["--no-env-file", cli], { env, encoding: "utf8" });
  assert.equal(disabled.status, 0); assert.match(disabled.stdout, /disabled without --allow-live/);
  const wrong = spawnSync("bun", ["--no-env-file", cli, "--allow-live"], { env, encoding: "utf8" });
  assert.equal(wrong.status, 1); assert.match(wrong.stderr, /no database or provider was contacted/);
  assert.doesNotMatch(disabled.stdout + wrong.stderr, /secret@|must-not-use/);
});

test("shared ChatGPT executor passes no DB/API keys and validates saved structured output", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "benstack-chatgpt-subprocess-")); t.after(() => rm(directory, { recursive: true, force: true }));
  const current = claim(), evidence = result(current.sku); let launches = 0;
  const executor = chatGPTSubprocess({ node: "/fixture/node", directory, env: { PATH: "/bin", HOME: "/fixture", DATABASE_URL: "secret", OPENAI_API_KEY: "secret", AWS_PROFILE: "prod", NODE_OPTIONS: "evil" },
    spawnWorker: (command, env) => {
      launches++; assert.equal(command[0], "/fixture/node"); assert.ok(command.includes(current.requestId)); assert.ok(command.includes("--allow-live"));
      assert.deepEqual(env, { PATH: "/bin", HOME: "/fixture", SKU_WORKER_STATE_DIR: directory });
      return { exited: (async () => { const path = join(directory, "pilot-jobs", current.requestId); await mkdir(path, { recursive: true });
        await writeFile(join(path, "result.json"), JSON.stringify({ requestId: current.requestId, organizationId: current.organizationId, result: evidence })); return 0; })(), kill: () => {} };
    } });
  assert.equal(executor.mode, "chatgpt-plan");
  assert.deepEqual(await executor.execute(current, new AbortController().signal), evidence); assert.equal(launches, 1);
});

test("subprocess failure or mismatched export does not launch another process", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "benstack-chatgpt-failed-")); t.after(() => rm(directory, { recursive: true, force: true }));
  let launches = 0; const current = claim();
  const failed = chatGPTSubprocess({ node: "/fixture/node", directory, spawnWorker: () => { launches++; return { exited: Promise.resolve(1), kill: () => {} }; } });
  await assert.rejects(failed.execute(current, new AbortController().signal), /did not complete/); assert.equal(launches, 1);
  const path = join(directory, "pilot-jobs", current.requestId); await mkdir(path, { recursive: true });
  await writeFile(join(path, "result.json"), JSON.stringify({ requestId: current.requestId, organizationId: "foreign-org", result: result(current.sku) }));
  const mismatched = chatGPTSubprocess({ node: "/fixture/node", directory, spawnWorker: () => { launches++; return { exited: Promise.resolve(0), kill: () => {} }; } });
  await assert.rejects(mismatched.execute(current, new AbortController().signal), /identity mismatch/); assert.equal(launches, 2);
});

test("cancellation prevents launch or terminates the single active child", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "benstack-chatgpt-abort-")); t.after(() => rm(directory, { recursive: true, force: true }));
  const controller = new AbortController(); let launches = 0; const kills: string[] = [];
  const executor = chatGPTSubprocess({ node: "/fixture/node", directory, spawnWorker: () => {
    launches++; let resolve!: (code: number | null) => void;
    const exited = new Promise<number | null>((done) => { resolve = done; });
    return { exited, kill: (signal) => { kills.push(signal); resolve(null); } };
  } });
  const running = executor.execute(claim(), controller.signal); controller.abort(); await assert.rejects(running);
  assert.equal(launches, 1); assert.deepEqual(kills, ["SIGTERM"]);
  await assert.rejects(executor.execute(claim(), controller.signal)); assert.equal(launches, 1);
});
