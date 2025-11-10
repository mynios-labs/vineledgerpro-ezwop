// eBay API client utilities
const EBAY_API_BASE = process.env.EBAY_ENV === "production" 
  ? "https://api.ebay.com"
  : "https://api.sandbox.ebay.com";

let accessToken: string | null = null;
let tokenExpiry: number = 0;

async function getAccessToken(): Promise<string> {
  // For Inventory API operations (creating listings), we need a User Access Token
  // The user can generate this from eBay Developer Portal > User Tokens
  // and add it to EBAY_USER_TOKEN environment variable
  if (process.env.EBAY_USER_TOKEN) {
    console.log("[eBay] Using EBAY_USER_TOKEN for authentication");
    return process.env.EBAY_USER_TOKEN;
  }

  // Fallback to client credentials (read-only operations)
  if (accessToken && Date.now() < tokenExpiry) {
    return accessToken;
  }

  console.log("[eBay] Generating client credentials token (read-only)");
  const isProduction = process.env.EBAY_ENV === "production";
  const clientId = isProduction ? process.env.EBAY_PROD_CLIENT_ID : process.env.EBAY_CLIENT_ID;
  const clientSecret = isProduction ? process.env.EBAY_PROD_CLIENT_SECRET : process.env.EBAY_CLIENT_SECRET;
  
  const credentials = Buffer.from(
    `${clientId}:${clientSecret}`
  ).toString("base64");

  const response = await fetch(`${EBAY_API_BASE}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
    },
    body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope",
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("eBay OAuth error:", response.status, errorText);
    throw new Error(`eBay authentication failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  if (!data.access_token) {
    console.error("eBay OAuth response missing access_token:", data);
    throw new Error("eBay authentication failed: No access token in response");
  }

  accessToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000; // Refresh 1 min before expiry

  return accessToken!;
}

export async function getSuggestedCategories(keywords: string): Promise<any> {
  const token = await getAccessToken();
  
  const response = await fetch(
    `${EBAY_API_BASE}/commerce/taxonomy/v1/category_tree/0/get_category_suggestions?q=${encodeURIComponent(keywords)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  return response.json();
}

export async function createOrUpdateInventoryItem(sku: string, item: any): Promise<void> {
  const token = await getAccessToken();

  console.log(`[eBay] Creating/updating inventory item: ${sku}`);
  const response = await fetch(
    `${EBAY_API_BASE}/sell/inventory/v1/inventory_item/${sku}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Content-Language": "en-US",
        "Accept-Language": "en-US", // Required for Inventory API
      },
      body: JSON.stringify(item),
    }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    console.error(`[eBay] Create inventory item failed:`, response.status, errorData);
    throw new Error(`eBay create inventory item failed: ${response.status} - ${JSON.stringify(errorData)}`);
  }
  
  console.log(`[eBay] Inventory item created successfully: ${sku}`);
}

export async function createOffer(offer: any): Promise<any> {
  const token = await getAccessToken();

  console.log(`[eBay] Creating offer for SKU: ${offer.sku}`);
  const response = await fetch(`${EBAY_API_BASE}/sell/inventory/v1/offer`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Language": "en-US",
      "Accept-Language": "en-US", // Required for Inventory API
    },
    body: JSON.stringify(offer),
  });

  const data = await response.json().catch(() => ({}));
  
  if (!response.ok || data.errors) {
    console.error(`[eBay] Create offer failed:`, response.status, data);
    throw new Error(`eBay create offer failed: ${response.status} - ${JSON.stringify(data)}`);
  }

  if (!data.offerId) {
    console.error(`[eBay] Offer response missing offerId:`, data);
    throw new Error(`eBay create offer failed: No offerId in response`);
  }

  console.log(`[eBay] Offer created successfully: ${data.offerId}`);
  return data;
}

