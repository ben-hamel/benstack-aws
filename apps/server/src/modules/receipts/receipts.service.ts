import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { db, desc, eq } from "@benstack-aws/db";
import { env } from "@benstack-aws/env/server";
import {
  receiptItems,
  receiptJobs,
  receiptTaxes,
  receiptTenders,
  receipts,
} from "@benstack-aws/db/schema/receipts";

const s3 = new S3Client({
  region: process.env.AWS_REGION ?? "us-east-1",
  requestChecksumCalculation: "WHEN_REQUIRED",
});

export async function createJob(organizationId: string, uploadedBy: string) {
  const [job] = await db
    .insert(receiptJobs)
    .values({ organizationId, uploadedBy, s3Key: "" })
    .returning({ id: receiptJobs.id });

  if (!job) throw new Error("Failed to create receipt job");

  const s3Key = `uploads/${organizationId}/${job.id}/receipts.json`;

  await db
    .update(receiptJobs)
    .set({ s3Key })
    .where(eq(receiptJobs.id, job.id));

  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: env.S3_RECEIPTS_BUCKET,
      Key: s3Key,
      ContentType: "application/json",
    }),
    { expiresIn: 300 },
  );

  return { jobId: job.id, uploadUrl };
}

export async function getJob(jobId: string, organizationId: string) {
  const [job] = await db
    .select()
    .from(receiptJobs)
    .where(eq(receiptJobs.id, jobId))
    .limit(1);

  if (!job || job.organizationId !== organizationId) return null;
  return job;
}

interface CostcoItem {
  itemActualName: string;
  itemDescription01: string;
  itemNumber: string;
  itemDepartmentNumber: number;
  itemUnitPriceAmount: number;
  unit: number;
  amount: number;
  taxFlag: string | null;
  fuelGradeCode: string | null;
  fuelUnitQuantity: number | null;
  fuelUomCode: string | null;
}

interface CostcoTender {
  tenderDescription: string | null;
  tenderTypeCode: string;
  amountTender: number;
  displayAccountNumber: string | null;
}

interface CostcoSubTaxes {
  aTaxAmount: number | null;
  aTaxLegend: string | null;
  aTaxPercent: number | null;
  bTaxAmount: number | null;
  bTaxLegend: string | null;
  bTaxPercent: number | null;
  cTaxAmount: number | null;
  cTaxLegend: string | null;
  cTaxPercent: number | null;
  dTaxAmount: number | null;
}

interface CostcoReceipt {
  documentType: string;
  receiptType: string;
  transactionDate: string;
  transactionDateTime: string;
  transactionDateISO: string;
  transactionBarcode: string;
  subTotal: number;
  taxes: number;
  total: number;
  instantSavings: number;
  warehouseName: string;
  warehouseNumber: number;
  warehouseCity: string;
  warehouseState: string;
  membershipNumber: string;
  itemArray: CostcoItem[];
  tenderArray: CostcoTender[];
  subTaxes: CostcoSubTaxes | null;
}

function classifyItem(item: CostcoItem): string {
  const desc = item.itemDescription01 || item.itemActualName;
  if (item.fuelGradeCode) return "fuel";
  if (desc.startsWith("DEPOSIT/") || desc.startsWith("CONSIGNE/")) return "deposit";
  if (desc.startsWith("TPD/")) return "discount";
  if (desc.startsWith("ECO FEE") || desc.startsWith("ECOFRAIS/")) return "eco_fee";
  return "item";
}

function extractParentItemNumber(desc: string): string | null {
  const match = desc.match(/(?:DEPOSIT|CONSIGNE|TPD|ECO FEE ADS|ECOFRAIS)\/(\d+)/);
  return match?.[1] ?? null;
}

function mapReceiptType(receiptType: string): "warehouse" | "gas_station" {
  return receiptType === "Gas Station" ? "gas_station" : "warehouse";
}

