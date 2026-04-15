import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { SQSEvent } from "aws-lambda";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import {
  receiptItems,
  receiptJobs,
  receiptTaxes,
  receiptTenders,
  receipts,
} from "@benstack-aws/db/schema/receipts";

// ── DB connection ────────────────────────────────────────────────────────────

const db: NodePgDatabase = drizzle(process.env.DATABASE_URL!);

// ── S3 client ────────────────────────────────────────────────────────────────

const s3 = new S3Client({});

// ── Costco receipt types ─────────────────────────────────────────────────────

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

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── Insert logic ─────────────────────────────────────────────────────────────

async function insertReceipts(
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

// ── Lambda handler ───────────────────────────────────────────────────────────

export const handler = async (event: SQSEvent) => {
  for (const record of event.Records) {
    const body = JSON.parse(record.body) as {
      Records: Array<{ s3: { bucket: { name: string }; object: { key: string } } }>;
    };

    for (const s3Record of body.Records) {
      const bucket = s3Record.s3.bucket.name;
      // S3 URL-encodes the key — decode it before use
      const key = decodeURIComponent(s3Record.s3.object.key.replace(/\+/g, " "));

      // Key format: uploads/{orgId}/{jobId}/receipts.json
      const [, orgId, jobId] = key.split("/");

      if (!orgId || !jobId) {
        console.error(`Unexpected S3 key format: ${key}`);
        continue;
      }

      try {
        // Mark job as processing
        await db
          .update(receiptJobs)
          .set({ status: "processing", updatedAt: new Date() })
          .where(eq(receiptJobs.id, jobId));

        // Fetch job to get uploadedBy
        const [job] = await db
          .select()
          .from(receiptJobs)
          .where(eq(receiptJobs.id, jobId))
          .limit(1);

        if (!job) throw new Error(`Job ${jobId} not found`);

        // Download file from S3
        const response = await s3.send(
          new GetObjectCommand({ Bucket: bucket, Key: key }),
        );
        const text = await response.Body!.transformToString();
        const parsed = JSON.parse(text) as unknown;
        const data: CostcoReceipt[] = Array.isArray(parsed)
          ? parsed
          : (parsed as { receipts: CostcoReceipt[] }).receipts;

        // Process receipts
        const result = await insertReceipts(data, orgId, job.uploadedBy);

        // Mark job done
        await db
          .update(receiptJobs)
          .set({
            status: "done",
            imported: result.imported,
            skipped: result.skipped,
            total: result.total,
            updatedAt: new Date(),
          })
          .where(eq(receiptJobs.id, jobId));

        console.log(
          `Job ${jobId} complete — imported: ${result.imported}, skipped: ${result.skipped}`,
        );
      } catch (error) {
        console.error(`Job ${jobId} failed:`, error);

        await db
          .update(receiptJobs)
          .set({
            status: "failed",
            errorMessage: String(error),
            updatedAt: new Date(),
          })
          .where(eq(receiptJobs.id, jobId));

        // Re-throw so SQS retries this message
        throw error;
      }
    }
  }
};
