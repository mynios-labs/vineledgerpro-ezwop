import type { Express } from "express";
import { createServer, type Server } from "http";
import { db } from "./db";
import { eq, desc, asc, and, or, like, ilike, inArray, sql } from "drizzle-orm";
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
  importConflicts,
  type InsertImport,
  type InsertImportRow,
  type InsertVineItem,
  type InsertInventoryItem,
  type InsertListing,
  type InsertAccountingLedger,
} from "@shared/schema";
import { openai } from "./lib/openai";
import { getSuggestedCategories, createOrUpdateInventoryItem, createOffer, publishOffer, getOrders, getOrder } from "./lib/ebay";
import { estimateShipping, createShipment, purchaseLabel, getTracking, getTransaction, listAllTransactions, requestRefund } from "./lib/shippo";
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

      const reservedCount = result.find((r) => r.status === "reserved")?.count || 0;
      const soldCount = result.find((r) => r.status === "sold")?.count || 0;
      const returnedCount = result.find((r) => r.status === "returned")?.count || 0;
      const goneCount = result.find((r) => r.status === "gone")?.count || 0;

      const stats = {
        total: result.reduce((sum, row) => sum + row.count, 0),
        available: result.find((r) => r.status === "available")?.count || 0,
        reserved: reservedCount,
        sold: soldCount,
        do_not_sell: result.find((r) => r.status === "do_not_sell")?.count || 0,
        gone: goneCount,
        returned: returnedCount,
        discarded: result.find((r) => r.status === "discarded")?.count || 0,
        personal_use: result.find((r) => r.status === "personal_use")?.count || 0,
        sold_or_live: reservedCount + soldCount + returnedCount + goneCount,
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
      
      let query = db.select().from(vineItems);
      
      // Apply status filter
      // "sold_or_live" is a special filter that shows both "reserved" and "sold" items
      if (status && typeof status === "string") {
        if (status === "sold_or_live") {
          query = query.where(inArray(vineItems.status, ["reserved", "sold", "returned", "gone"])) as any;
        } else {
          query = query.where(eq(vineItems.status, status)) as any;
        }
      }
      
      // Apply search filter (combine with status if both present)
      if (search && typeof search === "string") {
        const searchCondition = or(
          ilike(vineItems.titleNorm, `%${search}%`),
          ilike(vineItems.asin, `%${search}%`),
          ilike(vineItems.upc, `%${search}%`)
        );
        
        if (status && typeof status === "string") {
          // Both status and search filters
          if (status === "sold_or_live") {
            query = db.select().from(vineItems).where(
              and(
                inArray(vineItems.status, ["reserved", "sold", "returned", "gone"]),
                searchCondition
              )
            ) as any;
          } else {
            query = db.select().from(vineItems).where(
              and(
                eq(vineItems.status, status),
                searchCondition
              )
            ) as any;
          }
        } else {
          // Only search filter
          query = query.where(searchCondition) as any;
        }
      }

      // Apply sorting
      let orderedQuery;
      if (sort === "oldest") {
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

      // Process each row
      for (const row of actualData as any[]) {
        // Map Amazon Vine report columns
        const asin = row.__EMPTY || row.ASIN || row.asin || "";
        const titleRaw = row.__EMPTY_1 || row["Product Name"] || row.Title || row.title || "";
        const etvValue = row.__EMPTY_6 || row["Estimated Tax Value"] || row.ETV || row.etv || "0";
        const etvCents = Math.round((parseFloat(etvValue) || 0) * 100);
        const orderDate = row.__EMPTY_3 || row["Order Date"] || row.receivedDate || "";
        const shippedDate = row.__EMPTY_4 || row["Shipped Date"] || "";
        const receivedDate = shippedDate || orderDate || new Date().toISOString();
        const categoryRaw = row.Category || row.category || "";
        const upc = row.UPC || row.upc || null;
        const serial = row.Serial || row.serial || null;

        // Skip empty rows (no ASIN and no title)
        if (!asin && !titleRaw) {
          continue;
        }

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
          // Conflict - ETV changed - store in conflicts table
          await db.insert(importConflicts).values({
            importId: importRecord.id,
            vineItemId: existingItem.vineItemId,
            asin,
            titleNorm: titleRaw,
            receivedDate: new Date(receivedDate),
            existingEtvCents: existingItem.etvCents,
            newEtvCents: etvCents,
            resolved: false,
          });
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

      // Get eBay category suggestions
      const categories = await getSuggestedCategories(item.titleNorm);
      const suggestedCategory = categories.categorySuggestions?.[0] || {
        category: { categoryId: "0", categoryName: "Other" },
      };

      // Generate unique titles and description using AI
      // Using gpt-4.1-mini for cost efficiency - produces excellent eBay-friendly copy
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

Original product: "${item.titleNorm}"

Create 3 DISTINCT titles (max 80 chars each):
1. Title emphasizing QUALITY/PREMIUM (use synonyms: superior, elite, top-tier, exceptional, finest)
2. Title emphasizing FEATURES/TECH (use synonyms: innovative, cutting-edge, versatile, multi-function)
3. Title emphasizing BENEFITS/VALUE (use synonyms: reliable, essential, practical, affordable, trusted)

Each title MUST:
- Use COMPLETELY DIFFERENT wording and structure
- Rephrase the product type (e.g., "Floor Fan" → "Air Circulator", "Cooling Unit", "Ventilation System")
- Include key specs in natural language (e.g., "18-inch" → "Large", "4-speed" → "Variable Speed")
- Sound natural and buyer-focused

Create 1 description (4-6 sentences):
- Open with a benefit statement that solves a buyer problem
- List 3-4 key features with emotional appeal
- Include use cases and scenarios
- End with a call-to-action or confidence statement
- Make it exciting and persuasive, not just factual

STRICT RULES:
- NEVER mention: Amazon, Vine, review, promo, free sample, received, promotional, ASIN
- Reword everything - don't copy phrases from original
- Sound like a professional seller, not a reviewer

Output ONLY this JSON structure (no markdown, no backticks):
{"titles": ["title 1", "title 2", "title 3"], "description": "compelling description"}`,
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

      // Note: listingPolicies are omitted - eBay will use the account's default business policies
      // To use specific policies, they must first be created in your eBay account and stored in business_policies table
      const offer = await createOffer({
        sku,
        marketplaceId: "EBAY_US",
        format: "FIXED_PRICE",
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

      // Update vine item status back to available
      await db
        .update(vineItems)
        .set({ status: "available" })
        .where(eq(vineItems.vineItemId, inventoryItem.vineItemId));

      // If there was a listing, mark it as cancelled
      if (listing) {
        await db
          .update(listings)
          .set({ state: "cancelled" })
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
      const creationDateFrom = new Date();
      creationDateFrom.setDate(creationDateFrom.getDate() - daysBack);
      const fromDate = creationDateFrom.toISOString();

      // Fetch orders from eBay
      const ebayResponse = await getOrders({
        creationDateFrom: fromDate,
        limit: 200,
      });

      if (!ebayResponse.orders || ebayResponse.orders.length === 0) {
        return res.json({ 
          synced: 0, 
          message: "No new orders found" 
        });
      }

      let syncedCount = 0;
      let updatedCount = 0;

      for (const ebayOrder of ebayResponse.orders) {
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

            // Create order
            const [newOrder] = await tx
              .insert(orders)
              .values({
                ebayOrderId: ebayOrder.orderId,
                listingId: listing.listingId,
                buyerId: buyer.buyerId,
                saleGrossCents,
                shippingCollectedCents,
                ebayFeesCents: ebayFinalValueFee + promotionFee,
                payoutCents: 0, // Updated when payout occurs
                orderDate: new Date(ebayOrder.creationDate),
                shipBy: ebayOrder.fulfillmentStartInstructions?.[0]?.shipByDate 
                  ? new Date(ebayOrder.fulfillmentStartInstructions[0].shipByDate)
                  : null,
                status: "paid",
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

            // Update vine item status to sold
            if (inventoryItem) {
              await tx
                .update(vineItems)
                .set({ status: "sold" })
                .where(eq(vineItems.vineItemId, inventoryItem.vineItemId));
            }

            syncedCount++;
          });
        } catch (error: any) {
          console.error(`Failed to sync order ${ebayOrder.orderId}:`, error);
          // Continue with next order instead of failing the entire sync
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
          shippedAt: row.orders?.shippedAt || null,
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

  const httpServer = createServer(app);

  // Background job: Periodically sync eBay orders
  // Runs every hour to fetch new orders and create ledger entries
  const SYNC_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
  const AUTO_SYNC_DAYS_BACK = 7; // Sync orders from last 7 days

  async function autoSyncOrders() {
    try {
      console.log("Auto-syncing eBay orders...");
      
      const creationDateFrom = new Date();
      creationDateFrom.setDate(creationDateFrom.getDate() - AUTO_SYNC_DAYS_BACK);
      const fromDate = creationDateFrom.toISOString();

      const ebayResponse = await getOrders({
        creationDateFrom: fromDate,
        limit: 200,
      });

      if (!ebayResponse.orders || ebayResponse.orders.length === 0) {
        console.log("No new orders to sync");
        return;
      }

      let syncedCount = 0;
      let updatedCount = 0;

      for (const ebayOrder of ebayResponse.orders) {
        try {
          // Wrap each order sync in a transaction for atomicity
          await db.transaction(async (tx) => {
            const [existingOrder] = await tx
              .select()
              .from(orders)
              .where(eq(orders.ebayOrderId, ebayOrder.orderId));

            if (existingOrder) {
              updatedCount++;
              return;
            }

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

            const salesTaxCents = Math.round(
              parseFloat(ebayOrder.pricingSummary?.totalTax?.value || "0") * 100
            );

            const [newOrder] = await tx
              .insert(orders)
              .values({
                ebayOrderId: ebayOrder.orderId,
                listingId: listing.listingId,
                buyerId: buyer.buyerId,
                saleGrossCents,
                shippingCollectedCents,
                ebayFeesCents: ebayFinalValueFee + promotionFee,
                payoutCents: 0, // Updated when payout occurs
                orderDate: new Date(ebayOrder.creationDate),
                shipBy: ebayOrder.fulfillmentStartInstructions?.[0]?.shipByDate 
                  ? new Date(ebayOrder.fulfillmentStartInstructions[0].shipByDate)
                  : null,
                status: "paid",
              })
              .returning();

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

            // Update vine item status to sold
            if (inventoryItem) {
              await tx
                .update(vineItems)
                .set({ status: "sold" })
                .where(eq(vineItems.vineItemId, inventoryItem.vineItemId));
            }

            syncedCount++;
          });
        } catch (error: any) {
          console.error(`Failed to sync order ${ebayOrder.orderId}:`, error);
          // Continue with next order instead of failing the entire sync
        }
      }

      console.log(`Auto-sync complete: ${syncedCount} new orders, ${updatedCount} already existed`);
    } catch (error: any) {
      console.error("Error in auto-sync:", error);
    }
  }

  // Start the background sync job
  setInterval(autoSyncOrders, SYNC_INTERVAL_MS);
  
  // Run once on startup (after a short delay to allow server to fully start)
  setTimeout(autoSyncOrders, 30000); // 30 seconds after startup

  return httpServer;
}
