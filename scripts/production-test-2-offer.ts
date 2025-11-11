// PRODUCTION TEST - Step 2: Create Draft Offer (NOT PUBLISHED)
// Safe: Creates offer but NEVER publishes it
import { createOffer, getOrCreateMerchantLocation } from "../server/lib/ebay";

const TEST_SKU = "ITEM-TEST-PROD-001";

async function createTestOffer() {
  const confirmFlag = process.argv.includes("--confirm");
  
  console.log("\n🚨 PRODUCTION TEST - Step 2: Create Draft Offer");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  console.log("📋 What this will do:");
  console.log("  ✓ Create ONE draft offer for: " + TEST_SKU);
  console.log("  ✓ Offer will be in DRAFT state");
  console.log("\n❌ What this will NOT do:");
  console.log("  × Will NOT publish the offer");
  console.log("  × Will NOT make it live on eBay");
  console.log("  × Will NOT be visible to buyers");
  
  if (!confirmFlag) {
    console.log("\n⚠️  DRY RUN MODE - Add --confirm to proceed");
    console.log("\nCommand: tsx scripts/production-test-2-offer.ts --confirm");
    return;
  }
  
  console.log("\n⏳ Proceeding in 3 seconds...");
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  try {
    // Get merchant location
    console.log("\n[1/2] Getting merchant location...");
    const merchantLocationKey = await getOrCreateMerchantLocation();
    console.log(`✅ Merchant location: ${merchantLocationKey}`);
    
    // Create draft offer
    console.log("\n[2/2] Creating DRAFT offer...");
    const offerResponse = await createOffer({
      sku: TEST_SKU,
      marketplaceId: "EBAY_US",
      format: "FIXED_PRICE",
      merchantLocationKey,
      listingDescription: "This is a test listing. Please do not purchase.",
      availableQuantity: 1,
      categoryId: "172008",
      listingPolicies: {
        fulfillmentPolicyId: "278016180015", // Production: UPS Ground Saver
      },
      pricingSummary: {
        price: {
          value: "9.99",
          currency: "USD",
        },
      },
    });
    
    console.log(`✅ Draft offer created: ${offerResponse.offerId}`);
    console.log(`   Status: UNPUBLISHED (not live)`);
    
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("✅ STEP 2 COMPLETE\n");
    console.log("📋 Verify in eBay Seller Hub:");
    console.log("  → Go to: https://www.ebay.com/sh/lst/drafts");
    console.log("  → You should see the draft offer (NOT live)");
    console.log("\n📋 Next steps:");
    console.log("  1. Verify offer is NOT live in Seller Hub");
    console.log("  2. Run cleanup: tsx scripts/production-test-3-cleanup.ts --confirm");
    console.log("\n⚠️  This offer is DRAFT only - NOT visible to buyers");
    
  } catch (error: any) {
    console.error("\n❌ ERROR:", error.message);
    console.log("\n📋 Recovery:");
    console.log("  Run: tsx scripts/production-test-3-cleanup.ts --confirm");
    process.exit(1);
  }
}

createTestOffer();
