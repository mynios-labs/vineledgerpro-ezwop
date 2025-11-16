import { getAccessToken, getPublicAccessToken } from './ebay';

const EBAY_API_BASE = process.env.EBAY_ENV === "production" 
  ? "https://api.ebay.com"
  : "https://api.sandbox.ebay.com";

const EBAY_APIZ_BASE = process.env.EBAY_ENV === "production"
  ? "https://apiz.ebay.com"
  : "https://apiz.sandbox.ebay.com";

const MARKETPLACE_ID = "EBAY_US";

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface EbayOffer {
  offerId: string;
  sku: string;
  status: 'PUBLISHED' | 'UNPUBLISHED' | 'ENDED';
  marketplaceId: string;
  format: string;
  availableQuantity?: number;
  pricingSummary?: {
    price?: {
      value: string;
      currency: string;
    };
  };
  listingPolicies?: {
    fulfillmentPolicyId?: string;
    returnPolicyId?: string;
    paymentPolicyId?: string;
  };
  listing?: {
    listingId?: string;
    title?: string;
  };
}

export interface EbayInventoryItem {
  sku: string;
  product?: {
    title?: string;
    description?: string;
    aspects?: Record<string, string[]>;
    imageUrls?: string[];
  };
  condition?: string;
  availability?: {
    shipToLocationAvailability?: {
      quantity?: number;
    };
  };
  packageWeightAndSize?: {
    dimensions?: {
      height?: number;
      length?: number;
      width?: number;
      unit?: string;
    };
    weight?: {
      value?: number;
      unit?: string;
    };
  };
}

export interface EbayOrder {
  orderId: string;
  creationDate: string;
  orderFulfillmentStatus: string;
  orderPaymentStatus: string;
  pricingSummary: {
    total: { value: string; currency: string; };
    deliveryCost?: { value: string; currency: string; };
    tax?: { value: string; currency: string; };
  };
  buyer: { 
    username: string;
    buyerRegistrationAddress?: {
      fullName?: string;
      contactAddress?: {
        addressLine1?: string;
        addressLine2?: string;
        city?: string;
        stateOrProvince?: string;
        postalCode?: string;
        countryCode?: string;
      };
    };
  };
  lineItems: Array<{
    lineItemId?: string;
    legacyItemId?: string;
    sku: string;
    title: string;
    quantity: number;
  }>;
  paidTime?: string;
  fulfillmentStartInstructions?: Array<{
    ebaySupportedFulfillment?: boolean;
    shippingStep?: {
      shipTo?: {
        fullName?: string;
        contactAddress?: {
          addressLine1?: string;
          addressLine2?: string;
          city?: string;
          stateOrProvince?: string;
          postalCode?: string;
          countryCode?: string;
        };
        primaryPhone?: {
          phoneNumber?: string;
        };
      };
    };
  }>;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: any;
  headers?: Record<string, string>;
  requiresMarketplace?: boolean;
  usePublicToken?: boolean;
}

// ============================================================================
// Main EbayClient Class
// ============================================================================

export class EbayClient {
  private token: string | null = null;

