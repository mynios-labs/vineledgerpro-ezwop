// eBay API client utilities
import { ApiTracer } from './apiTracer';

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
    "https://api.ebay.com/oauth/api_scope/sell.account",
    "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
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

// Public API token (client credentials) for read-only operations like Taxonomy
let publicAccessToken: string | null = null;
let publicTokenExpiry: number = 0;

export async function getPublicAccessToken(): Promise<string> {
  // Check cached public token
  if (publicAccessToken && Date.now() < publicTokenExpiry) {
    return publicAccessToken;
  }

  console.log("[eBay] Generating client credentials token for public APIs");
  const isProduction = process.env.EBAY_ENV === "production";
  const clientId = isProduction ? process.env.EBAY_PROD_CLIENT_ID : process.env.EBAY_CLIENT_ID;
  const clientSecret = isProduction ? process.env.EBAY_PROD_CLIENT_SECRET : process.env.EBAY_CLIENT_SECRET;
  
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

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
    console.error("[eBay] Public OAuth error:", response.status, errorText);
    throw new Error(`eBay authentication failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  if (!data.access_token) {
    console.error("[eBay] Public OAuth response missing access_token:", data);
    throw new Error("eBay authentication failed: No access token in response");
  }

  publicAccessToken = data.access_token;
  publicTokenExpiry = Date.now() + (data.expires_in * 1000) - 60000; // Refresh 1 min before expiry

  console.log(`[eBay] Public access token generated, expires in ${data.expires_in} seconds`);
  return publicAccessToken!;
}

export async function getAccessToken(): Promise<string> {
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
  return await getPublicAccessToken();
}

export async function getSuggestedCategories(keywords: string): Promise<any> {
  const token = await getPublicAccessToken();  // Use public token for Taxonomy API
  
  const url = `${EBAY_API_BASE}/commerce/taxonomy/v1/category_tree/0/get_category_suggestions?q=${encodeURIComponent(keywords)}`;
  
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[eBay] Category suggestions API failed: ${response.status} ${errorText}`);
    throw new Error(`eBay category suggestions failed: ${response.status}`);
  }

  return response.json();
}

export async function getCategoryDetails(categoryId: string): Promise<any> {
  const token = await getPublicAccessToken();  // Use public token for Taxonomy API
  
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
  offset?: number;
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
  if (params.offset) {
    queryParams.append("offset", params.offset.toString());
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

// Fulfillment policy cache (15-minute TTL)
let fulfillmentPoliciesCache: any = null;
let fulfillmentPoliciesCacheExpiry: number = 0;

export async function createShippingFulfillment(params: {
  orderId: string;
  lineItems: Array<{ lineItemId: string; quantity: number }>;
  trackingNumber: string;
  shippingCarrierCode: string;
  shippedTime?: string;
}): Promise<any> {
  const token = await getAccessToken();
  
  const body = {
    lineItems: params.lineItems,
    trackingNumber: params.trackingNumber,
    shippingCarrierCode: params.shippingCarrierCode,
    shippedTime: params.shippedTime || new Date().toISOString(),
  };

  console.log("[eBay] Creating shipping fulfillment:", {
    orderId: params.orderId,
    trackingNumber: params.trackingNumber,
    carrier: params.shippingCarrierCode,
    lineItemCount: params.lineItems.length,
  });

  const response = await fetch(
    `${EBAY_API_BASE}/sell/fulfillment/v1/order/${params.orderId}/shipping_fulfillment`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (response.status === 201) {
    const fulfillmentId = response.headers.get("location");
    console.log("[eBay] Shipping fulfillment created:", fulfillmentId);
    return { success: true, fulfillmentId };
  }

  const errorText = await response.text();
  console.error(`[eBay] Create shipping fulfillment failed:`, response.status, errorText);
  throw new Error(`eBay create shipping fulfillment failed: ${response.status} - ${errorText}`);
}

export async function getFulfillmentPolicies(marketplaceId: string = "EBAY_US"): Promise<any> {
  // NOTE: Caching disabled per user request to ensure fresh policy data
  console.log("[eBay] Fetching fulfillment policies from Account API (no cache)");
  const token = await getAccessToken();

  const response = await fetch(
    `${EBAY_API_BASE}/sell/account/v1/fulfillment_policy?marketplace_id=${marketplaceId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": marketplaceId,
        "Accept": "application/json",
        "Content-Language": "en-US",
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[eBay] Get fulfillment policies failed:`, response.status, errorText);
    throw new Error(`eBay get fulfillment policies failed: ${response.status} - ${errorText}`);
  }

  const data = await response.json();

  console.log(`[eBay] Retrieved ${data.fulfillmentPolicies?.length || 0} fulfillment policies for ${marketplaceId}`);
  return data;
}

export async function getPaymentPolicies(marketplaceId: string = "EBAY_US"): Promise<any> {
  console.log("[eBay] Fetching payment policies from Account API (no cache)");
  const token = await getAccessToken();

  const response = await fetch(
    `${EBAY_API_BASE}/sell/account/v1/payment_policy?marketplace_id=${marketplaceId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": marketplaceId,
        "Accept": "application/json",
        "Content-Language": "en-US",
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[eBay] Get payment policies failed:`, response.status, errorText);
    throw new Error(`eBay get payment policies failed: ${response.status} - ${errorText}`);
  }

  const data = await response.json();

  console.log(`[eBay] Retrieved ${data.paymentPolicies?.length || 0} payment policies for ${marketplaceId}`);
  return data;
}

export async function getReturnPolicies(marketplaceId: string = "EBAY_US"): Promise<any> {
  console.log("[eBay] Fetching return policies from Account API (no cache)");
  const token = await getAccessToken();

  const response = await fetch(
    `${EBAY_API_BASE}/sell/account/v1/return_policy?marketplace_id=${marketplaceId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": marketplaceId,
        "Accept": "application/json",
        "Content-Language": "en-US",
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[eBay] Get return policies failed:`, response.status, errorText);
    throw new Error(`[eBay get return policies failed: ${response.status} - ${errorText}`);
  }

  const data = await response.json();

  console.log(`[eBay] Retrieved ${data.returnPolicies?.length || 0} return policies for ${marketplaceId}`);
  return data;
}

