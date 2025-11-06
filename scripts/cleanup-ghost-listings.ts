#!/usr/bin/env tsx
/**
 * Cleanup Ghost Listings Script
 * 
 * This script removes all "ghost listings" that were created locally but never
 * successfully published to eBay (indicated by ebay_item_id = NULL).
 * 
 * Steps:
 * 1. Find all listings with NULL ebay_item_id
 * 2. Delete the ghost listings
 * 3. Delete orphaned inventory_items (no associated listings)
 * 4. Delete orphaned photo_sets (no associated inventory_items)
 * 5. Reset vine_items status back to "available"
 */

import { db } from "../server/db";
import { listings, inventoryItems, photoSets, vineItems } from "@shared/schema";
import { isNull, eq, notInArray, inArray } from "drizzle-orm";

async function cleanupGhostListings() {
  console.log("🧹 Starting ghost listing cleanup...\n");

  try {
    // Step 1: Find all ghost listings (NULL ebay_item_id)
    console.log("Step 1: Finding ghost listings...");
    const ghostListings = await db
      .select()
      .from(listings)
      .where(isNull(listings.ebayItemId));

    console.log(`Found ${ghostListings.length} ghost listings\n`);

    if (ghostListings.length === 0) {
      console.log("✅ No ghost listings found. Database is clean!");
      return;
    }

    // Extract inventory IDs and listing IDs
    const ghostInventoryIds = ghostListings.map(l => l.inventoryId);
    const ghostListingIds = ghostListings.map(l => l.listingId);

    // Step 2: Get the vine_item IDs before deletion
    console.log("Step 2: Finding associated vine items...");
    const ghostInventories = await db
      .select()
      .from(inventoryItems)
      .where(inArray(inventoryItems.inventoryId, ghostInventoryIds));

    const vineItemIds = ghostInventories.map(i => i.vineItemId);
    const photoSetIds = ghostInventories
      .map(i => i.photoSetId)
      .filter((id): id is string => id !== null);

    console.log(`Found ${vineItemIds.length} vine items to reset`);
    console.log(`Found ${photoSetIds.length} photo sets to delete\n`);

    // Step 3: Delete ghost listings
    console.log("Step 3: Deleting ghost listings...");
    const deletedListings = await db
      .delete(listings)
      .where(inArray(listings.listingId, ghostListingIds))
      .returning();

    console.log(`✅ Deleted ${deletedListings.length} ghost listings\n`);

    // Step 4: Delete orphaned inventory items
    console.log("Step 4: Deleting orphaned inventory items...");
    const deletedInventories = await db
      .delete(inventoryItems)
      .where(inArray(inventoryItems.inventoryId, ghostInventoryIds))
      .returning();

    console.log(`✅ Deleted ${deletedInventories.length} orphaned inventory items\n`);

    // Step 5: Delete orphaned photo sets
    if (photoSetIds.length > 0) {
      console.log("Step 5: Deleting orphaned photo sets...");
      const deletedPhotoSets = await db
        .delete(photoSets)
        .where(inArray(photoSets.photoSetId, photoSetIds))
        .returning();

      console.log(`✅ Deleted ${deletedPhotoSets.length} orphaned photo sets\n`);
    } else {
      console.log("Step 5: No photo sets to delete\n");
    }

    // Step 6: Reset vine_item statuses to "available"
    console.log("Step 6: Resetting vine_item statuses to 'available'...");
    const updatedVineItems = await db
      .update(vineItems)
      .set({ status: "available" })
      .where(inArray(vineItems.vineItemId, vineItemIds))
      .returning();

    console.log(`✅ Reset ${updatedVineItems.length} vine items to 'available' status\n`);

    // Summary
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("✨ Cleanup Complete!");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`Ghost listings deleted:      ${deletedListings.length}`);
    console.log(`Inventory items deleted:     ${deletedInventories.length}`);
    console.log(`Photo sets deleted:          ${photoSetIds.length}`);
    console.log(`Vine items reset:            ${updatedVineItems.length}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  } catch (error) {
    console.error("❌ Error during cleanup:", error);
    throw error;
  }
}

// Run the cleanup
cleanupGhostListings()
  .then(() => {
    console.log("🎉 Script completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Script failed:", error);
    process.exit(1);
  });