  /**
   * Core HTTP request handler - ALL eBay API calls go through here
   */
  private async request<T>(
    endpoint: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const {
      method = 'GET',
      body,
      headers: customHeaders = {},
      requiresMarketplace = true,
      usePublicToken = false,
    } = options;

    // Get appropriate token (public for Taxonomy/Commerce, user for Inventory/Sell APIs)
    let token: string;
    if (usePublicToken) {
      token = await getPublicAccessToken();
    } else {
      if (!this.token) {
        this.token = await getAccessToken();
      }
      token = this.token;
    }

    const url = endpoint.startsWith('http') 
      ? endpoint 
      : `${EBAY_API_BASE}${endpoint}`;

    // Build headers - CENTRALIZED HEADER LOGIC
    // Use Headers object and set proper locale headers
    const headersObj = new Headers();
    headersObj.set('Authorization', `Bearer ${token}`);
    headersObj.set('Content-Type', 'application/json');
    headersObj.set('Accept', 'application/json');
    
    // Set proper locale headers - eBay requires valid BCP47 locale, not empty strings
    headersObj.set('Accept-Language', 'en-US');
    headersObj.set('Content-Language', 'en-US');

    // Add marketplace header for endpoints that need it
    if (requiresMarketplace && !endpoint.includes('/identity/') && !endpoint.includes('/commerce/')) {
      headersObj.set('X-EBAY-C-MARKETPLACE-ID', MARKETPLACE_ID);
    }

    // Add custom headers if provided
    for (const [key, value] of Object.entries(customHeaders)) {
      headersObj.set(key, value);
    }

    const fetchOptions: RequestInit = {
      method,
      headers: headersObj,
      body: body ? JSON.stringify(body) : undefined,
    };

    console.log(`[EbayClient] ${method} ${endpoint}`);

    try {
      const response = await fetch(url, fetchOptions);
      const responseText = await response.text();

      if (!response.ok) {
        // Handle rate limiting with retry
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const delay = retryAfter ? parseInt(retryAfter) * 1000 : 2000;
          console.log(`[EbayClient] Rate limited, retrying after ${delay}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
          return this.request<T>(endpoint, options); // Retry once
        }

        // Parse error response
        let errorData;
        try {
          errorData = JSON.parse(responseText);
        } catch {
          errorData = { message: responseText };
        }

        throw new Error(
          `eBay API error ${response.status}: ${JSON.stringify(errorData)}`
        );
      }

      return responseText ? JSON.parse(responseText) : null;
    } catch (error) {
      console.error(`[EbayClient] Request failed:`, error);
      throw error;
    }
  }

  /**
   * Paginated request handler - for endpoints that return lists
   */
  private async *requestPaginated<T>(
    endpoint: string,
    itemsKey: string,
    limit: number = 200
  ): AsyncGenerator<T[]> {
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const separator = endpoint.includes('?') ? '&' : '?';
      const url = `${endpoint}${separator}limit=${limit}&offset=${offset}`;
      
      const response: any = await this.request(url);
      const items = response[itemsKey] || [];

      if (items.length > 0) {
        yield items;
        offset += items.length;
        hasMore = items.length === limit;
      } else {
        hasMore = false;
      }
    }
  }

  // ============================================================================
  // INVENTORY API - Manage inventory items and offers
  // ============================================================================

  /**
   * Get or create an inventory item by SKU
   */
  async getInventoryItem(sku: string): Promise<EbayInventoryItem> {
    return this.request<EbayInventoryItem>(
      `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`
    );
  }

  /**
   * Create or update an inventory item
   */
  async upsertInventoryItem(sku: string, item: any): Promise<void> {
    await this.request<void>(
      `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
      { method: 'PUT', body: item }
    );
    console.log(`[EbayClient] Inventory item upserted: ${sku}`);
  }

  /**
   * Get all offers (paginated)
   * NOTE: This can fail if account has any listings with invalid SKUs
   */
  async *getAllOffers(): AsyncGenerator<EbayOffer[]> {
    yield* this.requestPaginated<EbayOffer>(
      `/sell/inventory/v1/offer?marketplace_id=${MARKETPLACE_ID}`,
      'offers'
    );
  }

  /**
   * Get active listings using Trading API (more robust than Inventory API)
   * Falls back gracefully when Inventory API fails due to invalid SKUs
   */
  async getActiveListingsViaTrading(): Promise<Array<{
    itemId: string;
    title: string;
    sku?: string;
    quantity: number;
    price: number;
  }>> {
    const XMLParser = (await import('fast-xml-parser')).XMLParser;
    const token = await getAccessToken();
    
    const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${token}</eBayAuthToken>
  </RequesterCredentials>
  <ActiveList>
    <Include>true</Include>
    <Pagination>
      <EntriesPerPage>200</EntriesPerPage>
      <PageNumber>1</PageNumber>
    </Pagination>
  </ActiveList>
  <DetailLevel>ReturnAll</DetailLevel>
</GetMyeBaySellingRequest>`;

    const response = await fetch(`${EBAY_API_BASE}/ws/api.dll`, {
      method: 'POST',
      headers: {
        'X-EBAY-API-SITEID': '0',
        'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
        'X-EBAY-API-CALL-NAME': 'GetMyeBaySelling',
        'Content-Type': 'text/xml',
      },
      body: xmlBody,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Trading API failed: ${response.status} - ${text}`);
    }

    const xmlText = await response.text();
    const parser = new XMLParser({
      ignoreAttributes: false,
      parseAttributeValue: true,
    });
    const result = parser.parse(xmlText);

    const items = result?.GetMyeBaySellingResponse?.ActiveList?.ItemArray?.Item || [];
    const itemArray = Array.isArray(items) ? items : [items];

    return itemArray
      .filter((item: any) => item?.ItemID)
      .map((item: any) => ({
        itemId: String(item.ItemID),  // Convert to string to match database type
        title: item.Title || '',
        sku: item.SKU || null,
        quantity: parseInt(item.QuantityAvailable || item.Quantity || '0', 10),
        price: parseFloat(item.SellingStatus?.CurrentPrice?.['#text'] || item.BuyItNowPrice?.['#text'] || '0'),
      }));
  }