export async function publishOffer(offerId: string): Promise<any> {
  const token = await getAccessToken();

  console.log(`[eBay] Publishing offer: ${offerId}`);
  const response = await fetch(
    `${EBAY_API_BASE}/sell/inventory/v1/offer/${offerId}/publish`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Content-Language": "en-US",
        "Accept-Language": "en-US", // Required for Inventory API
      },
    }
  );

  const data = await response.json().catch(() => ({}));
  
  if (!response.ok || data.errors) {
    console.error(`[eBay] Publish offer failed:`, response.status, data);
    throw new Error(`eBay publish offer failed: ${response.status} - ${JSON.stringify(data)}`);
  }

  if (!data.listingId) {
    console.error(`[eBay] Publish response missing listingId:`, data);
    throw new Error(`eBay publish offer failed: No listingId in response`);
  }

  console.log(`[eBay] Offer published successfully. Listing ID: ${data.listingId}`);
  return data;
}

export async function getFulfillmentPolicies(): Promise<any> {
  const token = await getAccessToken();

  console.log(`[eBay] Fetching fulfillment policies...`);
  const response = await fetch(
    `${EBAY_API_BASE}/sell/account/v1/fulfillment_policy?marketplace_id=EBAY_US`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Accept-Language": "en-US",
      },
    }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    console.error(`[eBay] Get fulfillment policies failed:`, response.status, errorData);
    throw new Error(`eBay get fulfillment policies failed: ${response.status} - ${JSON.stringify(errorData)}`);
  }

  const data = await response.json();
  console.log(`[eBay] Found ${data.fulfillmentPolicies?.length || 0} fulfillment policies`);
  return data;
}

export async function getOrCreateMerchantLocation(): Promise<string> {
  const token = await getAccessToken();
  const locationKey = "DEFAULT_LOCATION";

  // Try to get existing location
  try {
    console.log(`[eBay] Checking for existing merchant location: ${locationKey}`);
    const response = await fetch(
      `${EBAY_API_BASE}/sell/inventory/v1/location/${locationKey}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Accept-Language": "en-US",
        },
      }
    );

    if (response.ok) {
      console.log(`[eBay] Using existing merchant location: ${locationKey}`);
      return locationKey;
    }
  } catch (error) {
    console.log(`[eBay] Merchant location doesn't exist, creating new one...`);
  }

  // Create new location
  const locationData = {
    location: {
      address: {
        addressLine1: "123 Main St",
        city: "San Jose",
        stateOrProvince: "CA",
        postalCode: "95131",
        country: "US",
      },
    },
    locationInstructions: "Default shipping location",
    name: "Default Location",
    merchantLocationStatus: "ENABLED",
    locationTypes: ["WAREHOUSE"],
  };

  console.log(`[eBay] Creating merchant location: ${locationKey}`);
  const createResponse = await fetch(
    `${EBAY_API_BASE}/sell/inventory/v1/location/${locationKey}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Content-Language": "en-US",
        "Accept-Language": "en-US",
      },
      body: JSON.stringify(locationData),
    }
  );

  if (!createResponse.ok) {
    const errorData = await createResponse.json().catch(() => ({}));
    console.error(`[eBay] Create merchant location failed:`, createResponse.status, errorData);
    throw new Error(`eBay create merchant location failed: ${createResponse.status} - ${JSON.stringify(errorData)}`);
  }

  console.log(`[eBay] Merchant location created successfully: ${locationKey}`);
  return locationKey;
}

export async function uploadPictureToEbay(imageUrl: string): Promise<string> {
  // In production, you would upload to eBay Picture Services
  // For now, return the URL as-is
  return imageUrl;
}

export async function getOrders(params: {
  orderIds?: string[];
  creationDateFrom?: string;
  creationDateTo?: string;
  limit?: number;
}): Promise<any> {
  const token = await getAccessToken();
  
  const queryParams = new URLSearchParams();
  if (params.orderIds?.length) {
    queryParams.append("orderIds", params.orderIds.join(","));
  }
  if (params.creationDateFrom) {
    queryParams.append("filter", `creationdate:[${params.creationDateFrom}..${params.creationDateTo || ""}]`);
  }
  if (params.limit) {
    queryParams.append("limit", params.limit.toString());
  }

  const response = await fetch(
    `${EBAY_API_BASE}/sell/fulfillment/v1/order?${queryParams.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  return response.json();
}

export async function getOrder(orderId: string): Promise<any> {
  const token = await getAccessToken();

  const response = await fetch(
    `${EBAY_API_BASE}/sell/fulfillment/v1/order/${orderId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  return response.json();
}