export async function insertReceipts(
  data: CostcoReceipt[],
  organizationId: string,
  uploadedBy: string,
) {
  let imported = 0;
  let skipped = 0;

  for (const receipt of data) {
    try {
      const [inserted] = await db
        .insert(receipts)
        .values({
          organizationId,
          source: "json",
          receiptType: mapReceiptType(receipt.receiptType),
          transactionDate: receipt.transactionDate,
          transactionDateTimeLocal: receipt.transactionDateTime
            ? new Date(receipt.transactionDateTime)
            : null,
          transactionDateTimeUtc: receipt.transactionDateISO
            ? new Date(receipt.transactionDateISO)
            : null,
          transactionBarcode: receipt.transactionBarcode,
          subtotal: receipt.subTotal.toFixed(2),
          taxes: receipt.taxes.toFixed(2),
          total: receipt.total.toFixed(2),
          instantSavings: receipt.instantSavings
            ? receipt.instantSavings.toFixed(2)
            : null,
          storeName: receipt.warehouseName,
          storeNumber: receipt.warehouseNumber,
          storeCity: receipt.warehouseCity,
          storeProvince: receipt.warehouseState,
          membershipNumber: receipt.membershipNumber,
          uploadedBy,
        })
        .onConflictDoNothing({
          target: [receipts.organizationId, receipts.transactionBarcode],
        })
        .returning({ id: receipts.id });

      if (!inserted) {
        skipped++;
        continue;
      }

      const receiptId = inserted.id;

      if (receipt.itemArray.length > 0) {
        await db.insert(receiptItems).values(
          receipt.itemArray.map((item) => {
            const type = classifyItem(item);
            return {
              receiptId,
              type: type as "item" | "deposit" | "discount" | "eco_fee" | "fuel",
              description: item.itemDescription01 || item.itemActualName,
              itemNumber: item.itemNumber,
              departmentNumber: item.itemDepartmentNumber,
              unitPrice: item.itemUnitPriceAmount
                ? item.itemUnitPriceAmount.toFixed(2)
                : null,
              quantity: item.unit,
              amount: item.amount.toFixed(2),
              taxFlag: item.taxFlag,
              fuelQuantityLitres:
                type === "fuel" && item.fuelUnitQuantity
                  ? item.fuelUnitQuantity.toFixed(3)
                  : null,
              fuelPricePerLitre:
                type === "fuel" && item.itemUnitPriceAmount
                  ? item.itemUnitPriceAmount.toFixed(3)
                  : null,
              parentItemNumber: extractParentItemNumber(
                item.itemDescription01 || item.itemActualName,
              ),
            };
          }),
        );
      }

      if (receipt.tenderArray.length > 0) {
        await db.insert(receiptTenders).values(
          receipt.tenderArray.map((tender) => ({
            receiptId,
            description: tender.tenderDescription,
            tenderTypeCode: tender.tenderTypeCode,
            amount: tender.amountTender.toFixed(2),
            cardLast4: tender.displayAccountNumber,
          })),
        );
      }

      const taxSlots = receipt.subTaxes
        ? [
            {
              legend: receipt.subTaxes.aTaxLegend,
              percent: receipt.subTaxes.aTaxPercent,
              amount: receipt.subTaxes.aTaxAmount,
            },
            {
              legend: receipt.subTaxes.bTaxLegend,
              percent: receipt.subTaxes.bTaxPercent,
              amount: receipt.subTaxes.bTaxAmount,
            },
            {
              legend: receipt.subTaxes.cTaxLegend,
              percent: receipt.subTaxes.cTaxPercent,
              amount: receipt.subTaxes.cTaxAmount,
            },
          ].filter(
            (t): t is { legend: string; percent: number; amount: number } =>
              t.legend != null && t.percent != null && t.amount != null,
          )
        : [];

      if (taxSlots.length > 0) {
        await db.insert(receiptTaxes).values(
          taxSlots.map((tax) => ({
            receiptId,
            legend: tax.legend,
            percent: tax.percent.toFixed(2),
            amount: tax.amount.toFixed(2),
          })),
        );
      }

      imported++;
    } catch (error) {
      console.error(`Failed to insert receipt ${receipt.transactionBarcode}:`, error);
      skipped++;
    }
  }

  return { imported, total: data.length, skipped };
}

export async function getReceipts(organizationId: string) {
  return db
    .select()
    .from(receipts)
    .where(eq(receipts.organizationId, organizationId))
    .orderBy(desc(receipts.transactionDate));
}

export async function getReceiptDetail(receiptId: string, organizationId: string) {
  const [receipt] = await db
    .select()
    .from(receipts)
    .where(eq(receipts.id, receiptId))
    .limit(1);

  if (!receipt || receipt.organizationId !== organizationId) return null;

  const [items, tenders, taxes] = await Promise.all([
    db.select().from(receiptItems).where(eq(receiptItems.receiptId, receiptId)),
    db.select().from(receiptTenders).where(eq(receiptTenders.receiptId, receiptId)),
    db.select().from(receiptTaxes).where(eq(receiptTaxes.receiptId, receiptId)),
  ]);

  return { ...receipt, items, tenders, taxes };
}
