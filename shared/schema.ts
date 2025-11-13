import { sql } from "drizzle-orm";
import { relations } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, boolean, json, pgEnum, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Enums
// Vine item status represents PHYSICAL inventory state only
// - Listing state (draft/live/ended) is tracked in listings.state
// - Sale state is tracked via orders table
// - "cancelled" = order was cancelled by Amazon, never received (tracked for tax reconciliation)
export const vineItemStatusEnum = pgEnum("vine_item_status", ["available", "returned", "discarded", "do_not_sell", "gone", "personal_use", "cancelled"]);
export const listingStateEnum = pgEnum("listing_state", ["draft", "live", "ended"]);
export const orderStatusEnum = pgEnum("order_status", ["pending", "paid", "shipped", "delivered", "cancelled", "refunded"]);
export const shippingStatusEnum = pgEnum("shipping_status", ["unshipped", "label_purchased", "shipped"]);
export const eventTypeEnum = pgEnum("event_type", ["basis_add", "sale", "fee", "shipping_label", "label_refund", "return", "writeoff", "payout", "promotion_fee", "sales_tax_collected_by_marketplace"]);
export const timelineEventTypeEnum = pgEnum("timeline_event_type", ["rates_quoted", "label_purchased", "label_reprinted", "label_voided", "confirmed_shipped", "tracking_posted", "delivered", "in_transit", "exception", "refund_posted", "drift_detected", "service_upgraded", "address_overridden"]);
export const directionEnum = pgEnum("direction", ["debit", "credit"]);
export const addressKindEnum = pgEnum("address_kind", ["po_profile", "street_profile"]);
export const importStatusEnum = pgEnum("import_status", ["processing", "completed", "failed"]);
export const healthSeverityEnum = pgEnum("health_severity", ["info", "warning", "critical"]);

// Imports table
export const imports = pgTable("imports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  filename: text("filename").notNull(),
  fileSha256: text("file_sha256").notNull().unique(),
  fileContentBase64: text("file_content_base64").notNull(),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  rowCount: integer("row_count").notNull().default(0),
  status: importStatusEnum("status").notNull().default("processing"),
});

// Import rows table
export const importRows = pgTable("import_rows", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  importId: varchar("import_id").notNull().references(() => imports.id, { onDelete: "cascade" }),
  rowSha256: text("row_sha256").notNull(),
  orderNumber: text("order_number"),  // Amazon order number
  asin: text("asin"),
  titleRaw: text("title_raw"),
  etvCents: integer("etv_cents"),
  receivedDate: timestamp("received_date"),
  categoryRaw: text("category_raw"),
  upc: text("upc"),
  serial: text("serial"),
  notes: text("notes"),
});

// Vine items table
export const vineItems = pgTable("vine_items", {
  vineItemId: varchar("vine_item_id").primaryKey().default(sql`gen_random_uuid()`),
  orderNumber: text("order_number"),  // Amazon order number for matching cancellations
  asin: text("asin").notNull(),
  titleNorm: text("title_norm").notNull(),
  etvCents: integer("etv_cents").notNull(),
  receivedDate: timestamp("received_date").notNull(),
  upc: text("upc"),
  serial: text("serial"),
  status: vineItemStatusEnum("status").notNull().default("available"),
  defective: boolean("defective").notNull().default(false),
  defectiveNotes: text("defective_notes"),
  cancelledAt: timestamp("cancelled_at"),
  cancelledImportId: varchar("cancelled_import_id").references(() => imports.id, { onDelete: "set null" }),
});

