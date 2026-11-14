import { randomUUID } from "node:crypto";
import { demoHost } from "./host";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { count, desc, eq } from "drizzle-orm";
import { receiptItems, receipts, receiptTaxes, receiptTenders } from "@benstack-aws/db/schema/receipts";
import { approvedProducts, productResearchDecisions, productResearchRequests } from "@benstack-aws/db/schema/product-research";
import { importReceipts } from "@benstack-aws/receipt-import";
import { deleteOrganizationReceipts, receiptEnrichment } from "@benstack-aws/product-research";
import { runAutomaticOffline } from "@benstack-aws/product-research/automatic";
import { ResearchError } from "@benstack-aws/product-research/database";
import { createResearchRoutes } from "../../server/src/modules/product-research/product-research.http";
import type { AppEnv } from "../../server/src/types/hono";
import { createDemoDatabase } from "./database";
import { DEMO_ORG, DEMO_SESSION, DEMO_USER, DemoInputError, demoPolicy, onlyFixture, sampleReceipts, simulatedResult } from "./fixtures";

type Job = { id: string; token: string; status: "pending" | "processing" | "done" | "failed"; imported?: number; skipped?: number; total?: number; errorMessage?: string };

export async function createDemoApi(origin: string) {
  const url = new URL(origin);
  demoHost(url.hostname);
  if (url.protocol !== "http:" || url.origin !== origin) throw new Error("The demo requires an exact HTTP origin.");
  const database = await createDemoDatabase(), { db } = database;
  const actor = { organizationId: DEMO_ORG, userId: DEMO_USER };
  const jobs = new Map<string, Job>();
  let worker: Promise<void> | null = null;
  let writes: Promise<unknown> = Promise.resolve();
  function serialized<T>(operation: () => Promise<T>): Promise<T> {
    const pending = writes.then(operation); writes = pending.catch(() => undefined); return pending;
  }
  function pump() {
    if (worker) return;
    worker = runAutomaticOffline(db, { mode: "offline", execute: async (claim, signal) => {
      signal.throwIfAborted();
      // Static fixtures only: no model, page reader, DNS or provider credentials.
      return simulatedResult(claim.sku);
    } }, { policy: () => demoPolicy, maxJobs: 2, stopWhenIdle: true })
      .then(() => undefined).catch(() => console.error("Demo simulation stopped; reset the disposable demo to retry.")).finally(() => { worker = null; });
  }
  async function upload(input: unknown) {
    const fixture = onlyFixture(input);
    return serialized(async () => {
      const result = await importReceipts(db, fixture, DEMO_ORG, DEMO_USER, { policy: demoPolicy });
      pump(); return result;
    });
  }
  function session() {
    const now = new Date();
    return { user: { id: DEMO_USER, name: "Demo Owner (fictional)", email: "demo@example.invalid", emailVerified: true, createdAt: now, updatedAt: now, image: null, banned: false, role: "user", banReason: null, banExpires: null },
      session: { id: DEMO_SESSION, token: "fictional-demo-token", userId: DEMO_USER, activeOrganizationId: DEMO_ORG,
        expiresAt: new Date(Date.now() + 86_400_000), createdAt: now, updatedAt: now } };
  }
  const app = new Hono<AppEnv>();
  app.use("*", bodyLimit({ maxSize: 128_000 }));
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    if (!["GET", "HEAD"].includes(c.req.method) && c.req.header("origin") !== origin) return c.json({ error: "Trusted local demo origin required." }, 403);
    await next();
  });
  app.onError((error, c) => {
    if (error instanceof DemoInputError) return c.json({ error: error.message }, 400);
    if (error instanceof ResearchError) return c.json({ error: error.message }, error.status);
    if ((error instanceof HTTPException && error.status === 413) || error.name === "BodyLimitError") return c.json({ error: "Only the small bundled fixture is supported." }, 413);
    if (error instanceof SyntaxError) return c.json({ error: "Invalid demo JSON." }, 400);
    console.error("Disposable demo operation failed; diagnostics withheld.");
    return c.json({ error: "Demo operation failed. Reset the disposable demo and retry." }, 500);
  });
  app.get("/api/auth/get-session", (c) => c.json(session()));
  app.get("/api/demo/info", (c) => c.json({ demo: true, syntheticOnly: true, storage: "memory", providers: "disabled" }));
  app.get("/api/demo/sample", (c) => c.body(`${JSON.stringify(sampleReceipts, null, 2)}\n`, 200, {
    "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="demo-receipts.json"',
  }));
  app.post("/api/demo/reset", async (c) => {
    await serialized(async () => { await worker; await database.reset(); jobs.clear(); });
    return c.json({ reset: true });
  });
  app.get("/api/demo/state", async (c) => c.json({ products: await db.select().from(approvedProducts),
    requests: await db.select().from(productResearchRequests), decisions: await db.select().from(productResearchDecisions),
    receipts: await db.select().from(receipts), items: await db.select().from(receiptItems) }));
  app.route("/api/product-research", createResearchRoutes({ db, origin, admissionPolicy: demoPolicy, middleware: [async (c, next) => {
    const fake = session(); c.set("user", fake.user); c.set("orgId", DEMO_ORG); await next();
  }] }));
  app.post("/api/receipts/presign", (c) => {
    if (jobs.size >= 100) return c.json({ error: "Reset the demo before creating more upload slots." }, 409);
    const job: Job = { id: randomUUID(), token: randomUUID(), status: "pending" }; jobs.set(job.id, job);
    return c.json({ jobId: job.id, uploadUrl: `${origin}/api/demo/uploads/${job.id}?token=${job.token}` });
  });
  app.put("/api/demo/uploads/:id", async (c) => {
    const job = jobs.get(c.req.param("id"));
    if (!job || c.req.query("token") !== job.token) return c.json({ error: "Unknown demo upload slot." }, 404);
    const input: unknown = await c.req.json();
    onlyFixture(input);
    if (job.status === "done") return c.json({ status: "done" });
    try {
      job.status = "processing";
      const result = await upload(input);
      Object.assign(job, { status: "done", imported: result.imported, skipped: result.skipped, total: result.total });
      return c.json(result);
    } catch (error) { job.status = "failed"; job.errorMessage = "Only the bundled fictional receipt can be imported."; throw error; }
  });
  app.get("/api/receipts/jobs/:id", (c) => {
    const job = jobs.get(c.req.param("id"));
    return job ? c.json({ status: job.status, imported: job.imported ?? null, skipped: job.skipped ?? null, total: job.total ?? null, errorMessage: job.errorMessage ?? null }) : c.json({ error: "Demo job not found." }, 404);
  });
  app.post("/api/receipts/upload", async (c) => {
    let input: unknown;
    if ((c.req.header("content-type") ?? "").includes("multipart/form-data")) {
      const form = await c.req.formData(), file = form.get("file");
      if (!(file instanceof File)) return c.json({ error: "Choose demo-receipts.json." }, 400);
      input = JSON.parse(await file.text());
    } else input = await c.req.json();
    return c.json(await upload(input));
  });
  app.get("/api/receipts", async (c) => {
    const limit = Number(c.req.query("limit") ?? 10), offset = Number(c.req.query("offset") ?? 0);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 1_000) return c.json({ error: "Invalid page." }, 400);
    const rows = await db.select().from(receipts).where(eq(receipts.organizationId, DEMO_ORG)).orderBy(desc(receipts.createdAt)).limit(limit + 1).offset(offset);
    const [total] = await db.select({ count: count() }).from(receipts).where(eq(receipts.organizationId, DEMO_ORG));
    return c.json({ data: rows.slice(0, limit), total: Number(total?.count ?? 0), hasMore: rows.length > limit });
  });
  app.delete("/api/receipts", async (c) => c.json(await deleteOrganizationReceipts(db, actor)));
  app.get("/api/receipts/:id", async (c) => {
    if (!/^[0-9a-f-]{36}$/i.test(c.req.param("id"))) return c.json({ error: "Invalid demo receipt ID." }, 400);
    const [receipt] = await db.select().from(receipts).where(eq(receipts.id, c.req.param("id")));
    if (!receipt || receipt.organizationId !== DEMO_ORG) return c.json({ error: "Demo receipt not found." }, 404);
    const items = await db.select().from(receiptItems).where(eq(receiptItems.receiptId, receipt.id));
    const enrichment = await receiptEnrichment(db, DEMO_ORG, items, true);
    return c.json({ ...receipt, items: items.map((item) => ({ ...item, ...(enrichment.get(item.id) ?? { product: null, research: null }) })),
      tenders: await db.select().from(receiptTenders).where(eq(receiptTenders.receiptId, receipt.id)),
      taxes: await db.select().from(receiptTaxes).where(eq(receiptTaxes.receiptId, receipt.id)) });
  });
  app.all("/api/*", (c) => c.json({ error: "Only receipt and research demo operations are available. No real authentication or AI service is connected." }, 404));
  return { app, idle: async () => { await writes; await worker; }, close: async () => { await writes; await worker; await database.close(); } };
}
