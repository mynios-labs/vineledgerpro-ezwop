// Clean up ghost inventory items (which should cascade delete offers)
async function deleteGhostInventory() {
  const token = process.env.EBAY_USER_TOKEN;
  const EBAY_API_BASE = "https://api.sandbox.ebay.com";

  // All SKUs that have ghost offers
  const ghostSKUs = [
    "VINE-9a67f9f3-461e-4feb-9463-242e9a475b70",
    "VINE-3819cd6c-0b9a-4dce-9ccb-fac7811a12b8",
    "VINE-3289c3c6-b5a9-4787-98f5-f1b5430c8a60",
    "VINE-014ef262-6955-4638-8f07-65084d582233",
    "VINE-65feadc7-1f78-4cea-bb45-1e65cefa9f7f",
    "VINE-a01deee3-a8ad-4fc0-bb7d-e3a19d02b7e8",
    "VINE-b9e3c40a-92b6-4e75-8a5f-2cd65ce6faea",
    "VINE-d2b25f94-96a8-4e65-ac9c-e87e1e8d0c8c",
    "VINE-21ca1d45-e6c5-47d0-b2be-d9f2a1cda7d7",
  ];

  console.log(`🗑️  Deleting ${ghostSKUs.length} ghost inventory items...\n`);

  let deletedCount = 0;
  let errorCount = 0;

  for (const sku of ghostSKUs) {
    try {
      const deleteResponse = await fetch(
        `${EBAY_API_BASE}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Language": "en-US",
            "Accept-Language": "en-US",
          },
        }
      );

      if (deleteResponse.ok || deleteResponse.status === 204) {
        console.log(`  ✅ Deleted inventory item: ${sku}`);
        deletedCount++;
      } else if (deleteResponse.status === 404) {
        console.log(`  ⚠️  Not found: ${sku}`);
      } else {
        const errorData = await deleteResponse.json().catch(() => ({}));
        console.log(`  ❌ Failed to delete ${sku}: ${deleteResponse.status}`, errorData);
        errorCount++;
      }

    } catch (error: any) {
      console.log(`  ❌ Error deleting ${sku}: ${error.message}`);
      errorCount++;
    }
  }

  console.log(`\n📊 Cleanup Summary:`);
  console.log(`  Deleted: ${deletedCount}`);
  console.log(`  Errors: ${errorCount}`);
  console.log(`  Total: ${ghostSKUs.length}`);
}

deleteGhostInventory();
