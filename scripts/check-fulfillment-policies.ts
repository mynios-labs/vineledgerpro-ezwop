import { getFulfillmentPolicies } from "../server/lib/ebay";

async function checkPolicies() {
  try {
    console.log("🔍 Checking eBay fulfillment policies...\n");
    
    const data = await getFulfillmentPolicies();
    
    if (!data.fulfillmentPolicies || data.fulfillmentPolicies.length === 0) {
      console.log("❌ No fulfillment policies found!");
      console.log("\nYou need to create a fulfillment policy in eBay Seller Hub:");
      console.log("1. Go to: https://seller.sandbox.ebay.com/sh/policies/fulfillment");
      console.log("2. Create a new policy with at least one shipping service");
      process.exit(1);
    }
    
    console.log(`✅ Found ${data.fulfillmentPolicies.length} fulfillment policies:\n`);
    
    data.fulfillmentPolicies.forEach((policy: any, index: number) => {
      console.log(`Policy ${index + 1}:`);
      console.log(`  ID: ${policy.fulfillmentPolicyId}`);
      console.log(`  Name: ${policy.name}`);
      console.log(`  Marketplace: ${policy.marketplaceId}`);
      console.log(`  Shipping Services: ${policy.shippingOptions?.[0]?.shippingServices?.length || 0}`);
      if (policy.shippingOptions?.[0]?.shippingServices?.[0]) {
        console.log(`  First Service: ${policy.shippingOptions[0].shippingServices[0].shippingServiceCode}`);
      }
      console.log();
    });
    
    console.log("\n📋 Recommended policy to use:");
    const defaultPolicy = data.fulfillmentPolicies[0];
    console.log(`  fulfillmentPolicyId: "${defaultPolicy.fulfillmentPolicyId}"`);
    
  } catch (error: any) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

checkPolicies();
