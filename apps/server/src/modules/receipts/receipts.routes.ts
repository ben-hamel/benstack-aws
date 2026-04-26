import { Hono } from "hono";
import {
  authMiddleware,
  orgMiddleware,
} from "../../middleware/auth";
import type { AppEnv } from "../../types/hono";
import {
  createJob,
  deleteAllReceipts,
  getJob,
  getReceiptDetail,
  getReceipts,
  insertReceipts,
} from "./receipts.service";

const receipts = new Hono<AppEnv>();

receipts.use("*", authMiddleware);
receipts.use("*", orgMiddleware);

receipts.post("/presign", async (c) => {
  const user = c.get("user");
  const orgId = c.get("orgId");

  if (!user) return c.json({ error: "Unauthorized" }, { status: 401 });
  if (!orgId) return c.json({ error: "No active organization" }, { status: 403 });

  try {
    const result = await createJob(orgId, user.id);
    return c.json(result);
  } catch (error) {
    console.error("Failed to create upload job:", error);
    return c.json({ error: "Failed to create upload job" }, { status: 500 });
  }
});

receipts.get("/jobs/:id", async (c) => {
  const orgId = c.get("orgId");
  const jobId = c.req.param("id");

  if (!orgId) return c.json({ error: "No active organization" }, { status: 403 });

  try {
    const job = await getJob(jobId, orgId);
    if (!job) return c.json({ error: "Job not found" }, { status: 404 });
    return c.json(job);
  } catch (error) {
    console.error("Failed to fetch job:", error);
    return c.json({ error: "Failed to fetch job" }, { status: 500 });
  }
});

receipts.post("/upload", async (c) => {
  const user = c.get("user");
  const orgId = c.get("orgId");

  if (!user) return c.json({ error: "Unauthorized" }, { status: 401 });
  if (!orgId) return c.json({ error: "No active organization" }, { status: 403 });

  let data: unknown[];

  const contentType = c.req.header("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await c.req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return c.json({ error: "No file provided" }, { status: 400 });
    }
    const text = await file.text();
    const parsed = JSON.parse(text);
    data = Array.isArray(parsed) ? parsed : parsed.receipts;
  } else {
    const body = await c.req.json();
    data = Array.isArray(body) ? body : body.receipts;
  }

  if (!Array.isArray(data) || data.length === 0) {
    return c.json({ error: "No receipts found in upload" }, { status: 400 });
  }

  try {
    const result = await insertReceipts(data as never[], orgId, user.id);
    return c.json(result);
  } catch (error) {
    console.error("Failed to import receipts:", error);
    return c.json({ error: "Failed to import receipts" }, { status: 500 });
  }
});

receipts.get("/", async (c) => {
  const orgId = c.get("orgId");
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 100);
  const offset = Math.max(Number(c.req.query("offset") ?? 0), 0);

  if (!orgId) return c.json({ error: "No active organization" }, { status: 403 });

  try {
    const result = await getReceipts(orgId, limit, offset);
    return c.json(result);
  } catch (error) {
    console.error("Failed to fetch receipts:", error);
    return c.json({ error: "Failed to fetch receipts" }, { status: 500 });
  }
});

receipts.get("/:id", async (c) => {
  const orgId = c.get("orgId");
  const receiptId = c.req.param("id");

  if (!orgId) return c.json({ error: "No active organization" }, { status: 403 });

  try {
    const data = await getReceiptDetail(receiptId, orgId);
    if (!data) return c.json({ error: "Receipt not found" }, { status: 404 });
    return c.json(data);
  } catch (error) {
    console.error("Failed to fetch receipt:", error);
    return c.json({ error: "Failed to fetch receipt" }, { status: 500 });
  }
});

receipts.delete("/", async (c) => {
  const orgId = c.get("orgId");

  if (!orgId) return c.json({ error: "No active organization" }, { status: 403 });

  try {
    const result = await deleteAllReceipts(orgId);
    return c.json(result);
  } catch (error) {
    console.error("Failed to delete receipts:", error);
    return c.json({ error: "Failed to delete receipts" }, { status: 500 });
  }
});

export default receipts;
