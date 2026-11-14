import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { setTimeout as delay } from "node:timers/promises";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAutomaticOffline } from "../src/automatic";
import { runAutomaticChatGPT } from "../src/automatic-chatgpt";
import { pilotOperators } from "../src/manual-pilot";
import { eq, sql } from "drizzle-orm";
import { member, organization, user } from "@benstack-aws/db/schema/auth";
import { approvedProducts, productIdentities, productResearchAdmissionActions, productResearchDecisions, productResearchProposals, productResearchRequests } from "@benstack-aws/db/schema/product-research";
import { receiptItems } from "@benstack-aws/db/schema/receipts";
import { importReceipts, admissionPolicy, type AdmissionPolicy } from "@benstack-aws/receipt-import";
import { testDatabase } from "../../receipt-import/test/database";
import { resultSchema, type ResearchResult } from "../src/contracts";
import { claimNext, claimSelected, publishResult, renewClaim, runNext } from "../src/queue";
import { pilotRequests, runSelectedPilot } from "../src/manual-pilot";
import { decideResearch, deleteOrganizationReceipts, getResearch, listResearch, receiptEnrichment, researchAgain } from "../src/service";
import { createResearchRoutes } from "../../../apps/server/src/modules/product-research/product-research.http";
import type { AppVariables } from "../../../apps/server/src/types/hono";

let backend: Awaited<ReturnType<typeof testDatabase>>;
const actor = { organizationId: "org-a", userId: "owner" };
const policy = { ...admissionPolicy(), enabled: true, organizationIds: ["org-a", "org-b"] };
const input = (sku = "00123", countryCode = "CA") => [{ documentType: "RECEIPT", receiptType: "Warehouse", transactionDate: "2026-11-07", transactionBarcode: crypto.randomUUID(),
  subTotal: 1, taxes: 0, total: 1, warehouseName: "Fixture", warehouseNumber: 1, warehouseCity: "St John's", warehouseState: "NL", countryCode, membershipNumber: "fixture",
  itemArray: [{ itemDescription01: "ABBREVIATION", itemNumber: sku, unit: 1, amount: 1 }], tenderArray: [] }];
function result(sku = "00123"): ResearchResult {
  const at = "2026-11-07T12:00:00.000Z";
  return { schemaVersion: 1, sku, merchant: "costco", market: "CA", outcome: "proposed", answerId: 42, model: "faux/faux-1", observedAt: at,
    evidenceStatus: "direct_sku_match", flags: ["Human review required."],
    fields: { name: { value: "Fixture product", sourceIds: ["page"] }, brand: { value: "Fixture brand", sourceIds: ["page"] }, sizeText: { value: "907 g", sourceIds: ["page"] } },
    sources: [{ id: "page", url: "https://www.costco.ca/fixture.html", sku, exactSku: true, kind: "direct_page", observedAt: at, quotes: { name: "Fixture product", brand: "Fixture brand", sizeText: "907 g" } }] };
}
async function admitted(org = "org-a", config: AdmissionPolicy = policy) {
  await importReceipts(backend.db, input(), org, "owner", { policy: config });
  const [row] = await backend.db.select({ request: productResearchRequests }).from(productResearchRequests).innerJoin(productIdentities, eq(productIdentities.id, productResearchRequests.identityId)).where(eq(productIdentities.organizationId, org));
  return row!.request;
}
async function proposed() {
  const request = await admitted();
  const claim = (await claimNext(backend.db, { ...policy, organizationIds: ["org-a"] }))!;
  await publishResult(backend.db, claim, result());
  return { request, claim };
}
const approve = () => ({ revision: 1, expectedProductVersion: 0, fields: ["name", "sizeText"], idempotencyKey: crypto.randomUUID() });

beforeAll(async () => { backend = await testDatabase(); }, 30_000);
afterAll(async () => { await backend?.close(); });
beforeEach(async () => {
  await backend.exec('TRUNCATE "organization", "user", product_research_daily_usage CASCADE');
  await backend.db.insert(user).values(["owner", "viewer", "outsider"].map((id) => ({ id, name: id, email: `${id}@example.invalid` })));
  await backend.db.insert(organization).values(["org-a", "org-b"].map((id) => ({ id, name: id, slug: id, createdAt: new Date() })));
  await backend.db.insert(member).values([
    { id: "owner-a", userId: "owner", organizationId: "org-a", role: "owner", createdAt: new Date() },
    { id: "owner-b", userId: "owner", organizationId: "org-b", role: "owner", createdAt: new Date() },
    { id: "viewer-a", userId: "viewer", organizationId: "org-a", role: "member", createdAt: new Date() },
  ]);
});

test("ChatGPT automatic entrypoint requires explicit consent and a distinct executor mode", async () => {
  const request = await admitted(); let calls = 0;
  const executor = { mode: "chatgpt-plan" as const, execute: async () => { calls++; return result(); } };
  await expect(runAutomaticChatGPT(backend.db, actor, executor, { allowLive: false, policy: () => policy })).rejects.toThrow("consent");
  await expect(runAutomaticChatGPT(backend.db, actor, { ...executor, mode: "offline" } as never, { allowLive: true, policy: () => policy })).rejects.toThrow("consent");
  expect(await runAutomaticChatGPT(backend.db, actor, executor, { allowLive: true })).toMatchObject({ reason: "disabled", attempted: 0 });
  expect(calls).toBe(0); expect((await getResearch(backend.db, actor, request.id)).state).toBe("queued");
  expect((await pilotOperators(backend.db, ["viewer@example.invalid"])).length).toBe(0);
  expect((await pilotOperators(backend.db, ["OWNER@example.invalid"])).length).toBe(2);
});

