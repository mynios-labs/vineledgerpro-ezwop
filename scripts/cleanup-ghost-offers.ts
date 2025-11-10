// Clean up orphaned eBay offers that exist in sandbox but not in our database
async function cleanupGhostOffers() {
  const token = process.env.EBAY_USER_TOKEN;
  const EBAY_API_BASE = "https://api.sandbox.ebay.com";

  // SKUs that had ghost offers from our test output
  const ghostSKUs = [
    "VINE-5d34a560-b435-41db-9859-f7edc3c2dd5c", // Bluetooth Speaker
    "VINE-9a67f9f3-461e-4feb-9463-242e9a475b70", // Smart Security Camera
    "VINE-39e6abc8-309a-43ac-b80b-4a4e33a969a6", // Milk Frother
    "VINE-edd29f42-6daa-40d7-bb73-62e2a58f1b15", // Fitness Tracker
    "VINE-0e19f862-d71b-4e43-bbfc-6fe3f8b9c0c8", // LED Desk Lamp
    "VINE-c3b06b88-8f65-4be3-8ad2-9fdbecf56afc", // Portable Power Bank
    "VINE-f88afb3f-cdc2-4b10-8cce-0fbec2fb82b3", // Coffee Maker
    "VINE-04a26950-c5be-412a-a1f6-c2fd89331d88", // Wireless Mouse
    "VINE-d2f8d7c3-59ad-49f5-81ec-d54a63c0c3b8", // Phone Case (from error log)
  ];

  console.log(`🧹 Cleaning up ${ghostSKUs.length} ghost offers...\n`);

  let deletedCount = 0;
  let notFoundCount = 0;

  for (const sku of ghostSKUs) {
    try {
      // Get offers for this SKU
      const getResponse = await fetch(
        `${EBAY_API_BASE}/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!getResponse.ok) {
        console.log(`  ⚠️  ${sku}: Could not fetch offers (${getResponse.status})`);
        continue;
      }

      const data = await getResponse.json();
      
      if (!data.offers || data.offers.length === 0) {
        notFoundCount++;
        continue;
      }

      // Delete each offer found
      for (const offer of data.offers) {
        const offerId = offer.offerId;
        
        // If published, withdraw first
        if (offer.status === "PUBLISHED") {
          console.log(`  📤 Withdrawing published offer ${offerId}...`);
          const withdrawResponse = await fetch(
            `${EBAY_API_BASE}/sell/inventory/v1/offer/${offerId}/withdraw`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
            }
          );
          
          if (!withdrawResponse.ok) {
            console.log(`  ⚠️  Failed to withdraw ${offerId}`);
          }
          
          // Wait a bit for withdrawal to process
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        // Delete the offer
        console.log(`  🗑️  Deleting offer ${offerId}...`);
        const deleteResponse = await fetch(
          `${EBAY_API_BASE}/sell/inventory/v1/offer/${offerId}`,
          {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        if (deleteResponse.ok || deleteResponse.status === 204) {
          console.log(`  ✅ Deleted ${offerId}`);
          deletedCount++;
        } else {
          console.log(`  ❌ Failed to delete ${offerId} (${deleteResponse.status})`);
        }
      }

    } catch (error: any) {
      console.log(`  ❌ Error processing ${sku}: ${error.message}`);
    }
  }

  console.log(`\n📊 Cleanup Summary:`);
  console.log(`  Deleted: ${deletedCount}`);
  console.log(`  Not found: ${notFoundCount}`);
  console.log(`  Total processed: ${ghostSKUs.length}`);
}

cleanupGhostOffers();
