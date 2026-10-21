import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import type { OAuthCredential } from "@earendil-works/pi-ai";
import { workerModels } from "../src/models.ts";
import { installationId, lockState, WorkerCredentials } from "../src/state.ts";
import { COSTCO_SITES, searchEnvironment, validateProductUrl, validateSku, type ResearchWeb } from "../src/web.ts";
import { JobDoc, MAX_TOOL_CALLS, openJob } from "../src/worker.ts";

async function temporary(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "benstack-worker-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function fakeCredential(): OAuthCredential {
  return {
    type: "oauth", access: "test-access-not-a-secret", refresh: "test-refresh-not-a-secret",
    expires: Date.now() + 60_000, clientId: "test-client",
    scopes: ["chatgpt.tokens.use.direct"], count: 0,
  };
}

function fakeModels() {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  return { faux, models, model: { provider: "faux", modelId: "faux-1" } };
}

function fakeWeb(): ResearchWeb {
  return {
    search: async () => "A lead: https://www.costco.ca/product.html - exact SKU 1572430",
    fetchPage: async () => "Bounce Outdoor Fresh. Item 1572430. Includes 2 packs of 160 sheets.",
    close: async () => undefined,
  };
}

test("numeric SKUs cannot inject search operators or paths", () => {
  assert.equal(validateSku("1572430"), "1572430");
  for (const sku of ["../1572430", "1572430 OR secret", "", "1\n2", "1234567890123"]) {
    assert.throws(() => validateSku(sku));
  }
});

test("page fetching allows only exact Canadian Costco hosts over HTTPS", () => {
  for (const site of COSTCO_SITES) assert.equal(validateProductUrl(`https://${site}/p/test#fragment`), `https://${site}/p/test`);
  assert.equal(validateProductUrl("https://www.costco.ca/p/test"), "https://www.costco.ca/p/test");
  for (const url of [
    "http://costco.ca/test", "https://costco.com/test", "https://costco.ca.attacker.example/test",
    "https://foo.costco.ca/test", "file:///etc/passwd", "http://127.0.0.1/", "https://169.254.169.254/",
    "https://costco.ca:8443/", "https://ben:password@costco.ca/", "//costco.ca/test",
  ]) assert.throws(() => validateProductUrl(url));
});

test("search child receives a deliberately restricted environment", () => {
  const env = searchEnvironment("/tmp/isolated-home");
  assert.equal(env.HOME, "/tmp/isolated-home");
  assert.equal(env.PI_CODING_AGENT_DIR, "/tmp/isolated-home");
  for (const name of ["DATABASE_URL", "AWS_PROFILE", "AWS_ACCESS_KEY_ID", "OPENAI_API_KEY", "EXA_API_KEY"]) {
    assert.equal(env[name], undefined);
  }
});

test("credentials are private, serialized, metadata-only when listed, and separate from Pi", async (t) => {
  const directory = await temporary(t);
  const release = await lockState(directory);
  try {
    const store = new WorkerCredentials(directory);
    await store.modify("openai", async () => fakeCredential());
    await Promise.all(Array.from({ length: 10 }, () => store.modify("openai", async (current) => ({
      ...current as OAuthCredential, count: Number((current as OAuthCredential).count) + 1,
    }))));
    assert.equal((await store.read("openai") as OAuthCredential).count, 10);
    assert.equal((await stat(store.path)).mode & 0o777, 0o600);
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    assert.deepEqual(await store.list(), [{ providerId: "openai", type: "oauth" }]);
    const id = await installationId(directory);
    assert.equal(await installationId(directory), id);
    await store.delete("openai");
    assert.equal(await store.read("openai"), undefined);
    await assert.rejects(readFile(store.path));
  } finally { await release(); }
});

