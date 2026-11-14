import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { count, db, desc, eq } from "@benstack-aws/db";
import { createTransactionalDb } from "@benstack-aws/db/transactional";
import { env } from "@benstack-aws/env/server";
import { importReceipts } from "@benstack-aws/receipt-import";
import { deleteOrganizationReceipts, receiptEnrichment } from "@benstack-aws/product-research";
import { receiptItems, receiptJobs, receiptTaxes, receiptTenders, receipts } from "@benstack-aws/db/schema/receipts";

const s3 = new S3Client({
  region: process.env.AWS_REGION ?? "us-east-1",
  requestChecksumCalculation: "WHEN_REQUIRED",
});
const importDb = createTransactionalDb(env.DATABASE_URL);

export async function createJob(organizationId: string, uploadedBy: string) {
  const [job] = await db.insert(receiptJobs).values({ organizationId, uploadedBy, s3Key: "" })
    .returning({ id: receiptJobs.id });
  if (!job) throw new Error("Failed to create receipt job");
  const s3Key = `uploads/${organizationId}/${job.id}/receipts.json`;
  await db.update(receiptJobs).set({ s3Key }).where(eq(receiptJobs.id, job.id));
  const uploadUrl = await getSignedUrl(s3, new PutObjectCommand({
    Bucket: env.S3_RECEIPTS_BUCKET, Key: s3Key, ContentType: "application/json",
  }), { expiresIn: 300 });
  return { jobId: job.id, uploadUrl };
}

export async function getJob(jobId: string, organizationId: string) {
  const [job] = await db.select().from(receiptJobs).where(eq(receiptJobs.id, jobId)).limit(1);
  if (!job || job.organizationId !== organizationId) return null;
  return job;
}

export function insertReceipts(data: unknown, organizationId: string, uploadedBy: string) {
  return importReceipts(importDb, data, organizationId, uploadedBy);
}

export async function getReceipts(organizationId: string, limit: number, offset: number) {
  const [rows, [countRow]] = await Promise.all([
    db.select().from(receipts).where(eq(receipts.organizationId, organizationId))
      .orderBy(desc(receipts.transactionDate)).limit(limit + 1).offset(offset),
    db.select({ count: count() }).from(receipts).where(eq(receipts.organizationId, organizationId)),
  ]);
  const hasMore = rows.length > limit;
  return { data: hasMore ? rows.slice(0, limit) : rows, hasMore, total: Number(countRow?.count ?? 0) };
}

export function deleteAllReceipts(organizationId: string, userId: string) {
  return deleteOrganizationReceipts(importDb, { organizationId, userId });
}

export async function getReceiptDetail(receiptId: string, organizationId: string) {
  const [receipt] = await db.select().from(receipts).where(eq(receipts.id, receiptId)).limit(1);
  if (!receipt || receipt.organizationId !== organizationId) return null;
  const [items, tenders, taxes] = await Promise.all([
    db.select().from(receiptItems).where(eq(receiptItems.receiptId, receiptId)),
    db.select().from(receiptTenders).where(eq(receiptTenders.receiptId, receiptId)),
    db.select().from(receiptTaxes).where(eq(receiptTaxes.receiptId, receiptId)),
  ]);
  const enrichment = await receiptEnrichment(importDb, organizationId, items,
    receipt.receiptType === "warehouse" && ["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"].includes(receipt.storeProvince ?? ""));
  return { ...receipt, items: items.map((item) => ({ ...item, ...(enrichment.get(item.id) ?? { product: null, research: null }) })), tenders, taxes };
}
