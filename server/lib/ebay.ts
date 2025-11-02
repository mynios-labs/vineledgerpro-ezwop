// eBay API client utilities
const EBAY_API_BASE = process.env.EBAY_ENV === "production" 
  ? "https://api.ebay.com"
  : "https://api.sandbox.ebay.com";

let accessToken: string | null = null;
let tokenExpiry: number = 0;

async function getAccessToken(): Promise<string> {
  if (accessToken && Date.now() < tokenExpiry) {
    return accessToken;
  }

  const credentials = Buffer.from(
    `${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`
  ).toString("base64");

  const response = await fetch(`${EBAY_API_BASE}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
    },
    body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope",
  });

  const data = await response.json();
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

export async function createOrUpdateInventoryItem(sku: string, item: any): Promise<any> {
  const token = await getAccessToken();

  const response = await fetch(
    `${EBAY_API_BASE}/sell/inventory/v1/inventory_item/${sku}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(item),
    }
  );

  return response.ok ? null : response.json();
}

export async function createOffer(offer: any): Promise<any> {
  const token = await getAccessToken();

  const response = await fetch(`${EBAY_API_BASE}/sell/inventory/v1/offer`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(offer),
  });

  return response.json();
}

export async function publishOffer(offerId: string): Promise<any> {
  const token = await getAccessToken();

  const response = await fetch(
    `${EBAY_API_BASE}/sell/inventory/v1/offer/${offerId}/publish`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  return response.json();
}

export async function uploadPictureToEbay(imageUrl: string): Promise<string> {
  // In production, you would upload to eBay Picture Services
  // For now, return the URL as-is
  return imageUrl;
}