test("ambient OpenAI API keys cannot silently replace subscription login", async (t) => {
  const directory = await temporary(t);
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "fake-key-must-not-be-used";
  try {
    const models = workerModels(new WorkerCredentials(directory));
    assert.equal(await models.getAuth("openai"), undefined);
    assert.equal(models.getProviders().length, 1);
    assert.ok(models.getProvider("openai")?.auth.oauth);
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});

test("a completed job reopens without another model request, search, or duplicate user input", async (t) => {
  const directory = await temporary(t);
  const { faux, models, model } = fakeModels();
  let searches = 0;
  const web = fakeWeb();
  web.search = async (sku, site) => { searches++; assert.equal(sku, "1572430"); assert.equal(site, "costco.ca"); return "SKU product lead"; };
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("search_costco", { site: "costco.ca" })], { stopReason: "toolUse" }),
    fauxAssistantMessage("Proposed match: Bounce dryer sheets, 2 x 160. Review required."),
  ]);
  const first = await openJob({ directory, models, web, initial: { sku: "1572430", model } });
  assert.match(await first.run(), /Proposed match/);
  const saved = await first.harness.snapshot(JobDoc, first.root.id, BACKGROUND_CONTEXT);
  assert.equal(saved?.toolTasks.length, 1);
  const agent = await first.root.agent(BACKGROUND_CONTEXT);
  assert.deepEqual(agent.tools.map((tool) => tool.name).sort(), ["fetch_costco_page", "search_costco"]);
  await first.close();

  const second = await openJob({ directory, models, web });
  try {
    assert.match(await second.run(), /Proposed match/);
    assert.equal(searches, 1);
    assert.equal(faux.state.callCount, 2);
    const view = await second.root.context(BACKGROUND_CONTEXT);
    assert.equal(view.entries.filter((entry) => entry.kind === "pi.user").length, 1);
  } finally { await second.close(); }
});

test("an interrupted read-only search resumes from SQLite and keeps the original submission", async (t) => {
  const directory = await temporary(t);
  const { faux, models, model } = fakeModels();
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("search_costco", { site: "costco.ca" })], { stopReason: "toolUse" }),
    fauxAssistantMessage("Recovered match for SKU 1572430."),
  ]);
  let signalStarted!: () => void;
  const started = new Promise<void>((resolve) => { signalStarted = resolve; });
  const blocked = fakeWeb();
  blocked.search = async (_sku, _site, signal) => {
    signalStarted();
    return new Promise<string>((_resolve, reject) => {
      if (signal?.aborted) reject(new Error("interrupted"));
      else signal?.addEventListener("abort", () => reject(new Error("interrupted")), { once: true });
    });
  };
  const first = await openJob({ directory, models, web: blocked, initial: { sku: "1572430", model } });
  const running = first.run().catch(() => undefined);
  await started;
  await first.close();
  await running;

  let replays = 0;
  const restored = fakeWeb();
  restored.search = async () => { replays++; return "Exact-SKU evidence after restart"; };
  const second = await openJob({ directory, models, web: restored });
  try {
    assert.equal(await second.run(), "Recovered match for SKU 1572430.");
    assert.equal(replays, 1);
    const job = await second.harness.snapshot(JobDoc, second.root.id, BACKGROUND_CONTEXT);
    assert.equal(job?.toolTasks.length, 1, "replay must not consume another budget slot");
    const view = await second.root.context(BACKGROUND_CONTEXT);
    assert.equal(view.entries.filter((entry) => entry.kind === "pi.user").length, 1);
  } finally { await second.close(); }
});

test("an unsupported subscription model reports an actionable error without raw provider details", async (t) => {
  const directory = await temporary(t);
  const { faux, models, model } = fakeModels();
  faux.setResponses([fauxAssistantMessage("", {
    stopReason: "error",
    errorMessage: "OpenAI API error (400): The 'gpt-5.4' model is not supported when using Codex with a ChatGPT account. private-provider-details",
  })]);
  const job = await openJob({ directory, models, web: fakeWeb(), initial: { sku: "1572430", model } });
  try {
    await assert.rejects(job.run(), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /rejected for your ChatGPT plan/);
      assert.match(error.message, /bun run sku models/);
      assert.doesNotMatch(error.message, /private-provider-details/);
      return true;
    });
  } finally { await job.close(); }
});

test("the persisted tool budget prevents additional external requests", async (t) => {
  const directory = await temporary(t);
  const { faux, models, model } = fakeModels();
  let searches = 0;
  const web = fakeWeb();
  web.search = async () => { searches++; return "must not be called"; };
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("search_costco", { site: "costco.ca" })], { stopReason: "toolUse" }),
    fauxAssistantMessage("Unresolved: tool budget exhausted."),
  ]);
  const job = await openJob({ directory, models, web, initial: { sku: "1572430", model } });
  try {
    await job.root.commit(async (tx) => {
      const doc = await tx.doc(JobDoc, job.root.id);
      doc.toolTasks = Array.from({ length: MAX_TOOL_CALLS }, (_, i) => `used-${i}`);
    }, BACKGROUND_CONTEXT);
    assert.match(await job.run(), /budget exhausted/);
    assert.equal(searches, 0);
  } finally { await job.close(); }
});
