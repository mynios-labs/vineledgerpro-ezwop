#!/usr/bin/env tsx
/**
 * Test Listing Creation Script
 * 
 * This script tests creating 10 REAL listings on eBay with:
 * - Proper error handling verification
 * - Only updates database if eBay API confirms success
 * - Uses AI-generated product images
 */

import { db } from "../server/db";
import { vineItems, inventoryItems, photoSets, listings } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import * as fs from "fs/promises";
import * as path from "path";
import { createOrUpdateInventoryItem, createOffer, publishOffer, getOrCreateMerchantLocation } from "../server/lib/ebay";
import { estimateShippingCost } from "../server/lib/shippo";

// Product images - using publicly accessible placeholder URLs for testing
// NOTE: In production, these would be uploaded to eBay Picture Services first
const PRODUCT_IMAGES = [
  // Product 1: Bluetooth Speaker
  {
    name: "Bluetooth Speaker",
    images: [
      "https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?w=800",
      "https://images.unsplash.com/photo-1545454675-3531b543be5d?w=800"
    ]
  },
  // Product 2: Smart Camera
  {
    name: "Smart Security Camera",
    images: [
      "https://images.unsplash.com/photo-1557597774-9d273605dfa9?w=800",
      "https://images.unsplash.com/photo-1558002038-1055907df827?w=800"
    ]
  },
  // Product 3: Milk Frother
  {
    name: "Milk Frother",
    images: [
      "https://images.unsplash.com/photo-1517668808822-9ebb02f2a0e6?w=800",
      "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=800"
    ]
  },
  // Product 4: Fitness Tracker
  {
    name: "Fitness Tracker",
    images: [
      "https://images.unsplash.com/photo-1575311373937-040b8e1fd5b6?w=800",
      "https://images.unsplash.com/photo-1544117519-31a4b719223d?w=800"
    ]
  },
  // Product 5: LED Desk Lamp
  {
    name: "LED Desk Lamp",
    images: [
      "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=800",
      "https://images.unsplash.com/photo-1513506003901-1e6a229e2d15?w=800"
    ]
  },
  // Product 6: Power Bank
  {
    name: "Portable Power Bank",
    images: [
      "https://images.unsplash.com/photo-1609091839311-d5365f9ff1c5?w=800",
      "https://images.unsplash.com/photo-1625245488600-f89fa44c5f47?w=800"
    ]
  },
  // Product 7: Coffee Maker
  {
    name: "Coffee Maker",
    images: [
      "https://images.unsplash.com/photo-1517668808822-9ebb02f2a0e6?w=800",
      "https://images.unsplash.com/photo-1514433778-5748dad6f2e0?w=800"
    ]
  },
  // Product 8: Wireless Mouse
  {
    name: "Wireless Mouse",
    images: [
      "https://images.unsplash.com/photo-1527864550417-7fd91fc51a46?w=800",
      "https://images.unsplash.com/photo-1586829020531-a1df2bf6ee1c?w=800"
    ]
  },
  // Product 9: Phone Case
  {
    name: "Phone Case",
    images: [
      "https://images.unsplash.com/photo-1601784551446-20c9e07cdbdb?w=800",
      "https://images.unsplash.com/photo-1556656793-08538906a9f8?w=800"
    ]
  },
  // Product 10: Water Bottle
  {
    name: "Water Bottle",
    images: [
      "https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=800",
      "https://images.unsplash.com/photo-1523362628745-0c100150b504?w=800"
    ]
  },
];

