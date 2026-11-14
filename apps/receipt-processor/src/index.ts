import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { SQSEvent } from "aws-lambda";
import { Readable } from "node:stream";
import { createTransactionalDb } from "@benstack-aws/db/transactional";
import { MAX_UPLOAD_BYTES } from "@benstack-aws/receipt-import";
import { processUpload } from "./processor";

let db: ReturnType<typeof createTransactionalDb> | undefined;
async function getDb() {
  if (db) return db;
  const path = process.env.SSM_PARAMETER_PATH;
  const token = process.env.AWS_SESSION_TOKEN;
  if (!path || !token) throw new Error("Receipt database configuration unavailable");
  const response = await fetch(
    `http://localhost:2773/systemsmanager/parameters/get?name=${encodeURIComponent(path)}&withDecryption=true`,
    { headers: { "X-Aws-Parameters-Secrets-Token": token }, signal: AbortSignal.timeout(10_000) },
  );
  if (!response.ok) throw new Error("Receipt database configuration unavailable");
  const config: unknown = await response.json();
  if (!config || typeof config !== "object" || !("Parameter" in config)
    || !config.Parameter || typeof config.Parameter !== "object" || !("Value" in config.Parameter)
    || typeof config.Parameter.Value !== "string") throw new Error("Invalid receipt database configuration");
  db = createTransactionalDb(config.Parameter.Value);
  return db;
}

const s3 = new S3Client({});
async function readUpload(bucket: string, key: string) {
  const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(30_000) });
  if (!(response.Body instanceof Readable)) throw new Error("Missing receipt upload body");
  if (response.ContentLength === undefined || response.ContentLength > MAX_UPLOAD_BYTES) {
    response.Body.destroy();
    throw new Error("Receipt upload exceeds the size limit");
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of response.Body) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_UPLOAD_BYTES) { response.Body.destroy(); throw new Error("Receipt upload exceeds the size limit"); }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export const handler = async (event: SQSEvent) => {
  try {
    const database = await getDb();
    const expectedBucket = process.env.S3_RECEIPTS_BUCKET;
    if (!expectedBucket) throw new Error("Receipt bucket is not configured");
    for (const record of event.Records) {
      const body: unknown = JSON.parse(record.body);
      if (body && typeof body === "object" && "Event" in body && body.Event === "s3:TestEvent") continue;
      if (!body || typeof body !== "object" || !("Records" in body) || !Array.isArray(body.Records)) throw new Error("Invalid S3 notification");
      for (const notification of body.Records) {
        if (notification?.eventSource !== "aws:s3" || typeof notification.s3?.bucket?.name !== "string"
          || typeof notification.s3?.object?.key !== "string") throw new Error("Invalid S3 notification");
        await processUpload({ db: database, bucket: notification.s3.bucket.name, expectedBucket,
          encodedKey: notification.s3.object.key, readUpload });
      }
    }
  } catch {
    // Error responses can be persisted by Lambda/SQS. Never forward raw driver,
    // credential-store or receipt payload errors out of this boundary.
    throw new Error("Receipt processing failed; the message will be retried. Diagnostics withheld.");
  }
};
