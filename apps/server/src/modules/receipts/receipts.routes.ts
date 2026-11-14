import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { MAX_UPLOAD_BYTES, ReceiptAuthorizationError, ReceiptValidationError } from "@benstack-aws/receipt-import";
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

receipts.post("/upload", bodyLimit({ maxSize: MAX_UPLOAD_BYTES }), async (c) => {
  const user = c.get("user");
  const orgId = c.get("orgId");

  if (!user) return c.json({ error: "Unauthorized" }, { status: 401 });
  if (!orgId) return c.json({ error: "No active organization" }, { status: 403 });

  let data: unknown;
  try {
    if ((c.req.header("content-type") ?? "").includes("multipart/form-data")) {
      const formData = await c.req.formData();
      const file = formData.get("file");
      if (!(file instanceof File)) return c.json({ error: "No file provided" }, 400);
      data = JSON.parse(await file.text());
    } else {
      data = await c.req.json();
    }
  } catch (error) {
    // Hono uses BodyLimitError while reading chunked bodies, HTTPException
    // when a Content-Length is already over the limit. Preserve both as 413.
    if ((error instanceof HTTPException && error.status === 413)
      || (error instanceof Error && error.name === "BodyLimitError")) {
      return c.json({ error: "Receipt upload exceeds the size limit." }, 413);
    }
    return c.json({ error: "Invalid JSON or multipart receipt upload." }, 400);
  }
  try {
    return c.json(await insertReceipts(data, orgId, user.id));
  } catch (error) {
    if (error instanceof ReceiptAuthorizationError) return c.json({ error: error.message }, 403);
    if (error instanceof ReceiptValidationError) {
      return c.json({ error: "Invalid Costco receipt JSON or upload limits exceeded." }, 400);
    }
    console.error("Receipt import failed; diagnostics withheld.");
    return c.json({ error: "Failed to import receipts; retry the upload." }, 500);
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
  const user = c.get("user");

  if (!user) return c.json({ error: "Unauthorized" }, { status: 401 });
  if (!orgId) return c.json({ error: "No active organization" }, { status: 403 });

  try {
    const result = await deleteAllReceipts(orgId, user.id);
    return c.json(result);
  } catch (error) {
    console.error("Failed to delete receipts:", error);
    return c.json({ error: "Failed to delete receipts" }, { status: 500 });
  }
});

export default receipts;
