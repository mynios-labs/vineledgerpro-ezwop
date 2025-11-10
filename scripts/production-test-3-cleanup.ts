// PRODUCTION TEST - Step 3: Cleanup (Delete Test Items)
// Safe: Deletes test offer and inventory item
const TEST_SKU = "VINE-TEST-PROD-001";

async function cleanup() {
  const token = process.env.EBAY_USER_TOKEN;
  const EBAY_API_BASE = "https://api.ebay.com"; // Production
  const confirmFlag = process.argv.includes("--confirm");
  
  console.log("\n🧹 PRODUCTION TEST - Step 3: Cleanup");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  console.log("📋 What this will do:");
  console.log("  ✓ Delete any offers for: " + TEST_SKU);
  console.log("  ✓ Delete inventory item: " + TEST_SKU);
  console.log("  ✓ Clean up test data from eBay");
  
  if (!confirmFlag) {
    console.log("\n⚠️  DRY RUN MODE - Add --confirm to proceed");
    console.log("\nCommand: tsx scripts/production-test-3-cleanup.ts --confirm");
    return;
  }
  
  console.log("\n⏳ Proceeding in 2 seconds...");
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  try {
    // Step 1: Get and delete any offers
    console.log("\n[1/2] Checking for offers...");
    const getOffersResponse = await fetch(
      `${EBAY_API_BASE}/sell/inventory/v1/offer?sku=${encodeURIComponent(TEST_SKU)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Accept-Language": "en-US",
        },
      }
    );
    
    if (getOffersResponse.ok) {
      const data = await getOffersResponse.json();
      if (data.offers && data.offers.length > 0) {
        for (const offer of data.offers) {
          console.log(`  → Deleting offer: ${offer.offerId}`);
          const deleteOfferResponse = await fetch(
            `${EBAY_API_BASE}/sell/inventory/v1/offer/${offer.offerId}`,
            {
              method: "DELETE",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Language": "en-US",
                "Accept-Language": "en-US",
              },
            }
          );
          
          if (deleteOfferResponse.ok || deleteOfferResponse.status === 204) {
            console.log(`  ✅ Deleted offer: ${offer.offerId}`);
          } else {
            console.log(`  ⚠️  Could not delete offer: ${offer.offerId}`);
          }
        }
      } else {
        console.log("  ℹ️  No offers found");
      }
    }
    
    // Step 2: Delete inventory item
    console.log("\n[2/2] Deleting inventory item...");
    const deleteInventoryResponse = await fetch(
      `${EBAY_API_BASE}/sell/inventory/v1/inventory_item/${encodeURIComponent(TEST_SKU)}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Language": "en-US",
          "Accept-Language": "en-US",
        },
      }
    );
    
    if (deleteInventoryResponse.ok || deleteInventoryResponse.status === 204) {
      console.log(`✅ Deleted inventory item: ${TEST_SKU}`);
    } else if (deleteInventoryResponse.status === 404) {
      console.log(`ℹ️  Inventory item not found (already deleted)`);
    } else {
      const errorData = await deleteInventoryResponse.json().catch(() => ({}));
      console.log(`⚠️  Could not delete inventory item:`, errorData);
    }
    
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("✅ CLEANUP COMPLETE\n");
    console.log("📋 You can now run Step 1 again for another test");
    
  } catch (error: any) {
    console.error("\n❌ ERROR:", error.message);
    process.exit(1);
  }
}

cleanup();