test("automatic ChatGPT path handles queued work only in the operator organization, with a one-job cap", async () => {
  const foreign = await admitted("org-b");
  const paused = await admitted("org-a", { ...policy, enabled: false });
  await importReceipts(backend.db, [...input("00456"), ...input("00789")], actor.organizationId, actor.userId, { policy });
  const before = await backend.db.select().from(receiptItems); const seen: string[] = [];
  const executor = { mode: "chatgpt-plan" as const, execute: async (claim: { requestId: string; sku: string; organizationId: string }) => {
    expect(claim.organizationId).toBe(actor.organizationId); seen.push(claim.requestId); return result(claim.sku);
  } };
  expect(await runAutomaticChatGPT(backend.db, actor, executor, { allowLive: true, policy: () => policy })).toEqual({ attempted: 1, published: 1, reason: "job_limit" });
  expect((await getResearch(backend.db, actor, paused.id)).state).toBe("paused");
  expect((await getResearch(backend.db, { ...actor, organizationId: "org-b" }, foreign.id)).state).toBe("queued");
  expect(await runAutomaticChatGPT(backend.db, actor, executor, { allowLive: true, policy: () => policy })).toMatchObject({ attempted: 1 });
  expect(new Set(seen).size).toBe(2);
  expect(await runAutomaticChatGPT(backend.db, actor, executor, { allowLive: true, policy: () => policy, stopWhenIdle: true })).toMatchObject({ attempted: 0 });
  expect(await backend.db.select().from(receiptItems)).toEqual(before);
  expect((await backend.db.select().from(approvedProducts)).length).toBe(0);
});

test("UI queue action wakes the automatic ChatGPT consumer without a per-request command", async () => {
  const request = await admitted("org-a", { ...policy, enabled: false });
  const origin = "https://app.example.invalid";
  const app = createResearchRoutes({ db: backend.db, origin, admissionPolicy: policy, middleware: [async (c, next) => {
    c.set("user", { id: actor.userId } as AppVariables["user"]); c.set("orgId", actor.organizationId); await next();
  }] });
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10_000);
  let calls = 0;
  try {
    const worker = runAutomaticChatGPT(backend.db, actor, { mode: "chatgpt-plan", execute: async (claim) => { calls++; return result(claim.sku); } },
      { allowLive: true, policy: () => policy, pollMs: 10, signal: controller.signal });
    await delay(25); expect(calls).toBe(0);
    const response = await app.request(`/${request.id}/research-again`, { method: "POST", headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), acknowledgeCost: true }) });
    expect(response.status).toBe(200);
    expect(await worker).toEqual({ attempted: 1, published: 1, reason: "job_limit" });
    expect((await getResearch(backend.db, actor, request.id)).state).toBe("awaiting_review");
    expect(calls).toBe(1); expect((await backend.db.select().from(approvedProducts)).length).toBe(0);
  } finally { clearTimeout(timeout); controller.abort(); }
}, 15_000);

test("ChatGPT automatic claims reauthorize membership on each poll", async () => {
  const request = await admitted(); let calls = 0;
  const executor = { mode: "chatgpt-plan" as const, execute: async () => { calls++; return result(); } };
  await expect(runAutomaticChatGPT(backend.db, { ...actor, userId: "viewer" }, executor, { allowLive: true, policy: () => policy })).rejects.toThrow("owner or admin");
  await backend.db.delete(member).where(eq(member.id, "owner-a"));
  await expect(runAutomaticChatGPT(backend.db, actor, executor, { allowLive: true, policy: () => policy })).rejects.toThrow("membership");
  expect(calls).toBe(0);
  const [row] = await backend.db.select().from(productResearchRequests).where(eq(productResearchRequests.id, request.id)); expect(row!.state).toBe("queued");
});

test("ChatGPT automatic execution failures stop without retrying inference or later jobs", async () => {
  await importReceipts(backend.db, [...input("00123"), ...input("00456")], actor.organizationId, actor.userId, { policy });
  let calls = 0;
  expect(await runAutomaticChatGPT(backend.db, actor, { mode: "chatgpt-plan", execute: async () => { calls++; throw new Error("faux failure"); } },
    { allowLive: true, policy: () => policy, maxJobs: 100 })).toEqual({ attempted: 1, published: 0, reason: "execution_failed" });
  expect(calls).toBe(1);
  expect((await backend.db.select().from(productResearchRequests)).map((r) => r.state).sort()).toEqual(["failed", "queued"]);
});

test("ChatGPT publication retries do not repeat the executor after a lost commit acknowledgement", async () => {
  await admitted(); let lostAck = false, calls = 0;
  const flaky = new Proxy(backend.db, { get(target, property) {
    if (property === "transaction") return async (...args: Parameters<typeof target.transaction>) => {
      const value = await target.transaction(...args);
      if (!lostAck && value && typeof value === "object" && "state" in value && value.state === "awaiting_review") {
        lostAck = true; throw Object.assign(new Error("lost ack"), { code: "ECONNRESET" });
      }
      return value;
    };
    const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
  } });
  expect(await runAutomaticChatGPT(flaky, actor, { mode: "chatgpt-plan", execute: async () => { calls++; return result(); } },
    { allowLive: true, policy: () => policy })).toMatchObject({ published: 1 });
  expect(lostAck).toBe(true); expect(calls).toBe(1); expect((await backend.db.select().from(productResearchProposals)).length).toBe(1);
});

