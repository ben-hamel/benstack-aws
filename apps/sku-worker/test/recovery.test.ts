import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { JobDoc, openJob, validateTaskId } from "../src/worker.ts";

// Kill an actual subprocess while a task is running. Unlike graceful close,
// SIGKILL leaves a running task for Durable's restart counter to recover.
async function crashDuringWork(directory: string, blockModel = false) {
  const script = `
    import { createModels } from '@earendil-works/pi-ai/models';
    import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
    import { openJob } from ${JSON.stringify(new URL("../src/worker.ts", import.meta.url).href)};
    globalThis.fetch = async () => { throw Error('Network forbidden'); };
    const faux = fauxProvider();
    const models = createModels(); models.setProvider(faux.provider);
    faux.setResponses(${blockModel} ? [async () => {
      console.log('WORK_STARTED'); return new Promise(() => {});
    }] : [fauxAssistantMessage([fauxToolCall('search_costco', {site:'costco.ca'})], {stopReason:'toolUse'})]);
    const web = {
      search: async () => { console.log('WORK_STARTED'); return new Promise(() => {}); },
      fetchPage: async () => { throw Error('Unexpected fetch'); }, close: async () => {},
    };
    const job = await openJob({directory:${JSON.stringify(directory)}, models, web,
      initial:{sku:'1572430', model:{provider:'faux',modelId:'faux-1'}}});
    // Keep the faux blocked request alive just as an outstanding HTTP call would.
    setInterval(() => {}, 1_000);
    await job.run();
  `;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
      cwd: new URL("..", import.meta.url), stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "", killed = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Offline crash fixture did not reach its blocked task"));
    }, 5_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (!killed && stdout.includes("WORK_STARTED")) { killed = true; child.kill("SIGKILL"); }
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("exit", (_code, signal) => {
      clearTimeout(timer);
      if (killed && signal === "SIGKILL") resolve();
      else reject(new Error(`Offline crash fixture exited unexpectedly: ${stderr}`));
    });
  });
}

test("a crash-looping model task can be explicitly retried without duplicating the input", { timeout: 30_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "benstack-parked-model-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (let attempt = 0; attempt < 5; attempt++) await crashDuringWork(directory, true);
  const faux = fauxProvider();
  const models = createModels(); models.setProvider(faux.provider);
  faux.setResponses([fauxAssistantMessage("Recovered model response.")]);
  const job = await openJob({ directory, models, web: {
    search: async () => { throw new Error("Unexpected search"); },
    fetchPage: async () => { throw new Error("Unexpected fetch"); }, close: async () => {},
  } });
  try {
    const inspection = await job.harness.inspect(BACKGROUND_CONTEXT);
    const parked = inspection.tasks.find((task) => task.state.kind === "blocked" && task.state.reason === "restart_limit");
    assert.equal(parked?.record.kind, "pi.generation");
    await assert.rejects(job.run(), /Research is parked/);
    assert.equal(await job.run({ retryTaskId: String(parked!.record.id) }), "Recovered model response.");
    assert.equal(faux.state.callCount, 1);
    const view = await job.root.context(BACKGROUND_CONTEXT);
    assert.equal(view.entries.filter((entry) => entry.kind === "pi.user").length, 1);
  } finally { await job.close(); }
});

test("retry task IDs are canonical positive safe integers", () => {
  assert.equal(validateTaskId("13"), 13);
  for (const value of ["", "0", "-1", "01", "1.5", "1e2", " 13", "13\n", "9007199254740992", "abc"]) {
    assert.throws(() => validateTaskId(value));
  }
});

test("five real crashes park a search; resume refuses and explicit retry preserves the submission and budget", { timeout: 30_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "benstack-parked-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (let attempt = 0; attempt < 5; attempt++) await crashDuringWork(directory);

  const faux = fauxProvider();
  const models = createModels(); models.setProvider(faux.provider);
  faux.setResponses([fauxAssistantMessage("Recovered proposal for review.")]);
  let searches = 0;
  const logs: string[] = [];
  const job = await openJob({ directory, models, log: (message) => logs.push(message), web: {
    search: async () => { searches++; return "Saved SKU evidence"; },
    fetchPage: async () => { throw new Error("Unexpected fetch"); }, close: async () => {},
  } });
  try {
    const inspection = await job.harness.inspect(BACKGROUND_CONTEXT);
    const parked = inspection.tasks.find((task) => task.state.kind === "blocked" && task.state.reason === "restart_limit");
    assert.ok(parked);
    assert.equal(parked.record.restarts, 5);
    const id = String(parked.record.id);
    assert.ok(logs.some((message) => message.includes(`Task ${id} was parked`)));
    await assert.rejects(job.run(), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Research is parked/);
      assert.ok(error.message.includes(`bun run sku retry ${directory.split("/").at(-1)} ${id}`));
      return true;
    });
    for (const retryTaskId of ["1", "999999", "0", "not-a-task"]) {
      await assert.rejects(job.run({ retryTaskId }));
    }
    assert.equal(searches, 0);
    assert.equal(faux.state.callCount, 0);
    assert.equal(await job.run({ retryTaskId: id }), "Recovered proposal for review.");
    assert.equal(searches, 1);
    assert.equal(faux.state.callCount, 1);
    const saved = await job.harness.snapshot(JobDoc, job.root.id, BACKGROUND_CONTEXT);
    assert.deepEqual(saved?.toolTasks, [id]);
    const view = await job.root.context(BACKGROUND_CONTEXT);
    assert.equal(view.entries.filter((entry) => entry.kind === "pi.user").length, 1);
    await assert.rejects(job.run({ retryTaskId: id }), /not a parked task/);
    assert.equal(await job.run(), "Recovered proposal for review.");
    assert.equal(searches, 1);
  } finally { await job.close(); }
});