  /**
   * Get offers for a specific SKU
   */
  async getOffersBySku(sku: string): Promise<{ offers: EbayOffer[] }> {
    return this.request<{ offers: EbayOffer[] }>(
      `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&marketplace_id=${MARKETPLACE_ID}`
    );
  }

  /**
   * Get a single offer by ID
   */
  async getOffer(offerId: string): Promise<EbayOffer> {
    return this.request<EbayOffer>(
      `/sell/inventory/v1/offer/${offerId}`
    );
  }

  /**
   * Create a new offer
   */
  async createOffer(offer: any): Promise<{ offerId: string }> {
    console.log(`[EbayClient] Creating offer for SKU: ${offer.sku}`);
    const result = await this.request<{ offerId: string }>(
      '/sell/inventory/v1/offer',
      { method: 'POST', body: offer }
    );

    if (!result.offerId) {
      throw new Error('eBay create offer failed: No offerId in response');
    }

    console.log(`[EbayClient] Offer created: ${result.offerId}`);
    return result;
  }

  /**
   * Update an existing offer
   */
  async updateOffer(offerId: string, offer: any): Promise<void> {
    await this.request<void>(
      `/sell/inventory/v1/offer/${offerId}`,
      { method: 'PUT', body: offer }
    );
    console.log(`[EbayClient] Offer updated: ${offerId}`);
  }

  /**
   * Publish an offer to create a listing
   */
  async publishOffer(offerId: string): Promise<{ listingId: string }> {
    console.log(`[EbayClient] Publishing offer: ${offerId}`);
    const result = await this.request<{ listingId: string }>(
      `/sell/inventory/v1/offer/${offerId}/publish`,
      { method: 'POST' }
    );

    if (!result.listingId) {
      throw new Error('eBay publish offer failed: No listingId in response');
    }

    console.log(`[EbayClient] Offer published. Listing ID: ${result.listingId}`);
    return result;
  }

  /**
   * Withdraw (end) an offer
   */
  async withdrawOffer(offerId: string): Promise<void> {
    await this.request<void>(
      `/sell/inventory/v1/offer/${offerId}/withdraw`,
      { method: 'POST' }
    );
    console.log(`[EbayClient] Offer withdrawn: ${offerId}`);
  }

  // ============================================================================
  // FULFILLMENT API - Manage orders and shipping
  // ============================================================================

  /**
   * Get all orders (paginated async generator)
   */
  async *getAllOrders(since?: Date): AsyncGenerator<EbayOrder[]> {
    const sinceDate = since || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const filter = `creationdate:[${sinceDate.toISOString()}..]`;
    
    yield* this.requestPaginated<EbayOrder>(
      `/sell/fulfillment/v1/order?filter=${encodeURIComponent(filter)}`,
      'orders'
    );
  }

  /**
   * Get a single order by ID
   */
  async getOrder(orderId: string): Promise<EbayOrder> {
    return this.request<EbayOrder>(
      `/sell/fulfillment/v1/order/${orderId}`
    );
  }

