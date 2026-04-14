import { auth } from "@benstack-aws/auth";
import { Hono } from "hono";
import { getReceiptDetail, getReceipts, insertReceipts } from "./receipts.service";

type Variables = {
  userId: string;
  orgId: string;
};

const app = new Hono<{ Variables: Variables }>();

app.use("*", async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });

  if (!session) {
    return c.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId = session.session.activeOrganizationId;
  if (!orgId) {
    return c.json({ error: "No active organization" }, { status: 403 });
  }

  c.set("userId", session.user.id);
  c.set("orgId", orgId);
  await next();
});

app.post("/upload", async (c) => {
  const userId = c.get("userId");
  const orgId = c.get("orgId");

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
    const result = await insertReceipts(data as never[], orgId, userId);
    return c.json(result);
  } catch (error) {
    console.error("Failed to import receipts:", error);
    return c.json({ error: "Failed to import receipts" }, { status: 500 });
  }
});

app.get("/", async (c) => {
  const orgId = c.get("orgId");
  try {
    const data = await getReceipts(orgId);
    return c.json(data);
  } catch (error) {
    console.error("Failed to fetch receipts:", error);
    return c.json({ error: "Failed to fetch receipts" }, { status: 500 });
  }
});

app.get("/:id", async (c) => {
  const orgId = c.get("orgId");
  const receiptId = c.req.param("id");
  try {
    const data = await getReceiptDetail(receiptId, orgId);
    if (!data) return c.json({ error: "Receipt not found" }, { status: 404 });
    return c.json(data);
  } catch (error) {
    console.error("Failed to fetch receipt:", error);
    return c.json({ error: "Failed to fetch receipt" }, { status: 500 });
  }
});

export default app;
