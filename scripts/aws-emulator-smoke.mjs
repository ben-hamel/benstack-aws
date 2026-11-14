// Run with Node and NODE_EXTRA_CA_CERTS pointing at the emulator's ca.pem.
// Deliberately independent of app imports, .env files, databases, and real AWS credentials.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(new URL("../apps/server/package.json", import.meta.url));
const {
  S3Client, CreateBucketCommand, PutBucketCorsCommand, PutObjectCommand,
  GetObjectCommand, DeleteObjectCommand, DeleteBucketCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const endpoint = new URL(process.env.EMULATOR_ENDPOINT ?? "https://127.0.0.1:9297");
assert.equal(endpoint.protocol, "https:");
assert.equal(endpoint.hostname, "127.0.0.1", "Refusing a non-loopback endpoint");
assert.ok(endpoint.port, "An explicit emulator port is required");
assert.equal(endpoint.pathname, "/");
assert.equal(endpoint.username + endpoint.password + endpoint.search + endpoint.hash, "");
const directory = process.env.EMULATOR_DIRECTORY;
assert.ok(directory, "Set EMULATOR_DIRECTORY to the emulator's per-port config directory");
assert.equal(process.env.NODE_EXTRA_CA_CERTS, join(directory, "ca.pem"));
const ini = await readFile(join(directory, "emulator_credentials"), "utf8");
const field = (name) => {
  const value = ini.match(new RegExp(`^\\s*${name}\\s*=\\s*(\\S+)\\s*$`, "m"))?.[1];
  assert.ok(value, `Missing ${name}`);
  return value;
};
const accessKeyId = field("aws_access_key_id");
assert.ok(accessKeyId.startsWith("EMULATOR"), "Refusing non-emulator credentials");
const s3 = new S3Client({
  endpoint: endpoint.href,
  region: "us-east-1",
  credentials: { accessKeyId, secretAccessKey: field("aws_secret_access_key") },
  forcePathStyle: true,
  maxAttempts: 1,
  requestChecksumCalculation: "WHEN_REQUIRED",
});
const bucket = `benstack-smoke-${crypto.randomUUID()}`;
const key = "uploads/emulator-test/fake-job/receipts.json";
const origin = "http://localhost:5173";
const payload = JSON.stringify({ testOnly: true, receipts: [] });
const send = (command) => s3.send(command, { abortSignal: AbortSignal.timeout(15_000) });
let created = false;
let uploaded = false;
const gaps = [];
try {
  const health = await fetch(new URL("/__admin/health", endpoint), { signal: AbortSignal.timeout(5_000) });
  assert.equal(health.status, 200);
  console.log("PASS emulator health");
  await send(new CreateBucketCommand({ Bucket: bucket }));
  created = true;
  console.log("PASS create isolated bucket");
  await send(new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: {
    CORSRules: [{ AllowedOrigins: [origin], AllowedMethods: ["PUT"], AllowedHeaders: ["*"] }],
  } }));
  const url = await getSignedUrl(s3, new PutObjectCommand({
    Bucket: bucket, Key: key, ContentType: "application/json",
  }), { expiresIn: 300 });
  assert.equal(new URL(url).origin, endpoint.origin, "Presigned upload must stay local");
  const preflight = await fetch(url, {
    method: "OPTIONS",
    headers: { Origin: origin, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type" },
    signal: AbortSignal.timeout(10_000),
  });
  if (preflight.ok && preflight.headers.get("access-control-allow-origin") === origin
    && preflight.headers.get("access-control-allow-methods")?.includes("PUT")) {
    console.log("PASS browser-style CORS preflight");
  } else {
    gaps.push(`Browser CORS preflight: HTTP ${preflight.status}`);
    console.log(`GAP ${gaps.at(-1)}`);
  }
  await preflight.body?.cancel();
  const upload = await fetch(url, {
    method: "PUT", headers: { "Content-Type": "application/json", Origin: origin },
    body: payload, signal: AbortSignal.timeout(15_000),
  });
  if (upload.ok) {
    uploaded = true;
    console.log("PASS presigned receipt-shaped JSON upload (non-browser client)");
    if (upload.headers.get("access-control-allow-origin") !== origin) {
      gaps.push("Presigned upload response missing expected CORS origin");
      console.log(`GAP ${gaps.at(-1)}`);
    }
    await upload.body?.cancel();
  } else {
    const errorBody = await upload.text();
    const code = errorBody.match(/<Code>([^<]+)<\/Code>/)?.[1] ?? "unknown";
    gaps.push(`Presigned upload: HTTP ${upload.status}, ${code}`);
    console.log(`GAP ${gaps.at(-1)}`);
    await send(new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: "application/json", Body: payload }));
    uploaded = true;
    console.log("PASS fallback signed SDK PutObject");
  }
  const object = await send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  assert.ok(object.Body);
  assert.equal(await object.Body.transformToString(), payload);
  console.log("PASS SDK GetObject matches uploaded data");
  await assert.rejects(send(new GetObjectCommand({ Bucket: bucket, Key: "missing.json" })),
    (error) => error.name === "NoSuchKey" && error.$metadata?.httpStatusCode === 404);
  console.log("PASS missing object returns NoSuchKey/404");
} finally {
  try {
    if (uploaded) await send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    if (created) await send(new DeleteBucketCommand({ Bucket: bucket }));
    console.log("PASS cleanup");
  } finally {
    s3.destroy();
  }
}
if (gaps.length) {
  console.error(`Smoke test found ${gaps.length} compatibility gap(s). Browser uploads are not validated.`);
  process.exitCode = 1;
}