  /**
   * Create shipping fulfillment
   */
  async createShippingFulfillment(params: {
    orderId: string;
    lineItems: Array<{ lineItemId: string; quantity: number }>;
    trackingNumber: string;
    shippingCarrierCode: string;
  }): Promise<{ fulfillmentId: string }> {
    const body = {
      lineItems: params.lineItems,
      trackingNumber: params.trackingNumber,
      shippingCarrierCode: params.shippingCarrierCode,
      shippedTime: new Date().toISOString(),
    };

    const response = await this.request<any>(
      `/sell/fulfillment/v1/order/${params.orderId}/shipping_fulfillment`,
      { method: 'POST', body }
    );

    return { fulfillmentId: response.fulfillmentId };
  }

  // ============================================================================
  // ACCOUNT API - Business policies and settings
  // ============================================================================

  /**
   * Get fulfillment policies
   */
  async getFulfillmentPolicies(marketplaceId: string = MARKETPLACE_ID): Promise<any> {
    return this.request(
      `/sell/account/v1/fulfillment_policy?marketplace_id=${marketplaceId}`
    );
  }

  /**
   * Get payment policies
   */
  async getPaymentPolicies(marketplaceId: string = MARKETPLACE_ID): Promise<any> {
    return this.request(
      `/sell/account/v1/payment_policy?marketplace_id=${marketplaceId}`
    );
  }

  /**
   * Get return policies
   */
  async getReturnPolicies(marketplaceId: string = MARKETPLACE_ID): Promise<any> {
    return this.request(
      `/sell/account/v1/return_policy?marketplace_id=${marketplaceId}`
    );
  }

  /**
   * Get or create merchant location
   */
  async getOrCreateMerchantLocation(): Promise<string> {
    const locationKey = "DEFAULT_LOCATION";

    try {
      await this.request(
        `/sell/inventory/v1/location/${locationKey}`
      );
      console.log(`[EbayClient] Using existing merchant location: ${locationKey}`);
      return locationKey;
    } catch (error) {
      // Location doesn't exist, create it
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

      await this.request(
        `/sell/inventory/v1/location/${locationKey}`,
        { method: 'POST', body: locationData }
      );

      console.log(`[EbayClient] Merchant location created: ${locationKey}`);
      return locationKey;
    }
  }

  // ============================================================================
  // COMMERCE/TAXONOMY API - Categories and product data
  // ============================================================================

  /**
   * Get suggested categories for keywords
   * Uses public API token (client credentials) for Taxonomy API
   */
  async getSuggestedCategories(keywords: string): Promise<any> {
    return this.request(
      `/commerce/taxonomy/v1/category_tree/0/get_category_suggestions?q=${encodeURIComponent(keywords)}`,
      { requiresMarketplace: false, usePublicToken: true }
    );
  }

  /**
   * Get category details
   * Uses public API token (client credentials) for Taxonomy API
   */
  async getCategoryDetails(categoryId: string): Promise<any> {
    return this.request(
      `/commerce/taxonomy/v1/category_tree/0/get_category_subtree?category_id=${categoryId}`,
      { requiresMarketplace: false, usePublicToken: true }
    );
  }

  /**
   * Check if category is a leaf category (can list items in it)
   */
  async isLeafCategory(categoryId: string): Promise<boolean> {
    try {
      const details = await this.getCategoryDetails(categoryId);
      const subtree = details.categorySubtreeNode;
      if (!subtree) return false;
      
      const isLeaf = !subtree.childCategoryTreeNodes || subtree.childCategoryTreeNodes.length === 0;
      console.log(`[EbayClient] Category ${categoryId} is ${isLeaf ? 'LEAF' : 'NON-LEAF'}`);
      return isLeaf;
    } catch (error) {
      console.error(`[EbayClient] Failed to check category ${categoryId}:`, error);
      return false;
    }
  }

  // ============================================================================
  // IDENTITY API - User account info
  // ============================================================================

  /**
   * Get user account information
   */
  async getUserAccountInfo(): Promise<any> {
    return this.request(
      `${EBAY_APIZ_BASE}/commerce/identity/v1/user/`,
      { requiresMarketplace: false }
    );
  }
}

// ============================================================================
// Export singleton instance
// ============================================================================

export const ebayClient = new EbayClient();
