import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { member } from "@benstack-aws/db/schema/auth";
import { receiptItems, receiptTaxes, receiptTenders, receipts } from "@benstack-aws/db/schema/receipts";
import { admitResearch, type AdmissionDecision } from "./admission";
import type { ImportDatabase } from "./database";
import { admissionPolicy, type AdmissionPolicy } from "./policy";
import { classifyItem, parentItemNumber, parseReceiptUpload, ReceiptAuthorizationError } from "./validation";

export { admissionPolicy, type AdmissionPolicy } from "./policy";
export { MAX_UPLOAD_BYTES, parseReceiptUpload, ReceiptAuthorizationError, ReceiptValidationError } from "./validation";
export type { ImportDatabase } from "./database";

export interface ImportResult {
  imported: number;
  skipped: number;
  total: number;
  research: { queued: number; paused: number; reused: number; approved: number; excluded: number; cooldown: number; capacityBlocked: number };
}

/** Each receipt is atomic, not the whole file. On failure, throw so HTTP/SQS can
 * retry; earlier committed receipts are then duplicates, never partial headers.
 * Validation is shared by every caller and happens before the first DB write.
 */
export async function importReceipts(
  db: ImportDatabase,
  input: unknown,
  organizationId: string,
  uploadedBy: string,
  options: { policy?: AdmissionPolicy; now?: Date } = {},
): Promise<ImportResult> {
  const data = parseReceiptUpload(input);
  const policy = options.policy ?? admissionPolicy();
  const now = options.now ?? new Date();
  const result: ImportResult = { imported: 0, skipped: 0, total: data.length,
    research: { queued: 0, paused: 0, reused: 0, approved: 0, excluded: 0, cooldown: 0, capacityBlocked: 0 } };
  const decisions: AdmissionDecision[] = [];
  for (const receipt of data) {
    const saved = await db.transaction(async (tx) => {
      // Transaction-local settings also work through transaction-mode poolers;
      // do not rely on session startup settings carrying across pooled clients.
      await tx.execute(sql`SET LOCAL statement_timeout = '30s'`);
      await tx.execute(sql`SET LOCAL idle_in_transaction_session_timeout = '30s'`);
      const [membership] = await tx.select({ id: member.id }).from(member)
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, uploadedBy))).limit(1);
      if (!membership) throw new ReceiptAuthorizationError();
      const [inserted] = await tx.insert(receipts).values({
        organizationId, uploadedBy, source: "json",
        receiptType: receipt.receiptType === "Gas Station" ? "gas_station" : "warehouse",
        transactionDate: receipt.transactionDate,
        transactionDateTimeLocal: receipt.transactionDateTime ? new Date(receipt.transactionDateTime) : null,
        transactionDateTimeUtc: receipt.transactionDateISO ? new Date(receipt.transactionDateISO) : null,
        transactionBarcode: receipt.transactionBarcode,
        subtotal: receipt.subTotal.toFixed(2), taxes: receipt.taxes.toFixed(2), total: receipt.total.toFixed(2),
        instantSavings: receipt.instantSavings?.toFixed(2) ?? null,
        storeName: receipt.warehouseName, storeNumber: receipt.warehouseNumber,
        storeCity: receipt.warehouseCity, storeProvince: receipt.warehouseState,
        membershipNumber: receipt.membershipNumber,
      }).onConflictDoNothing({ target: [receipts.organizationId, receipts.transactionBarcode] }).returning({ id: receipts.id });
      if (!inserted) return null;
      const receiptId = inserted.id;
      const lines = receipt.itemArray.map((_item, index) => ({ id: randomUUID(), index }));
      if (lines.length) await tx.insert(receiptItems).values(lines.map(({ id, index }) => {
        const item = receipt.itemArray[index]!;
        const type = classifyItem(item);
        return {
          id, receiptId, type, description: item.itemDescription01 || item.itemActualName,
          itemNumber: item.itemNumber, departmentNumber: item.itemDepartmentNumber,
          unitPrice: item.itemUnitPriceAmount?.toFixed(2) ?? null,
          quantity: item.unit, amount: item.amount.toFixed(2), taxFlag: item.taxFlag,
          fuelQuantityLitres: type === "fuel" ? item.fuelUnitQuantity?.toFixed(3) ?? null : null,
          fuelPricePerLitre: type === "fuel" ? item.itemUnitPriceAmount?.toFixed(3) ?? null : null,
          parentItemNumber: parentItemNumber(item.itemDescription01 || item.itemActualName),
        };
      }));
      if (receipt.tenderArray.length) await tx.insert(receiptTenders).values(receipt.tenderArray.map((tender) => ({
        receiptId, description: tender.tenderDescription, tenderTypeCode: tender.tenderTypeCode,
        amount: tender.amountTender.toFixed(2), cardLast4: tender.displayAccountNumber,
      })));
      const taxes = receipt.subTaxes ? [
        { legend: receipt.subTaxes.aTaxLegend, percent: receipt.subTaxes.aTaxPercent, amount: receipt.subTaxes.aTaxAmount },
        { legend: receipt.subTaxes.bTaxLegend, percent: receipt.subTaxes.bTaxPercent, amount: receipt.subTaxes.bTaxAmount },
        { legend: receipt.subTaxes.cTaxLegend, percent: receipt.subTaxes.cTaxPercent, amount: receipt.subTaxes.cTaxAmount },
      ] : [];
      const populatedTaxes = taxes.filter((tax): tax is { legend: string; percent: number; amount: number } =>
        tax.legend !== null && tax.percent !== null && tax.amount !== null);
      if (populatedTaxes.length) await tx.insert(receiptTaxes).values(populatedTaxes.map((tax) => ({
        receiptId, legend: tax.legend, percent: tax.percent.toFixed(2), amount: tax.amount.toFixed(2),
      })));
      return admitResearch(tx, receipt, lines, organizationId, policy, now);
    });
    if (saved === null) result.skipped++;
    else { result.imported++; decisions.push(...saved); }
  }
  const ids = (reason: string) => new Set(decisions.filter((d) => d.reason === reason).map((d) => d.requestId ?? d.identityId));
  const queued = ids("queued"), paused = ids("paused"), reused = ids("existing_request");
  for (const id of [...queued, ...paused]) reused.delete(id);
  result.research = {
    queued: queued.size, paused: paused.size, reused: reused.size, approved: ids("approved_product").size,
    excluded: decisions.filter((d) => !d.identityId).length, cooldown: ids("cooldown").size, capacityBlocked: ids("queue_full").size,
  };
  return result;
}