// Inventory items table
// One-to-one relationship: each vine item can have exactly ONE inventory record
// Can also hold eBay-synced items without a corresponding Vine item
export const inventoryItems = pgTable("inventory_items", {
  inventoryId: varchar("inventory_id").primaryKey().default(sql`gen_random_uuid()`),
  vineItemId: varchar("vine_item_id").unique().references(() => vineItems.vineItemId, { onDelete: "cascade" }),
  source: text("source").notNull().default("vine"),
  binLocation: text("bin_location"),
  condition: text("condition").notNull().default("New"),
  photoSetId: varchar("photo_set_id"),
  weightOz: integer("weight_oz"),
  dimsInL: integer("dims_in_l"),
  dimsInW: integer("dims_in_w"),
  dimsInH: integer("dims_in_h"),
  quantity: integer("quantity").notNull().default(1),
  hazmatFlag: boolean("hazmat_flag").notNull().default(false),
  privacyPassed: boolean("privacy_passed").notNull().default(false),
});

// Listings table
export const listings = pgTable("listings", {
  listingId: varchar("listing_id").primaryKey().default(sql`gen_random_uuid()`),
  inventoryId: varchar("inventory_id").notNull().references(() => inventoryItems.inventoryId, { onDelete: "cascade" }),
  ebayOfferId: text("ebay_offer_id"),
  ebayItemId: text("ebay_item_id"),
  ebaySku: text("ebay_sku"),
  categoryId: text("category_id"),
  title: text("title").notNull(),
  description: text("description").notNull(),
  priceCents: integer("price_cents").notNull(),
  fulfillmentPolicyId: text("fulfillment_policy_id"),
  returnPolicyId: text("return_policy_id"),
  paymentPolicyId: text("payment_policy_id"),
  policyProfileId: varchar("policy_profile_id"),
  addressProfileId: varchar("address_profile_id"),
  publishedAt: timestamp("published_at"),
  state: listingStateEnum("state").notNull().default("draft"),
  
  lastSyncedAt: timestamp("last_synced_at"),
  driftSnapshot: json("drift_snapshot").$type<Record<string, { local: any; ebay: any }>>(),
  ebayOfferJson: json("ebay_offer_json").$type<any>(),
  ebayStatus: text("ebay_status"),
});

// Orders table
export const orders = pgTable("orders", {
  orderId: varchar("order_id").primaryKey().default(sql`gen_random_uuid()`),
  ebayOrderId: text("ebay_order_id").notNull().unique(),
  listingId: varchar("listing_id").references(() => listings.listingId, { onDelete: "set null" }),
  ebaySku: text("ebay_sku").notNull(),
  
  // Item info (for quick reference)
  title: text("title"),
  
  // Buyer info
  buyerId: varchar("buyer_id"),
  buyerUsername: text("buyer_username"),
  buyerName: text("buyer_name"),
  
  // Shipping address (structured JSON matching Shippo schema)
  shipToFullAddress: json("ship_to_full_address").$type<{
    name: string;
    company?: string;
    street1: string;
    street2?: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
    phone?: string;
    email?: string;
  }>(),
  
  // Financial totals (keep separate for accounting/reporting)
  saleGrossCents: integer("sale_gross_cents").notNull(),
  shippingCollectedCents: integer("shipping_collected_cents").notNull().default(0),
  ebayFeesCents: integer("ebay_fees_cents").notNull().default(0),
  payoutCents: integer("payout_cents").notNull().default(0),
  quantityOrdered: integer("quantity_ordered").notNull().default(1),
  
  // Timestamps
  orderDate: timestamp("order_date").notNull(),
  paidTime: timestamp("paid_time"),
  shipBy: timestamp("ship_by"),
  shippedTime: timestamp("shipped_time"),
  
  // Shipping tracking
  tracking: text("tracking"),
  carrier: text("carrier"),
  fulfillmentStatus: text("fulfillment_status"),
  status: orderStatusEnum("status").notNull().default("pending"),
  
  // Local shipping workflow status (two-step ship)
  shippingStatus: shippingStatusEnum("shipping_status").notNull().default("unshipped"),
  
  // Shippo label data (for reprint, void, refund)
  labelUrl: text("label_url"),
  labelId: text("label_id"),
  labelPurchasedAt: timestamp("label_purchased_at"),
  labelCanceledAt: timestamp("label_canceled_at"),
  labelFormat: text("label_format"),
  serviceLevel: text("service_level"),
  packagePresetId: varchar("package_preset_id"),
  shippoRateId: text("shippo_rate_id"),
  shippingCostCents: integer("shipping_cost_cents"),
  
  // eBay order payload (cached for lineItems and fulfillment)
  ebayOrderJson: json("ebay_order_json").$type<any>(),
  ebayFulfillmentId: text("ebay_fulfillment_id"),
  shippedAt: timestamp("shipped_at"),
  
  // Shippo transaction data
  shippoTransactionId: text("shippo_transaction_id"),
  trackingNumber: text("tracking_number"),
  trackingProvider: text("tracking_provider"),
  
  // Drift detection (eBay vs local mismatches)
  driftSnapshot: json("drift_snapshot").$type<Array<{
    detectedAt: string;
    field: string;
    local: any;
    ebay: any;
    note: string;
  }>>(),
  driftDetectedAt: timestamp("drift_detected_at"),
  driftResolvedAt: timestamp("drift_resolved_at"),
  
  // Address override (for exception handling before purchase)
  addressOverride: json("address_override").$type<{
    name: string;
    company?: string;
    street1: string;
    street2?: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
    phone?: string;
    email?: string;
  }>(),
  addressOverrideNote: text("address_override_note"),
  
  // Sync bookkeeping
  lastSyncedAt: timestamp("last_synced_at"),
  lastSyncSource: text("last_sync_source"),
});

