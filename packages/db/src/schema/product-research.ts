import { sql } from "drizzle-orm";
import {
  boolean, check, date, foreignKey, index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import { receiptItems } from "./receipts";

export const productIdentities = pgTable("product_identity", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  merchant: text("merchant").notNull().default("costco"),
  market: text("market").notNull().default("CA"),
  sku: text("sku").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("product_identity_key_unique").on(t.organizationId, t.merchant, t.market, t.sku),
  check("product_identity_supported_key", sql`${t.merchant} = 'costco' AND ${t.market} = 'CA' AND ${t.sku} ~ '^[0-9]{1,12}$'`),
]);

// Only an authorized approval service may write here. Import/research never does.
export const approvedProducts = pgTable("approved_product", {
  identityId: uuid("identity_id").primaryKey().references(() => productIdentities.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  brand: text("brand"),
  variant: text("variant"),
  sizeText: text("size_text"),
  packText: text("pack_text"),
  version: integer("version").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("approved_product_name_nonempty", sql`length(trim(${t.name})) > 0`),
  check("approved_product_version_positive", sql`${t.version} > 0`),
]);

export const researchRequestState = pgEnum("product_research_state", [
  "queued", "paused", "running", "awaiting_review", "approved", "rejected", "unresolved", "failed", "cancelled",
]);
export const activeResearchStates = ["queued", "paused", "running", "awaiting_review"] as const;

export const productResearchRequests = pgTable("product_research_request", {
  id: uuid("id").primaryKey().defaultRandom(),
  identityId: uuid("identity_id").notNull().references(() => productIdentities.id, { onDelete: "cascade" }),
  generation: integer("generation").notNull(),
  state: researchRequestState("state").notNull(),
  reason: text("reason"),
  cooldownUntil: timestamp("cooldown_until", { withTimezone: true }),
  claimToken: uuid("claim_token"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  baseProductVersion: integer("base_product_version").notNull().default(0),
  manual: boolean("manual").notNull().default(false),
  requestedBy: text("requested_by").references(() => user.id, { onDelete: "set null" }),
  admissionKey: uuid("admission_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("product_research_generation_unique").on(t.identityId, t.generation),
  unique("product_research_admission_key_unique").on(t.identityId, t.admissionKey),
  unique("product_research_request_identity_unique").on(t.id, t.identityId),
  uniqueIndex("product_research_one_active_identity").on(t.identityId)
    .where(sql`${t.state} IN ('queued', 'paused', 'running', 'awaiting_review')`),
  index("product_research_queue_idx").on(t.state, t.createdAt),
  check("product_research_generation_positive", sql`${t.generation} > 0`),
]);

export const productResearchAdmissionActions = pgTable("product_research_admission_action", {
  id: uuid("id").primaryKey().defaultRandom(),
  identityId: uuid("identity_id").notNull().references(() => productIdentities.id, { onDelete: "cascade" }),
  sourceRequestId: uuid("source_request_id").notNull().references(() => productResearchRequests.id, { onDelete: "cascade" }),
  resultRequestId: uuid("result_request_id").notNull().references(() => productResearchRequests.id, { onDelete: "cascade" }),
  actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
  idempotencyKey: uuid("idempotency_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("product_research_admission_action_key").on(t.identityId, t.idempotencyKey)]);

export const productResearchProposals = pgTable("product_research_proposal", {
  requestId: uuid("request_id").primaryKey().references(() => productResearchRequests.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull().default(1),
  result: jsonb("result").notNull(),
  resultHash: text("result_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const productResearchDecisions = pgTable("product_research_decision", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull().references(() => productResearchRequests.id, { onDelete: "cascade" }),
  actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  idempotencyKey: uuid("idempotency_key").notNull(),
  payloadHash: text("payload_hash").notNull(),
  selectedFields: jsonb("selected_fields").$type<string[]>().notNull().default([]),
  reason: text("reason"),
  before: jsonb("before"),
  after: jsonb("after"),
  weakEvidenceAcknowledged: boolean("weak_evidence_acknowledged").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("product_research_decision_key_unique").on(t.requestId, t.idempotencyKey),
  unique("product_research_one_decision").on(t.requestId),
  check("product_research_decision_action", sql`${t.action} IN ('approve', 'reject')`),
]);

// One persisted admission decision per imported line, including exclusions and
// capacity/cooldown suppression. A linked request must belong to this identity.
export const receiptItemResearch = pgTable("product_research_receipt_item", {
  receiptItemId: uuid("receipt_item_id").primaryKey().references(() => receiptItems.id, { onDelete: "cascade" }),
  identityId: uuid("identity_id").references(() => productIdentities.id, { onDelete: "cascade" }),
  requestId: uuid("request_id"),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({ columns: [t.requestId, t.identityId], foreignColumns: [productResearchRequests.id, productResearchRequests.identityId] })
    .onDelete("cascade"),
  check("product_research_link_identity_required", sql`${t.requestId} IS NULL OR ${t.identityId} IS NOT NULL`),
  index("product_research_receipt_request_idx").on(t.requestId),
]);

// Admission accounting only. Paid-provider accounting/reservations are a later
// gate; these rows do not grant permission to make a model or search request.
export const productResearchDailyUsage = pgTable("product_research_daily_usage", {
  scopeKey: text("scope_key").notNull(),
  day: date("day").notNull(),
  organizationId: text("organization_id").references(() => organization.id, { onDelete: "cascade" }),
  admittedJobs: integer("admitted_jobs").notNull().default(0),
}, (t) => [
  unique("product_research_daily_scope_unique").on(t.scopeKey, t.day),
  check("product_research_daily_nonnegative", sql`${t.admittedJobs} >= 0`),
  check("product_research_daily_scope_valid", sql`(${t.scopeKey} = 'global' AND ${t.organizationId} IS NULL) OR (${t.organizationId} IS NOT NULL AND ${t.scopeKey} = 'org:' || ${t.organizationId})`),
]);
