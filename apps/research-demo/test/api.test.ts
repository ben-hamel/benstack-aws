import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { createDemoApi } from "../src/api";
import { cleanDemoEnvironment } from "../src/start";
import { sampleReceipts } from "../src/fixtures";

const origin = "http://127.0.0.1:4175";
let demo: Awaited<ReturnType<typeof createDemoApi>>;
const send = (path: string, input?: unknown, method = "POST") => demo.app.request(path, {
  method, headers: { origin, "content-type": "application/json" }, ...(input === undefined ? {} : { body: JSON.stringify(input) }),
});
const state = async () => (await demo.app.request("/api/demo/state")).json() as Promise<{ products: { name: string }[]; receipts: { total: string }[]; items: { description: string; amount: string }[]; requests: { id: string; state: string }[]; decisions: unknown[] }>;

beforeAll(async () => { demo = await createDemoApi(origin); }, 30_000);
afterAll(async () => { await demo?.close(); });
beforeEach(async () => { expect((await send("/api/demo/reset")).status).toBe(200); });

test("launcher strips database, AWS, AI and runtime injection environment settings", () => {
  expect(cleanDemoEnvironment({ PATH: "/bin", HOME: "/tmp/demo-home", LANG: "C", DATABASE_URL: "must-not-copy", AWS_PROFILE: "must-not-copy",
    AWS_ACCESS_KEY_ID: "must-not-copy", OPENAI_API_KEY: "must-not-copy", NODE_OPTIONS: "must-not-copy", VITE_SERVER_URL: "https://must-not-copy.invalid" }))
    .toEqual({ PATH: "/bin", HOME: "/tmp/demo-home", LANG: "C" });
});

test("demo refuses public configuration and untrusted mutation origins", async () => {
  await expect(createDemoApi("https://production.example.invalid")).rejects.toThrow("Tailscale");
  await expect(createDemoApi("http://0.0.0.0:4173")).rejects.toThrow("Tailscale");
  expect((await demo.app.request("/api/demo/reset", { method: "POST" })).status).toBe(403);
  expect((await demo.app.request("/api/demo/reset", { method: "POST", headers: { origin: "https://attacker.invalid" } })).status).toBe(403);
  expect(await (await demo.app.request("/api/demo/info")).json()).toMatchObject({ storage: "memory", providers: "disabled" });
});

test("Tailscale demo uses its exact origin for mutations", async () => {
  const remoteOrigin = "http://100.67.130.3:4173";
  const remote = await createDemoApi(remoteOrigin);
  try {
    expect((await remote.app.request("/api/demo/reset", { method: "POST", headers: { origin: remoteOrigin } })).status).toBe(200);
    expect((await remote.app.request("/api/demo/reset", { method: "POST", headers: { origin } })).status).toBe(403);
  } finally { await remote.close(); }
  // This test initializes a second PostgreSQL/WASM instance, like beforeAll.
}, 30_000);

test("only the exact bundled fictional receipt is accepted", async () => {
  const bad = structuredClone(sampleReceipts); bad[0]!.membershipNumber = "real-looking-data-must-be-refused";
  const response = await send("/api/receipts/upload", bad);
  expect(response.status).toBe(400);
  expect(await response.text()).not.toContain("real-looking-data");
  expect((await state()).receipts).toEqual([]);
  expect((await demo.app.request("/api/demo/sample")).headers.get("content-disposition")).toContain("demo-receipts.json");
});

test("fixture upload simulates proposals; approval/rejection do not change receipt amounts", async () => {
  expect((await send("/api/receipts/upload", sampleReceipts)).status).toBe(200);
  await demo.idle();
  const before = await state(); expect(before.requests.map((request) => request.state)).toEqual(["awaiting_review", "awaiting_review"]);
  expect(before.products).toEqual([]);
  const id = before.requests[0]!.id, other = before.requests[1]!.id;
  expect((await send(`/api/product-research/${id}/approve`, { revision: 1, expectedProductVersion: 0, fields: ["name", "sizeText"], idempotencyKey: crypto.randomUUID() })).status).toBe(200);
  expect((await send(`/api/product-research/${other}/reject`, { revision: 1, expectedProductVersion: 0, reason: "Fictional rejection", idempotencyKey: crypto.randomUUID() })).status).toBe(200);
  const after = await state();
  expect(after.products.length).toBe(1); expect(after.decisions.length).toBe(2);
  expect(after.items).toEqual(before.items); expect(after.receipts).toEqual(before.receipts);
  expect(after.receipts[0]!.total).toBe("25.00");
});

test("normal upload UI uses a local upload slot, not an AWS endpoint", async () => {
  const response = await send("/api/receipts/presign");
  const job = await response.json() as { jobId: string; uploadUrl: string };
  const target = new URL(job.uploadUrl); expect(target.origin).toBe(origin);
  expect((await send(`${target.pathname}?token=wrong`, sampleReceipts, "PUT")).status).toBe(404);
  expect((await send(`${target.pathname}${target.search}`, sampleReceipts, "PUT")).status).toBe(200);
  const status = await (await demo.app.request(`/api/receipts/jobs/${job.jobId}`)).json();
  expect(status).toMatchObject({ status: "done", imported: 1 }); expect(status).not.toHaveProperty("token");
  expect((await send(`${target.pathname}${target.search}`, [{ membershipNumber: "not-the-fixture" }], "PUT")).status).toBe(400);
  expect(await (await demo.app.request(`/api/receipts/jobs/${job.jobId}`)).json()).toMatchObject({ status: "done" });
});

test("duplicate uploads reuse work and reset removes only in-memory demo records", async () => {
  await send("/api/receipts/upload", sampleReceipts); await demo.idle();
  const duplicate = await send("/api/receipts/upload", sampleReceipts);
  expect(await duplicate.json()).toMatchObject({ skipped: 1, imported: 0 });
  expect((await state()).requests.length).toBe(2);
  await send("/api/demo/reset");
  expect(await state()).toMatchObject({ products: [], receipts: [], requests: [], decisions: [] });
});