test("ChatGPT automatic loop honors pause policy and does not reclaim interrupted running work", async () => {
  const request = await admitted(); await claimNext(backend.db, policy);
  await backend.db.update(productResearchRequests).set({ leaseUntil: new Date(0) }).where(eq(productResearchRequests.id, request.id));
  let calls = 0;
  const executor = { mode: "chatgpt-plan" as const, execute: async () => { calls++; return result(); } };
  expect(await runAutomaticChatGPT(backend.db, actor, executor, { allowLive: true, policy: () => ({ ...policy, enabled: false }) })).toMatchObject({ reason: "disabled" });
  expect(await runAutomaticChatGPT(backend.db, actor, executor, { allowLive: true, policy: () => policy, stopWhenIdle: true })).toMatchObject({ reason: "idle", attempted: 0 });
  expect(calls).toBe(0);
});

test("automatic worker defaults off and rejects live executors before touching jobs", async () => {
  const request = await admitted(); let calls = 0;
  const executor = { mode: "offline" as const, execute: async () => { calls++; return result(); } };
  expect(await runAutomaticOffline(backend.db, executor)).toMatchObject({ reason: "disabled", attempted: 0 });
  await expect(runAutomaticOffline(backend.db, { ...executor, mode: "live" } as never)).rejects.toThrow("live execution is not enabled");
  for (const maxJobs of [0, -1, Infinity, 1.5, 101]) await expect(runAutomaticOffline(backend.db, executor, { maxJobs })).rejects.toThrow("1-100");
  expect(calls).toBe(0); expect((await getResearch(backend.db, actor, request.id)).state).toBe("queued");
});

test("automatic worker picks up a newly uploaded receipt without a per-request command", async () => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let calls = 0;
  try {
    const worker = runAutomaticOffline(backend.db, { mode: "offline", execute: async (claim) => { calls++; return result(claim.sku); } },
      { policy: () => policy, pollMs: 10, signal: controller.signal });
    await delay(25); expect(calls).toBe(0);
    const request = await admitted();
    expect(await worker).toEqual({ reason: "job_limit", attempted: 1, published: 1 });
    expect((await getResearch(backend.db, actor, request.id)).state).toBe("awaiting_review");
    expect((await backend.db.select().from(approvedProducts)).length).toBe(0);
  } finally { clearTimeout(timeout); controller.abort(); }
}, 15_000);

test("automatic limits and process restarts never replay finished jobs or duplicate uploads", async () => {
  const receipts = [...input("00123"), ...input("00456")];
  await importReceipts(backend.db, receipts, actor.organizationId, actor.userId, { policy });
  const calls = new Map<string, number>();
  const executor = { mode: "offline" as const, execute: async (claim: { requestId: string; sku: string }) => {
    calls.set(claim.requestId, (calls.get(claim.requestId) ?? 0) + 1); return result(claim.sku);
  } };
  expect(await runAutomaticOffline(backend.db, executor, { policy: () => policy })).toMatchObject({ attempted: 1, reason: "job_limit" });
  expect((await backend.db.select().from(productResearchRequests)).filter((r) => r.state === "queued").length).toBe(1);
  await importReceipts(backend.db, receipts, actor.organizationId, actor.userId, { policy });
  expect(await runAutomaticOffline(backend.db, executor, { policy: () => policy, maxJobs: 100, stopWhenIdle: true })).toMatchObject({ attempted: 1, reason: "idle" });
  expect(await runAutomaticOffline(backend.db, executor, { policy: () => policy, stopWhenIdle: true })).toMatchObject({ attempted: 0, reason: "idle" });
  expect([...calls.values()]).toEqual([1, 1]);
  expect((await backend.db.select().from(productResearchRequests)).length).toBe(2);
});

test("automatic workers remain single-active even with two processes polling", async () => {
  await importReceipts(backend.db, [...input("00123"), ...input("00456")], actor.organizationId, actor.userId, { policy });
  let active = 0, peak = 0; const seen = new Set<string>();
  const executor = { mode: "offline" as const, execute: async (claim: { requestId: string; sku: string }) => {
    active++; peak = Math.max(peak, active); expect(seen.has(claim.requestId)).toBe(false); seen.add(claim.requestId);
    try { await delay(30); return result(claim.sku); } finally { active--; }
  } };
  await Promise.all([1, 2].map(() => runAutomaticOffline(backend.db, executor, { policy: () => policy, stopWhenIdle: true })));
  expect(peak).toBe(1); expect(seen.size).toBeGreaterThanOrEqual(1);
});

test("automatic worker respects paused admission, tenant allowlist and runtime pause switch", async () => {
  const paused = await admitted("org-a", { ...policy, enabled: false }); const foreign = await admitted("org-b");
  let calls = 0;
  const executor = { mode: "offline" as const, execute: async (claim: { sku: string }) => { calls++; return result(claim.sku); } };
  expect(await runAutomaticOffline(backend.db, executor, { policy: () => ({ ...policy, organizationIds: ["org-a"] }), stopWhenIdle: true })).toMatchObject({ attempted: 0 });
  expect((await getResearch(backend.db, actor, paused.id)).state).toBe("paused");
  expect((await getResearch(backend.db, { ...actor, organizationId: "org-b" }, foreign.id)).state).toBe("queued");
  let enabled = true;
  await importReceipts(backend.db, [...input("00456"), ...input("00789")], actor.organizationId, actor.userId, { policy });
  expect(await runAutomaticOffline(backend.db, { mode: "offline", execute: async (claim) => { calls++; enabled = false; return result(claim.sku); } },
    { maxJobs: 100, policy: () => ({ enabled, organizationIds: ["org-a"] }) })).toEqual({ reason: "disabled", attempted: 1, published: 1 });
  expect(calls).toBe(1);
  expect((await backend.db.select().from(productResearchRequests)).filter((r) => r.state === "queued").length).toBe(2);
});

