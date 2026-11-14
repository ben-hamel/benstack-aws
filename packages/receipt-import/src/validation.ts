import { z } from "zod";

const money = z.number().min(-99_999_999.99).max(99_999_999.99);
const shortText = z.string().max(2_048);
const nullableText = shortText.nullish().transform((value) => value ?? null);
const nullableMoney = money.nullish().transform((value) => value ?? null);
const percentage = z.number().min(-999.99).max(999.99).nullish().transform((value) => value ?? null);
const optionalTime = z.string().max(80).nullish().refine((value) => !value || Number.isFinite(Date.parse(value)));
const itemSchema = z.object({
  itemActualName: shortText.nullish().transform((value) => value ?? ""),
  itemDescription01: shortText.nullish().transform((value) => value ?? ""),
  itemNumber: z.string().max(128).nullish().transform((value) => value?.trim() || null),
  itemDepartmentNumber: z.number().int().min(-2_147_483_648).max(2_147_483_647).nullish(),
  itemUnitPriceAmount: nullableMoney,
  unit: z.number().int().min(-2_147_483_648).max(2_147_483_647),
  amount: money,
  taxFlag: nullableText,
  fuelGradeCode: nullableText,
  fuelUnitQuantity: z.number().min(-9_999_999).max(9_999_999).nullish(),
  fuelUomCode: nullableText,
}).refine((item) => Boolean(item.itemDescription01.trim() || item.itemActualName.trim()));

export const costcoReceiptSchema = z.object({
  documentType: shortText,
  receiptType: shortText,
  transactionDate: z.iso.date(),
  transactionDateTime: optionalTime,
  transactionDateISO: optionalTime,
  transactionBarcode: z.string().trim().min(1).max(256),
  subTotal: money,
  taxes: money,
  total: money,
  instantSavings: nullableMoney,
  warehouseName: shortText,
  warehouseNumber: z.number().int().min(0).max(2_147_483_647),
  warehouseCity: shortText,
  warehouseState: z.string().trim().toUpperCase().max(64),
  countryCode: z.string().trim().toUpperCase().max(64).optional(),
  membershipNumber: shortText,
  itemArray: z.array(itemSchema).max(2_000),
  tenderArray: z.array(z.object({
    tenderDescription: nullableText,
    tenderTypeCode: shortText,
    amountTender: money,
    displayAccountNumber: nullableText,
  })).max(100),
  subTaxes: z.object({
    aTaxAmount: nullableMoney, aTaxLegend: nullableText, aTaxPercent: percentage,
    bTaxAmount: nullableMoney, bTaxLegend: nullableText, bTaxPercent: percentage,
    cTaxAmount: nullableMoney, cTaxLegend: nullableText, cTaxPercent: percentage,
    dTaxAmount: nullableMoney,
  }).nullish(),
});

export type CostcoReceipt = z.infer<typeof costcoReceiptSchema>;
export type CostcoItem = CostcoReceipt["itemArray"][number];
export class ReceiptValidationError extends Error {
  constructor() { super("Invalid Costco receipt JSON. Check receipt dates, amounts, item fields and upload limits."); }
}
export class ReceiptAuthorizationError extends Error {
  constructor() { super("The uploader is not a current member of this organization."); }
}
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export function parseReceiptUpload(input: unknown): CostcoReceipt[] {
  const value = input && typeof input === "object" && !Array.isArray(input) && "receipts" in input ? input.receipts : input;
  const parsed = z.array(costcoReceiptSchema).min(1).max(1_000).safeParse(value);
  if (!parsed.success || parsed.data.reduce((sum, receipt) => sum + receipt.itemArray.length, 0) > 10_000) {
    throw new ReceiptValidationError();
  }
  return parsed.data;
}

export function classifyItem(item: CostcoItem): "item" | "fuel" | "deposit" | "discount" | "eco_fee" {
  const description = (item.itemDescription01 || item.itemActualName).trim().toUpperCase();
  if (item.fuelGradeCode) return "fuel";
  if (description.startsWith("DEPOSIT/") || description.startsWith("CONSIGNE/")) return "deposit";
  if (description.startsWith("TPD/")) return "discount";
  if (description.startsWith("ECO FEE") || description.startsWith("ECOFRAIS/")) return "eco_fee";
  return "item";
}

export function parentItemNumber(description: string): string | null {
  return description.toUpperCase().match(/(?:DEPOSIT|CONSIGNE|TPD|ECO FEE ADS|ECOFRAIS)\/(\d+)/)?.[1] ?? null;
}

const canadianProvinces = new Set(["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"]);
export function researchExclusion(receipt: CostcoReceipt, item: CostcoItem): string | null {
  if (receipt.receiptType === "Gas Station") return "fuel_receipt";
  if (!["Warehouse", "In-Warehouse"].includes(receipt.receiptType)) return "unsupported_receipt_type";
  if (!canadianProvinces.has(receipt.warehouseState) || (receipt.countryCode && receipt.countryCode !== "CA")) return "unsupported_market";
  if (classifyItem(item) !== "item") return "non_merchandise";
  if (!item.itemNumber) return "missing_sku";
  if (!/^[0-9]{1,12}$/.test(item.itemNumber)) return "invalid_sku";
  return null;
}
