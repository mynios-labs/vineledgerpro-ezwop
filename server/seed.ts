import { db } from "./db";
import { vineItems, addressProfiles, businessPolicies } from "@shared/schema";

async function seed() {
  console.log("Seeding database...");

  // Create sample vine items
  await db.insert(vineItems).values([
    {
      asin: "B0ABCD1234",
      titleNorm: "Premium Wireless Bluetooth Headphones with Noise Cancellation",
      etvCents: 7999,
      receivedDate: new Date("2024-10-15"),
      upc: "123456789012",
      status: "available",
    },
    {
      asin: "B0EFGH5678",
      titleNorm: "Stainless Steel Kitchen Knife Set - 15 Pieces",
      etvCents: 12999,
      receivedDate: new Date("2024-10-20"),
      upc: "234567890123",
      status: "available",
    },
    {
      asin: "B0IJKL9012",
      titleNorm: "Smart Home LED Light Bulbs (4-Pack) WiFi Compatible",
      etvCents: 3999,
      receivedDate: new Date("2024-10-25"),
      upc: "345678901234",
      status: "available",
    },
    {
      asin: "B0MNOP3456",
      titleNorm: "Portable Power Bank 20000mAh Fast Charging",
      etvCents: 4999,
      receivedDate: new Date("2024-10-28"),
      upc: "456789012345",
      status: "available",
    },
    {
      asin: "B0QRST7890",
      titleNorm: "Professional Hair Dryer with Ionic Technology",
      etvCents: 8999,
      receivedDate: new Date("2024-11-01"),
      upc: "567890123456",
      status: "available",
    },
  ]);

  // Create default address profiles
  await db.insert(addressProfiles).values([
    {
      label: "Return Address (PO Box)",
      line1: "PO Box 12345",
      line2: "",
      city: "New York",
      state: "NY",
      zip: "10001",
      country: "US",
      isDefault: true,
      kind: "po_profile",
    },
  ]);

  // Create default business policy
  await db.insert(businessPolicies).values([
    {
      label: "Standard Shipping & Returns",
      shippingPolicyId: "default",
      returnPolicyId: "default",
      handlingTimeDays: 1,
    },
  ]);

  console.log("Seed data created successfully!");
}

seed()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .then(() => process.exit(0));
