import { and, eq } from "drizzle-orm";
import { receiptJobs } from "@benstack-aws/db/schema/receipts";
import { importReceipts, MAX_UPLOAD_BYTES, ReceiptValidationError, type ImportDatabase } from "@benstack-aws/receipt-import";
import type { AdmissionPolicy } from "@benstack-aws/receipt-import";

export function parseUploadKey(encodedKey: string) {
  let key: string;
  try { key = decodeURIComponent(encodedKey.replace(/\+/g, " ")); }
  catch { throw new Error("Invalid receipt upload key"); }
  const match = /^uploads\/([^/]+)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/receipts\.json$/i.exec(key);
  if (!match || !/^[A-Za-z0-9_-]{1,128}$/.test(match[1]!)) throw new Error("Invalid receipt upload key");
  return { key, organizationId: match[1]!, jobId: match[2]! };
}

export async function processUpload(options: {
  db: ImportDatabase;
  bucket: string;
  expectedBucket: string;
  encodedKey: string;
  readUpload: (bucket: string, key: string) => Promise<string>;
  policy?: AdmissionPolicy;
}) {
  if (!options.expectedBucket || options.bucket !== options.expectedBucket) throw new Error("Unexpected receipt bucket");
  const { key, organizationId, jobId } = parseUploadKey(options.encodedKey);
  const condition = and(eq(receiptJobs.id, jobId), eq(receiptJobs.organizationId, organizationId), eq(receiptJobs.s3Key, key));
  const [job] = await options.db.select().from(receiptJobs).where(condition).limit(1);
  if (!job) throw new Error("Receipt job does not match the upload");
  if (job.status === "done") return; // An S3/SQS redelivery must not fetch/import again.
  try {
    await options.db.update(receiptJobs).set({ status: "processing", updatedAt: new Date() }).where(condition);
    const text = await options.readUpload(options.bucket, key);
    if (Buffer.byteLength(text, "utf8") > MAX_UPLOAD_BYTES) throw new ReceiptValidationError();
    let input: unknown;
    try { input = JSON.parse(text); } catch { throw new ReceiptValidationError(); }
    const result = await importReceipts(options.db, input, organizationId, job.uploadedBy, { policy: options.policy });
    await options.db.update(receiptJobs).set({
      status: "done", imported: result.imported, skipped: result.skipped, total: result.total, errorMessage: null, updatedAt: new Date(),
    }).where(condition);
    return result;
  } catch (error) {
    await options.db.update(receiptJobs).set({
      status: "failed", errorMessage: "Receipt import failed. Check the upload and retry; diagnostics withheld.", updatedAt: new Date(),
    }).where(condition);
    throw error; // Let SQS retry. No raw receipt/auth/driver diagnostics in logs or job rows.
  }
}
