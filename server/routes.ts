import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { db } from "./db";
import { eq, desc, asc, and, or, like, ilike, inArray, sql, isNotNull, ne } from "drizzle-orm";
import multer from "multer";
import * as XLSX from "xlsx";
import crypto from "crypto";
import sharp from "sharp";
import {
  imports,
  importRows,
  vineItems,
  inventoryItems,
  listings,
  orders,
  orderTimelineEvents,
  buyers,
  accountingLedger,
  addressProfiles,
  businessPolicies,
  photoSets,
  healthEvents,
  importConflicts,
  amazon1099Data,
  ebay1099Data,
  config,
  type InsertImport,
  type InsertImportRow,
  type InsertVineItem,
  type InsertInventoryItem,
  type InsertListing,
  type InsertAccountingLedger,
  type InsertOrderTimelineEvent,
  insertOrderTimelineEventSchema,
  insertAmazon1099Schema,
  insertEbay1099Schema,
  insertConfigSchema,
} from "@shared/schema";
import { openai } from "./lib/openai";
import { z } from "zod";
import { getAccessToken } from "./lib/ebay";
import { estimateShipping, createShipment, purchaseLabel, getTracking, getTransaction, listAllTransactions, requestRefund } from "./lib/shippo";
import { checkForbiddenWords, checkAsinInText, calculateSimilarity } from "./lib/privacy";
import { fetchAllEbayListings } from "./lib/ebayListings";
import { ebayClient } from "./lib/EbayClient";

const upload = multer({ storage: multer.memoryStorage() });

// Zod schemas for eBay order validation
const ebayOrderLineItemSchema = z.object({
  lineItemId: z.string().min(1).optional(),
  quantity: z.number().int().positive(),
  sku: z.string().optional(),
  title: z.string().optional(),
  legacyItemId: z.string().optional(),
  legacyVariationId: z.string().optional(),
}).refine(
  (item) => item.lineItemId || item.legacyItemId,
  { message: "LineItem must have either lineItemId or legacyItemId" }
);

const ebayOrderSchema = z.object({
  orderId: z.string(),
  lineItems: z.array(ebayOrderLineItemSchema).min(1),
  buyer: z.object({
    username: z.string().optional(),
  }).optional(),
  pricingSummary: z.object({
    total: z.object({
      value: z.string().optional(),
      currency: z.string().optional(),
    }).optional(),
  }).optional(),
  fulfillmentStartInstructions: z.array(z.any()).optional(),
  paymentSummary: z.object({
    totalDueSeller: z.object({
      value: z.string().optional(),
      currency: z.string().optional(),
    }).optional(),
  }).optional(),
});