// Helper to select the best policy from a list (prefer default for marketplace, fallback to first)
export function selectBestPolicy(policies: any[], marketplaceId: string, policyIdField: string): any {
  if (!policies || policies.length === 0) {
    return null;
  }

  // Filter to marketplace first
  const marketplacePolicies = policies.filter(p => p.marketplaceId === marketplaceId);
  if (marketplacePolicies.length === 0) {
    return null;
  }

  // Prefer default policy for this marketplace
  const defaultPolicy = marketplacePolicies.find(p => 
    p.categoryTypes?.some((ct: any) => ct.default === true)
  );
  
  if (defaultPolicy) {
    console.log(`[eBay] Selected default policy: ${defaultPolicy.name} (${defaultPolicy[policyIdField]})`);
    return defaultPolicy;
  }

  // Fallback to first active policy
  const firstPolicy = marketplacePolicies[0];
  console.log(`[eBay] Selected first available policy: ${firstPolicy.name} (${firstPolicy[policyIdField]})`);
  return firstPolicy;
}

// Traced eBay API functions for idempotent publish flow

export async function getOffersBySku(sku: string, marketplaceId: string = "EBAY_US", tracer?: ApiTracer): Promise<any> {
  const token = await getAccessToken();
  const url = `${EBAY_API_BASE}/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&marketplace_id=${marketplaceId}`;
  
  const defaultLocale = (process.env.EBAY_LOCALE || 'en-US').trim();
  
  const requestInit: RequestInit = {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept-Language": defaultLocale,
      "Content-Language": defaultLocale,
    },
  };

  if (tracer) {
    const { response, data } = await tracer.trace<any>(
      "Get existing offers",
      "GET",
      url,
      requestInit,
      () => fetch(url, requestInit),
      (data, response) => {
        // 404 is normal when no offers exist yet
        if (response.status === 404) {
          return null;
        }
        if (!response.ok) {
          return `Get offers failed: ${response.status} - ${JSON.stringify(data)}`;
        }
        if (data.errors) {
          return `Get offers failed: ${JSON.stringify(data.errors)}`;
        }
        return null;
      }
    );
    
    // 404 means no offers exist - return empty offers array
    if (response.status === 404) {
      console.log(`[eBay] No existing offers found for SKU ${sku} (404 - this is normal)`);
      return { offers: [] };
    }
    
    if (!response.ok || data.errors) {
      throw new Error(`Get offers failed: ${response.status} - ${JSON.stringify(data)}`);
    }
    
    return data;
  } else {
    const response = await fetch(url, requestInit);
    
    // 404 means no offers exist - return empty offers array (normal case)
    if (response.status === 404) {
      console.log(`[eBay] No existing offers found for SKU ${sku} (404 - this is normal)`);
      return { offers: [] };
    }
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Get offers failed: ${response.status} - ${JSON.stringify(errorData)}`);
    }
    return response.json();
  }
}

export async function getOffer(offerId: string, tracer?: ApiTracer): Promise<any> {
  const token = await getAccessToken();
  const url = `${EBAY_API_BASE}/sell/inventory/v1/offer/${offerId}`;
  
  const requestInit: RequestInit = {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };

  if (tracer) {
    const { response, data } = await tracer.trace<any>(
      "Verify offer",
      "GET",
      url,
      requestInit,
      () => fetch(url, requestInit),
      (data, response) => {
        if (!response.ok) {
          return `Get offer failed: ${response.status} - ${JSON.stringify(data)}`;
        }
        if (data.errors) {
          return `Get offer failed: ${JSON.stringify(data.errors)}`;
        }
        return null;
      }
    );
    
    if (!response.ok || data.errors) {
      throw new Error(`Get offer failed: ${response.status} - ${JSON.stringify(data)}`);
    }
    
    return data;
  } else {
    const response = await fetch(url, requestInit);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Get offer failed: ${response.status} - ${JSON.stringify(errorData)}`);
    }
    return response.json();
  }
}