test("automatic execution failure stops the session rather than retrying or draining the queue", async () => {
  await importReceipts(backend.db, [...input("00123"), ...input("00456")], actor.organizationId, actor.userId, { policy });
  let calls = 0;
  expect(await runAutomaticOffline(backend.db, { mode: "offline", execute: async () => { calls++; throw new Error("fixture provider failure"); } },
    { policy: () => policy, maxJobs: 100 })).toEqual({ reason: "execution_failed", attempted: 1, published: 0 });
  expect(calls).toBe(1);
  const states = (await backend.db.select().from(productResearchRequests)).map((r) => r.state).sort();
  expect(states).toEqual(["failed", "queued"]);
});

test("automatic restart never reclaims an expired running job", async () => {
  const request = await admitted(); const claim = await claimNext(backend.db, policy);
  await backend.db.update(productResearchRequests).set({ leaseUntil: new Date(0) }).where(eq(productResearchRequests.id, request.id));
  let calls = 0;
  expect(await runAutomaticOffline(backend.db, { mode: "offline", execute: async () => { calls++; return result(); } },
    { policy: () => policy, stopWhenIdle: true })).toEqual({ reason: "idle", attempted: 0, published: 0 });
  const [row] = await backend.db.select().from(productResearchRequests).where(eq(productResearchRequests.id, request.id));
  expect(row!.state).toBe("running"); expect(row!.claimToken).toBe(claim!.token); expect(calls).toBe(0);
});

test("automatic cancellation stops polling and never claims work after a pre-aborted signal", async () => {
  const controller = new AbortController();
  const idle = runAutomaticOffline(backend.db, { mode: "offline", execute: async () => { throw new Error("must not execute"); } },
    { policy: () => policy, pollMs: 10, signal: controller.signal });
  await delay(25); controller.abort(); expect((await idle).reason).toBe("aborted");
  const request = await admitted();
  expect(await runAutomaticOffline(backend.db, { mode: "offline", execute: async () => result() }, { policy: () => policy, signal: controller.signal })).toMatchObject({ reason: "aborted", attempted: 0 });
  expect((await getResearch(backend.db, actor, request.id)).state).toBe("queued");
});

for (const scenario of [
  { name: "transient publication failure", code: "40001", failures: 2, attempts: 3, success: true },
  { name: "exhausted transient publication retries", code: "40001", failures: 10, attempts: 3, success: false },
  { name: "permanent publication failure", code: "23514", failures: 10, attempts: 1, success: false },
]) test(`automatic ${scenario.name} never reexecutes research`, async () => {
  const request = await admitted(); let calls = 0;
  await backend.exec(`CREATE SEQUENCE offline_auto_publish_attempt;
    CREATE FUNCTION offline_auto_publish_fail() RETURNS trigger AS $$ BEGIN
      IF nextval('offline_auto_publish_attempt') <= ${scenario.failures} THEN RAISE EXCEPTION 'fixture publication failure' USING ERRCODE = '${scenario.code}'; END IF;
      RETURN NEW; END $$ LANGUAGE plpgsql;
    CREATE TRIGGER offline_auto_publish_trigger BEFORE INSERT ON product_research_proposal FOR EACH ROW EXECUTE FUNCTION offline_auto_publish_fail();`);
  try {
    const worker = runAutomaticOffline(backend.db, { mode: "offline", execute: async () => { calls++; return result(); } }, { policy: () => policy });
    if (scenario.success) expect(await worker).toEqual({ reason: "job_limit", attempted: 1, published: 1 });
    else await expect(worker).rejects.toThrow();
    expect(calls).toBe(1);
    const [attempts] = await backend.db.select({ value: sql<string>`(SELECT last_value::text FROM offline_auto_publish_attempt)` }).from(productResearchRequests).limit(1);
    expect(Number(attempts!.value)).toBe(scenario.attempts);
    expect((await getResearch(backend.db, actor, request.id)).state).toBe(scenario.success ? "awaiting_review" : "running");
    // Restarting cannot reclaim either a completed request or uncertain running work.
    expect(await runAutomaticOffline(backend.db, { mode: "offline", execute: async () => { calls++; return result(); } },
      { policy: () => policy, stopWhenIdle: true })).toMatchObject({ attempted: 0, reason: "idle" });
    expect(calls).toBe(1);
  } finally { await backend.exec("DROP TRIGGER offline_auto_publish_trigger ON product_research_proposal; DROP FUNCTION offline_auto_publish_fail(); DROP SEQUENCE offline_auto_publish_attempt;"); }
});

test("automatic retry after an uncertain committed publication is idempotent", async () => {
  const request = await admitted(); let lostAck = false, calls = 0;
  const flaky = new Proxy(backend.db, { get(target, property) {
    if (property === "transaction") return async (...args: Parameters<typeof target.transaction>) => {
      const value = await target.transaction(...args);
      if (!lostAck && value && typeof value === "object" && "state" in value && value.state === "awaiting_review") {
        lostAck = true; throw Object.assign(new Error("lost commit acknowledgement"), { code: "ECONNRESET" });
      }
      return value;
    };
    const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
  } });
  expect(await runAutomaticOffline(flaky, { mode: "offline", execute: async () => { calls++; return result(); } }, { policy: () => policy })).toMatchObject({ published: 1 });
  expect(calls).toBe(1); expect(lostAck).toBe(true);
  expect((await backend.db.select().from(productResearchProposals)).length).toBe(1);
  expect((await getResearch(backend.db, actor, request.id)).state).toBe("awaiting_review");
});

