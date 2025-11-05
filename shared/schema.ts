import { sql } from "drizzle-orm";
import { relations } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, boolean, json, pgEnum, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Enums
export const vineItemStatusEnum = pgEnum("vine_item_status", ["available", "reserved", "sold", "returned", "discarded", "do_not_sell", "gone", "personal_use"]);
export const listingStateEnum = pgEnum("listing_state", ["draft", "live", "ended"]);
export const orderStatusEnum = pgEnum("order_status", ["pending", "paid", "shipped", "delivered", "cancelled", "refunded"]);
export const eventTypeEnum = pgEnum("event_type", ["basis_add", "sale", "fee", "shipping_label", "label_refund", "return", "writeoff", "payout", "promotion_fee", "sales_tax_collected_by_marketplace"]);
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
  asin: text("asin").notNull(),
  titleNorm: text("title_norm").notNull(),
  etvCents: integer("etv_cents").notNull(),
  receivedDate: timestamp("received_date").notNull(),
  upc: text("upc"),
  serial: text("serial"),
  status: vineItemStatusEnum("status").notNull().default("available"),
  defective: boolean("defective").notNull().default(false),
  defectiveNotes: text("defective_notes"),
});

// Inventory items table
export const inventoryItems = pgTable("inventory_items", {
  inventoryId: varchar("inventory_id").primaryKey().default(sql`gen_random_uuid()`),
  vineItemId: varchar("vine_item_id").notNull().references(() => vineItems.vineItemId, { onDelete: "cascade" }),
  binLocation: text("bin_location"),
  condition: text("condition").notNull().default("New"),
  photoSetId: varchar("photo_set_id"),
  weightOz: integer("weight_oz"),
  dimsInL: integer("dims_in_l"),
  dimsInW: integer("dims_in_w"),
  dimsInH: integer("dims_in_h"),
  hazmatFlag: boolean("hazmat_flag").notNull().default(false),
  privacyPassed: boolean("privacy_passed").notNull().default(false),
});

// Listings table
export const listings = pgTable("listings", {
  listingId: varchar("listing_id").primaryKey().default(sql`gen_random_uuid()`),
  inventoryId: varchar("inventory_id").notNull().references(() => inventoryItems.inventoryId, { onDelete: "cascade" }),
  ebayItemId: text("ebay_item_id"),
  categoryId: text("category_id"),
  title: text("title").notNull(),
  description: text("description").notNull(),
  priceCents: integer("price_cents").notNull(),
  policyProfileId: varchar("policy_profile_id"),
  addressProfileId: varchar("address_profile_id"),
  publishedAt: timestamp("published_at"),
  state: listingStateEnum("state").notNull().default("draft"),
});

// Orders table
export const orders = pgTable("orders", {
  orderId: varchar("order_id").primaryKey().default(sql`gen_random_uuid()`),
  ebayOrderId: text("ebay_order_id").notNull().unique(),
  listingId: varchar("listing_id").notNull().references(() => listings.listingId, { onDelete: "restrict" }),
  buyerId: varchar("buyer_id"),
  saleGrossCents: integer("sale_gross_cents").notNull(),
  shippingCollectedCents: integer("shipping_collected_cents").notNull().default(0),
  ebayFeesCents: integer("ebay_fees_cents").notNull().default(0),
  payoutCents: integer("payout_cents").notNull().default(0),
  orderDate: timestamp("order_date").notNull(),
  shipBy: timestamp("ship_by"),
  tracking: text("tracking"),
  carrier: text("carrier"),
  status: orderStatusEnum("status").notNull().default("pending"),
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
export const insertBuyerSchema = createInsertSchema(buyers).omit({ buyerId: true });
export const insertAccountingLedgerSchema = createInsertSchema(accountingLedger).omit({ ledgerId: true, txDate: true });
export const insertAddressProfileSchema = createInsertSchema(addressProfiles).omit({ profileId: true });
export const insertBusinessPolicySchema = createInsertSchema(businessPolicies).omit({ policyId: true });
export const insertPhotoSetSchema = createInsertSchema(photoSets).omit({ photoSetId: true });
export const insertHealthEventSchema = createInsertSchema(healthEvents).omit({ id: true, createdAt: true });
export const insertImportConflictSchema = createInsertSchema(importConflicts).omit({ conflictId: true, createdAt: true });
export const insertAmazon1099Schema = createInsertSchema(amazon1099Data).omit({ id: true, userId: true, enteredAt: true, updatedAt: true });
export const insertEbay1099Schema = createInsertSchema(ebay1099Data).omit({ id: true, userId: true, enteredAt: true, updatedAt: true });

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
