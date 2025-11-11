// eBay API client utilities
const EBAY_API_BASE = process.env.EBAY_ENV === "production" 
  ? "https://api.ebay.com"
  : "https://api.sandbox.ebay.com";

let accessToken: string | null = null;
let tokenExpiry: number = 0;

async function refreshAccessToken(): Promise<string> {
  const isProduction = process.env.EBAY_ENV === "production";
  const clientId = isProduction ? process.env.EBAY_PROD_CLIENT_ID : process.env.EBAY_CLIENT_ID;
  const clientSecret = isProduction ? process.env.EBAY_PROD_CLIENT_SECRET : process.env.EBAY_CLIENT_SECRET;
  const refreshToken = isProduction ? process.env.EBAY_PROD_REFRESH_TOKEN : process.env.EBAY_REFRESH_TOKEN;

  if (!refreshToken) {
    throw new Error("No refresh token available - please authorize the application");
  }

  console.log("[eBay] Refreshing access token using refresh token");
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  
  // eBay requires the same scopes that were originally granted
  const scopes = [
    "https://api.ebay.com/oauth/api_scope/sell.inventory",
    "https://api.ebay.com/oauth/api_scope/sell.inventory.readonly",
    "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
    "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
  ].join(" ");

  const response = await fetch(`${EBAY_API_BASE}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
    },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}&scope=${encodeURIComponent(scopes)}`,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[eBay] Token refresh failed:", response.status, errorText);
    
    // Check for expired refresh token
    if (errorText.includes("invalid_grant")) {
      throw new Error(
        "eBay refresh token has expired (18-month limit). " +
        "Please re-authorize the application via eBay Developer Portal > User Tokens."
      );
    }
    
    throw new Error(`eBay token refresh failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  accessToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000; // Refresh 1 min before expiry

  console.log(`[eBay] Access token refreshed, expires in ${data.expires_in} seconds`);
  return accessToken!;
}

async function getAccessToken(): Promise<string> {
  // Priority 1: Use manually provided user token (for testing or manual override)
  const isProduction = process.env.EBAY_ENV === "production";
  const userToken = isProduction ? process.env.EBAY_PROD_USER_TOKEN : process.env.EBAY_USER_TOKEN;
  
  if (userToken) {
    console.log("[eBay] Using manual user token for authentication");
    return userToken;
  }

  // Priority 2: Use cached access token if still valid
  if (accessToken && Date.now() < tokenExpiry) {
    return accessToken;
  }

  // Priority 3: Refresh access token using refresh token
  const refreshToken = isProduction ? process.env.EBAY_PROD_REFRESH_TOKEN : process.env.EBAY_REFRESH_TOKEN;
  if (refreshToken) {
    return await refreshAccessToken();
  }

  // Priority 4: Fallback to client credentials (read-only operations)
  console.log("[eBay] Generating client credentials token (read-only)");
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

export async function getCategoryDetails(categoryId: string): Promise<any> {
  const token = await getAccessToken();
  
  const response = await fetch(
    `${EBAY_API_BASE}/commerce/taxonomy/v1/category_tree/0/get_category_subtree?category_id=${categoryId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to get category details: ${response.status}`);
  }

  return response.json();
}

export async function isLeafCategory(categoryId: string): Promise<boolean> {
  try {
    const details = await getCategoryDetails(categoryId);
    // eBay API returns data nested under categorySubtreeNode
    const subtree = details.categorySubtreeNode;
    if (!subtree) {
      console.error(`[eBay] Category ${categoryId} has no subtree node`);
      return false;
    }
    // A leaf category has no child categories
    const isLeaf = !subtree.childCategoryTreeNodes || subtree.childCategoryTreeNodes.length === 0;
    console.log(`[eBay] Category ${categoryId} (${subtree.category?.categoryName}) is ${isLeaf ? 'LEAF' : 'NON-LEAF'}`);
    return isLeaf;
  } catch (error) {
    console.error(`[eBay] Failed to check if category ${categoryId} is leaf:`, error);
    return false;
  }
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