export async function updateOffer(offerId: string, offer: any, tracer?: ApiTracer): Promise<any> {
  const token = await getAccessToken();
  const url = `${EBAY_API_BASE}/sell/inventory/v1/offer/${offerId}`;
  
  const requestInit: RequestInit = {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Language": "en-US",
    },
    body: JSON.stringify(offer),
  };

  if (tracer) {
    const { response, data } = await tracer.trace<any>(
      "Update offer",
      "PUT",
      url,
      requestInit,
      () => fetch(url, requestInit),
      (data, response) => {
        if (!response.ok) {
          return `Update offer failed: ${response.status} - ${JSON.stringify(data)}`;
        }
        if (data.errors) {
          return `Update offer failed: ${JSON.stringify(data.errors)}`;
        }
        return null;
      }
    );
    
    if (!response.ok || data.errors) {
      throw new Error(`Update offer failed: ${response.status} - ${JSON.stringify(data)}`);
    }
    
    return data;
  } else {
    const response = await fetch(url, requestInit);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.errors) {
      throw new Error(`Update offer failed: ${response.status} - ${JSON.stringify(data)}`);
    }
    return data;
  }
}

export async function withdrawOffer(offerId: string, tracer?: ApiTracer): Promise<void> {
  const token = await getAccessToken();
  const url = `${EBAY_API_BASE}/sell/inventory/v1/offer/${offerId}/withdraw`;
  
  const requestInit: RequestInit = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Language": "en-US",
    },
  };

  if (tracer) {
    const { response, data } = await tracer.trace<any>(
      "Withdraw offer",
      "POST",
      url,
      requestInit,
      () => fetch(url, requestInit),
      (data, response) => {
        if (!response.ok) {
          return `Withdraw offer failed: ${response.status} - ${JSON.stringify(data)}`;
        }
        if (data.errors) {
          return `Withdraw offer failed: ${JSON.stringify(data.errors)}`;
        }
        return null;
      }
    );
    
    if (!response.ok || data.errors) {
      throw new Error(`Withdraw offer failed: ${response.status} - ${JSON.stringify(data)}`);
    }
  } else {
    const response = await fetch(url, requestInit);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Withdraw offer failed: ${response.status} - ${JSON.stringify(errorData)}`);
    }
  }
}

export async function createOfferTraced(offer: any, tracer?: ApiTracer): Promise<any> {
  const token = await getAccessToken();
  const url = `${EBAY_API_BASE}/sell/inventory/v1/offer`;
  
  const requestInit: RequestInit = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Language": "en-US",
    },
    body: JSON.stringify(offer),
  };

  if (tracer) {
    const { response, data } = await tracer.trace<any>(
      "Create offer",
      "POST",
      url,
      requestInit,
      () => fetch(url, requestInit),
      (data, response) => {
        if (!response.ok) {
          return `Create offer failed: ${response.status} - ${JSON.stringify(data)}`;
        }
        if (data.errors) {
          return `Create offer failed: ${JSON.stringify(data.errors)}`;
        }
        if (!data.offerId) {
          return `Create offer failed: No offerId in response`;
        }
        return null;
      }
    );
    
    if (!response.ok || data.errors) {
      throw new Error(`Create offer failed: ${response.status} - ${JSON.stringify(data)}`);
    }
    
    if (!data.offerId) {
      throw new Error(`Create offer failed: No offerId in response`);
    }
    
    return data;
  } else {
    return createOffer(offer);
  }
}

export async function publishOfferTraced(offerId: string, tracer?: ApiTracer): Promise<any> {
  const token = await getAccessToken();
  const url = `${EBAY_API_BASE}/sell/inventory/v1/offer/${offerId}/publish`;
  
  const requestInit: RequestInit = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Language": "en-US",
    },
  };

  if (tracer) {
    const { response, data } = await tracer.trace<any>(
      "Publish offer",
      "POST",
      url,
      requestInit,
      () => fetch(url, requestInit),
      (data, response) => {
        if (!response.ok) {
          return `Publish offer failed: ${response.status} - ${JSON.stringify(data)}`;
        }
        if (data.errors) {
          return `Publish offer failed: ${JSON.stringify(data.errors)}`;
        }
        if (!data.listingId) {
          return `Publish offer failed: No listingId in response`;
        }
        return null;
      }
    );
    
    if (!response.ok || data.errors) {
      throw new Error(`Publish offer failed: ${response.status} - ${JSON.stringify(data)}`);
    }
    
    if (!data.listingId) {
      throw new Error(`Publish offer failed: No listingId in response`);
    }
    
    return data;
  } else {
    return publishOffer(offerId);
  }
}

export async function createOrUpdateInventoryItemTraced(sku: string, item: any, tracer?: ApiTracer): Promise<void> {
  const token = await getAccessToken();
  const url = `${EBAY_API_BASE}/sell/inventory/v1/inventory_item/${sku}`;
  
  const requestInit: RequestInit = {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Language": "en-US",
    },
    body: JSON.stringify(item),
  };

  if (tracer) {
    const { response, data } = await tracer.trace<any>(
      "Create/update inventory item",
      "PUT",
      url,
      requestInit,
      () => fetch(url, requestInit),
      (data, response) => {
        // 204 No Content is success for PUT inventory_item
        if (response.status === 204) {
          return null;
        }
        if (!response.ok) {
          return `Create inventory item failed: ${response.status} - ${JSON.stringify(data)}`;
        }
        if (data.errors) {
          return `Create inventory item failed: ${JSON.stringify(data.errors)}`;
        }
        return null;
      }
    );
    
    // 204 No Content is success
    if (response.status !== 204 && (!response.ok || data.errors)) {
      throw new Error(`Create inventory item failed: ${response.status} - ${JSON.stringify(data)}`);
    }
    
    console.log(`[eBay] Inventory item ${response.status === 204 ? 'created/updated' : 'processed'} successfully: ${sku}`);
  } else {
    await createOrUpdateInventoryItem(sku, item);
  }
}

export async function getAllOffers(limit: number = 200): Promise<any[]> {
  const token = await getAccessToken();
  const allOffers: any[] = [];
  let offset = 0;
  
  console.log("[eBay] Fetching all offers from Inventory API...");
  
  while (true) {
    const url = `${EBAY_API_BASE}/sell/inventory/v1/offer?marketplace_id=EBAY_US&limit=${limit}&offset=${offset}`;
    
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Content-Language": "en-US",
      },
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Get offers failed: ${response.status} - ${JSON.stringify(errorData)}`);
    }
    
    const data = await response.json();
    const offers = data.offers || [];
    
    if (offers.length === 0) {
      break;
    }
    
    allOffers.push(...offers);
    console.log(`[eBay] Fetched ${offers.length} offers (offset: ${offset}, total so far: ${allOffers.length})`);
    
    // Check if there are more pages
    if (offers.length < limit) {
      break;
    }
    
    offset += limit;
  }
  
  console.log(`[eBay] Fetched total of ${allOffers.length} offers`);
  return allOffers;
}

export async function getUserAccountInfo(): Promise<any> {
  const token = await getAccessToken();
  const EBAY_APIZ_BASE = process.env.EBAY_ENV === "production" 
    ? "https://apiz.ebay.com"
    : "https://apiz.sandbox.ebay.com";
  const url = `${EBAY_APIZ_BASE}/commerce/identity/v1/user/`;
  
  console.log("[eBay] Fetching user account information...");
  
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Language": "en-US",
    },
  });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`Get user account failed: ${response.status} - ${JSON.stringify(errorData)}`);
  }
  
  return response.json();
}
