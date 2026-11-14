import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { executeManualJob, pilotJobDirectory, savedPilotResult } from "../src/manual-job.ts";
import { PILOT_HOST, pilotChildEnvironment, validatePilotTarget } from "../src/pilot-config.ts";
import { extractProductEvidence } from "../src/product-evidence.ts";

test("manual pilot is pinned to dev direct TLS endpoint and rejects parameter overrides", () => {
  const good = `postgresql://fixture:fixture@${PILOT_HOST}/neondb?sslmode=require&channel_binding=require`;
  assert.match(validatePilotTarget(good), /sslmode=verify-full/);
  for (const bad of [undefined, "", good.replace(PILOT_HOST, "ep-production.us-east-1.aws.neon.tech"), good.replace(PILOT_HOST, PILOT_HOST.replace(".c-5", "-pooler.c-5")), good.replace("/neondb", "/other"), good.replace("sslmode=require", "sslmode=disable"), good+"&host=production", good+"&sslmode=no-verify", good.replace("postgresql:", "https:")]) {
    assert.throws(() => validatePilotTarget(bad));
  }
});

test("pilot CLIs reject missing consent and unknown DB targets before using credentials", () => {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME };
  const worker = spawnSync(process.execPath, [fileURLToPath(new URL("../src/pilot-worker.ts", import.meta.url)), "--request", randomUUID(), "--organization", "fixture-org", "--sku", "1572430"], { env, encoding: "utf8" });
  assert.equal(worker.status, 1); assert.match(worker.stderr, /consent/);
  const coordinator = spawnSync("bun", ["--no-env-file", fileURLToPath(new URL("../pilot/cli.ts", import.meta.url))], { env: { ...env, DATABASE_URL: "postgresql://fixture:secret@production.invalid/neondb?sslmode=require", ALLOWED_EMAILS: "owner@example.invalid" }, encoding: "utf8" });
  assert.equal(coordinator.status, 1); assert.match(coordinator.stderr, /no database or provider was contacted/);
  assert.doesNotMatch(coordinator.stderr, /fixture:secret/);
});

test("node worker receives no DB, AWS, API keys or runtime injection env", () => {
  assert.deepEqual(pilotChildEnvironment({ PATH: "/bin", HOME: "/home/fixture", SKU_WORKER_STATE_DIR: "/private/worker", DATABASE_URL: "secret", OPENAI_API_KEY: "secret", AWS_PROFILE: "prod", ANTHROPIC_API_KEY: "secret", NODE_OPTIONS: "--import evil", BUN_OPTIONS: "evil", SSL_CERT_FILE: "evil" }),
    { PATH: "/bin", HOME: "/home/fixture", SKU_WORKER_STATE_DIR: "/private/worker" });
});

test("manual durable job saves direct evidence before publication and reuses it without inference", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "benstack-manual-pilot-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const faux = fauxProvider(), models = createModels(); models.setProvider(faux.provider);
  const claim = { requestId: randomUUID(), organizationId: "fixture-org", sku: "1572430" };
  const url = "https://www.costco.ca/fixture.html";
  const html = await readFile(new URL("fixtures/bounce.html", import.meta.url), "utf8");
  faux.setResponses([fauxAssistantMessage([fauxToolCall("fetch_costco_page", { url })], { stopReason: "toolUse" }), fauxAssistantMessage("Invented answer name must not enter catalog.")]);
  let fetches = 0;
  const options = { directory, claim, models, model: { provider: "faux", modelId: "faux-1" }, signal: new AbortController().signal,
    web: { search: async () => { throw new Error("Unexpected search"); }, fetchPage: async (_url: string, _signal?: AbortSignal, sku?: string) => { fetches++; return extractProductEvidence(html, url, sku); }, close: async () => {} } };
  const result = await executeManualJob(options);
  assert.equal(result.outcome, "proposed"); assert.match(result.fields.name!.value, /Bounce/i);
  assert.doesNotMatch(JSON.stringify(result), /Invented answer/);
  assert.deepEqual(await savedPilotResult(directory, claim), result);
  assert.deepEqual(await executeManualJob(options), result);
  assert.equal(fetches, 1); assert.equal(faux.state.callCount, 2);
  await assert.rejects(savedPilotResult(directory, { ...claim, organizationId: "other-org" }), /identity mismatch/);
  await assert.rejects(savedPilotResult(directory, { ...claim, sku: "1" }), /SKU mismatch/);
});

test("existing interrupted state and cancellation do not silently restart inference", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "benstack-manual-block-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const faux = fauxProvider(), models = createModels(); models.setProvider(faux.provider);
  const claim = { requestId: randomUUID(), organizationId: "fixture-org", sku: "1572430" };
  const jobDirectory = pilotJobDirectory(directory, claim.requestId); await mkdir(jobDirectory, { recursive: true }); await writeFile(join(jobDirectory, "session.sqlite"), "fixture interrupted transcript");
  const options = { directory, claim, models, model: { provider: "faux", modelId: "faux-1" }, signal: new AbortController().signal,
    web: { search: async () => { throw new Error("Network forbidden"); }, fetchPage: async () => { throw new Error("Network forbidden"); }, close: async () => {} } };
  await assert.rejects(executeManualJob(options), /operator inspection/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(executeManualJob({ ...options, signal: controller.signal }));
  assert.throws(() => pilotJobDirectory(directory, "../../escape"));
  assert.equal(faux.state.callCount, 0);
});
