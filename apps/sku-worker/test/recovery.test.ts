import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { LiveDoc } from "@earendil-works/pi-durable";
import { JobDoc, openJob } from "../src/worker.ts";

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

test("a hard-crashed model request ends without replay when model retries are disabled", { timeout: 15_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "benstack-interrupted-model-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await crashDuringWork(directory, true);
  const faux = fauxProvider();
  const models = createModels(); models.setProvider(faux.provider);
  faux.setResponses([fauxAssistantMessage("Recovered model response.")]);
  const job = await openJob({ directory, models, web: {
    search: async () => { throw new Error("Unexpected search"); },
    fetchPage: async () => { throw new Error("Unexpected fetch"); }, close: async () => {},
  } });
  try {
    await assert.rejects(job.run(), /interrupted.*will not restart on resume/);
    await assert.rejects(job.run(), /bun run sku research 1572430/);
    assert.equal(faux.state.callCount, 0);
    const live = await job.harness.snapshot(LiveDoc, job.root.id, BACKGROUND_CONTEXT);
    assert.equal(live?.run, undefined);
    assert.equal(live?.runFailure?.reason, "interrupted");
    const view = await job.root.context(BACKGROUND_CONTEXT);
    assert.equal(view.entries.filter((entry) => entry.kind === "pi.user").length, 1);
  } finally { await job.close(); }
});

test("five real search crashes end the tool with restart_limit and preserve submission and budget", { timeout: 30_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "benstack-restart-limit-test-"));
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
    const savedBefore = await job.harness.snapshot(JobDoc, job.root.id, BACKGROUND_CONTEXT);
    assert.equal(savedBefore?.toolTasks.length, 1);
    assert.equal(await job.run(), "Recovered proposal for review.");
    assert.equal(searches, 0, "the crash-limited tool must not execute again");
    assert.equal(faux.state.callCount, 1, "the model can answer from the tool error and saved evidence");
    const saved = await job.harness.snapshot(JobDoc, job.root.id, BACKGROUND_CONTEXT);
    assert.deepEqual(saved?.toolTasks, savedBefore?.toolTasks);
    assert.ok(logs.some((message) => message.includes("ended after a process interruption or repeated crashes")));
    const view = await job.root.context(BACKGROUND_CONTEXT);
    assert.equal(view.entries.filter((entry) => entry.kind === "pi.user").length, 1);
    const toolResult = view.entries.find((entry) => entry.kind === "pi.tool-result");
    assert.match(JSON.stringify(toolResult), /restart_limit/);
    assert.equal((await job.harness.inspect(BACKGROUND_CONTEXT)).tasks.length, 0);
    assert.equal(await job.run(), "Recovered proposal for review.");
    assert.equal(searches, 0);
    assert.equal(faux.state.callCount, 1);
  } finally { await job.close(); }
});
