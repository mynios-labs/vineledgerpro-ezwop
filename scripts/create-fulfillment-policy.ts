// Attempt to create a fulfillment policy with shipping services
async function createFulfillmentPolicy() {
  const token = process.env.EBAY_USER_TOKEN;
  const EBAY_API_BASE = "https://api.sandbox.ebay.com";

  const policyData = {
    name: "Free Standard Shipping",
    marketplaceId: "EBAY_US",
    categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }],
    handlingTime: { value: 1, unit: "DAY" },
    shippingOptions: [
      {
        optionType: "DOMESTIC",
        costType: "FLAT_RATE",
        shippingServices: [
          {
            shippingServiceCode: "USPSPriority",
            freeShipping: true,
            buyerResponsibleForShipping: false,
            sortOrder: 1,
          },
        ],
      },
    ],
  };

  console.log("🔧 Attempting to create fulfillment policy...\n");
  
  try {
    const response = await fetch(
      `${EBAY_API_BASE}/sell/account/v1/fulfillment_policy`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Accept-Language": "en-US",
        },
        body: JSON.stringify(policyData),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("❌ Create fulfillment policy failed:", response.status);
      console.error(JSON.stringify(data, null, 2));
      
      console.log("\n📋 Manual setup required:");
      console.log("Go to: https://seller.sandbox.ebay.com/sh/policies/fulfillment");
      console.log("Edit 'Free Domestic Shipping' policy");
      console.log("Add shipping service: USPS Priority Mail (Free)");
      process.exit(1);
    }

    console.log("✅ Fulfillment policy created!");
    console.log(`Policy ID: ${data.fulfillmentPolicyId}`);
    console.log(`Name: ${data.name}`);
    
  } catch (error: any) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

createFulfillmentPolicy();
