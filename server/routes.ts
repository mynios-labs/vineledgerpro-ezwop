import type { Express } from "express";
import { createServer, type Server } from "http";
import { db } from "./db";
import { eq, desc, and, or, like, sql } from "drizzle-orm";
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
  buyers,
  accountingLedger,
  addressProfiles,
  businessPolicies,
  photoSets,
  healthEvents,
  type InsertImport,
  type InsertImportRow,
  type InsertVineItem,
  type InsertInventoryItem,
  type InsertListing,
  type InsertAccountingLedger,
} from "@shared/schema";
import { openai } from "./lib/openai";
import { getSuggestedCategories, createOrUpdateInventoryItem, createOffer, publishOffer } from "./lib/ebay";
import { estimateShipping, createShipment, purchaseLabel } from "./lib/shippo";
import { checkForbiddenWords, checkAsinInText, calculateSimilarity } from "./lib/privacy";

const upload = multer({ storage: multer.memoryStorage() });

export async function registerRoutes(app: Express): Promise<Server> {
  // Get vine items stats
  app.get("/api/vine-items/stats", async (_req, res) => {
    try {
      const result = await db
        .select({
          status: vineItems.status,
          count: sql<number>`count(*)::int`,
        })
        .from(vineItems)
        .groupBy(vineItems.status);

      const stats = {
        total: result.reduce((sum, row) => sum + row.count, 0),
        available: result.find((r) => r.status === "available")?.count || 0,
        reserved: result.find((r) => r.status === "reserved")?.count || 0,
        sold: result.find((r) => r.status === "sold")?.count || 0,
      };

      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get vine items (with search)
  app.get("/api/vine-items", async (req, res) => {
    try {
      const { search } = req.query;
      
      let query = db.select().from(vineItems);
      
      if (search && typeof search === "string") {
        query = query.where(
          or(
            like(vineItems.titleNorm, `%${search}%`),
            like(vineItems.asin, `%${search}%`),
            like(vineItems.upc, `%${search}%`)
          )
        ) as any;
      }

      const items = await query.orderBy(desc(vineItems.receivedDate)).limit(100);
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

  // Upload and process XLSX file
  app.post("/api/imports/upload", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const fileBuffer = req.file.buffer;
      const fileSha256 = crypto.createHash("sha256").update(fileBuffer).digest("hex");

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

      // Create import record
      const [importRecord] = await db
        .insert(imports)
        .values({
          filename: req.file.originalname,
          fileSha256,
          rowCount: data.length,
          status: "processing",
        })
        .returning();

      let added = 0;
      let unchanged = 0;
      let conflicts = 0;

      // Process each row
      for (const row of data as any[]) {
        const asin = row.ASIN || row.asin || "";
        const titleRaw = row.Title || row.title || "";
        const etvCents = Math.round((parseFloat(row.ETV || row.etv || "0") || 0) * 100);
        const receivedDate = row["Received Date"] || row.receivedDate || new Date().toISOString();
        const categoryRaw = row.Category || row.category || "";
        const upc = row.UPC || row.upc || null;
        const serial = row.Serial || row.serial || null;

        const rowSha256 = crypto
          .createHash("sha256")
          .update(`${asin}${titleRaw}${etvCents}${receivedDate}`)
          .digest("hex");

        // Insert import row
        await db.insert(importRows).values({
          importId: importRecord.id,
          rowSha256,
          asin,
          titleRaw,
          etvCents,
          receivedDate: new Date(receivedDate),
          categoryRaw,
          upc,
          serial,
        });

        // Check for existing vine item
        const [existingItem] = await db
          .select()
          .from(vineItems)
          .where(
            and(
              eq(vineItems.asin, asin),
              eq(vineItems.receivedDate, new Date(receivedDate))
            )
          );

        if (!existingItem) {
          // New item
          await db.insert(vineItems).values({
            asin,
            titleNorm: titleRaw,
            etvCents,
            receivedDate: new Date(receivedDate),
            upc,
            serial,
            status: "available",
          });
          added++;
        } else if (existingItem.etvCents !== etvCents) {
          // Conflict - ETV changed
          conflicts++;
        } else {
          // Unchanged
          unchanged++;
        }
      }

      // Update import status
      await db
        .update(imports)
        .set({ status: "completed" })
        .where(eq(imports.id, importRecord.id));

      res.json({
        importId: importRecord.id,
        reconciliation: { added, unchanged, conflicts },
      });
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

      // Get eBay category suggestions
      const categories = await getSuggestedCategories(item.titleNorm);
      const suggestedCategory = categories.categorySuggestions?.[0] || {
        category: { categoryId: "0", categoryName: "Other" },
      };

      // Generate unique titles and description using AI
      // the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
      const completion = await openai.chat.completions.create({
        model: "gpt-5",
        messages: [
          {
            role: "system",
            content: "You are an expert eBay copywriter. Create 3 DIFFERENT listing titles - each must be completely unique from the others. NEVER repeat the same words or phrasing. NEVER mention Amazon, Vine, or reviews.",
          },
          {
            role: "user",
            content: `Product: "${item.titleNorm}"

Create 3 COMPLETELY DIFFERENT title variations (each under 80 chars):
1. First title: Focus on QUALITY and PREMIUM aspects (use words like: Premium, Professional, High-Quality, Luxury)
2. Second title: Focus on FEATURES and SPECIFICATIONS (use words like: Advanced, Feature-Rich, Latest Technology)
3. Third title: Focus on VALUE and USE CASES (use words like: Best Deal, Perfect For, Essential, Must-Have)

IMPORTANT: Each title MUST use different words and different structure. DO NOT repeat phrases.

Also create 1 compelling description (3-5 sentences) highlighting benefits and features.

NEVER use: vine, amazon, review, promo, free, sample, received

Return ONLY valid JSON (no markdown, no extra text):
{"titles": ["unique title 1 about quality", "unique title 2 about features", "unique title 3 about value"], "description": "detailed product description"}`,
          },
        ],
        max_completion_tokens: 1000,
      });

      console.log("Completion object:", JSON.stringify(completion, null, 2));
      
      const rawContent = completion.choices[0].message.content || "";
      console.log("Raw AI content length:", rawContent.length);
      console.log("Raw AI content:", rawContent);
      console.log("Finish reason:", completion.choices[0].finish_reason);
      
      let generated;
      try {
        generated = JSON.parse(rawContent);
        console.log("Parsed AI Response:", JSON.stringify(generated, null, 2));
      } catch (e) {
        console.error("JSON parse error:", e);
        // Try using gpt-5-mini as fallback
        console.log("Falling back to simple titles...");
        generated = {
          titles: [
            `Premium ${item.titleNorm}`,
            `${item.titleNorm} - Professional Grade`,
            `${item.titleNorm} - Best Value`
          ],
          description: `High-quality ${item.titleNorm}. Perfect for your needs. Ships fast!`
        };
      }

      // Privacy checks
      const privacyWarnings: string[] = [];
      for (const title of generated.titles || []) {
        const violations = checkForbiddenWords(title);
        if (violations.length > 0) {
          privacyWarnings.push(`Title contains forbidden words: ${violations.join(", ")}`);
        }
        if (checkAsinInText(title, item.asin)) {
          privacyWarnings.push("Title contains ASIN");
        }
      }

      const descViolations = checkForbiddenWords(generated.description || "");
      if (descViolations.length > 0) {
        privacyWarnings.push(`Description contains forbidden words: ${descViolations.join(", ")}`);
      }

      // Similarity check
      const similarityScore = calculateSimilarity(item.titleNorm, generated.titles?.[0] || "");

      res.json({
        titles: generated.titles || [item.titleNorm, item.titleNorm, item.titleNorm],
        description: generated.description || item.titleNorm,
        categoryId: suggestedCategory.category.categoryId,
        categoryName: suggestedCategory.category.categoryName,
        privacyWarnings,
        similarityScore,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Publish listing
  app.post("/api/listings/publish", upload.array("photos", 12), async (req, res) => {
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
      } = req.body;

      if (!req.files || (req.files as Express.Multer.File[]).length < 2) {
        return res.status(400).json({ error: "At least 2 photos required" });
      }

      // Process photos - strip EXIF
      const photoUrls: string[] = [];
      for (const file of req.files as Express.Multer.File[]) {
        const processed = await sharp(file.buffer)
          .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 90 })
          .toBuffer();

        // In production, upload to a CDN or eBay Picture Services
        // For now, create a data URL
        const dataUrl = `data:image/jpeg;base64,${processed.toString("base64")}`;
        photoUrls.push(dataUrl);
      }

      // Create photo set
      const [photoSet] = await db
        .insert(photoSets)
        .values({
          coverUrl: photoUrls[0],
          urls: photoUrls,
        })
        .returning();

      // Create inventory item
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
        .returning();

      // Create eBay listing
      const sku = `VINE-${inventoryItem.inventoryId}`;
      await createOrUpdateInventoryItem(sku, {
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
      });

      const offer = await createOffer({
        sku,
        marketplaceId: "EBAY_US",
        format: "FIXED_PRICE",
        listingPolicies: {
          fulfillmentPolicyId: "default",
          paymentPolicyId: "default",
          returnPolicyId: "default",
        },
        pricingSummary: {
          price: {
            value: (parseInt(priceCents) / 100).toFixed(2),
            currency: "USD",
          },
        },
        categoryId,
      });

      const published = await publishOffer(offer.offerId);

      // Create listing record
      const [listing] = await db
        .insert(listings)
        .values({
          inventoryId: inventoryItem.inventoryId,
          ebayItemId: published.listingId,
          categoryId,
          title,
          description,
          priceCents: parseInt(priceCents),
          publishedAt: new Date(),
          state: "live",
        })
        .returning();

      // Update vine item status
      await db
        .update(vineItems)
        .set({ status: "reserved" })
        .where(eq(vineItems.vineItemId, vineItemId));

      // Create accounting entry for basis
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

      res.json({ listing, ebayListingId: published.listingId });
    } catch (error: any) {
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

        // Mark the vine item as defective and returned
        await db.update(vineItems)
          .set({ 
            defective: true,
            defectiveNotes: "Returned by buyer",
            status: "returned"
          })
          .where(eq(vineItems.vineItemId, order.vineItemId));

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

      res.json({
        totalSales,
        totalFees,
        totalShipping,
        totalPayout,
        realizedGain,
        realizedLoss,
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

  const httpServer = createServer(app);
  return httpServer;
}
