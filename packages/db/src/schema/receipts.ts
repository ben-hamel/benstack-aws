import {
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { organization } from "./auth";

export const receiptSourceEnum = pgEnum("receipt_source", ["json", "pdf"]);

export const receiptTypeEnum = pgEnum("receipt_type", [
  "warehouse",
  "gas_station",
]);

export const receipts = pgTable(
  "receipt",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    source: receiptSourceEnum("source").notNull(),
    receiptType: receiptTypeEnum("receipt_type").notNull(),
    transactionDate: date("transaction_date").notNull(),
    transactionDateTimeLocal: timestamp("transaction_date_time_local"),
    transactionDateTimeUtc: timestamp("transaction_date_time_utc", {
      withTimezone: true,
    }),
    transactionBarcode: text("transaction_barcode").notNull(),
    subtotal: numeric("subtotal", { precision: 10, scale: 2 }),
    taxes: numeric("taxes", { precision: 10, scale: 2 }),
    total: numeric("total", { precision: 10, scale: 2 }).notNull(),
    instantSavings: numeric("instant_savings", { precision: 10, scale: 2 }),
    storeName: text("store_name"),
    storeNumber: integer("store_number"),
    storeCity: text("store_city"),
    storeProvince: text("store_province"),
    membershipNumber: text("membership_number"),
    uploadedBy: text("uploaded_by").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("receipt_org_id_idx").on(table.organizationId),
    index("receipt_date_idx").on(table.organizationId, table.transactionDate),
    unique("receipt_barcode_unique").on(
      table.organizationId,
      table.transactionBarcode,
    ),
  ],
);

export const receiptItemTypeEnum = pgEnum("receipt_item_type", [
  "item",
  "deposit",
  "discount",
  "eco_fee",
  "fuel",
]);

export const receiptItems = pgTable(
  "receipt_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    receiptId: uuid("receipt_id")
      .notNull()
      .references(() => receipts.id, { onDelete: "cascade" }),
    type: receiptItemTypeEnum("type").notNull().default("item"),
    description: text("description").notNull(),
    itemNumber: text("item_number"),
    departmentNumber: integer("department_number"),
    unitPrice: numeric("unit_price", { precision: 10, scale: 2 }),
    quantity: integer("quantity").notNull().default(1),
    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
    taxFlag: text("tax_flag"),
    fuelQuantityLitres: numeric("fuel_quantity_litres", {
      precision: 10,
      scale: 3,
    }),
    fuelPricePerLitre: numeric("fuel_price_per_litre", {
      precision: 10,
      scale: 3,
    }),
    parentItemNumber: text("parent_item_number"),
  },
  (table) => [
    index("receipt_item_receipt_id_idx").on(table.receiptId),
    index("receipt_item_number_idx").on(table.itemNumber),
  ],
);

export const receiptTenders = pgTable(
  "receipt_tender",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    receiptId: uuid("receipt_id")
      .notNull()
      .references(() => receipts.id, { onDelete: "cascade" }),
    description: text("description"),
    tenderTypeCode: text("tender_type_code"),
    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
    cardLast4: text("card_last4"),
  },
  (table) => [index("receipt_tender_receipt_id_idx").on(table.receiptId)],
);

export const receiptTaxes = pgTable(
  "receipt_tax",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    receiptId: uuid("receipt_id")
      .notNull()
      .references(() => receipts.id, { onDelete: "cascade" }),
    legend: text("legend").notNull(),
    percent: numeric("percent", { precision: 5, scale: 2 }).notNull(),
    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  },
  (table) => [index("receipt_tax_receipt_id_idx").on(table.receiptId)],
);

export const receiptJobStatusEnum = pgEnum("receipt_job_status", [
  "pending",
  "processing",
  "done",
  "failed",
]);

export const receiptJobs = pgTable(
  "receipt_job",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    uploadedBy: text("uploaded_by").notNull(),
    status: receiptJobStatusEnum("status").notNull().default("pending"),
    s3Key: text("s3_key").notNull(),
    imported: integer("imported"),
    skipped: integer("skipped"),
    total: integer("total"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("receipt_job_org_id_idx").on(table.organizationId)],
);