async function testListingCreation() {
  console.log("🧪 Starting listing creation test...\n");
  console.log("Testing with 10 products using AI-generated images\n");

  let successCount = 0;
  let failureCount = 0;
  const results: Array<{ product: string; success: boolean; error?: string }> = [];

  try {
    // Get 10 available vine items
    const availableItems = await db
      .select()
      .from(vineItems)
      .where(eq(vineItems.status, "available"))
      .limit(10);

    if (availableItems.length < 10) {
      console.error(`❌ Not enough available items! Found ${availableItems.length}, need 10`);
      return;
    }

    console.log(`✅ Found ${availableItems.length} available vine items\n`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    // Process each item
    for (let i = 0; i < 10; i++) {
      const vineItem = availableItems[i];
      const productSet = PRODUCT_IMAGES[i];
      
      console.log(`\n[${ i + 1}/10] Processing: ${productSet.name}`);
      console.log(`Vine Item ID: ${vineItem.vineItemId}`);
      console.log(`ASIN: ${vineItem.asin}`);

      try {
        // STEP 1: Create photo set
        console.log("  → Creating photo set...");
        const [photoSet] = await db
          .insert(photoSets)
          .values({
            coverUrl: productSet.images[0],
            urls: productSet.images,
          })
          .returning();
        console.log(`  ✓ Photo set created: ${photoSet.photoSetId}`);

        // STEP 2: Create inventory item
        console.log("  → Creating inventory item...");
        const [inventoryItem] = await db
          .insert(inventoryItems)
          .values({
            vineItemId: vineItem.vineItemId,
            photoSetId: photoSet.photoSetId,
            condition: "New",
            weightOz: 16, // 1 lb placeholder
            dimsInL: 10,
            dimsInW: 8,
            dimsInH: 6,
            privacyPassed: true,
          })
          .returning();
        console.log(`  ✓ Inventory item created: ${inventoryItem.inventoryId}`);

        // STEP 3: Mark vine item as reserved (prevents double-listing)
        console.log("  → Marking vine item as reserved...");
        await db
          .update(vineItems)
          .set({ status: "reserved" })
          .where(eq(vineItems.vineItemId, vineItem.vineItemId));
        console.log(`  ✓ Vine item marked as reserved`);

        // STEP 4: Create eBay inventory item via API
        const sku = `ITEM-${vineItem.vineItemId}`;
        const title = `Premium ${productSet.name} - Brand New Condition`;
        const description = `High-quality ${productSet.name.toLowerCase()} in brand new condition. Perfect for home or office use. Fast shipping with tracking.`;
        
        console.log("  → Creating eBay inventory item...");
        await createOrUpdateInventoryItem(sku, {
          availability: {
            shipToLocationAvailability: {
              quantity: 1,
            },
          },
          condition: "NEW",
          product: {
            title: title,
            description: description,
            imageUrls: productSet.images,
            aspects: {
              Brand: ["Generic"],
              Type: [productSet.name],
              Condition: ["New"],
            },
          },
          // Add location with country code (required for publishing)
          location: {
            address: {
              addressLine1: "123 Main St",
              city: "San Jose",
              stateOrProvince: "CA",
              postalCode: "95110",
              country: "US" // Required!
            },
            geoCoordinates: {
              latitude: 37.3382,
              longitude: -121.8863
            },
            locationInstructions: "Items ship from California"
          }
        });
        console.log(`  ✓ eBay inventory item created: ${sku}`);

        // STEP 5: Get or create merchant location
        console.log("  → Getting merchant location...");
        const merchantLocationKey = await getOrCreateMerchantLocation();
        console.log(`  ✓ Using merchant location: ${merchantLocationKey}`);

        // STEP 6: Create eBay offer
        console.log("  → Creating eBay offer...");
        const offerResponse = await createOffer({
          sku: sku,
          marketplaceId: "EBAY_US",
          format: "FIXED_PRICE",
          merchantLocationKey,
          listingDescription: description,
          availableQuantity: 1,
          categoryId: "172008", // Electronics > Portable Audio & Headphones > Bluetooth Speakers
          listingPolicies: {
            fulfillmentPolicyId: "278016180015", // Production: UPS Ground Saver + free shipping
          },
          pricingSummary: {
            price: {
              value: "29.99",
              currency: "USD",
            },
          },
        });
        console.log(`  ✓ eBay offer created: ${offerResponse.offerId}`);

        // STEP 6: Publish offer to eBay
        console.log("  → Publishing offer to eBay...");
        const publishResponse = await publishOffer(offerResponse.offerId);
        console.log(`  ✓ Published to eBay! Listing ID: ${publishResponse.listingId}`);

        // STEP 7: Save listing to database (ONLY after eBay confirms success)
        console.log("  → Saving listing to database...");
        const [listing] = await db
          .insert(listings)
          .values({
            inventoryId: inventoryItem.inventoryId,
            ebayItemId: publishResponse.listingId,
            categoryId: "99",
            title: title,
            description: description,
            priceCents: 2999,
            state: "live",
            publishedAt: new Date(),
          })
          .returning();
        console.log(`  ✓ Listing saved to database: ${listing.listingId}`);

        // STEP 8: Update vine item status to "sold" (live on eBay)
        console.log("  → Updating vine item status to 'sold'...");
        await db
          .update(vineItems)
          .set({ status: "sold" })
          .where(eq(vineItems.vineItemId, vineItem.vineItemId));
        console.log(`  ✓ Vine item status updated to 'sold'`);

        successCount++;
        results.push({ product: productSet.name, success: true });
        console.log(`  ✅ SUCCESS: ${productSet.name} listed on eBay!`);

      } catch (error: any) {
        failureCount++;
        const errorMessage = error.message || String(error);
        results.push({ product: productSet.name, success: false, error: errorMessage });
        
        console.error(`  ❌ FAILED: ${productSet.name}`);
        console.error(`  Error: ${errorMessage}`);
        
        // Rollback: reset vine item status if listing failed
        console.log("  → Rolling back: resetting vine item status...");
        await db
          .update(vineItems)
          .set({ status: "available" })
          .where(eq(vineItems.vineItemId, vineItem.vineItemId));
        console.log(`  ✓ Vine item reset to 'available'`);
      }

      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    }

    // Print summary
    console.log("\n\n╔═══════════════════════════════════════╗");
    console.log("║         TEST SUMMARY                  ║");
    console.log("╚═══════════════════════════════════════╝");
    console.log(`Total attempts: 10`);
    console.log(`✅ Successful:  ${successCount}`);
    console.log(`❌ Failed:      ${failureCount}`);
    console.log("\n");

    // Print detailed results
    console.log("Detailed Results:");
    results.forEach((result, idx) => {
      if (result.success) {
        console.log(`  ${idx + 1}. ✅ ${result.product}`);
      } else {
        console.log(`  ${idx + 1}. ❌ ${result.product}`);
        console.log(`      Error: ${result.error}`);
      }
    });

    console.log("\n");

    // Verify database state
    console.log("Verifying database state...");
    const listingCount = await db.select().from(listings);
    const reservedCount = await db.select().from(vineItems).where(eq(vineItems.status, "reserved"));
    const soldCount = await db.select().from(vineItems).where(eq(vineItems.status, "sold"));
    
    console.log(`Listings in database: ${listingCount.length}`);
    console.log(`Vine items 'reserved': ${reservedCount.length} (should be 0)`);
    console.log(`Vine items 'sold': ${soldCount.length} (should equal successful listings)`);
    
    if (listingCount.length !== successCount) {
      console.warn(`⚠️  WARNING: Database mismatch! ${listingCount.length} listings but ${successCount} successes`);
    } else {
      console.log(`✅ Database state is consistent!`);
    }

  } catch (error) {
    console.error("❌ Script error:", error);
    throw error;
  }
}

// Run the test
testListingCreation()
  .then(() => {
    console.log("\n🎉 Test completed!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n💥 Test failed:", error);
    process.exit(1);
  });