test.skipIf(!process.env.RECEIPT_IMPORT_TEST_DATABASE_URL)("offline automatic CLI saves a result and publishes through native PostgreSQL without app credentials", async () => {
  const request = await admitted();
  const home = await mkdtemp(join(tmpdir(), "benstack-auto-cli-"));
  try {
    const child = Bun.spawn([process.execPath, "--no-env-file", fileURLToPath(new URL("../../../apps/sku-worker/automatic/cli.ts", import.meta.url)), "--enabled", "--organization", actor.organizationId, "--drain"], {
      env: { PATH: process.env.PATH!, HOME: home, RECEIPT_IMPORT_TEST_DATABASE_URL: process.env.RECEIPT_IMPORT_TEST_DATABASE_URL!,
        DATABASE_URL: "postgresql://must-not-use@production.invalid/app", OPENAI_API_KEY: "must-not-use", NODE_OPTIONS: "", PRODUCT_RESEARCH_ADMISSION_ENABLED: "true" },
      stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    const [out, err, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(err).toBe(""); expect(exit).toBe(0); expect(out).toContain("attempted 1, published 1");
    expect(out).not.toContain("must-not-use");
    const detail = await getResearch(backend.db, actor, request.id);
    expect(detail.state).toBe("unresolved"); expect(detail.result?.model).toBe("offline/static-queue-fixture");
    const path = join(home, ".local/state/benstack-sku-auto-offline/exports", `${request.id}.json`);
    const saved = JSON.parse(await readFile(path, "utf8"));
    expect(saved.result).toEqual(detail.result); expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await backend.db.select().from(approvedProducts)).length).toBe(0);
  } finally { await rm(home, { recursive: true, force: true }); }
}, 30_000);

test("manual pilot requires explicit consent, owner membership and one exact request", async () => {
  const paused = await admitted("org-a", { ...policy, enabled: false });
  let calls = 0;
  const executor = { mode: "manual-live-pilot" as const, execute: async () => { calls++; return result(); } };
  await expect(runSelectedPilot(backend.db, actor, paused.id, executor, { allowLive: false })).rejects.toThrow("consent");
  await expect(runSelectedPilot(backend.db, { ...actor, userId: "viewer" }, paused.id, executor, { allowLive: true })).rejects.toThrow("Owner or admin");
  await expect(runSelectedPilot(backend.db, { ...actor, organizationId: "org-b" }, paused.id, executor, { allowLive: true })).rejects.toThrow("not found");
  expect(calls).toBe(0);
  expect((await getResearch(backend.db, actor, paused.id)).state).toBe("paused");
  expect((await pilotRequests(backend.db, ["viewer@example.invalid"])).length).toBe(0);
  expect((await pilotRequests(backend.db, ["owner@example.invalid"], paused.id)).map((r) => r.requestId)).toEqual([paused.id]);
});

test("manual pilot runs selected paused work only, preserving other queued and paused requests", async () => {
  const older = await admitted("org-b");
  const selected = await admitted("org-a", { ...policy, enabled: false });
  await importReceipts(backend.db, input("00456"), "org-a", "owner", { policy: { ...policy, enabled: false } });
  const before = await backend.db.select().from(receiptItems);
  const seen: string[] = [];
  const outcome = await runSelectedPilot(backend.db, actor, selected.id, { mode: "manual-live-pilot", execute: async (claim) => { seen.push(claim.requestId); return result(claim.sku); } }, { allowLive: true });
  expect(seen).toEqual([selected.id]); expect(outcome.state).toBe("awaiting_review");
  expect((await getResearch(backend.db, { ...actor, organizationId: "org-b" }, older.id)).state).toBe("queued");
  const all = await backend.db.select().from(productResearchRequests);
  expect(all.filter((r) => r.state === "paused").length).toBe(1);
  expect((await backend.db.select().from(approvedProducts)).length).toBe(0);
  expect(await backend.db.select().from(receiptItems)).toEqual(before);
});

test("targeted claims never fall back to a foreign or missing request", async () => {
  const request = await admitted();
  const runner = { enabled: true, organizationIds: ["org-a", "org-b"] };
  expect(await claimSelected(backend.db, runner, { ...actor, organizationId: "org-b" }, request.id)).toBeNull();
  expect(await claimSelected(backend.db, runner, actor, crypto.randomUUID())).toBeNull();
  expect(await claimSelected(backend.db, { ...runner, enabled: false }, actor, request.id)).toBeNull();
  await expect(claimSelected(backend.db, runner, { ...actor, userId: "viewer" }, request.id)).rejects.toThrow("owner or admin");
  expect((await getResearch(backend.db, actor, request.id)).state).toBe("queued");
});

test("manual pilot respects admission quotas and does not call an executor", async () => {
  const request = await admitted("org-a", { ...policy, enabled: false });
  await backend.exec("INSERT INTO product_research_daily_usage(scope_key,day,admitted_jobs) VALUES ('global',(now() AT TIME ZONE 'UTC')::date,20)");
  let called = false;
  await expect(runSelectedPilot(backend.db, actor, request.id, { mode: "manual-live-pilot", execute: async () => { called = true; return result(); } }, { allowLive: true })).rejects.toThrow("Admission limits");
  expect(called).toBe(false); expect((await getResearch(backend.db, actor, request.id)).state).toBe("paused");
});

test("manual pilot cannot steal running work or repeat a completed request", async () => {
  const request = await admitted();
  const running = await claimNext(backend.db, policy);
  let calls = 0;
  const executor = { mode: "manual-live-pilot" as const, execute: async () => { calls++; return result(); } };
  await expect(runSelectedPilot(backend.db, actor, request.id, executor, { allowLive: true })).rejects.toThrow("paused or queued");
  await publishResult(backend.db, running!, result());
  await expect(runSelectedPilot(backend.db, actor, request.id, executor, { allowLive: true })).rejects.toThrow("paused or queued");
  expect(calls).toBe(0);
});

test("manual pilot abort or invalid evidence fails closed without automatic retries", async () => {
  const request = await admitted();
  let calls = 0;
  await expect(runSelectedPilot(backend.db, actor, request.id, { mode: "manual-live-pilot", execute: async () => { calls++; return { invented: true }; } }, { allowLive: true })).rejects.toThrow("saved worker state retained");
  expect(calls).toBe(1); expect((await getResearch(backend.db, actor, request.id)).state).toBe("failed");
  expect((await backend.db.select().from(productResearchProposals)).length).toBe(0);
  const controller = new AbortController(); controller.abort();
  await expect(runSelectedPilot(backend.db, actor, request.id, { mode: "manual-live-pilot", execute: async () => { calls++; } }, { allowLive: true, signal: controller.signal })).rejects.toThrow();
  expect(calls).toBe(1);
});

test("manual pilot does not call providers while another job is running", async () => {
  await admitted("org-b"); await claimNext(backend.db, { enabled: true, organizationIds: ["org-b"] });
  const selected = await admitted("org-a", { ...policy, enabled: false });
  let calls = 0;
  await expect(runSelectedPilot(backend.db, actor, selected.id, { mode: "manual-live-pilot", execute: async () => { calls++; return result(); } }, { allowLive: true })).rejects.toThrow("cannot be claimed");
  expect(calls).toBe(0);
});

test("cancellation during manual execution cannot publish evidence", async () => {
  const request = await admitted(), controller = new AbortController();
  await expect(runSelectedPilot(backend.db, actor, request.id, { mode: "manual-live-pilot", execute: async () => { controller.abort(); return result(); } }, { allowLive: true, signal: controller.signal })).rejects.toThrow("stopped or failed");
  expect((await getResearch(backend.db, actor, request.id)).state).toBe("failed");
  expect((await backend.db.select().from(productResearchProposals)).length).toBe(0);
});

test("manual publication failure preserves running claim and never repeats inference", async () => {
  const request = await admitted();
  await backend.exec("ALTER TABLE product_research_proposal ADD CONSTRAINT injected_pilot_failure CHECK (false)");
  let calls = 0;
  try {
    await expect(runSelectedPilot(backend.db, actor, request.id, { mode: "manual-live-pilot", execute: async () => { calls++; return result(); } }, { allowLive: true })).rejects.toThrow();
    expect(calls).toBe(1); expect((await getResearch(backend.db, actor, request.id)).state).toBe("running");
  } finally { await backend.exec("ALTER TABLE product_research_proposal DROP CONSTRAINT injected_pilot_failure"); }
});

test("structured contracts reject unsupported links, foreign SKUs, invented quotes and arbitrary fields", () => {
  expect(resultSchema.safeParse(result()).success).toBe(true);
  for (const url of ["http://costco.ca/x", "https://costco.ca.attacker.invalid/x", "https://user:pass@costco.ca/x", "https://127.0.0.1/x", "javascript:alert(1)"]) {
    const bad = result(); bad.sources[0]!.url = url; expect(resultSchema.safeParse(bad).success).toBe(false);
  }
  const bad = result(); bad.fields.name!.value = "Invented"; expect(resultSchema.safeParse(bad).success).toBe(false);
  bad.fields.name!.value = "Fixture product"; bad.sources[0]!.sku = "456"; expect(resultSchema.safeParse(bad).success).toBe(false);
  expect(resultSchema.safeParse({ ...result(), approved: true }).success).toBe(false);
});

test("execution defaults off and one global claim cannot be stolen, even after lease expiry", async () => {
  await admitted(); await admitted("org-b");
  expect(await claimNext(backend.db, { ...policy, enabled: false })).toBeNull();
  const claims = await Promise.all([claimNext(backend.db, policy), claimNext(backend.db, policy)]);
  expect(claims.filter(Boolean).length).toBe(1);
  const claim = claims.find(Boolean)!;
  expect(await claimNext(backend.db, policy, new Date(Date.now() + 120_000))).toBeNull();
  expect(await renewClaim(backend.db, { ...claim, token: crypto.randomUUID() })).toBe(false);
  await expect(publishResult(backend.db, claim, result(), new Date(Date.now() + 120_000))).rejects.toThrow("expired");
});

test("publication is idempotent and never approves product data", async () => {
  const { claim } = await proposed();
  expect((await publishResult(backend.db, claim, result())).state).toBe("awaiting_review");
  expect((await backend.db.select().from(productResearchProposals)).length).toBe(1);
  expect((await backend.db.select().from(approvedProducts)).length).toBe(0);
  await expect(publishResult(backend.db, claim, { ...result(), model: "different" })).rejects.toThrow("different result");
  await expect(publishResult(backend.db, { ...claim, token: crypto.randomUUID() }, result())).rejects.toThrow("no longer current");
});

test("inbox is scoped and current membership/organization role are checked server-side", async () => {
  const foreign = await admitted("org-b"); const { request } = await proposed();
  expect((await listResearch(backend.db, actor)).items.map((row) => row.id)).toEqual([request.id]);
  await expect(getResearch(backend.db, actor, foreign.id)).rejects.toThrow("not found");
  await expect(listResearch(backend.db, { ...actor, userId: "outsider" })).rejects.toThrow("membership");
  expect((await getResearch(backend.db, { ...actor, userId: "viewer" }, request.id)).canDecide).toBe(false);
  await expect(decideResearch(backend.db, { ...actor, userId: "viewer" }, request.id, "approve", approve())).rejects.toThrow("owner or admin");
  await backend.db.delete(member).where(eq(member.id, "owner-a"));
  await expect(decideResearch(backend.db, actor, request.id, "approve", approve())).rejects.toThrow("membership");
});

test("approval applies only selected supported fields, is audited/idempotent, and preserves receipt facts", async () => {
  const { request } = await proposed();
  const before = await backend.db.select().from(receiptItems), body = approve();
  expect(await decideResearch(backend.db, actor, request.id, "approve", body)).toMatchObject({ state: "approved" });
  expect(await decideResearch(backend.db, actor, request.id, "approve", body)).toMatchObject({ state: "approved" });
  const [product] = await backend.db.select().from(approvedProducts);
  expect(product).toMatchObject({ name: "Fixture product", brand: null, sizeText: "907 g", version: 1 });
  expect((await backend.db.select().from(productResearchDecisions)).length).toBe(1);
  expect(await backend.db.select().from(receiptItems)).toEqual(before);
  const metadata = await receiptEnrichment(backend.db, "org-a", before, true);
  expect(metadata.get(before[0]!.id)?.product?.name).toBe("Fixture product");
  await expect(decideResearch(backend.db, actor, request.id, "approve", { ...body, fields: ["brand"] })).rejects.toThrow("another action");
});

test("approval and audit rollback together if the final decision write fails", async () => {
  const { request } = await proposed(), body = approve();
  await backend.exec("ALTER TABLE product_research_decision ADD CONSTRAINT injected_decision_failure CHECK (false)");
  try {
    await expect(decideResearch(backend.db, actor, request.id, "approve", body)).rejects.toThrow();
    expect((await backend.db.select().from(approvedProducts)).length).toBe(0);
    expect((await getResearch(backend.db, actor, request.id)).state).toBe("awaiting_review");
  } finally { await backend.exec("ALTER TABLE product_research_decision DROP CONSTRAINT injected_decision_failure"); }
  expect((await decideResearch(backend.db, actor, request.id, "approve", body)).state).toBe("approved");
});

test("concurrent conflicting decisions have exactly one winner", async () => {
  const { request } = await proposed();
  const responses = await Promise.allSettled([
    decideResearch(backend.db, actor, request.id, "approve", approve()),
    decideResearch(backend.db, actor, request.id, "reject", { revision: 1, expectedProductVersion: 0, idempotencyKey: crypto.randomUUID(), reason: "Wrong product" }),
  ]);
  expect(responses.filter((row) => row.status === "fulfilled").length).toBe(1);
  expect((await backend.db.select().from(productResearchDecisions)).length).toBe(1);
});

test("stale product versions and unsupported selected fields cannot overwrite the catalog", async () => {
  const { request } = await proposed();
  await expect(decideResearch(backend.db, actor, request.id, "approve", { ...approve(), fields: ["variant"] })).rejects.toThrow("no supported");
  await backend.db.insert(approvedProducts).values({ identityId: request.identityId, name: "Approved elsewhere", version: 1 });
  await expect(decideResearch(backend.db, actor, request.id, "approve", approve())).rejects.toThrow("changed");
  expect((await backend.db.select().from(approvedProducts))[0]?.name).toBe("Approved elsewhere");
  const refreshed = await getResearch(backend.db, actor, request.id);
  expect(refreshed.expectedProductVersion).toBe(1);
  await decideResearch(backend.db, actor, request.id, "reject", { revision: 1, expectedProductVersion: 1, idempotencyKey: crypto.randomUUID(), reason: "Stale proposal" });
  expect((await backend.db.select().from(approvedProducts))[0]?.name).toBe("Approved elsewhere");
});

test("search-only proposals require explicit weak-evidence acknowledgment", async () => {
  const request = await admitted(), claim = (await claimNext(backend.db, policy))!, weak = result();
  weak.evidenceStatus = "search_only"; weak.sources[0]!.kind = "hosted_search";
  await publishResult(backend.db, claim, weak);
  const body = approve();
  await expect(decideResearch(backend.db, actor, request.id, "approve", body)).rejects.toThrow("acknowledgment");
  await decideResearch(backend.db, actor, request.id, "approve", { ...body, acknowledgeWeakEvidence: true });
  expect((await backend.db.select().from(productResearchDecisions))[0]?.weakEvidenceAcknowledged).toBe(true);
});

test("re-research ledger preserves old keys through repeated paused actions and a later promotion", async () => {
  const request = await admitted("org-a", admissionPolicy({}));
  const body = { idempotencyKey: crypto.randomUUID(), acknowledgeCost: true };
  await researchAgain(backend.db, actor, request.id, body, admissionPolicy({}));
  await researchAgain(backend.db, actor, request.id, { ...body, idempotencyKey: crypto.randomUUID() }, admissionPolicy({}));
  expect((await researchAgain(backend.db, actor, request.id, body, policy)).state).toBe("paused");
  const fresh = { ...body, idempotencyKey: crypto.randomUUID() };
  expect((await researchAgain(backend.db, actor, request.id, fresh, policy)).state).toBe("queued");
  expect((await researchAgain(backend.db, actor, request.id, fresh, policy)).requestId).toBe(request.id);
  expect((await backend.db.select().from(productResearchAdmissionActions)).length).toBe(3);
});

test("a new research generation preserves existing approved fields and updates receipt status to the latest request", async () => {
  const { request } = await proposed();
  await decideResearch(backend.db, actor, request.id, "approve", approve());
  const next = await researchAgain(backend.db, actor, request.id, { idempotencyKey: crypto.randomUUID(), acknowledgeCost: true }, policy);
  expect(next.requestId).not.toBe(request.id);
  expect((await getResearch(backend.db, actor, next.requestId)).receipts.length).toBe(1);
  const claim = (await claimNext(backend.db, policy))!;
  await publishResult(backend.db, claim, result());
  await decideResearch(backend.db, actor, next.requestId, "approve", { revision: 1, expectedProductVersion: 1, fields: ["brand"], idempotencyKey: crypto.randomUUID() });
  expect((await backend.db.select().from(approvedProducts))[0]).toMatchObject({ name: "Fixture product", sizeText: "907 g", brand: "Fixture brand", version: 2 });
  const lines = await backend.db.select().from(receiptItems);
  expect((await receiptEnrichment(backend.db, "org-a", lines, true)).get(lines[0]!.id)?.research?.requestId).toBe(next.requestId);
});

test("receipt deletion cancels unpublished work and stale workers cannot resurrect it", async () => {
  await admitted(); const claim = (await claimNext(backend.db, policy))!;
  expect((await deleteOrganizationReceipts(backend.db, actor)).deleted).toBe(1);
  expect(await renewClaim(backend.db, claim)).toBe(false);
  await expect(publishResult(backend.db, claim, result())).rejects.toThrow("no longer current");
  expect((await backend.db.select().from(productResearchProposals)).length).toBe(0);
});

test("unapproved and foreign-market receipt lines never display proposed catalog facts", async () => {
  await proposed();
  await importReceipts(backend.db, input("00123", "US"), "org-a", "owner", { policy });
  const lines = await backend.db.select().from(receiptItems);
  const before = await receiptEnrichment(backend.db, "org-a", lines, true);
  expect([...before.values()].every((row) => row.product === null)).toBe(true);
  expect(before.size).toBe(1); // The contradictory-market receipt has no verified identity association.
});

test("offline runner is opt-in and malformed executor results fail without a proposal", async () => {
  await admitted(); let calls = 0;
  const executor = { mode: "offline" as const, execute: async () => { calls++; return { invented: true }; } };
  expect(await runNext(backend.db, { ...policy, enabled: false }, executor)).toBeNull();
  expect(calls).toBe(0);
  expect((await runNext(backend.db, policy, executor))?.state).toBe("failed");
  expect((await backend.db.select().from(productResearchProposals)).length).toBe(0);
});

test("publication failure preserves the claim for saved-result retry without repeating execution", async () => {
  await admitted(); let executions = 0;
  await backend.exec("ALTER TABLE product_research_proposal ADD CONSTRAINT injected_publish_failure CHECK (false)");
  try {
    await expect(runNext(backend.db, policy, { mode: "offline", execute: async () => { executions++; return result(); } })).rejects.toThrow();
  } finally { await backend.exec("ALTER TABLE product_research_proposal DROP CONSTRAINT injected_publish_failure"); }
  const [request] = await backend.db.select().from(productResearchRequests);
  expect(request!.state).toBe("running");
  const [identity] = await backend.db.select().from(productIdentities).where(eq(productIdentities.id, request!.identityId));
  await publishResult(backend.db, { requestId: request!.id, identityId: identity!.id, organizationId: identity!.organizationId, sku: identity!.sku, token: request!.claimToken! }, result());
  expect(executions).toBe(1);
  expect((await backend.db.select().from(productResearchProposals)).length).toBe(1);
});

test("pagination retains microsecond precision and does not skip tied timestamps", async () => {
  const batch = input();
  batch[0]!.itemArray = Array.from({ length: 21 }, (_, i) => ({ itemDescription01: "Fixture", itemNumber: String(1000 + i), unit: 1, amount: 1 }));
  await importReceipts(backend.db, batch, "org-a", "owner", { policy: { ...policy, globalDailyLimit: 100, organizationDailyLimit: 100 } });
  await backend.exec("UPDATE product_research_request SET created_at = '2026-11-07T12:00:00.123456Z'");
  const first = await listResearch(backend.db, actor);
  expect(first.items.length).toBe(20); expect(first.nextCursor).not.toBeNull();
  const second = await listResearch(backend.db, actor, { cursor: first.nextCursor });
  expect(second.items.length).toBe(1); expect(second.nextCursor).toBeNull();
  expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(21);
});

test("unresolved results are visible without catalog fields or an approval path", async () => {
  const request = await admitted(), claim = (await claimNext(backend.db, policy))!;
  await publishResult(backend.db, claim, { ...result(), outcome: "unresolved", fields: {}, sources: [], evidenceStatus: "unresolved" });
  expect((await getResearch(backend.db, actor, request.id)).state).toBe("unresolved");
  await expect(decideResearch(backend.db, actor, request.id, "approve", approve())).rejects.toThrow("changed");
  expect((await backend.db.select().from(approvedProducts)).length).toBe(0);
});

test("HTTP actions enforce origin, authentication, payload schemas and safe errors", async () => {
  const { request } = await proposed();
  const app = createResearchRoutes({ db: backend.db, origin: "https://app.example.invalid", middleware: [async (c, next) => {
    const id = c.req.header("x-fixture-user") ?? "owner";
    c.set("user", id === "none" ? null : { id } as AppVariables["user"]); c.set("orgId", "org-a"); await next();
  }] });
  const post = (origin?: string, body: unknown = approve(), who = "owner") => app.request(`/${request.id}/approve`, { method: "POST", headers: {
    "content-type": "application/json", "x-fixture-user": who, ...(origin ? { origin } : {}),
  }, body: JSON.stringify(body) });
  expect((await post()).status).toBe(403);
  expect((await post("https://attacker.invalid")).status).toBe(403);
  expect((await post("https://app.example.invalid", approve(), "none")).status).toBe(401);
  expect((await post("https://app.example.invalid", { ...approve(), organizationId: "org-b" })).status).toBe(400);
  expect((await post("https://app.example.invalid", approve(), "viewer")).status).toBe(403);
  expect((await app.request("/?cursor=not-a-cursor")).status).toBe(400);
  expect((await post("https://app.example.invalid", { ...approve(), padding: "x".repeat(17_000) })).status).toBe(413);
  expect((await app.request("/context")).status).toBe(200);
  expect((await post("https://app.example.invalid")).status).toBe(200);
});
