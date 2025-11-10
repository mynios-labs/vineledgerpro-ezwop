import { db } from "../server/db";
import {
  orders,
  listings,
  inventoryItems,
  vineItems,
  buyers,
  photoSets,
  importConflicts,
  importRows,
  imports,
  amazon1099Data,
  ebay1099Data,
  accountingLedger,
} from "@shared/schema";
import { sql } from "drizzle-orm";

async function clearInventoryData() {
  const confirmClear = process.env.CONFIRM_CLEAR === "true";
  
  if (!confirmClear) {
    console.error("❌ SAFETY CHECK FAILED");
    console.error("This script will DELETE ALL inventory data permanently.");
    console.error("To proceed, run: CONFIRM_CLEAR=true tsx scripts/clear-inventory.ts");
    process.exit(1);
  }

  console.log("⚠️  WARNING: This will DELETE ALL inventory data!");
  console.log("This includes:");
  console.log("  - All vine items and inventory records");
  console.log("  - All eBay listings and orders");
  console.log("  - All financial ledger entries");
  console.log("  - All import history");
  console.log("  - All 1099 tax data");
  console.log("");
  console.log("Configuration will be preserved:");
  console.log("  ✓ Address profiles");
  console.log("  ✓ Business policies");
  console.log("  ✓ Health events");
  console.log("");

  // Get row counts before deletion
  console.log("📊 Current row counts:");
  const beforeCounts = {
    orders: (await db.select({ count: sql<number>`count(*)::int` }).from(orders))[0]?.count || 0,
    listings: (await db.select({ count: sql<number>`count(*)::int` }).from(listings))[0]?.count || 0,
    inventoryItems: (await db.select({ count: sql<number>`count(*)::int` }).from(inventoryItems))[0]?.count || 0,
    vineItems: (await db.select({ count: sql<number>`count(*)::int` }).from(vineItems))[0]?.count || 0,
    buyers: (await db.select({ count: sql<number>`count(*)::int` }).from(buyers))[0]?.count || 0,
    photoSets: (await db.select({ count: sql<number>`count(*)::int` }).from(photoSets))[0]?.count || 0,
    imports: (await db.select({ count: sql<number>`count(*)::int` }).from(imports))[0]?.count || 0,
    amazon1099: (await db.select({ count: sql<number>`count(*)::int` }).from(amazon1099Data))[0]?.count || 0,
    ebay1099: (await db.select({ count: sql<number>`count(*)::int` }).from(ebay1099Data))[0]?.count || 0,
    ledger: (await db.select({ count: sql<number>`count(*)::int` }).from(accountingLedger))[0]?.count || 0,
  };
  
  console.table(beforeCounts);
  
  // Wait 3 seconds before proceeding
  console.log("");
  console.log("⏳ Starting deletion in 3 seconds...");
  await new Promise(resolve => setTimeout(resolve, 3000));

  try {
    // Perform deletion in a transaction
    await db.transaction(async (tx) => {
      console.log("🗑️  Deleting in order...");
      
      // 1. Delete orders first (due to ON DELETE RESTRICT on listings)
      console.log("  → Deleting orders (will cascade to accounting_ledger)...");
      await tx.delete(orders);
      
      // 2. Delete listings (will cascade to inventory_items via FK)
      console.log("  → Deleting listings...");
      await tx.delete(listings);
      
      // 3. Delete inventory_items (will cascade from vine_items if vine items deleted first)
      console.log("  → Deleting inventory items...");
      await tx.delete(inventoryItems);
      
      // 4. Delete vine_items (cascades to inventory_items)
      console.log("  → Deleting vine items...");
      await tx.delete(vineItems);
      
      // 5. Delete buyers
      console.log("  → Deleting buyers...");
      await tx.delete(buyers);
      
      // 6. Delete photo sets
      console.log("  → Deleting photo sets...");
      await tx.delete(photoSets);
      
      // 7. Delete import data (conflicts → rows → imports, respecting FK cascade)
      console.log("  → Deleting import conflicts...");
      await tx.delete(importConflicts);
      
      console.log("  → Deleting import rows...");
      await tx.delete(importRows);
      
      console.log("  → Deleting imports...");
      await tx.delete(imports);
      
      // 8. Delete 1099 tax data
      console.log("  → Deleting Amazon 1099 data...");
      await tx.delete(amazon1099Data);
      
      console.log("  → Deleting eBay 1099-K data...");
      await tx.delete(ebay1099Data);
      
      console.log("✅ All deletions committed successfully");
    });

    // Verify deletion
    console.log("");
    console.log("📊 Row counts after deletion:");
    const afterCounts = {
      orders: (await db.select({ count: sql<number>`count(*)::int` }).from(orders))[0]?.count || 0,
      listings: (await db.select({ count: sql<number>`count(*)::int` }).from(listings))[0]?.count || 0,
      inventoryItems: (await db.select({ count: sql<number>`count(*)::int` }).from(inventoryItems))[0]?.count || 0,
      vineItems: (await db.select({ count: sql<number>`count(*)::int` }).from(vineItems))[0]?.count || 0,
      buyers: (await db.select({ count: sql<number>`count(*)::int` }).from(buyers))[0]?.count || 0,
      photoSets: (await db.select({ count: sql<number>`count(*)::int` }).from(photoSets))[0]?.count || 0,
      imports: (await db.select({ count: sql<number>`count(*)::int` }).from(imports))[0]?.count || 0,
      amazon1099: (await db.select({ count: sql<number>`count(*)::int` }).from(amazon1099Data))[0]?.count || 0,
      ebay1099: (await db.select({ count: sql<number>`count(*)::int` }).from(ebay1099Data))[0]?.count || 0,
      ledger: (await db.select({ count: sql<number>`count(*)::int` }).from(accountingLedger))[0]?.count || 0,
    };
    
    console.table(afterCounts);
    
    console.log("");
    console.log("✅ SUCCESS: All inventory data cleared!");
    console.log("You can now upload fresh XLSX files for 2024 and 2025.");
    
  } catch (error: any) {
    console.error("❌ ERROR during deletion:", error.message);
    console.error("Transaction rolled back. No data was deleted.");
    process.exit(1);
  }
}

clearInventoryData();