// Order Timeline Events table (append-only audit log for shipping workflow)
export const orderTimelineEvents = pgTable("order_timeline_events", {
  timelineId: varchar("timeline_id").primaryKey().default(sql`gen_random_uuid()`),
  orderId: varchar("order_id").notNull().references(() => orders.orderId, { onDelete: "cascade" }),
  eventType: timelineEventTypeEnum("event_type").notNull(),
  note: text("note"),
  metadata: json("metadata").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Buyers table
export const buyers = pgTable("buyers", {
  buyerId: varchar("buyer_id").primaryKey().default(sql`gen_random_uuid()`),
  ebayBuyerUsername: text("ebay_buyer_username").notNull().unique(),
  emailMask: text("email_mask"),
});

// Accounting ledger table
export const accountingLedger = pgTable("accounting_ledger", {
  ledgerId: varchar("ledger_id").primaryKey().default(sql`gen_random_uuid()`),
  inventoryId: varchar("inventory_id").references(() => inventoryItems.inventoryId, { onDelete: "cascade" }),
  orderId: varchar("order_id").references(() => orders.orderId, { onDelete: "cascade" }),
  eventType: eventTypeEnum("event_type").notNull(),
  amountCents: integer("amount_cents").notNull(),
  direction: directionEnum("direction").notNull(),
  txDate: timestamp("tx_date").notNull().defaultNow(),
  note: text("note"),
});

// Address profiles table
export const addressProfiles = pgTable("address_profiles", {
  profileId: varchar("profile_id").primaryKey().default(sql`gen_random_uuid()`),
  label: text("label").notNull(),
  line1: text("line1").notNull(),
  line2: text("line2"),
  city: text("city").notNull(),
  state: text("state").notNull(),
  zip: text("zip").notNull(),
  country: text("country").notNull().default("US"),
  isDefault: boolean("is_default").notNull().default(false),
  kind: addressKindEnum("kind").notNull(),
});

// Business policies table
export const businessPolicies = pgTable("business_policies", {
  policyId: varchar("policy_id").primaryKey().default(sql`gen_random_uuid()`),
  label: text("label").notNull(),
  shippingPolicyId: text("shipping_policy_id"),
  returnPolicyId: text("return_policy_id"),
  handlingTimeDays: integer("handling_time_days").notNull().default(1),
});

// Photo sets table
export const photoSets = pgTable("photo_sets", {
  photoSetId: varchar("photo_set_id").primaryKey().default(sql`gen_random_uuid()`),
  coverUrl: text("cover_url").notNull(),
  urls: json("urls").$type<string[]>().notNull(),
});

// Health events table
export const healthEvents = pgTable("health_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  kind: text("kind").notNull(),
  severity: healthSeverityEnum("severity").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Import conflicts table
export const importConflicts = pgTable("import_conflicts", {
  conflictId: varchar("conflict_id").primaryKey().default(sql`gen_random_uuid()`),
  importId: varchar("import_id").notNull().references(() => imports.id, { onDelete: "cascade" }),
  vineItemId: varchar("vine_item_id").notNull().references(() => vineItems.vineItemId, { onDelete: "cascade" }),
  asin: text("asin").notNull(),
  titleNorm: text("title_norm").notNull(),
  receivedDate: timestamp("received_date").notNull(),
  existingEtvCents: integer("existing_etv_cents").notNull(),
  newEtvCents: integer("new_etv_cents").notNull(),
  resolved: boolean("resolved").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Config table (application settings)
export const config = pgTable("config", {
  configKey: varchar("config_key").primaryKey(),
  value: json("value").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Amazon 1099 data table
export const amazon1099Data = pgTable("amazon_1099_data", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().default("default"),
  taxYear: integer("tax_year").notNull(),
  amountCents: integer("amount_cents").notNull(),
  notes: text("notes"),
  enteredAt: timestamp("entered_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  // Unique constraint per user per year (allows multi-tenancy)
  userYearUnique: unique().on(table.userId, table.taxYear),
}));

// eBay 1099-K data table
export const ebay1099Data = pgTable("ebay_1099_data", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().default("default"),
  taxYear: integer("tax_year").notNull(),
  amountCents: integer("amount_cents").notNull(),
  notes: text("notes"),
  enteredAt: timestamp("entered_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  // Unique constraint per user per year (allows multi-tenancy)
  userYearUnique: unique().on(table.userId, table.taxYear),
}));

// Relations
export const importsRelations = relations(imports, ({ many }) => ({
  rows: many(importRows),
}));

export const importRowsRelations = relations(importRows, ({ one }) => ({
  import: one(imports, {
    fields: [importRows.importId],
    references: [imports.id],
  }),
}));

export const vineItemsRelations = relations(vineItems, ({ many }) => ({
  inventoryItems: many(inventoryItems),
}));

export const inventoryItemsRelations = relations(inventoryItems, ({ one, many }) => ({
  vineItem: one(vineItems, {
    fields: [inventoryItems.vineItemId],
    references: [vineItems.vineItemId],
  }),
  listings: many(listings),
  ledgerEntries: many(accountingLedger),
}));

export const listingsRelations = relations(listings, ({ one, many }) => ({
  inventoryItem: one(inventoryItems, {
    fields: [listings.inventoryId],
    references: [inventoryItems.inventoryId],
  }),
  orders: many(orders),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  listing: one(listings, {
    fields: [orders.listingId],
    references: [listings.listingId],
  }),
  buyer: one(buyers, {
    fields: [orders.buyerId],
    references: [buyers.buyerId],
  }),
  ledgerEntries: many(accountingLedger),
  timelineEvents: many(orderTimelineEvents),
}));

export const orderTimelineEventsRelations = relations(orderTimelineEvents, ({ one }) => ({
  order: one(orders, {
    fields: [orderTimelineEvents.orderId],
    references: [orders.orderId],
  }),
}));

export const accountingLedgerRelations = relations(accountingLedger, ({ one }) => ({
  inventoryItem: one(inventoryItems, {
    fields: [accountingLedger.inventoryId],
    references: [inventoryItems.inventoryId],
  }),
  order: one(orders, {
    fields: [accountingLedger.orderId],
    references: [orders.orderId],
  }),
}));

// Insert schemas
export const insertImportSchema = createInsertSchema(imports).omit({ id: true, uploadedAt: true });
export const insertImportRowSchema = createInsertSchema(importRows).omit({ id: true });
export const insertVineItemSchema = createInsertSchema(vineItems).omit({ vineItemId: true });
export const insertInventoryItemSchema = createInsertSchema(inventoryItems).omit({ inventoryId: true });
export const insertListingSchema = createInsertSchema(listings).omit({ listingId: true, publishedAt: true });
export const insertOrderSchema = createInsertSchema(orders).omit({ orderId: true });
export const insertOrderTimelineEventSchema = createInsertSchema(orderTimelineEvents).omit({ timelineId: true, orderId: true, createdAt: true });
export const insertBuyerSchema = createInsertSchema(buyers).omit({ buyerId: true });
export const insertAccountingLedgerSchema = createInsertSchema(accountingLedger).omit({ ledgerId: true, txDate: true });
export const insertAddressProfileSchema = createInsertSchema(addressProfiles).omit({ profileId: true });
export const insertBusinessPolicySchema = createInsertSchema(businessPolicies).omit({ policyId: true });
export const insertPhotoSetSchema = createInsertSchema(photoSets).omit({ photoSetId: true });
export const insertHealthEventSchema = createInsertSchema(healthEvents).omit({ id: true, createdAt: true });
export const insertImportConflictSchema = createInsertSchema(importConflicts).omit({ conflictId: true, createdAt: true });
export const insertAmazon1099Schema = createInsertSchema(amazon1099Data).omit({ id: true, userId: true, enteredAt: true, updatedAt: true });
export const insertEbay1099Schema = createInsertSchema(ebay1099Data).omit({ id: true, userId: true, enteredAt: true, updatedAt: true });
export const insertConfigSchema = createInsertSchema(config).omit({ updatedAt: true });

// Types
export type Import = typeof imports.$inferSelect;
export type InsertImport = z.infer<typeof insertImportSchema>;
export type ImportRow = typeof importRows.$inferSelect;
export type InsertImportRow = z.infer<typeof insertImportRowSchema>;
export type VineItem = typeof vineItems.$inferSelect;
export type InsertVineItem = z.infer<typeof insertVineItemSchema>;
export type InventoryItem = typeof inventoryItems.$inferSelect;
export type InsertInventoryItem = z.infer<typeof insertInventoryItemSchema>;
export type Listing = typeof listings.$inferSelect;
export type InsertListing = z.infer<typeof insertListingSchema>;
export type Order = typeof orders.$inferSelect;
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type OrderTimelineEvent = typeof orderTimelineEvents.$inferSelect;
export type InsertOrderTimelineEvent = z.infer<typeof insertOrderTimelineEventSchema>;
export type Buyer = typeof buyers.$inferSelect;
export type InsertBuyer = z.infer<typeof insertBuyerSchema>;
export type AccountingLedger = typeof accountingLedger.$inferSelect;
export type InsertAccountingLedger = z.infer<typeof insertAccountingLedgerSchema>;
export type AddressProfile = typeof addressProfiles.$inferSelect;
export type InsertAddressProfile = z.infer<typeof insertAddressProfileSchema>;
export type BusinessPolicy = typeof businessPolicies.$inferSelect;
export type InsertBusinessPolicy = z.infer<typeof insertBusinessPolicySchema>;
export type PhotoSet = typeof photoSets.$inferSelect;
export type InsertPhotoSet = z.infer<typeof insertPhotoSetSchema>;
export type HealthEvent = typeof healthEvents.$inferSelect;
export type InsertHealthEvent = z.infer<typeof insertHealthEventSchema>;
export type ImportConflict = typeof importConflicts.$inferSelect;
export type InsertImportConflict = z.infer<typeof insertImportConflictSchema>;
export type Amazon1099Data = typeof amazon1099Data.$inferSelect;
export type InsertAmazon1099 = z.infer<typeof insertAmazon1099Schema>;
export type Ebay1099Data = typeof ebay1099Data.$inferSelect;
export type InsertEbay1099 = z.infer<typeof insertEbay1099Schema>;
export type Config = typeof config.$inferSelect;
export type InsertConfig = z.infer<typeof insertConfigSchema>;