// Helper: Truncate title to eBay's 80-char limit at word boundaries
function truncateTitle(title: string, maxLength: number = 80): string {
  if (title.length <= maxLength) return title;
  
  // Find last space before maxLength
  const truncated = title.substring(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  
  // If there's a space, cut there; otherwise cut at maxLength
  return lastSpace > 0 ? truncated.substring(0, lastSpace) : truncated;
}

// Helper: Validate eBay listing requirements
function validateListingData(data: {
  title: string;
  description: string;
  categoryId: string;
  photos?: number;
}): string[] {
  const errors: string[] = [];
  
  if (!data.title || data.title.trim().length === 0) {
    errors.push("Title is required");
  } else if (data.title.length > 80) {
    errors.push(`Title is too long (${data.title.length}/80 chars)`);
  }
  
  if (!data.description || data.description.trim().length === 0) {
    errors.push("Description is required");
  }
  
  if (!data.categoryId || data.categoryId === "0") {
    errors.push("Valid category is required");
  }
  
  if (data.photos !== undefined && data.photos < 2) {
    errors.push("At least 2 photos are required");
  }
  
  return errors;
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Get vine items stats
  app.get("/api/vine-items/stats", async (_req, res) => {
    try {
      // Get all status counts, live listings, and sold items in parallel
      const [statusResult, liveListingsResult, soldResult] = await Promise.all([
        db
          .select({
            status: vineItems.status,
            count: sql<number>`count(*)::int`,
          })
          .from(vineItems)
          .groupBy(vineItems.status),
        
        // Count items with live eBay listings (state='live')
        db
          .select({ count: sql<number>`count(DISTINCT ${listings.inventoryId})::int` })
          .from(listings)
          .where(eq(listings.state, "live")),
        
        // Count items with orders (sold items)
        db
          .select({ count: sql<number>`count(DISTINCT ${listings.inventoryId})::int` })
          .from(orders)
          .innerJoin(listings, eq(listings.listingId, orders.listingId)),
      ]);

      const cancelledCount = statusResult.find((r) => r.status === "cancelled")?.count || 0;
      
      const stats = {
        total: statusResult.reduce((sum, row) => sum + row.count, 0) - cancelledCount,  // Exclude cancelled from active inventory total
        available: statusResult.find((r) => r.status === "available")?.count || 0,
        do_not_sell: statusResult.find((r) => r.status === "do_not_sell")?.count || 0,
        personal_use: statusResult.find((r) => r.status === "personal_use")?.count || 0,
        gone: statusResult.find((r) => r.status === "gone")?.count || 0,
        returned: statusResult.find((r) => r.status === "returned")?.count || 0,
        discarded: statusResult.find((r) => r.status === "discarded")?.count || 0,
        cancelled: cancelledCount,  // Track cancelled for tax reconciliation
        live_listings: liveListingsResult[0]?.count || 0,
        sold: soldResult[0]?.count || 0,
      };

      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get vine items (with search, sort, and status filter)
  app.get("/api/vine-items", async (req, res) => {
    try {
      const { search, sort, status } = req.query;
      
      // Handle special tab filters: live_listings and sold
      if (status === "live_listings") {
        // Get vine items with live eBay listings
        const liveItems = await db
          .select({
            vineItemId: vineItems.vineItemId,
            asin: vineItems.asin,
            titleNorm: vineItems.titleNorm,
            etvCents: vineItems.etvCents,
            receivedDate: vineItems.receivedDate,
            upc: vineItems.upc,
            serial: vineItems.serial,
            status: vineItems.status,
            defective: vineItems.defective,
            defectiveNotes: vineItems.defectiveNotes,
          })
          .from(vineItems)
          .innerJoin(inventoryItems, eq(inventoryItems.vineItemId, vineItems.vineItemId))
          .innerJoin(listings, eq(listings.inventoryId, inventoryItems.inventoryId))
          .where(eq(listings.state, "live"))
          .orderBy(desc(vineItems.receivedDate))
          .limit(100);
        return res.json(liveItems);
      }
      
      if (status === "sold") {
        // Get vine items with orders (sold items)
        const soldItems = await db
          .selectDistinct({
            vineItemId: vineItems.vineItemId,
            asin: vineItems.asin,
            titleNorm: vineItems.titleNorm,
            etvCents: vineItems.etvCents,
            receivedDate: vineItems.receivedDate,
            upc: vineItems.upc,
            serial: vineItems.serial,
            status: vineItems.status,
            defective: vineItems.defective,
            defectiveNotes: vineItems.defectiveNotes,
          })
          .from(vineItems)
          .innerJoin(inventoryItems, eq(inventoryItems.vineItemId, vineItems.vineItemId))
          .innerJoin(listings, eq(listings.inventoryId, inventoryItems.inventoryId))
          .innerJoin(orders, eq(orders.listingId, listings.listingId))
          .orderBy(desc(vineItems.receivedDate))
          .limit(100);
        return res.json(soldItems);
      }
      
      // Build filter conditions for regular status tabs
      const conditions = [];
      
      // Add status filter for regular statuses
      if (status && typeof status === "string") {
        conditions.push(eq(vineItems.status, status as any));
      }
      
      // Add search filter
      if (search && typeof search === "string") {
        conditions.push(
          or(
            ilike(vineItems.titleNorm, `%${search}%`),
            ilike(vineItems.asin, `%${search}%`),
            ilike(vineItems.upc, `%${search}%`)
          )
        );
      }
      
      // Add 6-month filter if using six_months_plus sort
      if (sort === "six_months_plus") {
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
        conditions.push(sql`${vineItems.receivedDate} <= ${sixMonthsAgo.toISOString()}`);
      }
      
      // Build query with all conditions
      let query = db.select().from(vineItems);
      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as any;
      }

      // Apply sorting
      let orderedQuery;
      if (sort === "oldest" || sort === "six_months_plus") {
        orderedQuery = query.orderBy(asc(vineItems.receivedDate));
      } else if (sort === "price_high") {
        orderedQuery = query.orderBy(desc(vineItems.etvCents));
      } else if (sort === "price_low") {
        orderedQuery = query.orderBy(asc(vineItems.etvCents));
      } else {
        // Default: "recent" - most recent first
        orderedQuery = query.orderBy(desc(vineItems.receivedDate));
      }
      
      const items = await orderedQuery.limit(100);
      res.json(items);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get single vine item
  app.get("/api/vine-items/:id", async (req, res) => {
    try {
      const [item] = await db
        .select()
        .from(vineItems)
        .where(eq(vineItems.vineItemId, req.params.id));
      
      if (!item) {
        return res.status(404).json({ error: "Item not found" });
      }

      res.json(item);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Mark item as defective or not
  app.patch("/api/vine-items/:id/defective", async (req, res) => {
    try {
      const { id } = req.params;
      const { defective, defectiveNotes } = req.body;

      // Validate input
      if (typeof defective !== "boolean") {
        return res.status(400).json({ error: "defective must be a boolean" });
      }

      // Update the item
      const updated = await db.update(vineItems)
        .set({ 
          defective, 
          defectiveNotes: defectiveNotes || null 
        })
        .where(eq(vineItems.vineItemId, id))
        .returning();

      if (updated.length === 0) {
        return res.status(404).json({ error: "Item not found" });
      }

      res.json(updated[0]);
    } catch (error: any) {
      console.error("Error marking item as defective:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Update item status (available, do_not_sell, gone, personal_use)
  app.patch("/api/vine-items/:id/status", async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      // Validate status
      const validStatuses = ["available", "reserved", "sold", "returned", "discarded", "do_not_sell", "gone", "personal_use"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }

      // Update the item
      const updated = await db.update(vineItems)
        .set({ status })
        .where(eq(vineItems.vineItemId, id))
        .returning();

      if (updated.length === 0) {
        return res.status(404).json({ error: "Item not found" });
      }

      res.json(updated[0]);
    } catch (error: any) {
      console.error("Error updating item status:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Upload and process XLSX file
  app.post("/api/imports/upload", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const fileBuffer = req.file.buffer;
      const fileSha256 = crypto.createHash("sha256").update(fileBuffer).digest("hex");
      const fileContentBase64 = fileBuffer.toString("base64");

      // Check if file already imported
      const [existing] = await db
        .select()
        .from(imports)
        .where(eq(imports.fileSha256, fileSha256));

      if (existing) {
        return res.status(400).json({ error: "File already imported" });
      }

      // Parse XLSX
      const workbook = XLSX.read(fileBuffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(sheet);

      // Skip first row (header row that was parsed as data)
      const actualData = data.slice(1);

      // Create import record
      const [importRecord] = await db
        .insert(imports)
        .values({
          filename: req.file.originalname,
          fileSha256,
          fileContentBase64,
          rowCount: actualData.length,
          status: "processing",
        })
        .returning();

      let added = 0;
      let unchanged = 0;
      let conflicts = 0;
      let removed = 0;
      let skipped = 0;

      // Process each row
      for (const row of actualData as any[]) {
        // Map Amazon Vine report columns
        // Column layout: A=Order#, B=ASIN, C=Product Name, D=Order Type, E=Order Date, F=Shipped Date, G=Cancelled Date, H=ETV
        // Note: First column uses the file title as key, then __EMPTY, __EMPTY_1, etc.
        const orderNumber = row["Amazon Vine Itemized Report for 2025"] || row["Order Number"] || "";
        const asin = row.__EMPTY || row.ASIN || "";
        const titleRaw = row.__EMPTY_1 || row["Product Name"] || "";
        const orderType = row.__EMPTY_2 || row["Order Type"] || "";
        const orderDate = row.__EMPTY_3 || row["Order Date"] || "";
        const shippedDate = row.__EMPTY_4 || row["Shipped Date"] || "";
        const cancelledDate = row.__EMPTY_5 || row["Cancelled Date"] || "";
        const etvValue = row.__EMPTY_6 || row["Estimated Tax Value"] || row.ETV || "0";
        const etvCents = Math.round((parseFloat(etvValue) || 0) * 100);
        const receivedDate = shippedDate || orderDate || new Date().toISOString();
        const categoryRaw = row.Category || row.category || "";
        const upc = row.UPC || row.upc || null;
        const serial = row.Serial || row.serial || null;

        // Skip empty rows (no ASIN and no title)
        if (!asin && !titleRaw) {
          continue;
        }

        // Check if this is a cancellation (use BOTH order type AND cancelled date)
        const isCancellation = 
          orderType.toLowerCase().includes("cancellation") || 
          (cancelledDate && typeof cancelledDate === 'string' && cancelledDate.trim() !== "");
        
        // For cancellations, ETV is often negative or zero - use absolute value for tracking
        const normalizedEtvCents = isCancellation ? Math.abs(etvCents) : etvCents;

        const rowSha256 = crypto
          .createHash("sha256")
          .update(`${asin}${titleRaw}${normalizedEtvCents}${receivedDate}`)
          .digest("hex");

        // Insert import row (for audit trail)
        await db.insert(importRows).values({
          importId: importRecord.id,
          rowSha256,
          orderNumber,
          asin,
          titleRaw,
          etvCents: normalizedEtvCents,
          receivedDate: new Date(receivedDate),
          categoryRaw,
          upc,
          serial,
        });

        // Check for existing vine item
        // For cancellations: match by order number (same order being cancelled)
        // For regular orders: match by ASIN + receivedDate (duplicates of same item on same day)
        const [existingItem] = await db
          .select()
          .from(vineItems)
          .where(
            isCancellation && orderNumber
              ? eq(vineItems.orderNumber, orderNumber)
              : and(
                  eq(vineItems.asin, asin),
                  eq(vineItems.receivedDate, new Date(receivedDate))
                )
          );

        if (isCancellation) {
          // Handle cancellation: mark as cancelled for tax reconciliation, never delete
          if (existingItem) {
            // Update existing item to cancelled status
            await db
              .update(vineItems)
              .set({ 
                status: "cancelled",
                cancelledAt: cancelledDate ? new Date(cancelledDate) : new Date(),
                cancelledImportId: importRecord.id,
              })
              .where(eq(vineItems.vineItemId, existingItem.vineItemId));
            removed++;  // "removed" from active inventory (now tracked as cancelled)
          } else {
            // Cancellation for item never in system - add it as cancelled for tax tracking
            await db.insert(vineItems).values({
              orderNumber,
              asin,
              titleNorm: titleRaw,
              etvCents: normalizedEtvCents,
              receivedDate: new Date(receivedDate),
              upc,
              serial,
              status: "cancelled",
              cancelledAt: cancelledDate ? new Date(cancelledDate) : new Date(),
              cancelledImportId: importRecord.id,
            });
            skipped++;  // Counted as "skipped" since it was never in active inventory
          }
        } else {
          // Normal processing (not a cancellation)
          if (!existingItem) {
            // New item
            await db.insert(vineItems).values({
              orderNumber,
              asin,
              titleNorm: titleRaw,
              etvCents: normalizedEtvCents,
              receivedDate: new Date(receivedDate),
              upc,
              serial,
              status: "available",
            });
            added++;
          } else if (existingItem.etvCents !== normalizedEtvCents) {
            // Conflict - ETV changed - store in conflicts table
            await db.insert(importConflicts).values({
              importId: importRecord.id,
              vineItemId: existingItem.vineItemId,
              asin,
              titleNorm: titleRaw,
              receivedDate: new Date(receivedDate),
              existingEtvCents: existingItem.etvCents,
              newEtvCents: normalizedEtvCents,
              resolved: false,
            });
            conflicts++;
          } else {
            // Unchanged
            unchanged++;
          }
        }
      }

      // Update import status
      await db
        .update(imports)
        .set({ status: "completed" })
        .where(eq(imports.id, importRecord.id));

      res.json({
        importId: importRecord.id,
        reconciliation: { added, unchanged, conflicts, removed, skipped },
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get unresolved conflicts
  app.get("/api/conflicts", async (_req, res) => {
    try {
      const conflicts = await db
        .select()
        .from(importConflicts)
        .where(eq(importConflicts.resolved, false))
        .orderBy(desc(importConflicts.createdAt));
      
      res.json(conflicts);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Resolve a conflict by updating the vine item's ETV
  app.post("/api/conflicts/:conflictId/resolve", async (req, res) => {
    try {
      const { conflictId } = req.params;
      const { selectedEtvCents } = req.body;

      if (typeof selectedEtvCents !== "number") {
        return res.status(400).json({ error: "selectedEtvCents must be a number" });
      }

      // Get the conflict
      const [conflict] = await db
        .select()
        .from(importConflicts)
        .where(eq(importConflicts.conflictId, conflictId));

      if (!conflict) {
        return res.status(404).json({ error: "Conflict not found" });
      }

      if (conflict.resolved) {
        return res.status(400).json({ error: "Conflict already resolved" });
      }

      // Update the vine item's ETV
      await db
        .update(vineItems)
        .set({ etvCents: selectedEtvCents })
        .where(eq(vineItems.vineItemId, conflict.vineItemId));

      // Mark conflict as resolved
      await db
        .update(importConflicts)
        .set({ resolved: true })
        .where(eq(importConflicts.conflictId, conflictId));

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // List all imports with stats
  app.get("/api/imports", async (_req, res) => {
    try {
      const allImports = await db
        .select({
          id: imports.id,
          filename: imports.filename,
          fileSha256: imports.fileSha256,
          uploadedAt: imports.uploadedAt,
          rowCount: imports.rowCount,
          status: imports.status,
        })
        .from(imports)
        .orderBy(desc(imports.uploadedAt));
      
      res.json(allImports);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Download original XLSX file
  app.get("/api/imports/:importId/download", async (req, res) => {
    try {
      const { importId } = req.params;

      const [importRecord] = await db
        .select()
        .from(imports)
        .where(eq(imports.id, importId));

      if (!importRecord) {
        return res.status(404).json({ error: "Import not found" });
      }

      // Decode base64 to buffer
      const fileBuffer = Buffer.from(importRecord.fileContentBase64, "base64");

      // Set headers for file download
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${importRecord.filename}"`);
      res.send(fileBuffer);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get import details with all rows
  app.get("/api/imports/:importId/details", async (req, res) => {
    try {
      const { importId } = req.params;

      const [importRecord] = await db
        .select({
          id: imports.id,
          filename: imports.filename,
          uploadedAt: imports.uploadedAt,
          rowCount: imports.rowCount,
          status: imports.status,
        })
        .from(imports)
        .where(eq(imports.id, importId));

      if (!importRecord) {
        return res.status(404).json({ error: "Import not found" });
      }

      // Get all rows for this import
      const rows = await db
        .select()
        .from(importRows)
        .where(eq(importRows.importId, importId))
        .limit(100); // Limit to first 100 rows for preview

      res.json({
        import: importRecord,
        rows,
        hasMore: importRecord.rowCount > 100,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete a specific import and its related data
  app.delete("/api/imports/:importId", async (req, res) => {
    try {
      const { importId } = req.params;

      // Delete import_rows for this import
      await db
        .delete(importRows)
        .where(eq(importRows.importId, importId));

      // Delete import_conflicts for this import
      await db
        .delete(importConflicts)
        .where(eq(importConflicts.importId, importId));

      // Delete the import itself
      const deleted = await db
        .delete(imports)
        .where(eq(imports.id, importId))
        .returning();

      if (deleted.length === 0) {
        return res.status(404).json({ error: "Import not found" });
      }

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Clear ALL data from all tables (nuclear option)
  app.post("/api/imports/clear-all", async (_req, res) => {
    try {
      // Delete in correct order to respect foreign key constraints
      await db.delete(importConflicts);
      await db.delete(importRows);
      await db.delete(imports);
      await db.delete(listings);
      await db.delete(inventoryItems);
      await db.delete(vineItems);
      await db.delete(orders);
      await db.delete(buyers);
      await db.delete(accountingLedger);
      await db.delete(healthEvents);
      await db.delete(photoSets);
      await db.delete(addressProfiles);
      await db.delete(businessPolicies);

      res.json({ success: true, message: "All data cleared" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Generate listing copy with AI
  app.get("/api/listings/generate-copy", async (req, res) => {
    try {
      const { vineItemId } = req.query;

      if (!vineItemId) {
        return res.status(400).json({ error: "vineItemId required" });
      }

      const [item] = await db
        .select()
        .from(vineItems)
        .where(eq(vineItems.vineItemId, vineItemId as string));

      if (!item) {
        return res.status(404).json({ error: "Item not found" });
      }

      // Get eBay category suggestions and find a valid leaf category
      let suggestedCategory: { category: { categoryId: string, categoryName: string } } | null = null;
      
      // Step 1: Try eBay category suggestions with original title
      try {
        const categories = await ebayClient.getSuggestedCategories(item.titleNorm);
        if (categories.categorySuggestions && categories.categorySuggestions.length > 0) {
          // Find first leaf category in the results
          for (const cat of categories.categorySuggestions) {
            const isLeaf = await ebayClient.isLeafCategory(cat.category.categoryId);
            if (isLeaf) {
              suggestedCategory = cat;
              console.log("[AI Generation] Found leaf category from eBay:", cat.category);
              break;
            }
          }
        }
      } catch (error) {
        console.error("[AI Generation] eBay category suggestion failed:", error);
      }
      
      // Step 2: If no leaf category found, use AI to generate better search keywords
      if (!suggestedCategory) {
        console.log("[AI Generation] No leaf category found, asking AI for better keywords");
        try {
          const keywordCompletion = await openai.chat.completions.create({
            model: "gpt-4.1-mini",
            messages: [
              {
                role: "system",
                content: "You are a product categorization expert. Extract the most specific product type, brand, and key features from a title. Output only valid JSON.",
              },
              {
                role: "user",
                content: `From this product title: "${item.titleNorm}"

Extract keywords for eBay category search. Focus on:
- Specific product type (e.g., "automatic dog water dispenser" not just "pet product")
- Brand name if present
- Key distinguishing features

Output ONLY this JSON (no markdown):
{"keywords": "specific search keywords here"}`,
              },
            ],
            max_completion_tokens: 100,
          });

          const keywordContent = keywordCompletion.choices[0].message.content || "";
          const keywordData = JSON.parse(keywordContent.trim().replace(/^```json?\s*/, '').replace(/\s*```$/, ''));
          
          if (keywordData.keywords) {
            console.log("[AI Generation] AI-generated keywords:", keywordData.keywords);
            
            // Try eBay again with AI-generated keywords
            const categories = await ebayClient.getSuggestedCategories(keywordData.keywords);
            if (categories.categorySuggestions && categories.categorySuggestions.length > 0) {
              for (const cat of categories.categorySuggestions) {
                const isLeaf = await ebayClient.isLeafCategory(cat.category.categoryId);
                if (isLeaf) {
                  suggestedCategory = cat;
                  console.log("[AI Generation] Found leaf category with AI keywords:", cat.category);
                  break;
                }
              }
            }
          }
        } catch (aiError) {
          console.error("[AI Generation] AI keyword generation failed:", aiError);
        }
      }
      
      // Step 3: If still no category, return error
      if (!suggestedCategory) {
        return res.status(502).json({ 
          error: "Unable to find a valid eBay category for this product. Please try selecting a category manually or contact support." 
        });
      }

      // Generate unique titles and description using AI
      // Using gpt-4.1-mini for cost efficiency - produces excellent eBay-friendly copy
      const basisPrice = item.etvCents ? item.etvCents / 100 : 0;
      const valueMessage = basisPrice > 0 
        ? `\n\nVALUE MESSAGING (IMPORTANT):
- This item typically retails for $${basisPrice.toFixed(2)}
- Include this value comparison in the description
- Use phrasing like: "Item normally sells for $${basisPrice.toFixed(2)}, but our price is [their listing price]"
- This shows the buyer they're getting a great deal
- DO NOT mention where it originally came from (no Amazon, Vine, etc.)
- Just state the typical retail price as a fact`
        : '';

      const completion = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content: "You are an expert eBay listing copywriter specializing in creating unique, compelling product listings that maximize buyer appeal while protecting seller privacy. Output only valid JSON.",
          },
          {
            role: "user",
            content: `Transform this product into 3 unique eBay listing titles and 1 enticing description.

Original product: "${item.titleNorm}"${valueMessage}

Create 3 DISTINCT titles (max 80 chars each) with different creative approaches:
1. One emphasizing QUALITY/CRAFTSMANSHIP - focus on build, materials, durability
2. One emphasizing KEY FEATURES/FUNCTIONALITY - highlight what it does, unique capabilities
3. One emphasizing BUYER BENEFITS/USE CASES - focus on results, convenience, value

Each title MUST:
- Use COMPLETELY DIFFERENT wording and structure from each other AND the original
- Be creative and varied - avoid generic marketing words like "superior", "innovative", "reliable"
- Rephrase the product type creatively (e.g., "Floor Fan" → "Air Circulator", "Cooling Unit", "Breeze Maker")
- Include key specs naturally (e.g., "18-inch" → "Large", "4-speed" → "Adjustable Speed")
- Sound natural, specific, and buyer-focused - like a real person selling their item

Create 1 STRUCTURED description with these exact parts:
- "intro": One benefit-focused opening paragraph (2-3 sentences) that solves a buyer problem
- "bullets": Array of 4-7 key feature bullets (each 1 sentence, focus on specs, benefits, use cases)
  Examples: "18-inch diameter provides powerful airflow for large rooms"
           "Adjustable height from 38 to 54 inches for customized comfort"
           "Durable metal construction withstands outdoor conditions"
- "closing": One confident closing sentence with call-to-action
${basisPrice > 0 ? '- Include the value comparison in intro or bullets about typical retail price\n' : ''}
STRICT RULES:
- NEVER mention: Amazon, Vine, review, promo, free sample, received, promotional, ASIN
- Reword everything - don't copy phrases from original
- Sound like a professional seller, not a reviewer
- Make bullets scannable and benefit-focused, not just features

Output ONLY this JSON structure (no markdown, no backticks):
{"titles": ["title 1", "title 2", "title 3"], "description": {"intro": "opening paragraph", "bullets": ["bullet 1", "bullet 2", "bullet 3", "bullet 4"], "closing": "closing sentence"}}`,
          },
        ],
        max_completion_tokens: 2500,
      });

      console.log("Completion object:", JSON.stringify(completion, null, 2));
      
      const rawContent = completion.choices[0].message.content || "";
      console.log("Raw AI content length:", rawContent.length);
      console.log("Raw AI content:", rawContent);
      console.log("Finish reason:", completion.choices[0].finish_reason);
      
      let generated;
      try {
        // Clean markdown code blocks if present
        let cleanContent = rawContent.trim();
        if (cleanContent.startsWith('```json')) {
          cleanContent = cleanContent.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        } else if (cleanContent.startsWith('```')) {
          cleanContent = cleanContent.replace(/^```\s*/, '').replace(/\s*```$/, '');
        }
        
        generated = JSON.parse(cleanContent);
        console.log("Parsed AI Response:", JSON.stringify(generated, null, 2));
      } catch (e) {
        console.error("JSON parse error:", e);
        console.log("Attempting fallback with gpt-5-mini...");
        
        // Fallback: Try with nano model
        try {
          const fallbackCompletion = await openai.chat.completions.create({
            model: "gpt-4.1-nano",
            messages: [
              {
                role: "system",
                content: "You are an eBay listing copywriter. Create unique product listings. Output only valid JSON, no markdown.",
              },
              {
                role: "user",
                content: `Rewrite this product for eBay: "${item.titleNorm}"

Create 3 different titles (max 80 chars) and 1 description (4-5 sentences).
Each title should use different words. Make it buyer-focused and appealing.
Never mention Amazon, Vine, or review.

Output only JSON:
{"titles": ["title 1", "title 2", "title 3"], "description": "description"}`,
              },
            ],
            max_completion_tokens: 1500,
          });

          const fallbackContent = fallbackCompletion.choices[0].message.content || "";
          generated = JSON.parse(fallbackContent.trim().replace(/^```json?\s*/, '').replace(/\s*```$/, ''));
          console.log("Fallback succeeded:", JSON.stringify(generated, null, 2));
        } catch (fallbackError) {
          console.error("Fallback also failed:", fallbackError);
          // Last resort: Extract key words and create variations
          const words = item.titleNorm.split(/\s+/).filter(w => w.length > 3);
          const mainProduct = words.slice(0, 3).join(" ");
          
          generated = {
            titles: [
              `High-Quality ${mainProduct} - Professional Grade`,
              `${mainProduct} - Advanced Features & Design`,
              `Essential ${mainProduct} - Great Value Deal`
            ],
            description: `Upgrade your experience with this exceptional ${mainProduct}. Features premium construction and reliable performance. Perfect for home or professional use. Fast shipping and satisfaction guaranteed!`
          };
        }
      }

      // Truncate titles to 80 chars and track original lengths
      const truncatedTitles = (generated.titles || [item.titleNorm]).map((title: string) => truncateTitle(title, 80));
      const originalTitleLengths = (generated.titles || [item.titleNorm]).map((title: string) => title.length);

      // Normalize description to structured format if it's a string
      let structuredDescription;
      if (typeof generated.description === 'string') {
        // Legacy format: convert to structured
        structuredDescription = {
          intro: generated.description,
          bullets: [],
          closing: "Order now with confidence!"
        };
      } else {
        structuredDescription = generated.description || {
          intro: item.titleNorm,
          bullets: [],
          closing: "Order now!"
        };
      }

      // Privacy checks
      const privacyWarnings: string[] = [];
      for (const title of truncatedTitles) {
        const violations = checkForbiddenWords(title);
        if (violations.length > 0) {
          privacyWarnings.push(`Title contains forbidden words: ${violations.join(", ")}`);
        }
        if (checkAsinInText(title, item.asin)) {
          privacyWarnings.push("Title contains ASIN");
        }
      }

      // Check description parts for privacy violations
      const allDescText = [
        structuredDescription.intro,
        ...structuredDescription.bullets,
        structuredDescription.closing
      ].join(' ');
      const descViolations = checkForbiddenWords(allDescText);
      if (descViolations.length > 0) {
        privacyWarnings.push(`Description contains forbidden words: ${descViolations.join(", ")}`);
      }

      // Similarity check
      const similarityScore = calculateSimilarity(item.titleNorm, truncatedTitles[0] || "");

      res.json({
        titles: truncatedTitles,
        originalTitleLengths,
        description: structuredDescription,
        categoryId: suggestedCategory.category.categoryId,
        categoryName: suggestedCategory.category.categoryName,
        privacyWarnings,
        similarityScore,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Search eBay categories by keyword
  app.get("/api/ebay/categories", async (req, res) => {
    try {
      const { q } = req.query;
      
      if (!q || typeof q !== 'string' || q.length < 3) {
        return res.json([]);
      }

      const categories = await ebayClient.getSuggestedCategories(q);
      
      if (!categories.categorySuggestions || categories.categorySuggestions.length === 0) {
        return res.json([]);
      }

      // Validate each category is a leaf category (no child categories)
      // Memoize results during this request to avoid duplicate API calls
      const leafCheckCache = new Map<string, boolean>();
      const validCategories = [];

      for (const suggestion of categories.categorySuggestions) {
        const catId = suggestion.category.categoryId;
        
        // Check cache first
        let isLeaf: boolean;
        if (leafCheckCache.has(catId)) {
          isLeaf = leafCheckCache.get(catId)!;
        } else {
          isLeaf = await ebayClient.isLeafCategory(catId);
          leafCheckCache.set(catId, isLeaf);
        }

        if (isLeaf) {
          validCategories.push({
            categoryId: catId,
            categoryName: suggestion.category.categoryName,
          });

          // Limit to 10 results for performance
          if (validCategories.length >= 10) {
            break;
          }
        }
      }

      res.json(validCategories);
    } catch (error: any) {
      console.error("[Category Search] Failed:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get eBay fulfillment policies
  app.get("/api/ebay/fulfillment-policies", async (req, res) => {
    try {
      const marketplaceId = (req.query.marketplace_id as string) || "EBAY_US";
      const policies = await ebayClient.getFulfillmentPolicies(marketplaceId);
      
      res.json(policies.fulfillmentPolicies || []);
    } catch (error: any) {
      console.error("[Fulfillment Policies] Failed:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get inventory items by vine item ID
  app.get("/api/inventory/by-vine-item/:vineItemId", async (req, res) => {
    try {
      const { vineItemId } = req.params;
      
      const items = await db
        .select()
        .from(inventoryItems)
        .where(eq(inventoryItems.vineItemId, vineItemId));
      
      res.json(items[0] || null);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get shipping cost estimate using Shippo API (with 5% cushion)
  app.get("/api/shipping/estimate", async (req, res) => {
    try {
      const { weightOz, length, width, height } = req.query;

      if (!weightOz || !length || !width || !height) {
        return res.status(400).json({ error: "Missing required parameters" });
      }

      const shippoApiKey = process.env.SHIPPO_API_KEY;
      if (!shippoApiKey) {
        return res.status(500).json({ error: "Shippo API key not configured" });
      }

      // Convert to numbers
      const weightLb = parseFloat(weightOz as string) / 16;
      const lengthIn = parseFloat(length as string);
      const widthIn = parseFloat(width as string);
      const heightIn = parseFloat(height as string);

      // Create a shipment to get rate estimates
      const shipmentResponse = await fetch("https://api.goshippo.com/shipments/", {
        method: "POST",
        headers: {
          "Authorization": `ShippoToken ${shippoApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          address_from: {
            name: "Seller",
            street1: "123 Main St",
            city: "San Francisco",
            state: "CA",
            zip: "94105",
            country: "US",
          },
          address_to: {
            name: "Buyer",
            street1: "456 Market St",
            city: "Los Angeles",
            state: "CA",
            zip: "90001",
            country: "US",
          },
          parcels: [{
            length: String(lengthIn),
            width: String(widthIn),
            height: String(heightIn),
            distance_unit: "in",
            weight: String(weightLb),
            mass_unit: "lb",
          }],
          async: false,
        }),
      });

      if (!shipmentResponse.ok) {
        const errorText = await shipmentResponse.text();
        console.error("Shippo API error:", errorText);
        return res.status(500).json({ error: "Failed to get shipping rates" });
      }

      const shipmentData = await shipmentResponse.json();

      // Extract UPS Ground rate (cheapest option)
      const rates = shipmentData.rates || [];
      const upsGroundRate = rates
        .filter((rate: any) => 
          rate.provider === "UPS" && 
          rate.servicelevel?.name?.toLowerCase().includes("ground")
        )
        .map((rate: any) => parseFloat(rate.amount))
        .filter((amount: number) => !isNaN(amount) && amount > 0)[0];

      // Fallback to cheapest UPS rate if Ground not found
      const fallbackUpsRate = rates
        .filter((rate: any) => rate.provider === "UPS")
        .map((rate: any) => parseFloat(rate.amount))
        .filter((amount: number) => !isNaN(amount) && amount > 0)
        .sort((a: number, b: number) => a - b)[0];

      const baseRate = upsGroundRate || fallbackUpsRate;

      if (!baseRate) {
        // Fallback estimate based on weight
        const estimatedRate = weightLb < 1 ? 5.00 : weightLb < 3 ? 9.00 : weightLb < 5 ? 12.00 : 16.00;
        const withCushion = Math.round(estimatedRate * 1.05 * 100) / 100;
        return res.json({
          low: withCushion,
          high: withCushion,
        });
      }

      // Apply 5% cushion to account for estimate inaccuracy
      const withCushion = Math.round(baseRate * 1.05 * 100) / 100;
      res.json({
        low: withCushion,
        high: withCushion,
      });
    } catch (error: any) {
      console.error("Shipping estimate error:", error);
      // Fallback estimate with 5% cushion
      res.json({
        low: Math.round(5.50 * 1.05 * 100) / 100,
        high: Math.round(12.00 * 1.05 * 100) / 100,
      });
    }
  });

  // Publish listing (idempotent with API tracing)
  app.post("/api/listings/publish", upload.array("photos", 12), async (req, res) => {
    const { ApiTracer } = await import("./lib/apiTracer");
    const { compareOffers, verifyOfferPublished } = await import("./lib/ebayOfferHelpers");
    const {
      getOffersBySku,
      getOffer,
      createOfferTraced,
      publishOfferTraced,
      updateOffer,
      withdrawOffer,
      createOrUpdateInventoryItemTraced,
    } = await import("./lib/ebay");

    const tracer = new ApiTracer();

    try {
      const {
        vineItemId,
        title,
        description,
        categoryId,
        priceCents,
        weightOz,
        dimsL,
        dimsW,
        dimsH,
        fulfillmentPolicyId,
      } = req.body;

      // Validate all required fields before processing
      const photoCount = (req.files as Express.Multer.File[])?.length || 0;
      const validationErrors = validateListingData({
        title,
        description,
        categoryId,
        photos: photoCount,
      });

      // Add fulfillment policy validation
      if (!fulfillmentPolicyId) {
        validationErrors.push("Fulfillment policy must be selected");
      }

      if (validationErrors.length > 0) {
        return res.status(400).json({ 
          error: "Validation failed",
          details: validationErrors,
          trace: tracer.getTrace(),
          fieldErrors: {
            title: validationErrors.find(e => e.includes("Title")),
            description: validationErrors.find(e => e.includes("Description")),
            categoryId: validationErrors.find(e => e.includes("category")),
            photos: validationErrors.find(e => e.includes("photos")),
            fulfillmentPolicyId: validationErrors.find(e => e.includes("Fulfillment")),
          }
        });
      }

      // Process photos - strip EXIF and upload to public URLs
      const photoUrls: string[] = [];
      for (const file of req.files as Express.Multer.File[]) {
        const processed = await sharp(file.buffer)
          .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 90 })
          .toBuffer();

        const { imageUploader } = await import("./lib/imageUploader");
        const publicUrl = await imageUploader.upload(processed, "image/jpeg");
        photoUrls.push(publicUrl);
      }

      // Validate all image URLs before calling eBay
      const invalidUrls = photoUrls.filter(url => !url || (!url.startsWith("http://") && !url.startsWith("https://")));
      if (invalidUrls.length > 0) {
        return res.status(400).json({
          error: "Validation failed",
          details: ["One or more photo URLs are invalid. Photos must be publicly accessible."],
          trace: tracer.getTrace(),
          fieldErrors: {
            photos: "One or more photos failed to upload. Please try again.",
          }
        });
      }

      // Create photo set
      const [photoSet] = await db
        .insert(photoSets)
        .values({
          coverUrl: photoUrls[0],
          urls: photoUrls,
        })
        .returning();

      // Upsert inventory item (update if exists, insert if new)
      const [inventoryItem] = await db
        .insert(inventoryItems)
        .values({
          vineItemId,
          condition: "New",
          photoSetId: photoSet.photoSetId,
          weightOz: parseInt(weightOz),
          dimsInL: parseInt(dimsL),
          dimsInW: parseInt(dimsW),
          dimsInH: parseInt(dimsH),
          privacyPassed: true,
        })
        .onConflictDoUpdate({
          target: inventoryItems.vineItemId,
          set: {
            condition: "New",
            photoSetId: photoSet.photoSetId,
            weightOz: parseInt(weightOz),
            dimsInL: parseInt(dimsL),
            dimsInW: parseInt(dimsW),
            dimsInH: parseInt(dimsH),
            privacyPassed: true,
          },
        })
        .returning();

      // Create/update eBay inventory item
      const sku = `ITEM-${inventoryItem.inventoryId}`;
      
      // Build inventory item payload with shipping package details
      const inventoryItemPayload: any = {
        product: {
          title,
          description,
          aspects: {},
          imageUrls: photoUrls.slice(0, 12),
        },
        condition: "NEW",
        availability: {
          shipToLocationAvailability: {
            quantity: 1,
          },
        },
      };

      // Add package weight and dimensions (required by eBay)
      if (weightOz && dimsL && dimsW && dimsH) {
        inventoryItemPayload.packageWeightAndSize = {
          weight: {
            value: parseFloat(weightOz),
            unit: "OUNCE",
          },
          dimensions: {
            length: parseFloat(dimsL),
            width: parseFloat(dimsW),
            height: parseFloat(dimsH),
            unit: "INCH",
          },
        };
      }

      await createOrUpdateInventoryItemTraced(sku, inventoryItemPayload, tracer);

      // Get or create merchant location
      const merchantLocationKey = await ebayClient.getOrCreateMerchantLocation();

      // Fetch and validate all 3 required business policies
      const { getFulfillmentPolicies, getPaymentPolicies, getReturnPolicies, selectBestPolicy } = await import("./lib/ebay");
      
      // Validate fulfillment policy (user-selected)
      const fulfillmentPoliciesData = await ebayClient.getFulfillmentPolicies("EBAY_US");
      const validFulfillmentPolicy = fulfillmentPoliciesData.fulfillmentPolicies?.find((p: any) => p.fulfillmentPolicyId === fulfillmentPolicyId);
      
      if (!validFulfillmentPolicy) {
        throw new Error(
          `Fulfillment policy ${fulfillmentPolicyId} not found or inactive. ` +
          `Please select a valid policy from your eBay account's Business Policies.`
        );
      }
      
      console.log(`[Publish] Using fulfillment policy: ${validFulfillmentPolicy.name} (${fulfillmentPolicyId})`);
      
      // Auto-select payment policy (prefer default, fallback to first)
      const paymentPoliciesData = await getPaymentPolicies("EBAY_US");
      const selectedPaymentPolicy = selectBestPolicy(
        paymentPoliciesData.paymentPolicies || [],
        "EBAY_US",
        "paymentPolicyId"
      );
      
      if (!selectedPaymentPolicy) {
        throw new Error(
          "No payment policies found for EBAY_US. " +
          "Please configure at least one payment policy in eBay Seller Hub > Business Policies."
        );
      }
      
      const paymentPolicyId = selectedPaymentPolicy.paymentPolicyId;
      console.log(`[Publish] Auto-selected payment policy: ${selectedPaymentPolicy.name} (${paymentPolicyId})`);
      
      // Auto-select return policy (prefer default, fallback to first)
      const returnPoliciesData = await getReturnPolicies("EBAY_US");
      const selectedReturnPolicy = selectBestPolicy(
        returnPoliciesData.returnPolicies || [],
        "EBAY_US",
        "returnPolicyId"
      );
      
      if (!selectedReturnPolicy) {
        throw new Error(
          "No return policies found for EBAY_US. " +
          "Please configure at least one return policy in eBay Seller Hub > Business Policies."
        );
      }
      
      const returnPolicyId = selectedReturnPolicy.returnPolicyId;
      console.log(`[Publish] Auto-selected return policy: ${selectedReturnPolicy.name} (${returnPolicyId})`);

      // IDEMPOTENT FLOW: Detect existing offers
      const offersData = await getOffersBySku(sku, "EBAY_US", tracer);
      const existingOffers = offersData.offers || [];
      
      // Filter to only ACTIVE offers (exclude ENDED, WITHDRAWN, etc.)
      const activeOffers = existingOffers.filter((o: any) => 
        o.marketplaceId === "EBAY_US" && 
        (o.status === "PUBLISHED" || o.status === "UNPUBLISHED")
      );
      const existingOffer = activeOffers[0]; // Use first active offer if multiple exist

      let offerId: string;
      let itemId: string | null = null;
      let reusingExistingOffer = false;

      if (existingOffer) {
        console.log(`[Publish] Found existing ${existingOffer.status} offer ${existingOffer.offerId} for SKU ${sku}`);
        offerId = existingOffer.offerId;
        reusingExistingOffer = true;

        // Compare existing offer with new data
        const comparison = compareOffers(existingOffer, {
          priceCents: parseInt(priceCents),
          categoryId,
          title,
          description,
          fulfillmentPolicyId,
          imageUrls: photoUrls,
        });

        if (comparison.hasChanges) {
          console.log(`[Publish] Changes detected: revisable=${comparison.revisableChanges.join(', ')}, non-revisable=${comparison.nonRevisableChanges.join(', ')}`);

          if (comparison.nonRevisableChanges.length > 0) {
            // Non-revisable changes: withdraw → update → republish
            if (existingOffer.status === "PUBLISHED") {
              await withdrawOffer(offerId, tracer);
            }
            
            // Update offer
            await updateOffer(offerId, {
              sku,
              marketplaceId: "EBAY_US",
              format: "FIXED_PRICE",
              merchantLocationKey,
              listingPolicies: {
                paymentPolicyId,
                returnPolicyId,
                fulfillmentPolicyId,
              },
              pricingSummary: {
                price: {
                  value: (parseInt(priceCents) / 100).toFixed(2),
                  currency: "USD",
                },
              },
              categoryId,
            }, tracer);

            // Republish
            await publishOfferTraced(offerId, tracer);
          } else if (comparison.revisableChanges.length > 0) {
            // Only revisable changes: update in-place (revise)
            await updateOffer(offerId, {
              sku,
              marketplaceId: "EBAY_US",
              format: "FIXED_PRICE",
              merchantLocationKey,
              listingPolicies: {
                paymentPolicyId,
                returnPolicyId,
                fulfillmentPolicyId,
              },
              pricingSummary: {
                price: {
                  value: (parseInt(priceCents) / 100).toFixed(2),
                  currency: "USD",
                },
              },
              categoryId,
            }, tracer);

            // If not published, publish now
            if (existingOffer.status !== "PUBLISHED") {
              await publishOfferTraced(offerId, tracer);
            }
          }
        } else if (existingOffer.status !== "PUBLISHED") {
          // No changes but not published - publish it
          console.log(`[Publish] No changes detected, publishing unpublished offer`);
          await publishOfferTraced(offerId, tracer);
        } else {
          console.log(`[Publish] No changes detected, offer already published`);
        }
      } else {
        // No existing offer - create new one
        console.log(`[Publish] No existing offer found, creating new offer`);
        const offerData = await createOfferTraced({
          sku,
          marketplaceId: "EBAY_US",
          format: "FIXED_PRICE",
          merchantLocationKey,
          listingPolicies: {
            paymentPolicyId,
            returnPolicyId,
            fulfillmentPolicyId,
          },
          pricingSummary: {
            price: {
              value: (parseInt(priceCents) / 100).toFixed(2),
              currency: "USD",
            },
          },
          categoryId,
        }, tracer);

        offerId = offerData.offerId;
        await publishOfferTraced(offerId, tracer);
      }

      // Verify offer published and get itemId
      const verified = await verifyOfferPublished(
        (id: string) => getOffer(id, tracer),
        offerId,
        3,
        2000
      );
      itemId = verified.itemId;

      if (!itemId) {
        throw new Error(`Offer ${offerId} published but itemId not available after verification. Status: ${verified.status}`);
      }

      // Upsert listing record with offerId and itemId
      const existingListing = await db
        .select()
        .from(listings)
        .where(eq(listings.inventoryId, inventoryItem.inventoryId))
        .limit(1);

      let listing;
      if (existingListing.length > 0) {
        const [updated] = await db
          .update(listings)
          .set({
            ebayOfferId: offerId,
            ebayItemId: itemId,
            categoryId,
            title,
            description,
            priceCents: parseInt(priceCents),
            fulfillmentPolicyId,
            publishedAt: new Date(),
            state: "live",
          })
          .where(eq(listings.listingId, existingListing[0].listingId))
          .returning();
        listing = updated;
      } else {
        const [created] = await db
          .insert(listings)
          .values({
            inventoryId: inventoryItem.inventoryId,
            ebayOfferId: offerId,
            ebayItemId: itemId,
            categoryId,
            title,
            description,
            priceCents: parseInt(priceCents),
            fulfillmentPolicyId,
            publishedAt: new Date(),
            state: "live",
          })
          .returning();
        listing = created;
      }

      // Create accounting entry for basis (only if first time)
      const existingLedgerEntries = await db
        .select()
        .from(accountingLedger)
        .where(
          and(
            eq(accountingLedger.inventoryId, inventoryItem.inventoryId),
            eq(accountingLedger.eventType, "basis_add")
          )
        )
        .limit(1);

      if (existingLedgerEntries.length === 0) {
        const [vineItem] = await db
          .select()
          .from(vineItems)
          .where(eq(vineItems.vineItemId, vineItemId));

        await db.insert(accountingLedger).values({
          inventoryId: inventoryItem.inventoryId,
          eventType: "basis_add",
          amountCents: vineItem.etvCents,
          direction: "debit",
          txDate: vineItem.receivedDate,
          note: "Initial basis from ETV",
        });
      }

      // Return success with trace and diagnostic info
      res.json({ 
        success: true,
        listing,
        offerId,
        itemId,
        viewUrl: itemId ? `https://www.ebay.com/itm/${itemId}` : undefined,
        reusingExistingOffer,
        diagnostics: {
          sku,
          packageWeightAndSize: inventoryItemPayload.packageWeightAndSize,
          fulfillmentPolicyId,
          categoryId,
          priceCents: parseInt(priceCents),
        },
        trace: tracer.getTrace(),
      });
    } catch (error: any) {
      console.error("[Publish] Error:", error.message);
      
      // Get the failed step from tracer which has the full eBay error response
      const failedStep = tracer.getFailedStep();
      let ebayErrorResponse: any = null;
      
      // Extract full eBay error structure from the failed step's response body
      if (failedStep?.responseBody && typeof failedStep.responseBody === 'object') {
        ebayErrorResponse = failedStep.responseBody;
      }

      // Build detailed error response with complete eBay error structure
      const errorResponse: any = {
        success: false,
        error: error.message,
        trace: tracer.getTrace(),
        failedStep,
      };

      // If we have a full eBay error response, include it verbatim
      if (ebayErrorResponse?.errors) {
        errorResponse.ebayErrors = ebayErrorResponse.errors; // Array of full error objects
        errorResponse.ebayErrorDetails = ebayErrorResponse; // Complete eBay response
        
        // Create human-readable summary
        errorResponse.details = ebayErrorResponse.errors.map((err: any) => {
          const parts = [
            err.errorId ? `[${err.errorId}]` : '',
            err.message || err.longMessage || 'Unknown error',
          ].filter(Boolean);
          
          if (err.parameters && err.parameters.length > 0) {
            parts.push(`(${err.parameters.map((p: any) => `${p.name}: ${p.value}`).join(', ')})`);
          }
          
          return parts.join(' ');
        });
      } else {
        errorResponse.details = [error.message];
      }

      res.status(400).json(errorResponse);
    }
  });

  // Get all listings with photos
  app.get("/api/listings", async (_req, res) => {
    try {
      const allListings = await db
        .select({
          listingId: listings.listingId,
          inventoryId: listings.inventoryId,
          ebayOfferId: listings.ebayOfferId,
          ebayItemId: listings.ebayItemId,
          categoryId: listings.categoryId,
          title: listings.title,
          description: listings.description,
          priceCents: listings.priceCents,
          fulfillmentPolicyId: listings.fulfillmentPolicyId,
          publishedAt: listings.publishedAt,
          state: listings.state,
          photoSetId: inventoryItems.photoSetId,
          weightOz: inventoryItems.weightOz,
          dimsL: inventoryItems.dimsInL,
          dimsW: inventoryItems.dimsInW,
          dimsH: inventoryItems.dimsInH,
          quantity: inventoryItems.quantity,
        })
        .from(listings)
        .leftJoin(inventoryItems, eq(listings.inventoryId, inventoryItems.inventoryId))
        .orderBy(sql`${listings.publishedAt} DESC NULLS LAST`);

      // Fetch photos for each listing
      const listingsWithPhotos = await Promise.all(
        allListings.map(async (listing) => {
          if (listing.photoSetId) {
            const [photoSet] = await db
              .select()
              .from(photoSets)
              .where(eq(photoSets.photoSetId, listing.photoSetId));
            
            return {
              ...listing,
              photos: photoSet?.urls || [],
            };
          }
          return {
            ...listing,
            photos: [],
          };
        })
      );

      res.json(listingsWithPhotos);
    } catch (error: any) {
      console.error("[Get Listings] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get single listing by ID with all details needed for editing
  app.get("/api/listings/:id", async (req, res) => {
    try {
      const { id } = req.params;

      const [listing] = await db
        .select({
          listingId: listings.listingId,
          inventoryId: listings.inventoryId,
          ebayOfferId: listings.ebayOfferId,
          ebayItemId: listings.ebayItemId,
          categoryId: listings.categoryId,
          title: listings.title,
          description: listings.description,
          priceCents: listings.priceCents,
          fulfillmentPolicyId: listings.fulfillmentPolicyId,
          publishedAt: listings.publishedAt,
          state: listings.state,
          photoSetId: inventoryItems.photoSetId,
          weightOz: inventoryItems.weightOz,
          dimsL: inventoryItems.dimsInL,
          dimsW: inventoryItems.dimsInW,
          dimsH: inventoryItems.dimsInH,
          quantity: inventoryItems.quantity,
          vineItemId: inventoryItems.vineItemId,
          ebaySku: listings.ebaySku,
        })
        .from(listings)
        .leftJoin(inventoryItems, eq(listings.inventoryId, inventoryItems.inventoryId))
        .where(eq(listings.listingId, id));

      if (!listing) {
        return res.status(404).json({ error: "Listing not found" });
      }

      // Fetch photos if available
      let photos: string[] = [];
      if (listing.photoSetId) {
        const [photoSet] = await db
          .select()
          .from(photoSets)
          .where(eq(photoSets.photoSetId, listing.photoSetId));
        
        photos = photoSet?.urls || [];
      }

      res.json({
        ...listing,
        photos,
      });
    } catch (error: any) {
      console.error("[Get Listing By ID] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Edit a listing
  app.put("/api/listings/:id/edit", async (req, res) => {
    const { compareOffers } = await import("./lib/ebayOfferHelpers");
    const { z } = await import("zod");
    
    const tracer = { log: (msg: string) => console.log(msg), getTrace: () => [] };

    // Server-side validation schema  
    const editSchema = z.object({
      title: z.string().min(10).max(80),
      description: z.string().min(20),
      priceCents: z.number().int().positive(),
      ebaySku: z.string().min(1).max(50).regex(/^[a-zA-Z0-9]+$/, "SKU must be alphanumeric only"),
      categoryId: z.string().optional(),
      fulfillmentPolicyId: z.string().optional(),
      weightOz: z.number().positive().optional(),
      dimsL: z.number().positive().optional(),
      dimsW: z.number().positive().optional(),
      dimsH: z.number().positive().optional(),
      quantity: z.number().int().positive().min(1).optional(),
    });

    // Validate input BEFORE try/catch
    const validation = editSchema.safeParse({
      title: req.body.title,
      description: req.body.description,
      priceCents: Number(req.body.priceCents),
      ebaySku: req.body.ebaySku,
      categoryId: req.body.categoryId,
      fulfillmentPolicyId: req.body.fulfillmentPolicyId,
      weightOz: req.body.weightOz ? Number(req.body.weightOz) : undefined,
      dimsL: req.body.dimsL ? Number(req.body.dimsL) : undefined,
      dimsW: req.body.dimsW ? Number(req.body.dimsW) : undefined,
      dimsH: req.body.dimsH ? Number(req.body.dimsH) : undefined,
      quantity: req.body.quantity ? Number(req.body.quantity) : undefined,
    });

    if (!validation.success) {
      return res.status(400).json({
        error: "Validation failed",
        details: validation.error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
      });
    }

    const validatedData = validation.data;

    try {
      const { id } = req.params;

      // Get existing listing
      const [existingListing] = await db
        .select()
        .from(listings)
        .where(eq(listings.listingId, id));

      if (!existingListing) {
        return res.status(404).json({ error: "Listing not found" });
      }

      // Get inventory item with photos
      const [invItem] = await db
        .select()
        .from(inventoryItems)
        .where(eq(inventoryItems.inventoryId, existingListing.inventoryId));

      // Determine quantity: use provided value, or fall back to existing
      const currentQuantity = invItem.quantity ?? 1;
      const targetQuantity = validatedData.quantity ?? currentQuantity;

      let photoUrls: string[] = [];
      if (invItem.photoSetId) {
        const [photoSet] = await db
          .select()
          .from(photoSets)
          .where(eq(photoSets.photoSetId, invItem.photoSetId));
        photoUrls = photoSet?.urls || [];
      }

      // UPDATE EBAY FIRST - if it fails, we won't corrupt local DB
      if (existingListing.ebayOfferId && existingListing.state === "live") {
        // Get current eBay offer
        const currentOffer = await ebayClient.getOffer(existingListing.ebayOfferId);

        // Compare what changed
        const comparison = compareOffers(currentOffer, {
          priceCents: validatedData.priceCents,
          categoryId: validatedData.categoryId || existingListing.categoryId || "",
          title: validatedData.title,
          description: validatedData.description,
          fulfillmentPolicyId: validatedData.fulfillmentPolicyId || existingListing.fulfillmentPolicyId || "",
          imageUrls: photoUrls,
        });

        console.log(`[Edit Listing] Changes detected: revisable=${comparison.revisableChanges.join(', ')}, non-revisable=${comparison.nonRevisableChanges.join(', ')}`);

        // If dimensions or title/description/SKU changed, update inventory item
        const inventoryNeedsUpdate = 
          validatedData.weightOz !== invItem.weightOz ||
          validatedData.dimsL !== invItem.dimsInL ||
          validatedData.dimsW !== invItem.dimsInW ||
          validatedData.dimsH !== invItem.dimsInH ||
          validatedData.ebaySku !== existingListing.ebaySku ||
          comparison.nonRevisableChanges.includes("title") ||
          comparison.nonRevisableChanges.includes("description");

        if (inventoryNeedsUpdate) {
          const sku = validatedData.ebaySku;
          await ebayClient.upsertInventoryItem(sku, {
            product: {
              title: validatedData.title,
              description: validatedData.description,
              aspects: {},
              imageUrls: photoUrls.slice(0, 12),
            },
            condition: "NEW",
            availability: {
              shipToLocationAvailability: {
                quantity: targetQuantity,
              },
            },
            packageWeightAndSize: {
              weight: {
                value: validatedData.weightOz || invItem.weightOz || 1,
                unit: "OUNCE",
              },
              dimensions: {
                length: validatedData.dimsL || invItem.dimsInL || 1,
                width: validatedData.dimsW || invItem.dimsInW || 1,
                height: validatedData.dimsH || invItem.dimsInH || 1,
                unit: "INCH",
              },
            },
          });
        }

        // Get merchant location and policies
        const { getOrCreateMerchantLocation, getPaymentPolicies, getReturnPolicies, selectBestPolicy } = await import("./lib/ebay");
        const merchantLocationKey = await ebayClient.getOrCreateMerchantLocation();
        
        const paymentPoliciesData = await getPaymentPolicies("EBAY_US");
        const selectedPaymentPolicy = selectBestPolicy(
          paymentPoliciesData.paymentPolicies || [],
          "EBAY_US",
          "paymentPolicyId"
        );
        
        const returnPoliciesData = await getReturnPolicies("EBAY_US");
        const selectedReturnPolicy = selectBestPolicy(
          returnPoliciesData.returnPolicies || [],
          "EBAY_US",
          "returnPolicyId"
        );

        // Update offer on eBay
        await ebayClient.updateOffer(existingListing.ebayOfferId, {
          sku: validatedData.ebaySku,
          marketplaceId: "EBAY_US",
          format: "FIXED_PRICE",
          merchantLocationKey,
          listingPolicies: {
            paymentPolicyId: selectedPaymentPolicy.paymentPolicyId,
            returnPolicyId: selectedReturnPolicy.returnPolicyId,
            fulfillmentPolicyId: validatedData.fulfillmentPolicyId || existingListing.fulfillmentPolicyId,
          },
          pricingSummary: {
            price: {
              value: (validatedData.priceCents / 100).toFixed(2),
              currency: "USD",
            },
          },
          categoryId: validatedData.categoryId || existingListing.categoryId,
          availableQuantity: targetQuantity,
        });

        // Republish if needed
        if (comparison.nonRevisableChanges.length > 0 && currentOffer.status !== "PUBLISHED") {
          await ebayClient.publishOffer(existingListing.ebayOfferId);
        }

        console.log(`[Edit Listing] Successfully updated eBay listing ${existingListing.ebayItemId}`);
      }

      // ONLY update local DB after eBay succeeds
      await db
        .update(listings)
        .set({
          title: validatedData.title,
          description: validatedData.description,
          priceCents: validatedData.priceCents,
          ebaySku: validatedData.ebaySku,
          categoryId: validatedData.categoryId,
          fulfillmentPolicyId: validatedData.fulfillmentPolicyId,
        })
        .where(eq(listings.listingId, id));

      // Update inventory item fields (dimensions and quantity)
      const inventoryUpdates: any = {};
      if (validatedData.weightOz !== undefined) inventoryUpdates.weightOz = validatedData.weightOz;
      if (validatedData.dimsL !== undefined) inventoryUpdates.dimsInL = validatedData.dimsL;
      if (validatedData.dimsW !== undefined) inventoryUpdates.dimsInW = validatedData.dimsW;
      if (validatedData.dimsH !== undefined) inventoryUpdates.dimsInH = validatedData.dimsH;
      if (validatedData.quantity !== undefined) inventoryUpdates.quantity = validatedData.quantity;

      if (Object.keys(inventoryUpdates).length > 0) {
        await db
          .update(inventoryItems)
          .set(inventoryUpdates)
          .where(eq(inventoryItems.inventoryId, existingListing.inventoryId));
      }

      res.json({ 
        success: true, 
        message: "Listing updated successfully",
        trace: tracer.getTrace(),
      });
    } catch (error: any) {
      console.error("[Edit Listing] Error:", error);
      
      res.status(500).json({ 
        error: error.message,
        trace: tracer.getTrace(),
      });
    }
  });

  // End/withdraw a listing
  app.post("/api/listings/:id/end", async (req, res) => {
    const { withdrawOffer } = await import("./lib/ebay");
    const { ApiTracer } = await import("./lib/apiTracer");
    
    const tracer = new ApiTracer();

    try {
      const { id } = req.params;

      // Get existing listing
      const [existingListing] = await db
        .select()
        .from(listings)
        .where(eq(listings.listingId, id));

      if (!existingListing) {
        return res.status(404).json({ error: "Listing not found" });
      }

      // Withdraw from eBay if published
      if (existingListing.ebayOfferId && existingListing.state === "live") {
        try {
          await withdrawOffer(existingListing.ebayOfferId, tracer);
          console.log(`[End Listing] Successfully withdrew eBay offer ${existingListing.ebayOfferId}`);
        } catch (ebayError: any) {
          console.error("[End Listing] eBay withdraw failed:", ebayError.message);
          // Continue even if eBay withdraw fails
        }
      }

      // Update local database
      await db
        .update(listings)
        .set({
          state: "ended",
        })
        .where(eq(listings.listingId, id));

      res.json({ 
        success: true, 
        message: "Listing ended successfully",
        trace: tracer.getTrace(),
      });
    } catch (error: any) {
      console.error("[End Listing] Error:", error);
      res.status(500).json({ 
        error: error.message,
        trace: tracer.getTrace(),
      });
    }
  });

  // Zod schema for validating eBay offer data
  const ebayOfferSchema = z.object({
    listing: z.object({
      title: z.string().optional(),
    }).optional(),
    pricingSummary: z.object({
      price: z.object({
        value: z.string().optional(),
        currency: z.string().optional(),
      }).optional(),
    }).optional(),
    availableQuantity: z.number().int().nonnegative().optional(),
    status: z.string().optional(),
    categoryId: z.string().optional(),
  });

  // Sync all listings from eBay using centralized EbayClient
  app.post("/api/listings/sync-from-ebay", async (_req, res) => {
    try {
      console.log("[Sync] Starting sync...");
      
      let created = 0;
      let updated = 0;
      let unchanged = 0;
      const errors: any[] = [];

      // Try Inventory API first, fallback to Trading API if it fails
      let useInventoryAPI = true;
      let tradingListings: any[] = [];

      try {
        // Test if Inventory API works by trying to get first batch
        const testGen = ebayClient.getAllOffers();
        const firstBatch = await testGen.next();
        if (firstBatch.done || !firstBatch.value) {
          console.log("[Sync] Inventory API returned no data, using Trading API");
          useInventoryAPI = false;
        }
      } catch (inventoryError: any) {
        console.log("[Sync] Inventory API failed (likely invalid SKU issue), falling back to Trading API");
        console.log("[Sync] Inventory error:", inventoryError.message);
        useInventoryAPI = false;
      }

      // Prefetch all photoSets once to avoid O(n²) lookups
      const allPhotoSets = await db.select().from(photoSets);
      console.log(`[Sync] Prefetched ${allPhotoSets.length} existing photo sets for deduplication`);

      if (!useInventoryAPI) {
        // Use Trading API to get active listings
        console.log("[Sync] Using Trading API (GetMyeBaySelling)...");
        tradingListings = await ebayClient.getActiveListingsViaTrading();
        console.log(`[Sync] Trading API returned ${tradingListings.length} active listings`);

        // Process Trading API listings
        for (const item of tradingListings) {
          try {
            const sku = item.sku || `EBAY-${item.itemId}`;
            const title = item.title || sku || "Untitled";
            const priceCents = Math.round(item.price * 100);
            const state: 'live' | 'draft' | 'ended' = 'live';

            console.log(`[Sync] Processing eBay listing: ${title} (ID: ${item.itemId}, SKU: ${sku})`);

            // Find existing listing
            let existing = null;
            [existing] = await db.select().from(listings).where(eq(listings.ebayItemId, item.itemId));
            
            if (!existing && sku) {
              [existing] = await db.select().from(listings).where(eq(listings.ebaySku, sku));
            }

            if (existing) {
              console.log(`[Sync] Found existing listing: ${existing.title} (state: ${existing.state})`);
            }

            // Fetch images from eBay inventory item
            let photoSetId: string | null = null;
            try {
              const invItem = await ebayClient.getInventoryItem(sku);
              const imageUrls = invItem.product?.imageUrls || [];
              
              if (imageUrls.length > 0) {
                // Check if we already have a photoSet with these exact URLs to avoid duplicates
                const urlsJson = JSON.stringify(imageUrls);
                const matchingPhotoSet = allPhotoSets.find(ps => JSON.stringify(ps.urls) === urlsJson);
                
                if (matchingPhotoSet) {
                  photoSetId = matchingPhotoSet.photoSetId;
                  console.log(`[Sync] Reusing existing photo set (${imageUrls.length} images)`);
                } else {
                  const [photoSet] = await db.insert(photoSets).values({
                    urls: imageUrls,
                  }).returning();
                  photoSetId = photoSet.photoSetId;
                  allPhotoSets.push(photoSet); // Add to cache for future iterations
                  console.log(`[Sync] Created new photo set with ${imageUrls.length} images`);
                }
              }
            } catch (imageError: any) {
              console.log(`[Sync] Could not fetch images for SKU ${sku}: ${imageError.message}`);
            }

            if (!existing) {
              // Create new inventory and listing
              const [newInventory] = await db.insert(inventoryItems).values({
                vineItemId: null,
                source: "ebay",
                condition: "New",
                quantity: item.quantity || 1,
                privacyPassed: true,
                photoSetId,
              }).returning();

              await db.insert(listings).values({
                inventoryId: newInventory.inventoryId,
                title,
                description: "",
                priceCents,
                state,
                ebayItemId: item.itemId,
                ebaySku: sku,
                ebayOfferId: null,
                lastSyncedAt: new Date(),
              });
              created++;
              console.log(`[Sync] Created: ${title} (SKU: ${sku})`);
            } else {
              // Update existing
              const updateData: any = { source: "ebay" };
              if (photoSetId) {
                updateData.photoSetId = photoSetId;
              }
              
              await db.update(inventoryItems)
                .set(updateData)
                .where(eq(inventoryItems.inventoryId, existing.inventoryId));

              const changed = existing.title !== title || existing.priceCents !== priceCents || existing.state !== state;
              
              if (changed) {
                await db.update(listings).set({
                  title,
                  priceCents,
                  state,
                  ebaySku: sku || existing.ebaySku,
                  lastSyncedAt: new Date(),
                }).where(eq(listings.listingId, existing.listingId));
                updated++;
                console.log(`[Sync] Updated: ${title}`);
              } else {
                unchanged++;
              }
            }
          } catch (itemError: any) {
            console.error(`[Sync] Error processing listing:`, itemError);
            errors.push({ itemId: item.itemId, sku: item.sku, title: item.title, error: itemError.message });
          }
        }
      } else {
        // Use Inventory API (original code path)
        for await (const offerBatch of ebayClient.getAllOffers()) {
        for (const offer of offerBatch) {
          try {
            // CRITICAL: Generate SKU if missing (using FULL unique IDs for guaranteed uniqueness)
            let sku = offer.sku;
            const itemId = offer.listing?.listingId || null;
            const offerTitle = offer.listing?.title || null;
            const offerId = offer.offerId;
            
            if (!sku && itemId) {
              sku = `EBAY-${itemId}`;
              console.log(`[Sync] Generated SKU from itemId: ${sku}`);
            } else if (!sku && offerTitle && offerId) {
              const prefix = offerTitle.replace(/[^a-zA-Z]/g, '').substring(0, 4).toUpperCase() || 'ITEM';
              // Use FULL offerId (with hyphens removed) for guaranteed uniqueness
              const uniqueId = offerId.replace(/-/g, '');
              sku = `${prefix}-${uniqueId}`;
              console.log(`[Sync] Generated SKU from title: ${sku}`);
            } else if (!sku && offerId) {
              // Fallback: use full offerId
              const uniqueId = offerId.replace(/-/g, '');
              sku = `OFFER-${uniqueId}`;
              console.log(`[Sync] Generated fallback SKU: ${sku}`);
            }

            const title = offerTitle || sku || "Untitled";
            const priceCents = offer.pricingSummary?.price?.value 
              ? Math.round(parseFloat(offer.pricingSummary.price.value) * 100) 
              : 0;
            
            // Map status to state
            let state: 'live' | 'draft' | 'ended' = 'draft';
            if (offer.status === 'PUBLISHED') state = 'live';
            else if (offer.status === 'ENDED') state = 'ended';

            // Fetch images from eBay inventory item
            let photoSetId: string | null = null;
            if (sku) {
              try {
                const invItem = await ebayClient.getInventoryItem(sku);
                const imageUrls = invItem.product?.imageUrls || [];
                
                if (imageUrls.length > 0) {
                  // Check if we already have a photoSet with these exact URLs to avoid duplicates
                  const urlsJson = JSON.stringify(imageUrls);
                  const matchingPhotoSet = allPhotoSets.find(ps => JSON.stringify(ps.urls) === urlsJson);
                  
                  if (matchingPhotoSet) {
                    photoSetId = matchingPhotoSet.photoSetId;
                    console.log(`[Sync] Reusing existing photo set (${imageUrls.length} images)`);
                  } else {
                    const [photoSet] = await db.insert(photoSets).values({
                      urls: imageUrls,
                    }).returning();
                    photoSetId = photoSet.photoSetId;
                    allPhotoSets.push(photoSet); // Add to cache for future iterations
                    console.log(`[Sync] Created new photo set with ${imageUrls.length} images`);
                  }
                }
              } catch (imageError: any) {
                console.log(`[Sync] Could not fetch images for SKU ${sku}: ${imageError.message}`);
              }
            }

            // Find existing listing
            let existing = null;
            if (itemId) {
              [existing] = await db.select().from(listings).where(eq(listings.ebayItemId, itemId));
            }
            if (!existing && sku) {
              [existing] = await db.select().from(listings).where(eq(listings.ebaySku, sku));
            }

            if (!existing) {
              // Create new inventory and listing
              const [newInventory] = await db.insert(inventoryItems).values({
                vineItemId: null,
                source: "ebay",
                condition: "New",
                quantity: offer.availableQuantity || 1,
                privacyPassed: true,
                photoSetId,
              }).returning();

              await db.insert(listings).values({
                inventoryId: newInventory.inventoryId,
                title,
                description: "",
                priceCents,
                state,
                ebayItemId: itemId,
                ebaySku: sku,
                ebayOfferId: offer.offerId,
                lastSyncedAt: new Date(),
              });
              created++;
              console.log(`[Sync] Created: ${title} (SKU: ${sku})`);
            } else {
              // Update existing - ensure source is "ebay"
              const updateData: any = { source: "ebay" };
              if (photoSetId) {
                updateData.photoSetId = photoSetId;
              }
              
              await db.update(inventoryItems)
                .set(updateData)
                .where(eq(inventoryItems.inventoryId, existing.inventoryId));

              const changed = existing.title !== title || existing.priceCents !== priceCents || existing.state !== state;
              
              if (changed) {
                await db.update(listings).set({
                  title,
                  priceCents,
                  state,
                  ebaySku: sku || existing.ebaySku,
                  lastSyncedAt: new Date(),
                }).where(eq(listings.listingId, existing.listingId));
                updated++;
                console.log(`[Sync] Updated: ${title}`);
              } else {
                unchanged++;
              }
            }
          } catch (itemError: any) {
            console.error(`[Sync] Error processing listing:`, itemError);
            errors.push({ itemId: offer.listing?.listingId, sku: offer.sku, title: offer.listing?.title, error: itemError.message });
          }
        }
        }
      }

      // Mark removed listings as 'ended' (listings that exist in DB but not on eBay)
      const activeEbayItemIds = new Set<string>();
      
      if (!useInventoryAPI && tradingListings.length > 0) {
        for (const item of tradingListings) {
          if (item.itemId) {
            activeEbayItemIds.add(item.itemId);
            console.log(`[Sync] Added to active set: ${item.itemId}`);
          }
        }
      }

      console.log(`[Sync] Active eBay item IDs: ${Array.from(activeEbayItemIds).join(', ')}`);

      // Get all listings from our database that have eBay item IDs and are not already ended
      const dbListings = await db.select().from(listings).where(
        and(
          isNotNull(listings.ebayItemId),
          ne(listings.state, 'ended')
        )
      );

      console.log(`[Sync] Checking ${dbListings.length} DB listings for removal`);

      let ended = 0;
      for (const dbListing of dbListings) {
        console.log(`[Sync] Checking listing: ${dbListing.title} (ID: ${dbListing.ebayItemId}) - In active set? ${activeEbayItemIds.has(dbListing.ebayItemId || '')}`);
        if (dbListing.ebayItemId && !activeEbayItemIds.has(dbListing.ebayItemId)) {
          // This listing exists in our DB but not on eBay anymore - mark as ended
          await db.update(listings).set({
            state: 'ended',
            lastSyncedAt: new Date(),
          }).where(eq(listings.listingId, dbListing.listingId));
          ended++;
          console.log(`[Sync] Marked as ended (removed from eBay): ${dbListing.title}`);
        }
      }

      console.log(`[Sync] ✅ COMPLETE: created=${created} updated=${updated} unchanged=${unchanged} ended=${ended} failed=${errors.length}`);
      
      res.json({ total: created + updated + unchanged + ended, created, updated, unchanged, ended, failed: errors.length, errors: errors.length > 0 ? errors : undefined });
    } catch (e: any) {
      console.error("[Sync] ❌ FATAL ERROR:", e);
      res.status(500).json({ error: e.message || "sync failed" });
    }
  });

  // Sync single listing from eBay
  app.post("/api/listings/:id/sync-from-ebay", async (req, res) => {
    try {
      const { id } = req.params;

      // Get existing listing
      const [existingListing] = await db
        .select()
        .from(listings)
        .where(eq(listings.listingId, id));

      if (!existingListing) {
        return res.status(404).json({ error: "Listing not found" });
      }

      if (!existingListing.ebayOfferId) {
        return res.status(400).json({ error: "Listing does not have an eBay offer ID" });
      }

      // Fetch fresh data from eBay using centralized client
      const rawEbayOffer = await ebayClient.getOffer(existingListing.ebayOfferId);
      
      // Validate eBay response
      const ebayOffer = ebayOfferSchema.parse(rawEbayOffer);
      
      // Extract current eBay values
      const ebayData = {
        title: ebayOffer.listing?.title || existingListing.title,
        priceCents: (() => {
          const priceValue = ebayOffer.pricingSummary?.price?.value;
          // Only parse if we have a valid string or number value
          if (priceValue === undefined || priceValue === null || priceValue === "") {
            return existingListing.priceCents;
          }
          const parsed = parseFloat(String(priceValue));
          if (!Number.isFinite(parsed) || parsed < 0) {
            console.warn(`[Sync] Invalid price value for listing ${existingListing.listingId}: ${priceValue}`);
            return existingListing.priceCents;
          }
          return Math.round(parsed * 100);
        })(),
        status: ebayOffer.status || "UNKNOWN",
        categoryId: ebayOffer.categoryId || existingListing.categoryId,
      };

      // Calculate drift
      const driftSnapshot: Record<string, { local: any; ebay: any }> = {};
      
      if (existingListing.title !== ebayData.title) {
        driftSnapshot.title = { local: existingListing.title, ebay: ebayData.title };
      }
      if (existingListing.priceCents !== ebayData.priceCents) {
        driftSnapshot.priceCents = { local: existingListing.priceCents, ebay: ebayData.priceCents };
      }
      if (existingListing.categoryId !== ebayData.categoryId) {
        driftSnapshot.categoryId = { local: existingListing.categoryId, ebay: ebayData.categoryId };
      }

      // Update listing with eBay values and drift info
      await db
        .update(listings)
        .set({
          title: ebayData.title,
          priceCents: ebayData.priceCents,
          state: ebayData.status === "PUBLISHED" ? "live" : ebayData.status === "ENDED" ? "ended" : existingListing.state,
          driftSnapshot: Object.keys(driftSnapshot).length > 0 ? driftSnapshot : null,
          lastSyncedAt: new Date(),
        })
        .where(eq(listings.listingId, id));

      res.json({
        success: true,
        drift: Object.keys(driftSnapshot).length > 0 ? driftSnapshot : null,
        ebayData,
      });
    } catch (error: any) {
      console.error("[Sync Single Listing] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get orders stats
  app.get("/api/orders/stats", async (_req, res) => {
    try {
      const result = await db
        .select({
          status: orders.status,
          count: sql<number>`count(*)::int`,
        })
        .from(orders)
        .groupBy(orders.status);

      const stats = {
        pending: result.find((r) => r.status === "pending")?.count || 0,
        paid: result.find((r) => r.status === "paid")?.count || 0,
        shipped: result.find((r) => r.status === "shipped")?.count || 0,
        delivered: result.find((r) => r.status === "delivered")?.count || 0,
      };

      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create a timeline event for an order
  app.post("/api/orders/:orderId/timeline", async (req, res) => {
    try {
      const { orderId } = req.params;

      // Verify order exists
      const [order] = await db
        .select()
        .from(orders)
        .where(eq(orders.orderId, orderId))
        .limit(1);

      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      // Validate request body
      const validation = insertOrderTimelineEventSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ 
          error: "Validation failed", 
          details: validation.error.errors 
        });
      }

      // Insert timeline event
      const [event] = await db
        .insert(orderTimelineEvents)
        .values({
          ...validation.data,
          orderId,
        })
        .returning();

      res.json(event);
    } catch (error: any) {
      console.error("[Timeline Event] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get timeline events for an order
  app.get("/api/orders/:orderId/timeline", async (req, res) => {
    try {
      const { orderId } = req.params;

      // Verify order exists
      const [order] = await db
        .select()
        .from(orders)
        .where(eq(orders.orderId, orderId))
        .limit(1);

      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      // Get timeline events ordered by creation time
      const events = await db
        .select()
        .from(orderTimelineEvents)
        .where(eq(orderTimelineEvents.orderId, orderId))
        .orderBy(asc(orderTimelineEvents.createdAt));

      res.json(events);
    } catch (error: any) {
      console.error("[Timeline Events] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get orders
  app.get("/api/orders", async (_req, res) => {
    try {
      const allOrders = await db
        .select({
          orderId: orders.orderId,
          ebayOrderId: orders.ebayOrderId,
          listingId: orders.listingId,
          buyerId: orders.buyerId,
          saleGrossCents: orders.saleGrossCents,
          shippingCollectedCents: orders.shippingCollectedCents,
          ebayFeesCents: orders.ebayFeesCents,
          payoutCents: orders.payoutCents,
          orderDate: orders.orderDate,
          shipBy: orders.shipBy,
          tracking: orders.tracking,
          carrier: orders.carrier,
          status: orders.status,
          listingTitle: listings.title,
          buyerUsername: buyers.ebayBuyerUsername,
        })
        .from(orders)
        .leftJoin(listings, eq(orders.listingId, listings.listingId))
        .leftJoin(buyers, eq(orders.buyerId, buyers.buyerId))
        .orderBy(desc(orders.orderDate))
        .limit(100);

      res.json(allOrders);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Return item to inventory (cancel order/listing)
  app.post("/api/inventory/:inventoryId/return", async (req, res) => {
    try {
      const { inventoryId } = req.params;
      const { reason } = req.body;

      // Get inventory item and related data
      const [inventoryItem] = await db
        .select()
        .from(inventoryItems)
        .where(eq(inventoryItems.inventoryId, inventoryId));

      if (!inventoryItem) {
        return res.status(404).json({ error: "Inventory item not found" });
      }

      // Get listing if exists
      const [listing] = await db
        .select()
        .from(listings)
        .where(eq(listings.inventoryId, inventoryId));

      // Get order if exists
      let order = null;
      if (listing) {
        [order] = await db
          .select()
          .from(orders)
          .where(eq(orders.listingId, listing.listingId));
      }

      // Update vine item status back to available (only if vineItemId exists)
      if (inventoryItem.vineItemId) {
        await db
          .update(vineItems)
          .set({ status: "available" })
          .where(eq(vineItems.vineItemId, inventoryItem.vineItemId));
      }

      // If there was a listing, mark it as ended
      if (listing) {
        await db
          .update(listings)
          .set({ state: "ended" })
          .where(eq(listings.listingId, listing.listingId));
      }

      // If there was an order, cancel it
      if (order) {
        await db
          .update(orders)
          .set({ status: "cancelled" })
          .where(eq(orders.orderId, order.orderId));
      }

      res.json({ success: true, message: `Item returned to inventory: ${reason || "No reason provided"}` });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Sync orders from eBay and create ledger entries
  app.post("/api/orders/sync", async (req, res) => {
    try {
      const { daysBack = 30 } = req.body;
      
      // Calculate date range for syncing
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - daysBack);

      let syncedCount = 0;
      let updatedCount = 0;

      // Stream all orders using async generator
      for await (const orderBatch of ebayClient.getAllOrders(fromDate)) {
        for (const ebayOrder of orderBatch) {
        try {
          // Wrap each order sync in a transaction for atomicity
          await db.transaction(async (tx) => {
            // Check if order already exists
            const [existingOrder] = await tx
              .select()
              .from(orders)
              .where(eq(orders.ebayOrderId, ebayOrder.orderId));

            if (existingOrder) {
              updatedCount++;
              return; // Skip if already synced
            }

            // Find the listing by eBay item ID
            const lineItem = ebayOrder.lineItems?.[0];
            if (!lineItem) return;

            const [listing] = await tx
              .select()
              .from(listings)
              .where(eq(listings.ebayItemId, lineItem.lineItemId));

            if (!listing) {
              console.warn(`Listing not found for eBay item ${lineItem.lineItemId}`);
              return;
            }

            // Get or create buyer
            const buyerUsername = ebayOrder.buyer?.username || "unknown";
            let [buyer] = await tx
              .select()
              .from(buyers)
              .where(eq(buyers.ebayBuyerUsername, buyerUsername));

            if (!buyer) {
              [buyer] = await tx
                .insert(buyers)
                .values({
                  ebayBuyerUsername: buyerUsername,
                  emailMask: ebayOrder.buyer?.buyerRegistrationAddress?.email?.emailAddress,
                })
                .returning();
            }

            // Parse eBay order amounts
            const saleGrossCents = Math.round(
              parseFloat(ebayOrder.pricingSummary?.total?.value || "0") * 100
            );
            const shippingCollectedCents = Math.round(
              parseFloat(ebayOrder.pricingSummary?.deliveryCost?.value || "0") * 100
            );

            // eBay fees (final value fee + promotion fee)
            // Note: eBay provides detailed fee breakdown in the transaction response
            // For now, we'll estimate at 13.25% (typical eBay final value fee)
            const ebayFinalValueFee = Math.round(saleGrossCents * 0.1325);
            const promotionFee = 0; // Would come from eBay transaction details

            // Extract shipping address from eBay order
            const shipTo = ebayOrder.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
            const shipToFullAddress = shipTo?.contactAddress ? {
              name: shipTo.fullName || '',
              street1: shipTo.contactAddress.addressLine1 || '',
              street2: shipTo.contactAddress.addressLine2,
              city: shipTo.contactAddress.city || '',
              state: shipTo.contactAddress.stateOrProvince || '',
              postalCode: shipTo.contactAddress.postalCode || '',
              country: shipTo.contactAddress.countryCode || 'US',
              phone: shipTo.primaryPhone?.phoneNumber,
            } : null;

            // Create order
            const [newOrder] = await tx
              .insert(orders)
              .values({
                ebayOrderId: ebayOrder.orderId,
                ebaySku: lineItem.sku || listing.ebaySku || '',
                listingId: listing.listingId,
                title: lineItem.title,
                buyerId: buyer.buyerId,
                buyerUsername,
                buyerName: shipTo?.fullName || null,
                shipToFullAddress,
                saleGrossCents,
                shippingCollectedCents,
                ebayFeesCents: ebayFinalValueFee + promotionFee,
                payoutCents: 0, // Updated when payout occurs
                quantityOrdered: lineItem.quantity || 1,
                orderDate: new Date(ebayOrder.creationDate),
                paidTime: ebayOrder.paidTime ? new Date(ebayOrder.paidTime) : null,
                shipBy: ebayOrder.fulfillmentStartInstructions?.[0]?.shipByDate 
                  ? new Date(ebayOrder.fulfillmentStartInstructions[0].shipByDate)
                  : null,
                fulfillmentStatus: ebayOrder.orderFulfillmentStatus,
                status: "paid",
                shippingStatus: "unshipped",
                lastSyncedAt: new Date(),
                lastSyncSource: "auto_sync",
              })
              .returning();

            // Get inventory item for ledger tracking
            const [inventoryItem] = await tx
              .select()
              .from(inventoryItems)
              .where(eq(inventoryItems.inventoryId, listing.inventoryId));

            // Create ledger entries for this order
            const ledgerEntries: InsertAccountingLedger[] = [];

            // 1. Sale entry (credit - revenue)
            ledgerEntries.push({
              inventoryId: listing.inventoryId,
              orderId: newOrder.orderId,
              eventType: "sale",
              amountCents: saleGrossCents,
              direction: "credit",
              note: `Sale: ${listing.title}`,
            });

            // 2. eBay final value fee (debit - expense)
            if (ebayFinalValueFee > 0) {
              ledgerEntries.push({
                inventoryId: listing.inventoryId,
                orderId: newOrder.orderId,
                eventType: "fee",
                amountCents: ebayFinalValueFee,
                direction: "debit",
                note: "eBay final value fee",
              });
            }

            // 3. Promotion fee if applicable (debit - expense)
            if (promotionFee > 0) {
              ledgerEntries.push({
                inventoryId: listing.inventoryId,
                orderId: newOrder.orderId,
                eventType: "promotion_fee",
                amountCents: promotionFee,
                direction: "debit",
                note: "eBay promotion fee",
              });
            }

            // 4. Sales tax collected by marketplace (tracked separately for tax reporting)
            const salesTaxCents = Math.round(
              parseFloat(ebayOrder.pricingSummary?.tax?.value || "0") * 100
            );
            if (salesTaxCents > 0) {
              ledgerEntries.push({
                inventoryId: listing.inventoryId,
                orderId: newOrder.orderId,
                eventType: "sales_tax_collected_by_marketplace",
                amountCents: salesTaxCents,
                direction: "credit",
                note: "Sales tax collected by eBay (not taxable income)",
              });
            }

            // Insert all ledger entries
            await tx.insert(accountingLedger).values(ledgerEntries);

            // Note: vine_items.status is NOT updated to "sold"
            // Order existence now tracks sold status

            syncedCount++;
          });
        } catch (error: any) {
          console.error(`Failed to sync order ${ebayOrder.orderId}:`, error);
          // Continue with next order instead of failing the entire sync
        }
        }
      }

      res.json({ 
        synced: syncedCount,
        updated: updatedCount,
        message: `Synced ${syncedCount} new orders, ${updatedCount} already existed`
      });
    } catch (error: any) {
      console.error("Error syncing orders:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Comprehensive eBay orders sync with drift detection and pagination
  app.post("/api/sync/ebay/orders", async (req, res) => {
    try {
      const { since } = req.query;
      
      // Determine sync start date with smart defaults
      let syncStartDate: Date;
      
      if (since && typeof since === 'string') {
        // Use provided ISO date
        syncStartDate = new Date(since);
      } else {
        // Find the most recent lastSyncedAt from orders table
        const [mostRecentOrder] = await db
          .select({ lastSyncedAt: orders.lastSyncedAt })
          .from(orders)
          .where(sql`${orders.lastSyncedAt} IS NOT NULL`)
          .orderBy(sql`${orders.lastSyncedAt} DESC`)
          .limit(1);
        
        if (mostRecentOrder?.lastSyncedAt) {
          syncStartDate = mostRecentOrder.lastSyncedAt;
        } else {
          // Default to 30 days ago at 00:00 UTC
          syncStartDate = new Date();
          syncStartDate.setDate(syncStartDate.getDate() - 30);
          syncStartDate.setUTCHours(0, 0, 0, 0);
        }
      }

      const fromDate = syncStartDate.toISOString();
      console.log(`[Orders Sync] Starting sync from ${fromDate}`);

      let createdCount = 0;
      let updatedCount = 0;
      let shippedDetectedCount = 0;
      const changedOrderIds: string[] = [];

      // Stream all orders using async generator (handles pagination automatically)
      try {
        for await (const orderBatch of ebayClient.getAllOrders(syncStartDate)) {
          // Process each order in the batch
          for (const ebayOrder of orderBatch) {
            try {
              // Process order in transaction for atomicity
              await db.transaction(async (tx) => {
                const lineItem = ebayOrder.lineItems?.[0];
                if (!lineItem) return;

                // Check if order already exists
                const [existingOrder] = await tx
                  .select()
                  .from(orders)
                  .where(eq(orders.ebayOrderId, ebayOrder.orderId));

                // Extract shipping address
                const shipTo = ebayOrder.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
                const shipToFullAddress = shipTo?.contactAddress ? {
                  name: shipTo.fullName || '',
                  street1: shipTo.contactAddress.addressLine1 || '',
                  street2: shipTo.contactAddress.addressLine2,
                  city: shipTo.contactAddress.city || '',
                  state: shipTo.contactAddress.stateOrProvince || '',
                  postalCode: shipTo.contactAddress.postalCode || '',
                  country: shipTo.contactAddress.countryCode || 'US',
                  phone: shipTo.primaryPhone?.phoneNumber,
                } : null;

                // Parse order amounts
                const saleGrossCents = Math.round(
                  parseFloat(ebayOrder.pricingSummary?.total?.value || "0") * 100
                );
                const shippingCollectedCents = Math.round(
                  parseFloat(ebayOrder.pricingSummary?.deliveryCost?.value || "0") * 100
                );

                // Determine eBay fulfillment status
                const ebayFulfillmentStatus = ebayOrder.orderFulfillmentStatus || 'NOT_STARTED';
                const ebayIsShipped = ebayFulfillmentStatus === 'FULFILLED' || ebayFulfillmentStatus === 'IN_PROGRESS';

                // Compute local shipping status
                let computedShippingStatus: 'unshipped' | 'label_purchased' | 'shipped' = 'unshipped';
                
                if (ebayIsShipped) {
                  computedShippingStatus = 'shipped';
                } else if (existingOrder?.labelId) {
                  // We have a local label but eBay doesn't show shipped
                  computedShippingStatus = 'label_purchased';
                }

                // Drift detection: eBay shows shipped but local doesn't
                let driftSnapshot = existingOrder?.driftSnapshot || [];
                let driftDetected = false;
                
                if (existingOrder && ebayIsShipped && existingOrder.shippingStatus !== 'shipped') {
                  driftDetected = true;
                  shippedDetectedCount++;
                  
                  // Append drift entry matching schema
                  const ebayTracking = ebayOrder.fulfillmentStartInstructions?.[0]?.shippingStep?.shipment?.trackingNumber;
                  const carrier = ebayOrder.fulfillmentStartInstructions?.[0]?.shippingStep?.shipment?.carrier;
                  
                  const driftEntry = {
                    detectedAt: new Date().toISOString(),
                    field: 'shippingStatus',
                    local: existingOrder.shippingStatus,
                    ebay: 'shipped',
                    note: `eBay marked as ${ebayFulfillmentStatus}${ebayTracking ? ` with tracking ${ebayTracking} (${carrier})` : ''}`,
                  };
                  
                  driftSnapshot = [...driftSnapshot, driftEntry];
                  computedShippingStatus = 'shipped';
                  
                  console.log(`[Drift] Order ${ebayOrder.orderId} marked shipped in eBay but not locally`);
                }

                if (existingOrder) {
                  // Update existing order
                  await tx
                    .update(orders)
                    .set({
                      title: lineItem.title,
                      buyerName: shipTo?.fullName || null,
                      shipToFullAddress,
                      quantityOrdered: lineItem.quantity || 1,
                      paidTime: ebayOrder.paidTime ? new Date(ebayOrder.paidTime) : existingOrder.paidTime,
                      fulfillmentStatus: ebayFulfillmentStatus,
                      shippingStatus: computedShippingStatus,
                      ...(driftDetected && {
                        driftSnapshot,
                        driftDetectedAt: new Date(),
                      }),
                      lastSyncedAt: new Date(),
                      lastSyncSource: 'manual_sync',
                    })
                    .where(eq(orders.orderId, existingOrder.orderId));

                  updatedCount++;
                  changedOrderIds.push(ebayOrder.orderId);
                } else {
                  // Find listing by SKU or line item ID
                  const [listing] = await tx
                    .select()
                    .from(listings)
                    .where(
                      lineItem.sku 
                        ? eq(listings.ebaySku, lineItem.sku)
                        : eq(listings.ebayItemId, lineItem.lineItemId)
                    );

                  if (!listing) {
                    console.warn(`[Orders Sync] Listing not found for SKU ${lineItem.sku} or item ${lineItem.lineItemId}`);
                    return;
                  }

                  // Get or create buyer
                  const buyerUsername = ebayOrder.buyer?.username || "unknown";
                  let [buyer] = await tx
                    .select()
                    .from(buyers)
                    .where(eq(buyers.ebayBuyerUsername, buyerUsername));

                  if (!buyer) {
                    [buyer] = await tx
                      .insert(buyers)
                      .values({
                        ebayBuyerUsername: buyerUsername,
                        emailMask: ebayOrder.buyer?.buyerRegistrationAddress?.email?.emailAddress,
                      })
                      .returning();
                  }

                  // Create new order
                  const ebayFinalValueFee = Math.round(saleGrossCents * 0.1325);
                  
                  await tx
                    .insert(orders)
                    .values({
                      ebayOrderId: ebayOrder.orderId,
                      ebaySku: lineItem.sku || listing.ebaySku || '',
                      listingId: listing.listingId,
                      title: lineItem.title,
                      buyerId: buyer.buyerId,
                      buyerUsername,
                      buyerName: shipTo?.fullName || null,
                      shipToFullAddress,
                      saleGrossCents,
                      shippingCollectedCents,
                      ebayFeesCents: ebayFinalValueFee,
                      payoutCents: 0,
                      quantityOrdered: lineItem.quantity || 1,
                      orderDate: new Date(ebayOrder.creationDate),
                      paidTime: ebayOrder.paidTime ? new Date(ebayOrder.paidTime) : null,
                      shipBy: ebayOrder.fulfillmentStartInstructions?.[0]?.shipByDate 
                        ? new Date(ebayOrder.fulfillmentStartInstructions[0].shipByDate)
                        : null,
                      fulfillmentStatus: ebayFulfillmentStatus,
                      status: "paid",
                      shippingStatus: computedShippingStatus,
                      lastSyncedAt: new Date(),
                      lastSyncSource: 'manual_sync',
                    });

                  createdCount++;
                  changedOrderIds.push(ebayOrder.orderId);
                }
              });
            } catch (error: any) {
              console.error(`[Orders Sync] Failed to sync order ${ebayOrder.orderId}:`, error);
              // Continue with next order
            }
          }
        }
      } catch (error: any) {
        console.error('[Orders Sync] Fatal error during sync:', error);
        throw error;
      }

      const syncedCount = createdCount + updatedCount;
      const lastEvaluatedAt = new Date().toISOString();

      console.log(`[Orders Sync] Complete: ${createdCount} created, ${updatedCount} updated, ${shippedDetectedCount} drift detected`);

      res.json({
        syncedCount,
        createdCount,
        updatedCount,
        shippedDetectedCount,
        lastEvaluatedAt,
        changedOrderIds: changedOrderIds.slice(0, 10), // Sample of first 10
      });

    } catch (error: any) {
      console.error('[Orders Sync] Error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Purchase shipping label for an order
  app.post("/api/orders/:orderId/ship", async (req, res) => {
    try {
      const { orderId } = req.params;
      const { rateId, shippoTransactionId } = req.body;

      if (!rateId) {
        return res.status(400).json({ error: "rateId required" });
      }

      // Get the order with listing and inventory details
      const [order] = await db
        .select({
          orderId: orders.orderId,
          ebayOrderId: orders.ebayOrderId,
          listingId: orders.listingId,
          inventoryId: listings.inventoryId,
          status: orders.status,
        })
        .from(orders)
        .innerJoin(listings, eq(orders.listingId, listings.listingId))
        .where(eq(orders.orderId, orderId));

      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      if (order.status === "shipped") {
        return res.status(400).json({ error: "Order already shipped" });
      }

      // Purchase the label from Shippo
      const transaction = await purchaseLabel(rateId);

      if (transaction.status !== "SUCCESS") {
        return res.status(400).json({ 
          error: "Failed to purchase label",
          details: transaction.messages 
        });
      }

      // Extract label details
      const trackingNumber = transaction.tracking_number;
      const carrier = "UPS"; // We only use UPS
      const labelUrl = transaction.label_url;
      const shippingCostCents = Math.round(parseFloat(transaction.rate) * 100);

      // Wrap order update and ledger entry in a transaction for atomicity
      await db.transaction(async (tx) => {
        // Update order with tracking and status
        await tx.update(orders)
          .set({
            tracking: trackingNumber,
            carrier,
            status: "shipped",
          })
          .where(eq(orders.orderId, orderId));

        // Create ledger entry for shipping label purchase (debit - expense)
        await tx.insert(accountingLedger).values({
          inventoryId: order.inventoryId,
          orderId: order.orderId,
          eventType: "shipping_label",
          amountCents: shippingCostCents,
          direction: "debit",
          note: `Shippo label purchase - ${carrier} - Tracking: ${trackingNumber} - Transaction: ${transaction.object_id}`,
        });
      });

      res.json({
        success: true,
        tracking: trackingNumber,
        carrier,
        labelUrl,
        shippingCostCents,
        shippoTransactionId: transaction.object_id,
      });
    } catch (error: any) {
      console.error("Error purchasing shipping label:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Void/refund a shipping label
  app.post("/api/orders/:orderId/void-label", async (req, res) => {
    try {
      const { orderId } = req.params;
      const { refundAmountCents, shippoTransactionId } = req.body;

      if (!refundAmountCents) {
        return res.status(400).json({ error: "refundAmountCents required" });
      }

      // Get the order
      const [order] = await db
        .select({
          orderId: orders.orderId,
          inventoryId: listings.inventoryId,
        })
        .from(orders)
        .innerJoin(listings, eq(orders.listingId, listings.listingId))
        .where(eq(orders.orderId, orderId));

      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      // Create ledger entry for label refund (credit - reverses expense)
      await db.insert(accountingLedger).values({
        inventoryId: order.inventoryId,
        orderId: order.orderId,
        eventType: "label_refund",
        amountCents: refundAmountCents,
        direction: "credit",
        note: `Shippo label void/refund - Transaction: ${shippoTransactionId || 'unknown'}`,
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error voiding label:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get messages
  app.get("/api/messages", async (_req, res) => {
    try {
      // Mock messages - in production would fetch from eBay API
      const messages: any[] = [];
      res.json(messages);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Reply to message
  app.post("/api/messages/reply", async (req, res) => {
    try {
      const { messageId, reply } = req.body;
      // In production, would send via eBay Messaging API
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get return cases
  app.get("/api/returns", async (_req, res) => {
    try {
      // Mock returns - in production would fetch from eBay Post-Order API
      const returnCases: any[] = [];
      res.json(returnCases);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Handle return action
  app.post("/api/returns/action", async (req, res) => {
    try {
      const { orderId, action, refundCents } = req.body;
      
      if (!orderId || !action) {
        return res.status(400).json({ error: "orderId and action required" });
      }

      // Get the order with its listing and inventory
      const [order] = await db
        .select({
          orderId: orders.orderId,
          listingId: orders.listingId,
          inventoryId: listings.inventoryId,
          vineItemId: inventoryItems.vineItemId,
          saleGrossCents: orders.saleGrossCents,
        })
        .from(orders)
        .innerJoin(listings, eq(orders.listingId, listings.listingId))
        .innerJoin(inventoryItems, eq(listings.inventoryId, inventoryItems.inventoryId))
        .where(eq(orders.orderId, orderId));

      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      if (action === "accept_return" || action === "refund") {
        // Mark the order as refunded
        await db.update(orders)
          .set({ status: "refunded" })
          .where(eq(orders.orderId, orderId));

        // Mark the vine item as defective and returned (only if vineItemId exists)
        if (order.vineItemId) {
          await db.update(vineItems)
            .set({ 
              defective: true,
              defectiveNotes: "Returned by buyer",
              status: "returned"
            })
            .where(eq(vineItems.vineItemId, order.vineItemId));
        }

        // Create return ledger entry to reverse the sale
        await db.insert(accountingLedger).values({
          inventoryId: order.inventoryId,
          orderId: order.orderId,
          eventType: "return",
          amountCents: refundCents || order.saleGrossCents,
          direction: "debit",
          note: "Item returned - marked as defective",
        });
      }

      // In production, would also process via eBay Post-Order API
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error handling return:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get accounting stats
  app.get("/api/accounting/stats", async (_req, res) => {
    try {
      const entries = await db.select().from(accountingLedger);

      let totalSales = 0;
      let totalFees = 0;
      let totalShipping = 0;
      let totalPayout = 0;
      let totalBasis = 0;

      for (const entry of entries) {
        const amount = entry.direction === "credit" ? entry.amountCents : -entry.amountCents;
        
        switch (entry.eventType) {
          case "sale":
            totalSales += entry.amountCents;
            break;
          case "fee":
          case "promotion_fee":
            totalFees += entry.amountCents;
            break;
          case "shipping_label":
            totalShipping += entry.amountCents;
            break;
          case "payout":
            totalPayout += entry.amountCents;
            break;
          case "basis_add":
            totalBasis += entry.amountCents;
            break;
        }
      }

      const realizedGain = Math.max(0, totalSales - totalBasis - totalFees - totalShipping);
      const realizedLoss = Math.max(0, totalBasis + totalFees + totalShipping - totalSales);

      // Get additional metrics
      const [statsResult] = await db.select({
        totalListings: sql<number>`count(distinct ${listings.listingId})::int`,
        activeListings: sql<number>`count(distinct case when ${listings.state} = 'live' then ${listings.listingId} end)::int`,
        totalOrders: sql<number>`count(distinct ${orders.orderId})::int`,
        pendingShipments: sql<number>`count(distinct case when ${orders.status} = 'paid' then ${orders.orderId} end)::int`,
      }).from(listings).leftJoin(orders, eq(listings.listingId, orders.listingId));

      const [defectiveCount] = await db.select({
        count: sql<number>`count(*)::int`,
      }).from(vineItems).where(eq(vineItems.defective, true));

      res.json({
        totalSales,
        totalFees,
        totalShipping,
        totalPayout,
        realizedGain,
        realizedLoss,
        totalListings: statsResult?.totalListings || 0,
        activeListings: statsResult?.activeListings || 0,
        totalOrders: statsResult?.totalOrders || 0,
        pendingShipments: statsResult?.pendingShipments || 0,
        defectiveItems: defectiveCount?.count || 0,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get ledger entries
  app.get("/api/accounting/ledger", async (_req, res) => {
    try {
      const entries = await db
        .select({
          ledgerId: accountingLedger.ledgerId,
          inventoryId: accountingLedger.inventoryId,
          orderId: accountingLedger.orderId,
          eventType: accountingLedger.eventType,
          amountCents: accountingLedger.amountCents,
          direction: accountingLedger.direction,
          txDate: accountingLedger.txDate,
          note: accountingLedger.note,
          itemTitle: vineItems.titleNorm,
          defective: vineItems.defective,
        })
        .from(accountingLedger)
        .leftJoin(inventoryItems, eq(accountingLedger.inventoryId, inventoryItems.inventoryId))
        .leftJoin(vineItems, eq(inventoryItems.vineItemId, vineItems.vineItemId))
        .orderBy(desc(accountingLedger.txDate))
        .limit(100);

      res.json(entries);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get item-centric financial view
  app.get("/api/accounting/items", async (_req, res) => {
    try {
      // Get all inventory items with their related data
      const items = await db
        .select()
        .from(inventoryItems)
        .innerJoin(vineItems, eq(inventoryItems.vineItemId, vineItems.vineItemId))
        .leftJoin(listings, eq(inventoryItems.inventoryId, listings.inventoryId))
        .leftJoin(orders, eq(listings.listingId, orders.listingId));

      // Get all ledger entries to calculate totals per item
      const allLedger = await db
        .select()
        .from(accountingLedger);

      // Build item-centric view
      const itemView = items.map((row) => {
        // Get all ledger entries for this inventory item
        const itemLedger = allLedger.filter(
          (entry) => entry.inventoryId === row.inventory_items.inventoryId
        );

        let basisCents = 0;
        let saleCents = 0;
        let feesCents = 0;
        let shippingCostsCents = 0;
        let shippingRefundsCents = 0;

        itemLedger.forEach((entry) => {
          switch (entry.eventType) {
            case "basis_add":
              basisCents += entry.amountCents;
              break;
            case "sale":
              saleCents += entry.amountCents;
              break;
            case "fee":
            case "promotion_fee":
              feesCents += entry.amountCents;
              break;
            case "shipping_label":
              shippingCostsCents += entry.amountCents;
              break;
            case "label_refund":
              shippingRefundsCents += entry.amountCents;
              break;
          }
        });

        const netShippingCosts = shippingCostsCents - shippingRefundsCents;
        const netProfit = saleCents - basisCents - feesCents - netShippingCosts;

        return {
          inventoryId: row.inventory_items.inventoryId,
          title: row.vine_items.titleNorm,
          asin: row.vine_items.asin,
          status: row.vine_items.status,
          receivedDate: row.vine_items.receivedDate,
          publishedAt: row.listings?.publishedAt || null,
          orderDate: row.orders?.orderDate || null,
          orderStatus: row.orders?.status || null,
          basisCents,
          listPriceCents: row.listings?.priceCents || 0,
          saleCents,
          feesCents,
          shippingCostsCents: netShippingCosts,
          netProfitCents: netProfit,
          defective: row.vine_items.defective,
          defectiveNotes: row.vine_items.defectiveNotes,
          tracking: row.orders?.tracking || null,
          carrier: row.orders?.carrier || null,
          orderId: row.orders?.orderId || null,
        };
      });

      res.json(itemView);
    } catch (error: any) {
      console.error("Error in /api/accounting/items:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Export CSV
  app.get("/api/accounting/export/csv", async (_req, res) => {
    try {
      // Get all ledger entries with related item information
      const entries = await db
        .select({
          ledgerId: accountingLedger.ledgerId,
          txDate: accountingLedger.txDate,
          eventType: accountingLedger.eventType,
          amountCents: accountingLedger.amountCents,
          direction: accountingLedger.direction,
          note: accountingLedger.note,
          inventoryId: accountingLedger.inventoryId,
          orderId: accountingLedger.orderId,
          vineItemId: inventoryItems.vineItemId,
          titleNorm: vineItems.titleNorm,
          defective: vineItems.defective,
          defectiveNotes: vineItems.defectiveNotes,
        })
        .from(accountingLedger)
        .leftJoin(inventoryItems, eq(accountingLedger.inventoryId, inventoryItems.inventoryId))
        .leftJoin(vineItems, eq(inventoryItems.vineItemId, vineItems.vineItemId))
        .orderBy(desc(accountingLedger.txDate));
      
      const csv = [
        "Date,Event,Amount,Direction,Item Title,Defective,Defective Notes,Note",
        ...entries.map((e) =>
          `${e.txDate},"${e.eventType}",${e.amountCents / 100},"${e.direction}","${e.titleNorm || ""}","${e.defective ? "YES" : "NO"}","${e.defectiveNotes || ""}","${e.note || ""}"`
        ),
      ].join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=ledger.csv");
      res.send(csv);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Export PDF (simplified)
  app.get("/api/accounting/export/pdf", async (_req, res) => {
    try {
      // In production, would generate PDF using PDFKit
      res.status(501).json({ error: "PDF export not yet implemented" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get Shippo tracking information
  app.get("/api/shippo/tracking/:carrier/:trackingNumber", async (req, res) => {
    try {
      const { carrier, trackingNumber } = req.params;
      const tracking = await getTracking(carrier, trackingNumber);
      res.json(tracking);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get all Shippo transactions
  app.get("/api/shippo/transactions", async (_req, res) => {
    try {
      const transactions = await listAllTransactions();
      res.json(transactions);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Shippo webhook handler for post-shipping adjustments
  app.post("/api/webhooks/shippo", async (req, res) => {
    try {
      const { event, data } = req.body;

      // Log the webhook for debugging
      console.log("Shippo webhook received:", event, data?.object_id);

      // We're primarily interested in transaction updates that include additional charges
      if (event === "transaction_updated" || event === "transaction_created") {
        const transaction = data;
        
        if (!transaction || !transaction.object_id) {
          return res.status(400).json({ error: "Invalid webhook payload" });
        }

        // Check if this is a weight correction or additional charge
        // Shippo sends updated transactions when they detect actual weight differs from declared
        const trackingNumber = transaction.tracking_number;
        
        if (!trackingNumber) {
          // No tracking number means we can't match to an order
          return res.status(200).json({ received: true, skipped: "no tracking number" });
        }

        // Find the order by tracking number
        const [order] = await db
          .select({
            orderId: orders.orderId,
            inventoryId: listings.inventoryId,
            tracking: orders.tracking,
          })
          .from(orders)
          .innerJoin(listings, eq(orders.listingId, listings.listingId))
          .where(eq(orders.tracking, trackingNumber));

        if (!order) {
          console.warn(`Order not found for tracking number: ${trackingNumber}`);
          return res.status(200).json({ received: true, skipped: "order not found" });
        }

        // Check if there are any additional charges beyond the original rate
        // This happens when actual weight > declared weight
        const originalRateCents = Math.round(parseFloat(transaction.rate) * 100);
        const additionalChargeCents = transaction.additional_charge_amount 
          ? Math.round(parseFloat(transaction.additional_charge_amount) * 100)
          : 0;

        if (additionalChargeCents > 0) {
          // Check if we've already logged this adjustment to avoid duplicates
          const [existingAdjustment] = await db
            .select()
            .from(accountingLedger)
            .where(
              and(
                eq(accountingLedger.orderId, order.orderId),
                eq(accountingLedger.eventType, "shipping_label"),
                like(accountingLedger.note, `%${transaction.object_id}%`)
              )
            );

          if (!existingAdjustment) {
            // Create ledger entry for the additional shipping charge
            await db.insert(accountingLedger).values({
              inventoryId: order.inventoryId,
              orderId: order.orderId,
              eventType: "shipping_label",
              amountCents: additionalChargeCents,
              direction: "debit",
              note: `Shippo post-shipping adjustment (weight correction) - Transaction: ${transaction.object_id}`,
            });

            console.log(`Created ledger entry for weight correction: ${additionalChargeCents} cents`);
          } else {
            console.log(`Adjustment already logged for transaction ${transaction.object_id}`);
          }
        }
      }

      // Always return 200 to acknowledge receipt
      res.status(200).json({ received: true });
    } catch (error: any) {
      console.error("Error processing Shippo webhook:", error);
      // Return 200 anyway to prevent Shippo from retrying
      res.status(200).json({ received: true, error: error.message });
    }
  });

  // Get health metrics
  app.get("/api/health/metrics", async (_req, res) => {
    try {
      const metrics = {
        lateShipmentRate: 0.5,
        openCases: 0,
        policyAlerts: 0,
        listingRemovals: 0,
        defectRate: 0.2,
      };

      res.json(metrics);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get health events
  app.get("/api/health/events", async (_req, res) => {
    try {
      const events = await db
        .select()
        .from(healthEvents)
        .orderBy(desc(healthEvents.createdAt))
        .limit(50);

      res.json(events);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // eBay API Prerequisites Health Check
  // Verifies seller account is ready for API listing after OAuth consent
  app.get("/api/health/ebay-prerequisites", async (_req, res) => {
    try {
      const { getAccessToken } = await import("./lib/ebay");
      const token = await getAccessToken();
      const EBAY_API_BASE = process.env.EBAY_ENV === "production" 
        ? "https://api.ebay.com"
        : "https://api.sandbox.ebay.com";

      const results: any = {
        environment: process.env.EBAY_ENV || "sandbox",
        timestamp: new Date().toISOString(),
        checks: {},
        summary: {
          passed: 0,
          failed: 0,
          warnings: 0
        }
      };

      // 1. Check seller privileges
      try {
        const privResponse = await fetch(`${EBAY_API_BASE}/sell/account/v1/privilege`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const privData = await privResponse.json();
        
        const hasSellingPrivilege = privData.sellerRegistrationCompleted === true;
        const restrictions = privData.sellingLimit?.restrictions || [];
        const usRestrictions = restrictions.filter((r: any) => r.marketplaceId === "EBAY_US");

        results.checks.sellerPrivileges = {
          status: hasSellingPrivilege && usRestrictions.length === 0 ? "pass" : "fail",
          sellerRegistrationCompleted: privData.sellerRegistrationCompleted,
          restrictions: usRestrictions,
          message: hasSellingPrivilege 
            ? (usRestrictions.length > 0 ? "Seller registration complete but has US marketplace restrictions" : "Seller registration complete, no restrictions")
            : "Seller registration not completed - account onboarding required"
        };

        if (results.checks.sellerPrivileges.status === "pass") {
          results.summary.passed++;
        } else {
          results.summary.failed++;
        }
      } catch (error: any) {
        results.checks.sellerPrivileges = {
          status: "error",
          error: error.message
        };
        results.summary.failed++;
      }

      // 2. Check user identity
      try {
        const identityResponse = await fetch(`${EBAY_API_BASE}/commerce/identity/v1/user`, {
          headers: { 
            Authorization: `Bearer ${token}`,
            "Accept": "application/json",
            "Content-Language": "en-US",
            "Accept-Language": "en-US"
          }
        });
        
        if (!identityResponse.ok) {
          throw new Error(`Identity API returned ${identityResponse.status}: ${await identityResponse.text()}`);
        }
        
        const identityData = await identityResponse.json();
        
        const expectedUsername = "antonioomar"; // From the guide
        const actualUsername = identityData.username;
        const usernameMatches = actualUsername === expectedUsername;

        results.checks.userIdentity = {
          status: usernameMatches ? "pass" : "warning",
          username: actualUsername,
          expected: expectedUsername,
          message: usernameMatches 
            ? `User identity verified: ${actualUsername}`
            : `Username mismatch - expected ${expectedUsername}, got ${actualUsername}. OAuth may be consented to wrong account.`
        };

        if (results.checks.userIdentity.status === "pass") {
          results.summary.passed++;
        } else {
          results.summary.warnings++;
        }
      } catch (error: any) {
        results.checks.userIdentity = {
          status: "error",
          error: error.message
        };
        results.summary.failed++;
      }

      // 3. Check payment policies
      try {
        const paymentResponse = await fetch(`${EBAY_API_BASE}/sell/account/v1/payment_policy?marketplace_id=EBAY_US`, {
          headers: { 
            Authorization: `Bearer ${token}`,
            "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
            "Accept": "application/json",
            "Content-Language": "en-US",
            "Accept-Language": "en-US"
          }
        });
        
        if (!paymentResponse.ok) {
          throw new Error(`Payment policy API returned ${paymentResponse.status}: ${await paymentResponse.text()}`);
        }
        
        const paymentData = await paymentResponse.json();
        
        // Log raw response for debugging
        console.log("[Health Check] Payment policy raw response:", JSON.stringify(paymentData, null, 2));
        
        // Note: eBay Sell Account API doesn't include status field - policies returned are active by definition
        const usPolicies = paymentData.paymentPolicies?.filter((p: any) => 
          p.marketplaceId === "EBAY_US"
        ) || [];
        
        // Log what we found for debugging
        console.log("[Health Check] Payment policies:", {
          total: usPolicies.length,
          policies: usPolicies.map((p: any) => ({ id: p.paymentPolicyId, name: p.name, marketplaceId: p.marketplaceId }))
        });

        results.checks.paymentPolicies = {
          status: usPolicies.length > 0 ? "pass" : "fail",
          totalPolicies: usPolicies.length,
          activePolicies: usPolicies.length,
          policies: usPolicies.map((p: any) => ({
            id: p.paymentPolicyId,
            name: p.name
          })),
          message: usPolicies.length > 0 
            ? `Found ${usPolicies.length} US payment policy(ies): ${usPolicies.map((p: any) => p.name).join(', ')}`
            : "No US payment policies found - configure in eBay Seller Hub > Business Policies"
        };

        if (results.checks.paymentPolicies.status === "pass") {
          results.summary.passed++;
        } else {
          results.summary.failed++;
        }
      } catch (error: any) {
        results.checks.paymentPolicies = {
          status: "error",
          error: error.message
        };
        results.summary.failed++;
      }

      // 4. Check return policies
      try {
        const returnResponse = await fetch(`${EBAY_API_BASE}/sell/account/v1/return_policy?marketplace_id=EBAY_US`, {
          headers: { 
            Authorization: `Bearer ${token}`,
            "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
            "Accept": "application/json",
            "Content-Language": "en-US",
            "Accept-Language": "en-US"
          }
        });
        
        if (!returnResponse.ok) {
          throw new Error(`Return policy API returned ${returnResponse.status}: ${await returnResponse.text()}`);
        }
        
        const returnData = await returnResponse.json();
        
        // Log raw response for debugging
        console.log("[Health Check] Return policy raw response:", JSON.stringify(returnData, null, 2));
        
        // Note: eBay Sell Account API doesn't include status field - policies returned are active by definition
        const usPolicies = returnData.returnPolicies?.filter((p: any) => 
          p.marketplaceId === "EBAY_US"
        ) || [];
        
        // Log what we found for debugging
        console.log("[Health Check] Return policies:", {
          total: usPolicies.length,
          policies: usPolicies.map((p: any) => ({ id: p.returnPolicyId, name: p.name, marketplaceId: p.marketplaceId }))
        });

        results.checks.returnPolicies = {
          status: usPolicies.length > 0 ? "pass" : "fail",
          totalPolicies: usPolicies.length,
          activePolicies: usPolicies.length,
          policies: usPolicies.map((p: any) => ({
            id: p.returnPolicyId,
            name: p.name
          })),
          message: usPolicies.length > 0 
            ? `Found ${usPolicies.length} US return policy(ies): ${usPolicies.map((p: any) => p.name).join(', ')}`
            : "No US return policies found - configure in eBay Seller Hub > Business Policies"
        };

        if (results.checks.returnPolicies.status === "pass") {
          results.summary.passed++;
        } else {
          results.summary.failed++;
        }
      } catch (error: any) {
        results.checks.returnPolicies = {
          status: "error",
          error: error.message
        };
        results.summary.failed++;
      }

      // 5. Check fulfillment policies
      try {
        const fulfillmentResponse = await fetch(`${EBAY_API_BASE}/sell/account/v1/fulfillment_policy?marketplace_id=EBAY_US`, {
          headers: { 
            Authorization: `Bearer ${token}`,
            "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
            "Accept": "application/json",
            "Content-Language": "en-US",
            "Accept-Language": "en-US"
          }
        });
        
        if (!fulfillmentResponse.ok) {
          throw new Error(`Fulfillment policy API returned ${fulfillmentResponse.status}: ${await fulfillmentResponse.text()}`);
        }
        
        const fulfillmentData = await fulfillmentResponse.json();
        
        // Log raw response for debugging
        console.log("[Health Check] Fulfillment policy raw response:", JSON.stringify(fulfillmentData, null, 2));
        
        // Note: eBay Sell Account API doesn't include status field - policies returned are active by definition
        const usPolicies = fulfillmentData.fulfillmentPolicies?.filter((p: any) => 
          p.marketplaceId === "EBAY_US"
        ) || [];
        
        // Log what we found for debugging
        console.log("[Health Check] Fulfillment policies:", {
          total: usPolicies.length,
          policies: usPolicies.map((p: any) => ({ id: p.fulfillmentPolicyId, name: p.name, marketplaceId: p.marketplaceId }))
        });

        results.checks.fulfillmentPolicies = {
          status: usPolicies.length > 0 ? "pass" : "fail",
          totalPolicies: usPolicies.length,
          activePolicies: usPolicies.length,
          policies: usPolicies.map((p: any) => ({
            id: p.fulfillmentPolicyId,
            name: p.name
          })),
          message: usPolicies.length > 0 
            ? `Found ${usPolicies.length} US fulfillment policy(ies): ${usPolicies.map((p: any) => p.name).join(', ')}`
            : "No US fulfillment policies found - configure in eBay Seller Hub > Business Policies"
        };

        if (results.checks.fulfillmentPolicies.status === "pass") {
          results.summary.passed++;
        } else {
          results.summary.failed++;
        }
      } catch (error: any) {
        results.checks.fulfillmentPolicies = {
          status: "error",
          error: error.message
        };
        results.summary.failed++;
      }

      // Overall status
      results.overallStatus = results.summary.failed === 0 ? "ready" : "not_ready";
      results.message = results.overallStatus === "ready"
        ? "All eBay API prerequisites are satisfied. Ready to publish listings."
        : `${results.summary.failed} check(s) failed. Review failed checks and complete eBay account setup.`;

      res.json(results);
    } catch (error: any) {
      console.error("[Health Check] eBay prerequisites check failed:", error);
      res.status(500).json({ 
        error: "Failed to check eBay prerequisites",
        details: error.message
      });
    }
  });

  // Get eBay account information
  app.get("/api/ebay/account", async (_req, res) => {
    try {
      const { getUserAccountInfo } = await import("./lib/ebay");
      
      const accountInfo = await getUserAccountInfo();
      
      res.json({
        username: accountInfo.username || "N/A",
        userId: accountInfo.userId || "N/A",
        email: accountInfo.individualAccount?.email || accountInfo.businessAccount?.email || "N/A",
        registrationMarketplace: accountInfo.registrationMarketplaceId || "N/A",
        status: accountInfo.status || "UNKNOWN",
      });
    } catch (error: any) {
      console.error("[eBay Account] Failed to fetch account info:", error);
      res.status(500).json({ 
        error: "Failed to fetch eBay account information",
        details: error.message
      });
    }
  });

  const httpServer = createServer(app);

  // Background job: Periodically sync eBay orders with drift detection
  // Runs every 15 minutes to fetch new/updated orders from eBay
  const SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
  let lastSuccessfulSyncTimestamp: Date | null = null;

  async function autoSyncOrders() {
    try {
      console.log("[Auto-Sync] Starting background eBay orders sync...");
      
      // Find the most recent lastSyncedAt from orders table for smart defaults
      const [mostRecentOrder] = await db
        .select({ lastSyncedAt: orders.lastSyncedAt })
        .from(orders)
        .where(sql`${orders.lastSyncedAt} IS NOT NULL`)
        .orderBy(sql`${orders.lastSyncedAt} DESC`)
        .limit(1);
      
      let syncStartDate: Date;
      if (lastSuccessfulSyncTimestamp) {
        syncStartDate = lastSuccessfulSyncTimestamp;
      } else if (mostRecentOrder?.lastSyncedAt) {
        syncStartDate = mostRecentOrder.lastSyncedAt;
      } else {
        // Default to 30 days ago at 00:00 UTC
        syncStartDate = new Date();
        syncStartDate.setDate(syncStartDate.getDate() - 30);
        syncStartDate.setUTCHours(0, 0, 0, 0);
      }

      const fromDate = syncStartDate.toISOString();
      console.log(`[Auto-Sync] Syncing from ${fromDate}`);

      let createdCount = 0;
      let updatedCount = 0;
      let shippedDetectedCount = 0;

      // Stream all orders using async generator (handles pagination automatically)
      for await (const orderBatch of ebayClient.getAllOrders(syncStartDate)) {
        // Process each order with drift detection (matching manual sync endpoint logic)
        for (const ebayOrder of orderBatch) {
          try {
            await db.transaction(async (tx) => {
              const lineItem = ebayOrder.lineItems?.[0];
              if (!lineItem) return;

              const [existingOrder] = await tx
                .select()
                .from(orders)
                .where(eq(orders.ebayOrderId, ebayOrder.orderId));

              // Extract shipping address
              const shipTo = ebayOrder.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
              const shipToFullAddress = shipTo?.contactAddress ? {
                name: shipTo.fullName || '',
                street1: shipTo.contactAddress.addressLine1 || '',
                street2: shipTo.contactAddress.addressLine2,
                city: shipTo.contactAddress.city || '',
                state: shipTo.contactAddress.stateOrProvince || '',
                postalCode: shipTo.contactAddress.postalCode || '',
                country: shipTo.contactAddress.countryCode || 'US',
                phone: shipTo.primaryPhone?.phoneNumber,
              } : null;

              const saleGrossCents = Math.round(
                parseFloat(ebayOrder.pricingSummary?.total?.value || "0") * 100
              );
              const shippingCollectedCents = Math.round(
                parseFloat(ebayOrder.pricingSummary?.deliveryCost?.value || "0") * 100
              );

              const ebayFulfillmentStatus = ebayOrder.orderFulfillmentStatus || 'NOT_STARTED';
              const ebayIsShipped = ebayFulfillmentStatus === 'FULFILLED' || ebayFulfillmentStatus === 'IN_PROGRESS';

              let computedShippingStatus: 'unshipped' | 'label_purchased' | 'shipped' = 'unshipped';
              if (ebayIsShipped) {
                computedShippingStatus = 'shipped';
              } else if (existingOrder?.labelId) {
                computedShippingStatus = 'label_purchased';
              }

              // Drift detection
              let driftSnapshot = existingOrder?.driftSnapshot || [];
              let driftDetected = false;
              
              if (existingOrder && ebayIsShipped && existingOrder.shippingStatus !== 'shipped') {
                driftDetected = true;
                shippedDetectedCount++;
                
                const ebayTracking = ebayOrder.fulfillmentStartInstructions?.[0]?.shippingStep?.shipment?.trackingNumber;
                const carrier = ebayOrder.fulfillmentStartInstructions?.[0]?.shippingStep?.shipment?.carrier;
                
                const driftEntry = {
                  detectedAt: new Date().toISOString(),
                  field: 'shippingStatus',
                  local: existingOrder.shippingStatus,
                  ebay: 'shipped',
                  note: `eBay marked as ${ebayFulfillmentStatus}${ebayTracking ? ` with tracking ${ebayTracking} (${carrier})` : ''}`,
                };
                
                driftSnapshot = [...driftSnapshot, driftEntry];
                computedShippingStatus = 'shipped';
              }

              if (existingOrder) {
                await tx
                  .update(orders)
                  .set({
                    title: lineItem.title,
                    buyerName: shipTo?.fullName || null,
                    shipToFullAddress,
                    quantityOrdered: lineItem.quantity || 1,
                    paidTime: ebayOrder.paidTime ? new Date(ebayOrder.paidTime) : existingOrder.paidTime,
                    fulfillmentStatus: ebayFulfillmentStatus,
                    shippingStatus: computedShippingStatus,
                    ...(driftDetected && {
                      driftSnapshot,
                      driftDetectedAt: new Date(),
                    }),
                    lastSyncedAt: new Date(),
                    lastSyncSource: 'auto_sync',
                  })
                  .where(eq(orders.orderId, existingOrder.orderId));

                updatedCount++;
              } else {
                // Find listing and create new order
                const [listing] = await tx
                  .select()
                  .from(listings)
                  .where(
                    lineItem.sku 
                      ? eq(listings.ebaySku, lineItem.sku)
                      : eq(listings.ebayItemId, lineItem.lineItemId)
                  );

                if (!listing) return;

                const buyerUsername = ebayOrder.buyer?.username || "unknown";
                let [buyer] = await tx
                  .select()
                  .from(buyers)
                  .where(eq(buyers.ebayBuyerUsername, buyerUsername));

                if (!buyer) {
                  [buyer] = await tx
                    .insert(buyers)
                    .values({
                      ebayBuyerUsername: buyerUsername,
                      emailMask: ebayOrder.buyer?.buyerRegistrationAddress?.email?.emailAddress,
                    })
                    .returning();
                }

                const ebayFinalValueFee = Math.round(saleGrossCents * 0.1325);
                
                await tx
                  .insert(orders)
                  .values({
                    ebayOrderId: ebayOrder.orderId,
                    ebaySku: lineItem.sku || listing.ebaySku || '',
                    listingId: listing.listingId,
                    title: lineItem.title,
                    buyerId: buyer.buyerId,
                    buyerUsername,
                    buyerName: shipTo?.fullName || null,
                    shipToFullAddress,
                    saleGrossCents,
                    shippingCollectedCents,
                    ebayFeesCents: ebayFinalValueFee,
                    payoutCents: 0,
                    quantityOrdered: lineItem.quantity || 1,
                    orderDate: new Date(ebayOrder.creationDate),
                    paidTime: ebayOrder.paidTime ? new Date(ebayOrder.paidTime) : null,
                    shipBy: ebayOrder.fulfillmentStartInstructions?.[0]?.shipByDate 
                      ? new Date(ebayOrder.fulfillmentStartInstructions[0].shipByDate)
                      : null,
                    fulfillmentStatus: ebayFulfillmentStatus,
                    status: "paid",
                    shippingStatus: computedShippingStatus,
                    lastSyncedAt: new Date(),
                    lastSyncSource: 'auto_sync',
                  });

                createdCount++;
              }
            });
          } catch (error: any) {
            console.error(`[Auto-Sync] Failed to sync order ${ebayOrder.orderId}:`, error);
          }
        }
      }

      // Update last successful sync timestamp
      lastSuccessfulSyncTimestamp = new Date();
      
      console.log(`[Auto-Sync] Complete: ${createdCount} created, ${updatedCount} updated, ${shippedDetectedCount} drift detected`);
    } catch (error: any) {
      console.error("[Auto-Sync] Error:", error);
    }
  }

  // Start the background sync job
  setInterval(autoSyncOrders, SYNC_INTERVAL_MS);
  
  // Run once on startup (after a short delay to allow server to fully start)
  setTimeout(autoSyncOrders, 30000); // 30 seconds after startup

  // Amazon 1099 CRUD endpoints
  // Get all Amazon 1099 entries for the current user
  app.get("/api/amazon-1099", async (_req, res) => {
    try {
      // For single-user deployment, use default userId
      // In multi-tenant future, get from req.user or session
      const userId = "default";
      
      const data = await db
        .select()
        .from(amazon1099Data)
        .where(eq(amazon1099Data.userId, userId))
        .orderBy(desc(amazon1099Data.taxYear));
      
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Upsert Amazon 1099 entry for a specific year
  app.post("/api/amazon-1099", async (req, res) => {
    try {
      const { taxYear, amountCents, notes } = insertAmazon1099Schema.parse(req.body);
      
      // For single-user deployment, use default userId
      // In multi-tenant future, get from req.user or session
      const userId = "default";
      
      // Check if entry exists for this user and year
      const [existing] = await db
        .select()
        .from(amazon1099Data)
        .where(
          and(
            eq(amazon1099Data.userId, userId),
            eq(amazon1099Data.taxYear, taxYear)
          )
        );

      if (existing) {
        // Update existing entry
        const [updated] = await db
          .update(amazon1099Data)
          .set({ 
            amountCents, 
            notes,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(amazon1099Data.userId, userId),
              eq(amazon1099Data.taxYear, taxYear)
            )
          )
          .returning();
        
        res.json(updated);
      } else {
        // Insert new entry
        const [created] = await db
          .insert(amazon1099Data)
          .values({ userId, taxYear, amountCents, notes })
          .returning();
        
        res.json(created);
      }
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Delete Amazon 1099 entry
  app.delete("/api/amazon-1099/:year", async (req, res) => {
    try {
      const year = parseInt(req.params.year);
      
      // For single-user deployment, use default userId
      // In multi-tenant future, get from req.user or session
      const userId = "default";
      
      await db
        .delete(amazon1099Data)
        .where(
          and(
            eq(amazon1099Data.userId, userId),
            eq(amazon1099Data.taxYear, year)
          )
        );
      
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // eBay 1099-K CRUD endpoints
  // Get all eBay 1099-K entries for the current user
  app.get("/api/ebay-1099", async (_req, res) => {
    try {
      // For single-user deployment, use default userId
      // In multi-tenant future, get from req.user or session
      const userId = "default";
      
      const data = await db
        .select()
        .from(ebay1099Data)
        .where(eq(ebay1099Data.userId, userId))
        .orderBy(desc(ebay1099Data.taxYear));
      
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Upsert eBay 1099-K entry for a specific year
  app.post("/api/ebay-1099", async (req, res) => {
    try {
      const { taxYear, amountCents, notes } = insertEbay1099Schema.parse(req.body);
      
      // For single-user deployment, use default userId
      // In multi-tenant future, get from req.user or session
      const userId = "default";
      
      // Check if entry exists for this user and year
      const [existing] = await db
        .select()
        .from(ebay1099Data)
        .where(
          and(
            eq(ebay1099Data.userId, userId),
            eq(ebay1099Data.taxYear, taxYear)
          )
        );

      if (existing) {
        // Update existing entry
        const [updated] = await db
          .update(ebay1099Data)
          .set({ 
            amountCents, 
            notes,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(ebay1099Data.userId, userId),
              eq(ebay1099Data.taxYear, taxYear)
            )
          )
          .returning();
        
        res.json(updated);
      } else {
        // Insert new entry
        const [created] = await db
          .insert(ebay1099Data)
          .values({ userId, taxYear, amountCents, notes })
          .returning();
        
        res.json(created);
      }
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Delete eBay 1099-K entry
  app.delete("/api/ebay-1099/:year", async (req, res) => {
    try {
      const year = parseInt(req.params.year);
      
      // For single-user deployment, use default userId
      // In multi-tenant future, get from req.user or session
      const userId = "default";
      
      await db
        .delete(ebay1099Data)
        .where(
          and(
            eq(ebay1099Data.userId, userId),
            eq(ebay1099Data.taxYear, year)
          )
        );
      
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Tax Report - Comprehensive annual tax data
  app.get("/api/tax-report", async (_req, res) => {
    try {
      // Get all inventory items with their vine data and accounting ledger
      const allData = await db
        .select({
          inventoryId: inventoryItems.inventoryId,
          vineItemId: vineItems.vineItemId,
          title: vineItems.titleNorm,
          etvCents: vineItems.etvCents,
          receivedDate: vineItems.receivedDate,
          defective: vineItems.defective,
          defectiveNotes: vineItems.defectiveNotes,
          status: vineItems.status,
          listingId: listings.listingId,
          publishedAt: listings.publishedAt,
          orderId: orders.orderId,
          orderDate: orders.orderDate,
          saleGrossCents: orders.saleGrossCents,
        })
        .from(inventoryItems)
        .innerJoin(vineItems, eq(inventoryItems.vineItemId, vineItems.vineItemId))
        .leftJoin(listings, eq(listings.inventoryId, inventoryItems.inventoryId))
        .leftJoin(orders, eq(orders.listingId, listings.listingId));

      // Get all ledger entries
      const allLedger = await db
        .select()
        .from(accountingLedger)
        .orderBy(asc(accountingLedger.txDate));

      // Group data by year
      type YearData = {
        year: number;
        grossSalesCents: number;
        basisCents: number;
        ebayFeesCents: number;
        promotionFeesCents: number;
        shippingCostsCents: number;
        shippingRefundsCents: number;
        salesTaxCollectedCents: number;
        itemsSold: number;
        itemsDefective: number;
        netTaxableIncomeCents: number;
      };

      const yearMap = new Map<number, YearData>();

      const getYearData = (year: number): YearData => {
        if (!yearMap.has(year)) {
          yearMap.set(year, {
            year,
            grossSalesCents: 0,
            basisCents: 0,
            ebayFeesCents: 0,
            promotionFeesCents: 0,
            shippingCostsCents: 0,
            shippingRefundsCents: 0,
            salesTaxCollectedCents: 0,
            itemsSold: 0,
            itemsDefective: 0,
            netTaxableIncomeCents: 0,
          });
        }
        return yearMap.get(year)!;
      };

      // Process all ledger entries by tax year
      for (const entry of allLedger) {
        const year = new Date(entry.txDate).getFullYear();
        const yearData = getYearData(year);

        switch (entry.eventType) {
          case "sale":
            yearData.grossSalesCents += entry.amountCents;
            yearData.itemsSold++;
            break;
          case "basis_add":
            yearData.basisCents += entry.amountCents;
            break;
          case "fee":
            yearData.ebayFeesCents += entry.amountCents;
            break;
          case "promotion_fee":
            yearData.promotionFeesCents += entry.amountCents;
            break;
          case "shipping_label":
            yearData.shippingCostsCents += entry.amountCents;
            break;
          case "label_refund":
            yearData.shippingRefundsCents += entry.amountCents;
            break;
          case "sales_tax_collected_by_marketplace":
            yearData.salesTaxCollectedCents += entry.amountCents;
            break;
        }
      }

      // Calculate net taxable income for each year
      for (const yearData of Array.from(yearMap.values())) {
        yearData.netTaxableIncomeCents =
          yearData.grossSalesCents -
          yearData.basisCents -
          yearData.ebayFeesCents -
          yearData.promotionFeesCents -
          (yearData.shippingCostsCents - yearData.shippingRefundsCents);
      }

      // Cross-year analysis: items received in one year but sold in another
      type CrossYearItem = {
        title: string;
        receivedYear: number;
        soldYear: number;
        basisCents: number;
        saleCents: number;
      };

      const crossYearItems: CrossYearItem[] = [];

      for (const item of allData) {
        // Only include items that have complete sale data (skip pending/incomplete orders)
        if (item.orderDate && item.receivedDate && item.saleGrossCents !== null && item.saleGrossCents > 0) {
          const receivedYear = new Date(item.receivedDate).getFullYear();
          const soldYear = new Date(item.orderDate).getFullYear();

          if (receivedYear !== soldYear) {
            crossYearItems.push({
              title: item.title,
              receivedYear,
              soldYear,
              basisCents: item.etvCents,
              saleCents: item.saleGrossCents,
            });
          }
        }
      }

      // Current inventory value (unsold items with basis)
      const unsoldItems = allData.filter(
        (item) => !item.orderDate && !item.defective && item.status === "available"
      );
      
      const currentInventoryBasisCents = unsoldItems.reduce(
        (sum, item) => sum + item.etvCents,
        0
      );

      // Group unsold items by year received
      const unsoldByYear = new Map<number, { count: number; basisCents: number }>();
      for (const item of unsoldItems) {
        const year = new Date(item.receivedDate).getFullYear();
        if (!unsoldByYear.has(year)) {
          unsoldByYear.set(year, { count: 0, basisCents: 0 });
        }
        const yearData = unsoldByYear.get(year)!;
        yearData.count++;
        yearData.basisCents += item.etvCents;
      }

      // Count defective items
      const defectiveItems = allData.filter((item) => item.defective);
      const defectiveBasisCents = defectiveItems.reduce(
        (sum, item) => sum + item.etvCents,
        0
      );

      // Get Amazon 1099 data for the current user
      // For single-user deployment, use default userId
      // In multi-tenant future, get from req.user or session
      const userId = "default";
      
      const amazon1099Entries = await db
        .select()
        .from(amazon1099Data)
        .where(eq(amazon1099Data.userId, userId))
        .orderBy(asc(amazon1099Data.taxYear));

      // Get eBay 1099-K data for the current user
      const ebay1099Entries = await db
        .select()
        .from(ebay1099Data)
        .where(eq(ebay1099Data.userId, userId))
        .orderBy(asc(ebay1099Data.taxYear));

      // Calculate ETV received each year from vine items
      const etvByYearReceived = new Map<number, number>();
      for (const item of allData) {
        const year = new Date(item.receivedDate).getFullYear();
        etvByYearReceived.set(
          year,
          (etvByYearReceived.get(year) || 0) + item.etvCents
        );
      }

      // Calculate gross sales by year (from annual summary)
      const grossSalesByYear = new Map<number, number>();
      for (const yearData of Array.from(yearMap.values())) {
        grossSalesByYear.set(yearData.year, yearData.grossSalesCents);
      }

      // Return comprehensive report
      res.json({
        annualSummary: Array.from(yearMap.values()).sort((a, b) => a.year - b.year),
        crossYearAnalysis: crossYearItems,
        currentInventory: {
          totalItemsUnsold: unsoldItems.length,
          totalBasisCents: currentInventoryBasisCents,
          byYearReceived: Array.from(unsoldByYear.entries()).map(([year, data]) => ({
            year,
            count: data.count,
            basisCents: data.basisCents,
          })),
        },
        defectiveItems: {
          count: defectiveItems.length,
          totalBasisCents: defectiveBasisCents,
        },
        amazon1099: {
          entries: amazon1099Entries,
          etvReceivedByYear: Array.from(etvByYearReceived.entries())
            .map(([year, etv]) => ({
              year,
              calculatedEtvCents: etv,
              reported1099Cents: amazon1099Entries.find((e) => e.taxYear === year)?.amountCents || null,
              hasDiscrepancy: amazon1099Entries.find((e) => e.taxYear === year)
                ? Math.abs(etv - (amazon1099Entries.find((e) => e.taxYear === year)?.amountCents || 0)) > 100
                : false,
            }))
            .sort((a, b) => a.year - b.year),
        },
        ebay1099: {
          entries: ebay1099Entries,
          salesByYear: Array.from(grossSalesByYear.entries())
            .map(([year, sales]) => ({
              year,
              calculatedGrossSalesCents: sales,
              reported1099KCents: ebay1099Entries.find((e) => e.taxYear === year)?.amountCents || null,
              hasDiscrepancy: ebay1099Entries.find((e) => e.taxYear === year)
                ? Math.abs(sales - (ebay1099Entries.find((e) => e.taxYear === year)?.amountCents || 0)) > 100
                : false,
            }))
            .sort((a, b) => a.year - b.year),
        },
        taxNotes: {
          vineProgram:
            "All items were received for free through Amazon's Vine program. The Estimated Tax Value (ETV) provided by Amazon represents the cost basis for each item.",
          amazon1099:
            "Amazon issues a Form 1099-MISC or 1099-NEC each year reporting the total ETV of items you received as TAXABLE INCOME. This is the first layer of taxation. You must report this income in the year you receive the items, NOT when you sell them.",
          ebay1099K:
            "eBay may issue a Form 1099-K reporting gross payment amounts when you sell items. This form does NOT account for cost basis (ETV), business expenses (fees, shipping), or sales tax collected by the marketplace.",
          doubleTaxationRisk:
            "CRITICAL: Without proper accounting, you will be taxed TWICE - once on the ETV when received (Amazon 1099) and again on the full sale price (eBay 1099-K). To avoid this, your tax preparer MUST deduct the ETV as cost basis when reporting eBay sales.",
          properTreatment:
            "Year received: Report Amazon 1099 amount as income. Year sold: Report eBay gross sales, then deduct ETV as cost basis along with all business expenses (fees, shipping). Net taxable income = Sale Price - ETV - Expenses.",
          crossYearBasis:
            "Due to Amazon's 6-month waiting period recommendation, many items received in one year are sold in the following year. The ETV is reported as income in the year received (per Amazon 1099), but is deducted as cost basis in the year of sale.",
          reconciliation:
            "Compare your calculated ETV by year with Amazon's 1099 amounts. Small discrepancies may occur due to timing differences, but large differences should be investigated. Provide both this report and your Amazon 1099 forms to your tax preparer.",
          defectiveItems:
            "Defective items (including returns) that cannot be sold may qualify for loss deductions. The ETV was already reported as income when received, so the loss deduction helps offset that income.",
        },
      });
    } catch (error: any) {
      console.error("Error generating tax report:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================================================
  // Config Routes
  // ============================================================================

  // GET /api/config - Get all config settings
  app.get("/api/config", async (_req, res) => {
    try {
      const configEntries = await db.select().from(config);
      const configMap: Record<string, any> = {};
      
      for (const entry of configEntries) {
        configMap[entry.configKey] = entry.value;
      }
      
      res.json(configMap);
    } catch (error: any) {
      console.error("[Config] Error fetching config:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/config/:key - Update a single config setting
  app.post("/api/config/:key", async (req, res) => {
    try {
      const { key } = req.params;

      if (!key) {
        return res.status(400).json({ error: "Config key is required" });
      }

      // Validate request body using insertConfigSchema
      const validation = insertConfigSchema.safeParse({
        configKey: key,
        value: req.body.value,
      });

      if (!validation.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: validation.error.errors,
        });
      }

      // Upsert config setting
      await db
        .insert(config)
        .values(validation.data)
        .onConflictDoUpdate({
          target: config.configKey,
          set: { value: validation.data.value, updatedAt: new Date() },
        });

      res.json({ key, value: validation.data.value });
    } catch (error: any) {
      console.error("[Config] Error updating config:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Initialize default shipping settings if they don't exist
  async function initializeDefaultSettings() {
    try {
      const existingSettings = await db.select().from(config);
      const existingKeys = new Set(existingSettings.map((s) => s.configKey));

      const defaults: Array<{ configKey: string; value: any }> = [
        { configKey: "autoMarkShipped", value: false },
        { configKey: "autoBuyLabels", value: false },
        { configKey: "signatureThresholdCents", value: 25000 }, // $250
        { configKey: "insuranceCapCents", value: 50000 }, // $500
        { configKey: "shipCutoffTime", value: "16:00" }, // 4 PM
        { 
          configKey: "parcelPresets", 
          value: [
            { label: "Small Box", length: 8, width: 6, height: 4, weight: 8 },
            { label: "Medium Box", length: 12, width: 10, height: 6, weight: 16 },
            { label: "Large Box", length: 18, width: 14, height: 10, weight: 32 }
          ] 
        },
      ];

      for (const setting of defaults) {
        if (!existingKeys.has(setting.configKey)) {
          await db.insert(config).values(setting);
          console.log(`[Config] Initialized default setting: ${setting.configKey} = ${JSON.stringify(setting.value)}`);
        }
      }
    } catch (error: any) {
      console.error("[Config] Error initializing default settings:", error);
    }
  }

  // Initialize settings on server start
  initializeDefaultSettings();

  // ============================================================================
  // Shipping Workflow Routes
  // ============================================================================

  // POST /api/orders/:id/rates - Get shipping rates for an order
  app.post("/api/orders/:id/rates", async (req, res) => {
    try {
      const { id: orderId } = req.params;

      // Get order
      const order = await db.query.orders.findFirst({
        where: eq(orders.orderId, orderId),
      });

      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      // Validate order is in Paid status
      if (order.status !== "paid") {
        return res.status(400).json({ 
          error: "Order must be in Paid status to quote rates",
          currentStatus: order.status 
        });
      }

      // Validate shipping address exists
      if (!order.shipToFullAddress) {
        return res.status(400).json({ error: "Order missing shipping address" });
      }

      // Get default ship-from address
      const shipFromProfile = await db.query.addressProfiles.findFirst({
        where: and(
          eq(addressProfiles.isDefault, true),
          eq(addressProfiles.kind, "street_profile")
        ),
      });

      if (!shipFromProfile) {
        return res.status(400).json({ 
          error: "No default ship-from address configured. Please add a default street address profile." 
        });
      }

      // Prepare ship-from address for Shippo
      const addressFrom = {
        name: "Ship From", // TODO: Get from business profile
        street1: shipFromProfile.line1,
        street2: shipFromProfile.line2 || "",
        city: shipFromProfile.city,
        state: shipFromProfile.state,
        zip: shipFromProfile.zip,
        country: shipFromProfile.country,
      };

      // Prepare ship-to address from order
      const addressTo = {
        name: order.shipToFullAddress.name,
        company: order.shipToFullAddress.company || "",
        street1: order.shipToFullAddress.street1,
        street2: order.shipToFullAddress.street2 || "",
        city: order.shipToFullAddress.city,
        state: order.shipToFullAddress.state,
        zip: order.shipToFullAddress.postalCode,
        country: order.shipToFullAddress.country,
        phone: order.shipToFullAddress.phone || "",
        email: order.shipToFullAddress.email || "",
      };

      // Get parcel dimensions from config or use defaults
      // TODO: Get from item dimensions or config
      const parcels = [{
        length: "12",
        width: "12",
        height: "6",
        distance_unit: "in",
        weight: "2",
        mass_unit: "lb",
      }];

      console.log("[Rates] Requesting rates from Shippo:", { 
        from: addressFrom.city,
        to: addressTo.city,
        parcels 
      });

      // Call Shippo to create shipment and get rates
      const shipment = await createShipment({
        addressFrom,
        addressTo,
        parcels,
      });

      // Check for address validation errors
      const addressToValidation = shipment.address_to?.validation_results;
      const addressFromValidation = shipment.address_from?.validation_results;

      const addressErrors: any[] = [];

      if (addressToValidation && addressToValidation.is_valid === false) {
        addressErrors.push({
          type: "ship_to",
          messages: addressToValidation.messages || [],
          address: addressTo,
        });
      }

      if (addressFromValidation && addressFromValidation.is_valid === false) {
        addressErrors.push({
          type: "ship_from",
          messages: addressFromValidation.messages || [],
          address: addressFrom,
        });
      }

      // If we have address validation errors, return them with proper error code
      if (addressErrors.length > 0) {
        console.error("[Rates] Address validation failed:", addressErrors);
        return res.status(400).json({
          error: "ADDRESS_VALIDATION_FAILED",
          message: "One or more addresses failed validation",
          addressErrors,
          shipmentId: shipment.object_id,
        });
      }

      if (!shipment.rates || shipment.rates.length === 0) {
        console.error("[Rates] No rates returned from Shippo:", shipment);
        return res.status(500).json({ 
          error: "No shipping rates available",
          details: shipment.messages || [] 
        });
      }

      // Clone and sort rates by price (avoid mutating Shippo's original array)
      const sortedRates = [...shipment.rates].sort((a: any, b: any) => {
        const amountA = parseFloat(a.amount);
        const amountB = parseFloat(b.amount);
        
        // Handle invalid amounts by sorting them to the end
        if (isNaN(amountA)) return 1;
        if (isNaN(amountB)) return -1;
        
        return amountA - amountB;
      });

      // Validate we have at least one rate
      if (sortedRates.length === 0) {
        console.error("[Rates] No valid rates after sorting");
        return res.status(500).json({ 
          error: "No shipping rates available after processing",
          details: shipment.messages || [] 
        });
      }

      // Get top 3 cheapest rates (or fewer if less available)
      const topRates = sortedRates.slice(0, Math.min(3, sortedRates.length));

      // Auto-select and persist the cheapest rate with validation
      const cheapestRate = sortedRates[0];
      
      // Validate rate data
      if (!cheapestRate.object_id) {
        console.error("[Rates] Cheapest rate missing object_id:", cheapestRate);
        return res.status(500).json({ error: "Invalid rate data from Shippo" });
      }

      const serviceName = cheapestRate.servicelevel?.name || cheapestRate.servicelevel_name || "Unknown Service";
      const carrierName = cheapestRate.provider || "Unknown Carrier";
      
      // Parse and validate amount with explicit type checking
      if (!cheapestRate.amount || typeof cheapestRate.amount === 'undefined') {
        console.error("[Rates] Cheapest rate missing amount:", cheapestRate);
        return res.status(500).json({ error: "Rate missing amount from Shippo" });
      }
      
      const amountFloat = parseFloat(String(cheapestRate.amount));
      if (isNaN(amountFloat) || amountFloat < 0 || !isFinite(amountFloat)) {
        console.error("[Rates] Invalid amount in cheapest rate:", cheapestRate.amount);
        return res.status(500).json({ error: "Invalid rate amount from Shippo" });
      }
      
      const amountCents = Math.round(amountFloat * 100);

      // Persist the validated rate
      await db
        .update(orders)
        .set({
          shippoRateId: cheapestRate.object_id,
          serviceLevel: serviceName,
          shippingCostCents: amountCents,
        })
        .where(eq(orders.orderId, orderId));

      console.log("[Rates] Persisted cheapest rate:", {
        rateId: cheapestRate.object_id,
        service: serviceName,
        carrier: carrierName,
        amountCents,
      });

      // Write timeline event with validated data
      await db.insert(orderTimelineEvents).values({
        orderId,
        eventType: "rates_quoted",
        note: `Shipping rates quoted: ${sortedRates.length} option${sortedRates.length === 1 ? '' : 's'} available. Auto-selected ${carrierName} ${serviceName} ($${amountFloat.toFixed(2)})`,
        metadata: { 
          shipmentId: shipment.object_id,
          rateCount: sortedRates.length,
          selectedRate: {
            rateId: cheapestRate.object_id,
            carrier: carrierName,
            service: serviceName,
            amountCents,
            currency: cheapestRate.currency || "USD",
          }
        },
      });

      res.json({
        shipmentId: shipment.object_id,
        topRates: topRates.map((rate: any) => ({
          rateId: rate.object_id,
          carrier: rate.provider,
          service: rate.servicelevel?.name || rate.servicelevel_name,
          amountCents: Math.round(parseFloat(rate.amount) * 100),
          estimatedDays: rate.estimated_days,
          currency: rate.currency,
        })),
        allRates: sortedRates.map((rate: any) => ({
          rateId: rate.object_id,
          carrier: rate.provider,
          service: rate.servicelevel?.name || rate.servicelevel_name,
          amountCents: Math.round(parseFloat(rate.amount) * 100),
          estimatedDays: rate.estimated_days,
          currency: rate.currency,
        })),
      });

    } catch (error: any) {
      console.error("[Rates] Error:", error);
      res.status(500).json({ 
        error: error.message,
        details: error.response?.data || error 
      });
    }
  });

  // POST /api/orders/:id/buy - Purchase shipping label (idempotent)
  app.post("/api/orders/:id/buy", async (req: Request, res: Response) => {
    try {
      const orderId = req.params.id;

      // Fetch order
      const order = await db.query.orders.findFirst({
        where: eq(orders.orderId, orderId),
      });

      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      // Validate order is in Paid status
      if (order.status !== "paid") {
        return res.status(400).json({ 
          error: "Order must be in Paid status to purchase label",
          currentStatus: order.status 
        });
      }

      // Idempotency: Check if label already purchased
      if (order.shippoTransactionId && order.labelUrl) {
        console.log("[Buy] Label already purchased, returning existing label:", order.shippoTransactionId);
        return res.json({
          alreadyPurchased: true,
          labelUrl: order.labelUrl,
          trackingNumber: order.trackingNumber,
          trackingProvider: order.trackingProvider,
          transactionId: order.shippoTransactionId,
        });
      }

      // Validate shippoRateId exists (should be set by rates endpoint)
      if (!order.shippoRateId) {
        return res.status(400).json({ 
          error: "Must quote rates first",
          details: "Call POST /api/orders/:id/rates to quote shipping rates before purchasing label"
        });
      }

      console.log("[Buy] Purchasing label with rateId:", order.shippoRateId);

      // Purchase label via Shippo
      const transaction = await purchaseLabel(order.shippoRateId);

      console.log("[Buy] Shippo transaction response:", {
        status: transaction.status,
        objectId: transaction.object_id,
        trackingNumber: transaction.tracking_number,
      });

      // Validate transaction response
      if (transaction.status !== "SUCCESS") {
        console.error("[Buy] Label purchase failed:", transaction.messages);
        return res.status(500).json({ 
          error: "Label purchase failed",
          shippoError: transaction.messages || [],
          shippoStatus: transaction.status,
        });
      }

      // Validate required fields exist
      if (!transaction.object_id) {
        console.error("[Buy] Transaction missing object_id:", transaction);
        return res.status(500).json({ error: "Invalid transaction: missing ID" });
      }

      if (!transaction.label_url) {
        console.error("[Buy] Transaction missing label_url:", transaction);
        return res.status(500).json({ error: "Invalid transaction: missing label URL" });
      }

      if (!transaction.tracking_number) {
        console.error("[Buy] Transaction missing tracking_number:", transaction);
        return res.status(500).json({ error: "Invalid transaction: missing tracking number" });
      }

      // Extract actual cost, service, and carrier from transaction
      const actualRate = transaction.rate;
      let actualCostCents = order.shippingCostCents; // Fallback to quoted rate
      let serviceName = order.serviceLevel || "Unknown Service";
      let trackingProvider = "UPS"; // Default carrier
      
      if (actualRate) {
        // Use actual cost from transaction if available
        if (actualRate.amount) {
          const amountFloat = parseFloat(String(actualRate.amount));
          if (!isNaN(amountFloat) && isFinite(amountFloat) && amountFloat >= 0) {
            actualCostCents = Math.round(amountFloat * 100);
          }
        }
        
        // Use actual service name from transaction if available
        if (actualRate.servicelevel?.name) {
          serviceName = actualRate.servicelevel.name;
        } else if (actualRate.servicelevel_name) {
          serviceName = actualRate.servicelevel_name;
        }
        
        // Use provider from rate (more reliable than tracking_url_provider)
        if (actualRate.provider) {
          trackingProvider = actualRate.provider;
        }
      }
      
      // Fallback to transaction-level tracking provider if rate doesn't have it
      if (!actualRate?.provider && transaction.tracking_url_provider) {
        trackingProvider = transaction.tracking_url_provider;
      }

      // Persist label data with actual cost and service
      await db
        .update(orders)
        .set({
          shippoTransactionId: transaction.object_id,
          labelUrl: transaction.label_url,
          trackingNumber: transaction.tracking_number,
          trackingProvider,
          serviceLevel: serviceName,
          shippingCostCents: actualCostCents,
          shippingStatus: "label_purchased",
          labelPurchasedAt: new Date(),
        })
        .where(eq(orders.orderId, orderId));

      console.log("[Buy] Persisted label data:", {
        transactionId: transaction.object_id,
        trackingNumber: transaction.tracking_number,
        labelUrl: transaction.label_url,
        carrier: trackingProvider,
        service: serviceName,
        costCents: actualCostCents,
      });

      // Write timeline event
      await db.insert(orderTimelineEvents).values({
        orderId,
        eventType: "label_purchased",
        note: `Shipping label purchased: ${trackingProvider} ${serviceName} - Tracking: ${transaction.tracking_number} - Cost: $${((actualCostCents ?? 0) / 100).toFixed(2)}`,
        metadata: {
          transactionId: transaction.object_id,
          trackingNumber: transaction.tracking_number,
          carrier: trackingProvider,
          service: serviceName,
          labelUrl: transaction.label_url,
          shippingCostCents: actualCostCents,
        },
      });

      // Return normalized values that match persisted state
      res.json({
        labelUrl: transaction.label_url,
        trackingNumber: transaction.tracking_number,
        trackingProvider,                    // Normalized carrier
        transactionId: transaction.object_id,
        service: serviceName,                // Normalized service
        shippingCostCents: actualCostCents,  // Normalized cost
      });

    } catch (error: any) {
      console.error("[Buy] Error:", error);
      res.status(500).json({ 
        error: error.message,
        details: error.response?.data || error 
      });
    }
  });

  // GET /api/orders/:id/label - Get label URL for printing
  app.get("/api/orders/:id/label", async (req: Request, res: Response) => {
    try {
      const orderId = req.params.id;

      // Fetch order
      const order = await db.query.orders.findFirst({
        where: eq(orders.orderId, orderId),
      });

      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      // Check if label exists
      if (!order.labelUrl) {
        return res.status(404).json({ 
          error: "Label not found",
          details: "Label has not been purchased yet. Call POST /api/orders/:id/buy first."
        });
      }

      res.json({
        labelUrl: order.labelUrl,
        trackingNumber: order.trackingNumber,
        trackingProvider: order.trackingProvider,
        service: order.serviceLevel,
        shippingCostCents: order.shippingCostCents,
        shippingStatus: order.shippingStatus,
        labelPurchasedAt: order.labelPurchasedAt,
      });

    } catch (error: any) {
      console.error("[Get Label] Error:", error);
      res.status(500).json({ 
        error: error.message,
        details: error.response?.data || error 
      });
    }
  });

  // POST /api/orders/:id/confirm-shipped - Post tracking to eBay and mark as shipped (idempotent)
  app.post("/api/orders/:id/confirm-shipped", async (req: Request, res: Response) => {
    try {
      const orderId = req.params.id;

      // Fetch order
      const order = await db.query.orders.findFirst({
        where: eq(orders.orderId, orderId),
      });

      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      // Idempotency: Check if already shipped
      if (order.shippingStatus === "shipped" && order.ebayFulfillmentId) {
        console.log("[Confirm Shipped] Already shipped, returning success:", order.ebayFulfillmentId);
        return res.json({
          alreadyShipped: true,
          ebayFulfillmentId: order.ebayFulfillmentId,
          shippedAt: order.shippedAt,
        });
      }

      // Validate label was purchased and all required fields exist
      if (!order.trackingNumber || !order.trackingProvider || !order.shippoTransactionId) {
        return res.status(400).json({ 
          error: "Label must be purchased first with complete tracking data",
          details: "Call POST /api/orders/:id/buy to purchase shipping label before confirming shipment",
          missing: {
            trackingNumber: !order.trackingNumber,
            trackingProvider: !order.trackingProvider,
            shippoTransactionId: !order.shippoTransactionId,
          }
        });
      }

      // Validate eBay order ID exists
      if (!order.ebayOrderId) {
        return res.status(400).json({ error: "Order missing eBay order ID" });
      }

      // Get lineItems from cached eBay order or fetch fresh with Zod validation
      let lineItems: Array<{ lineItemId: string; quantity: number }> = [];
      let validatedOrder: z.infer<typeof ebayOrderSchema> | null = null;

      // Try cached order with Zod validation
      if (order.ebayOrderJson) {
        try {
          // Parse if stored as string, or use directly if object
          const cachedData = typeof order.ebayOrderJson === 'string' 
            ? JSON.parse(order.ebayOrderJson)
            : order.ebayOrderJson;
          
          const parseResult = ebayOrderSchema.safeParse(cachedData);
          if (parseResult.success) {
            validatedOrder = parseResult.data;
            // Filter and map with same logic as fresh fetch
            lineItems = validatedOrder.lineItems
              .filter(item => item.lineItemId || item.legacyItemId)
              .map(item => ({
                lineItemId: item.lineItemId || item.legacyItemId!,
                quantity: item.quantity,
              }));
            
            // Ensure cached data has valid identifiers
            if (lineItems.length === 0) {
              console.log("[Confirm Shipped] Cached order has no identifiable items, will fetch fresh");
              // Clear validatedOrder to force fresh fetch
              validatedOrder = null;
              lineItems = [];
            } else {
              console.log("[Confirm Shipped] Using cached lineItems:", lineItems.length);
            }
          } else {
            console.log("[Confirm Shipped] Cached order invalid, will fetch fresh:", parseResult.error.message);
          }
        } catch (parseError) {
          console.log("[Confirm Shipped] Cached JSON parse error, will fetch fresh");
        }
      }

      // Fetch fresh if cache missing or invalid
      let shouldCacheValidatedOrder = false;
      if (lineItems.length === 0) {
        console.log("[Confirm Shipped] Fetching from eBay");
        try {
          const fetchedEbayOrder = await ebayClient.getOrder(order.ebayOrderId);
          const parseResult = ebayOrderSchema.safeParse(fetchedEbayOrder);
          
          if (!parseResult.success) {
            console.error("[Confirm Shipped] eBay order validation failed:", parseResult.error);
            
            // Clear invalid cache to force fresh fetch on retry
            await db
              .update(orders)
              .set({ ebayOrderJson: null })
              .where(and(
                eq(orders.orderId, orderId),
                eq(orders.ebayOrderId, order.ebayOrderId)
              ));
            
            return res.status(502).json({ 
              error: "Invalid eBay order structure",
              details: "eBay order does not match expected schema",
              validationErrors: parseResult.error.issues,
            });
          }
          
          validatedOrder = parseResult.data;
          
          // Extract lineItems with identifier validation
          lineItems = validatedOrder.lineItems
            .filter(item => item.lineItemId || item.legacyItemId)
            .map(item => ({
              lineItemId: item.lineItemId || item.legacyItemId!,
              quantity: item.quantity,
            }));
          
          // Ensure we have identifiable lineItems
          if (lineItems.length === 0) {
            console.error("[Confirm Shipped] No identifiable line items in eBay order");
            
            // Clear invalid cache
            await db
              .update(orders)
              .set({ ebayOrderJson: null })
              .where(and(
                eq(orders.orderId, orderId),
                eq(orders.ebayOrderId, order.ebayOrderId)
              ));
            
            return res.status(502).json({ 
              error: "No identifiable line items in eBay order",
              details: "All line items missing both lineItemId and legacyItemId"
            });
          }
          
          // Mark for caching after successful transaction
          shouldCacheValidatedOrder = true;
          console.log("[Confirm Shipped] Validated eBay order, will cache after transaction");
        } catch (error: any) {
          console.error("[Confirm Shipped] eBay fetch failed:", error);
          return res.status(502).json({ 
            error: "Failed to fetch order from eBay",
            details: error.message 
          });
        }
      }

      // Final safety check
      if (lineItems.length === 0) {
        return res.status(502).json({ 
          error: "No line items available after validation",
          details: "eBay order has no valid line items"
        });
      }

      // Map carrier code to eBay format
      const carrierCodeMap: Record<string, string> = {
        "UPS": "UPS",
        "USPS": "USPS",
        "FedEx": "FEDEX",
        "DHL": "DHL",
      };
      
      const ebayCarrierCode = carrierCodeMap[order.trackingProvider || ""] 
        || order.trackingProvider?.toUpperCase() 
        || "UPS";

      console.log("[Confirm Shipped] Posting tracking to eBay:", {
        orderId: order.ebayOrderId,
        trackingNumber: order.trackingNumber,
        carrier: ebayCarrierCode,
        lineItems: lineItems.length,
      });

      // Post tracking to eBay FIRST (compensation pattern - outside transaction)
      const fulfillmentResult = await ebayClient.createShippingFulfillment({
        orderId: order.ebayOrderId,
        lineItems,
        trackingNumber: order.trackingNumber,
        shippingCarrierCode: ebayCarrierCode,
      });

      const shippedAtTime = new Date();

      // Atomic DB updates in transaction
      await db.transaction(async (tx) => {
        // Update order status
        await tx
          .update(orders)
          .set({
            shippingStatus: "shipped",
            shippedAt: shippedAtTime,
            ebayFulfillmentId: fulfillmentResult.fulfillmentId || order.trackingNumber,
          })
          .where(eq(orders.orderId, orderId));

        // Write timeline event: tracking_posted
        await tx.insert(orderTimelineEvents).values({
          orderId,
          eventType: "tracking_posted",
          note: `Tracking posted to eBay: ${order.trackingNumber}`,
          metadata: {
            trackingNumber: order.trackingNumber,
            carrier: ebayCarrierCode,
            fulfillmentId: fulfillmentResult.fulfillmentId,
            lineItems: lineItems.length,
          },
        });

        // Write timeline event: confirmed_shipped
        await tx.insert(orderTimelineEvents).values({
          orderId,
          eventType: "confirmed_shipped",
          note: `Order marked as shipped. Status: label_purchased → shipped`,
          metadata: {
            from: "label_purchased",
            to: "shipped",
            shippedAt: shippedAtTime.toISOString(),
          },
        });

        // Cache validated order if we fetched fresh (atomic with status change)
        if (shouldCacheValidatedOrder && validatedOrder) {
          await tx
            .update(orders)
            .set({ ebayOrderJson: validatedOrder })
            .where(and(
              eq(orders.orderId, orderId),
              eq(orders.ebayOrderId, order.ebayOrderId)
            ));
        }
      });

      console.log("[Confirm Shipped] Order marked as shipped atomically:", {
        fulfillmentId: fulfillmentResult.fulfillmentId,
        shippedAt: shippedAtTime,
        cached: shouldCacheValidatedOrder,
      });

      res.json({
        success: true,
        ebayFulfillmentId: fulfillmentResult.fulfillmentId,
        shippedAt: shippedAtTime,
        trackingNumber: order.trackingNumber,
        carrier: ebayCarrierCode,
      });

    } catch (error: any) {
      console.error("[Confirm Shipped] Error:", error);
      res.status(500).json({ 
        error: error.message,
        details: error.response?.data || error 
      });
    }
  });

  // POST /api/orders/:id/void-label - Void label and request refund (only within carrier window)
  app.post("/api/orders/:id/void-label", async (req, res) => {
    try {
      const { id: orderId } = req.params;

      // Get order
      const order = await db.query.orders.findFirst({
        where: eq(orders.orderId, orderId),
      });

      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      // Validate order has a label to void
      if (!order.labelId || !order.shippoTransactionId) {
        return res.status(400).json({ 
          error: "Order does not have a label to void",
          shippingStatus: order.shippingStatus 
        });
      }

      // Validate shipping status is label_purchased (not already shipped)
      if (order.shippingStatus !== "label_purchased") {
        return res.status(400).json({ 
          error: "Can only void labels that are purchased but not yet shipped",
          shippingStatus: order.shippingStatus 
        });
      }

      console.log("[Void Label] Requesting refund for label:", {
        orderId,
        transactionId: order.shippoTransactionId,
      });

      // Request refund from Shippo (OUTSIDE transaction - compensation pattern)
      const refundResult = await requestRefund(order.shippoTransactionId);

      if (!refundResult || refundResult.status === "ERROR" || refundResult.status === "INVALID") {
        console.error("[Void Label] Refund request failed:", refundResult);
        return res.status(424).json({ 
          error: "Shippo refund request failed",
          shippoStatus: refundResult?.status,
          shippoMessage: refundResult?.messages || refundResult?.message,
          details: refundResult 
        });
      }

      console.log("[Void Label] Refund requested successfully:", {
        refundId: refundResult.object_id,
        status: refundResult.status,
        amountCents: refundResult.amount ? Math.round(parseFloat(refundResult.amount) * 100) : null,
      });

      // Atomic transaction: clear label data, update status, write timeline events
      await db.transaction(async (tx) => {
        // Clear label data and set status back to unshipped
        await tx
          .update(orders)
          .set({
            shippingStatus: "unshipped",
            labelId: null,
            labelUrl: null,
            shippoTransactionId: null,
            shippoRateId: null,
            trackingNumber: null,
            carrier: null,
            serviceLevel: null,
            shippingCostCents: null,
            labelPurchasedAt: null,
            shippedAt: null,
          })
          .where(and(
            eq(orders.orderId, orderId),
            eq(orders.ebayOrderId, order.ebayOrderId)
          ));

        // Write timeline event: label_voided
        await tx.insert(orderTimelineEvents).values({
          orderId,
          eventType: "label_voided",
          note: `Shipping label voided. Status: label_purchased → unshipped`,
          metadata: {
            transactionId: order.shippoTransactionId,
            trackingNumber: order.trackingNumber,
            from: "label_purchased",
            to: "unshipped",
          },
        });

        // Write timeline event: refund_posted
        await tx.insert(orderTimelineEvents).values({
          orderId,
          eventType: "refund_posted",
          note: `Refund posted by carrier. Amount: $${refundResult.amount || 'N/A'}`,
          metadata: {
            refundId: refundResult.object_id,
            refundStatus: refundResult.status,
            amountCents: refundResult.amount ? Math.round(parseFloat(refundResult.amount) * 100) : null,
            currency: refundResult.currency || "USD",
          },
        });
      });

      console.log("[Void Label] Label voided and refund recorded atomically:", {
        refundId: refundResult.object_id,
        status: refundResult.status,
      });

      res.json({
        success: true,
        refundId: refundResult.object_id,
        refundStatus: refundResult.status,
        amountCents: refundResult.amount ? Math.round(parseFloat(refundResult.amount) * 100) : null,
      });

    } catch (error: any) {
      console.error("[Void Label] Error:", error);
      res.status(500).json({ 
        error: error.message,
        details: error.response?.data || error 
      });
    }
  });

  return httpServer;
}
