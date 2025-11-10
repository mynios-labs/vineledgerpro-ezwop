// PRODUCTION TEST - Step 1: Create Inventory Item Only
// Safe: Does NOT create offers or publish anything
import { createOrUpdateInventoryItem, getOrCreateMerchantLocation } from "../server/lib/ebay";

const TEST_SKU = "VINE-TEST-PROD-001";

async function createTestInventory() {
  const confirmFlag = process.argv.includes("--confirm");
  
  console.log("\n🚨 PRODUCTION TEST - Step 1: Create Inventory Item");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  console.log("📋 What this will do:");
  console.log("  ✓ Create ONE test inventory item");
  console.log("  ✓ SKU: " + TEST_SKU);
  console.log("  ✓ Create/verify merchant location");
  console.log("\n❌ What this will NOT do:");
  console.log("  × Will NOT create an offer");
  console.log("  × Will NOT publish anything");
  console.log("  × Will NOT make item visible on eBay");
  
  if (!confirmFlag) {
    console.log("\n⚠️  DRY RUN MODE - Add --confirm to proceed");
    console.log("\nCommand: tsx scripts/production-test-1-inventory.ts --confirm");
    return;
  }
  
  console.log("\n⏳ Proceeding in 3 seconds...");
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  try {
    // Step 1: Ensure merchant location exists
    console.log("\n[1/2] Getting merchant location...");
    const merchantLocationKey = await getOrCreateMerchantLocation();
    console.log(`✅ Merchant location: ${merchantLocationKey}`);
    
    // Step 2: Create inventory item
    console.log("\n[2/2] Creating inventory item...");
    await createOrUpdateInventoryItem(TEST_SKU, {
      availability: {
        shipToLocationAvailability: {
          quantity: 1,
        },
      },
      condition: "NEW",
      product: {
        title: "TEST ITEM - DO NOT BUY - TESTING ONLY",
        description: "This is a test listing. Please do not purchase.",
        imageUrls: ["https://via.placeholder.com/800x800?text=TEST"],
        aspects: {
          Brand: ["Test"],
          Type: ["Test Item"],
          Condition: ["New"],
        },
      },
    });
    console.log(`✅ Inventory item created: ${TEST_SKU}`);
    
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("✅ STEP 1 COMPLETE\n");
    console.log("📋 Next steps:");
    console.log("  1. Run cleanup: tsx scripts/production-test-3-cleanup.ts --confirm");
    console.log("  2. OR continue to Step 2: tsx scripts/production-test-2-offer.ts --confirm");
    console.log("\n⚠️  Remember: This item is NOT live on eBay (no offer created yet)");
    
  } catch (error: any) {
    console.error("\n❌ ERROR:", error.message);
    console.log("\n📋 Recovery:");
    console.log("  Run: tsx scripts/production-test-3-cleanup.ts --confirm");
    process.exit(1);
  }
}

createTestInventory();
