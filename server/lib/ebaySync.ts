import { getAccessToken } from './ebay';

const EBAY_API_BASE = process.env.EBAY_ENV === "production" 
  ? "https://api.ebay.com"
  : "https://api.sandbox.ebay.com";

const MARKETPLACE_ID = "EBAY_US";

interface EbayOffer {
  offerId: string;
  sku: string;
  marketplaceId: string;
  format: string;
  listingDescription?: string;
  listingPolicies?: {
    fulfillmentPolicyId?: string;
    returnPolicyId?: string;
    paymentPolicyId?: string;
  };
  pricingSummary?: {
    price?: {
      value: string;
      currency: string;
    };
  };
  quantityLimitPerBuyer?: number;
  categoryId?: string;
  status?: string;
  listingId?: string;
}

interface EbayInventoryItem {
  sku: string;
  product?: {
    title?: string;
    description?: string;
    aspects?: Record<string, string[]>;
    imageUrls?: string[];
  };
  condition?: string;
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
  availability?: {
    shipToLocationAvailability?: {
      quantity?: number;
    };
  };
}

interface EbayOrder {
  orderId: string;
  creationDate: string;
  orderFulfillmentStatus: string;
  orderPaymentStatus: string;
  pricingSummary: {
    total: {
      value: string;
      currency: string;
    };
    priceSubtotal?: {
      value: string;
      currency: string;
    };
    deliveryCost?: {
      value: string;
      currency: string;
    };
  };
  buyer: {
    username: string;
  };
  lineItems: Array<{
    lineItemId: string;
    sku: string;
    title: string;
    quantity: number;
    soldDate?: string;
    total: {
      value: string;
      currency: string;
    };
  }>;
  fulfillmentStartInstructions?: Array<{
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
      };
    };
  }>;
}

async function makeEbayRequest<T>(
  endpoint: string,
  options: {
    method?: string;
    body?: any;
    isPublicApi?: boolean;
    retryCount?: number;
  } = {}
): Promise<T> {
  const maxRetries = 3;
  const retryCount = options.retryCount || 0;

  const token = await getAccessToken();
  const url = `${EBAY_API_BASE}${endpoint}`;

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Content-Language': 'en-US',
    'Accept-Language': 'en-US',
  };

  if (!options.isPublicApi) {
    headers['X-EBAY-C-MARKETPLACE-ID'] = MARKETPLACE_ID;
  }

  const fetchOptions: RequestInit = {
    method: options.method || 'GET',
    headers,
  };

  if (options.body) {
    fetchOptions.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, fetchOptions);
  const responseText = await response.text();

  if (!response.ok) {
    if (response.status === 429 && retryCount < maxRetries) {
      const retryAfter = response.headers.get('Retry-After');
      const delaySeconds = retryAfter ? parseInt(retryAfter) : Math.pow(2, retryCount);
      
      console.log(`[eBaySync] Rate limited. Retrying after ${delaySeconds}s (attempt ${retryCount + 1}/${maxRetries})`);
      
      await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
      return makeEbayRequest<T>(endpoint, { ...options, retryCount: retryCount + 1 });
    }
    
    throw new Error(`eBay API error: ${response.status} ${responseText}`);
  }

  return responseText ? JSON.parse(responseText) : null;
}

export async function* fetchAllOffers(): AsyncGenerator<EbayOffer[]> {
  let offset = 0;
  const limit = 200;
  let hasMore = true;

  while (hasMore) {
    const endpoint = `/sell/inventory/v1/offer?marketplaceId=${MARKETPLACE_ID}&limit=${limit}&offset=${offset}`;
    
    try {
      const response = await makeEbayRequest<{ offers: EbayOffer[]; total: number }>(endpoint);
      
      if (response.offers && response.offers.length > 0) {
        yield response.offers;
        offset += response.offers.length;
        hasMore = response.offers.length === limit;
      } else {
        hasMore = false;
      }
    } catch (error) {
      console.error('[eBaySync] Error fetching offers:', error);
      throw error;
    }
  }
}

export async function fetchInventoryItem(sku: string): Promise<EbayInventoryItem> {
  const endpoint = `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`;
  return makeEbayRequest<EbayInventoryItem>(endpoint);
}

export async function* fetchAllOrders(since?: Date): AsyncGenerator<EbayOrder[]> {
  let offset = 0;
  const limit = 200;
  let hasMore = true;

  const sinceDate = since || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // Default: last 90 days
  const sinceIso = sinceDate.toISOString();

  while (hasMore) {
    const filter = `creationdate:%5B${sinceIso}..%5D`;
    const endpoint = `/sell/fulfillment/v1/order?filter=${filter}&limit=${limit}&offset=${offset}`;

    try {
      const response = await makeEbayRequest<{ orders: EbayOrder[]; total: number }>(endpoint);
      
      if (response.orders && response.orders.length > 0) {
        yield response.orders;
        offset += response.orders.length;
        hasMore = response.orders.length === limit;
      } else {
        hasMore = false;
      }
    } catch (error) {
      console.error('[eBaySync] Error fetching orders:', error);
      throw error;
    }
  }
}

export interface DriftDetectionResult {
  hasDrift: boolean;
  driftFields: Record<string, { local: any; ebay: any }>;
}

export function detectDrift(
  localListing: {
    title?: string;
    priceCents?: number;
    categoryId?: string;
    fulfillmentPolicyId?: string | null;
    returnPolicyId?: string | null;
    paymentPolicyId?: string | null;
    quantity?: number;
    weightOz?: number | null;
    dimsInL?: number | null;
    dimsInW?: number | null;
    dimsInH?: number | null;
    imageUrls?: string[];
  },
  ebayOffer: EbayOffer,
  ebayInventoryItem: EbayInventoryItem
): DriftDetectionResult {
  const driftFields: Record<string, { local: any; ebay: any }> = {};

  const ebayTitle = ebayInventoryItem.product?.title;
  if (localListing.title && ebayTitle && localListing.title !== ebayTitle) {
    driftFields.title = { local: localListing.title, ebay: ebayTitle };
  }

  const ebayPriceCents = ebayOffer.pricingSummary?.price?.value 
    ? Math.round(parseFloat(ebayOffer.pricingSummary.price.value) * 100)
    : null;
  if (localListing.priceCents && ebayPriceCents && localListing.priceCents !== ebayPriceCents) {
    driftFields.price = { 
      local: localListing.priceCents, 
      ebay: ebayPriceCents 
    };
  }

  if (localListing.categoryId && ebayOffer.categoryId && localListing.categoryId !== ebayOffer.categoryId) {
    driftFields.categoryId = { local: localListing.categoryId, ebay: ebayOffer.categoryId };
  }

  const ebayFulfillmentPolicyId = ebayOffer.listingPolicies?.fulfillmentPolicyId || null;
  if (localListing.fulfillmentPolicyId !== ebayFulfillmentPolicyId) {
    driftFields.fulfillmentPolicyId = { 
      local: localListing.fulfillmentPolicyId, 
      ebay: ebayFulfillmentPolicyId 
    };
  }

  const ebayReturnPolicyId = ebayOffer.listingPolicies?.returnPolicyId || null;
  if (localListing.returnPolicyId !== ebayReturnPolicyId) {
    driftFields.returnPolicyId = { 
      local: localListing.returnPolicyId, 
      ebay: ebayReturnPolicyId 
    };
  }

  const ebayPaymentPolicyId = ebayOffer.listingPolicies?.paymentPolicyId || null;
  if (localListing.paymentPolicyId !== ebayPaymentPolicyId) {
    driftFields.paymentPolicyId = { 
      local: localListing.paymentPolicyId, 
      ebay: ebayPaymentPolicyId 
    };
  }

  const ebayQuantity = ebayInventoryItem.availability?.shipToLocationAvailability?.quantity ?? 0;
  const localQuantity = localListing.quantity ?? 1;
  if (localQuantity !== ebayQuantity) {
    driftFields.quantity = { local: localQuantity, ebay: ebayQuantity };
  }

  const ebayWeight = ebayInventoryItem.packageWeightAndSize?.weight;
  let ebayWeightOz: number | null = null;
  if (ebayWeight && ebayWeight.value !== undefined) {
    switch (ebayWeight.unit) {
      case 'OUNCE':
        ebayWeightOz = ebayWeight.value;
        break;
      case 'POUND':
        ebayWeightOz = ebayWeight.value * 16;
        break;
      case 'GRAM':
        ebayWeightOz = ebayWeight.value / 28.3495;
        break;
      case 'KILOGRAM':
        ebayWeightOz = ebayWeight.value * 35.274;
        break;
      default:
        ebayWeightOz = null;
    }
  }
  const localWeightOz = localListing.weightOz ?? null;
  
  if (ebayWeightOz !== null || localWeightOz !== null) {
    if (localWeightOz === null && ebayWeightOz !== null) {
      driftFields.weight = { local: null, ebay: ebayWeightOz };
    } else if (localWeightOz !== null && ebayWeightOz === null) {
      driftFields.weight = { local: localWeightOz, ebay: null };
    } else if (localWeightOz !== null && ebayWeightOz !== null && Math.abs(localWeightOz - ebayWeightOz) > 0.1) {
      driftFields.weight = { local: localWeightOz, ebay: ebayWeightOz };
    }
  }

  const ebayDims = ebayInventoryItem.packageWeightAndSize?.dimensions;
  let ebayLengthIn: number | null = null;
  let ebayWidthIn: number | null = null;
  let ebayHeightIn: number | null = null;

  if (ebayDims && ebayDims.unit) {
    const convertToInches = (value: number | undefined, unit: string): number | null => {
      if (value === undefined) return null;
      switch (unit) {
        case 'INCH':
          return value;
        case 'FOOT': // eBay uses singular 'FOOT'
        case 'FEET':
          return value * 12;
        case 'YARD':
          return value * 36;
        case 'CENTIMETER':
          return value / 2.54;
        case 'MILLIMETER':
          return value / 25.4;
        case 'METER':
          return value * 39.3701;
        default:
          return null;
      }
    };

    ebayLengthIn = convertToInches(ebayDims.length, ebayDims.unit);
    ebayWidthIn = convertToInches(ebayDims.width, ebayDims.unit);
    ebayHeightIn = convertToInches(ebayDims.height, ebayDims.unit);
  }

  const localDimsInL = localListing.dimsInL ?? null;
  const localDimsInW = localListing.dimsInW ?? null;
  const localDimsInH = localListing.dimsInH ?? null;

  if ((localDimsInL !== ebayLengthIn) && (localDimsInL !== null || ebayLengthIn !== null)) {
    driftFields.dimsInL = { local: localDimsInL, ebay: ebayLengthIn };
  }
  if ((localDimsInW !== ebayWidthIn) && (localDimsInW !== null || ebayWidthIn !== null)) {
    driftFields.dimsInW = { local: localDimsInW, ebay: ebayWidthIn };
  }
  if ((localDimsInH !== ebayHeightIn) && (localDimsInH !== null || ebayHeightIn !== null)) {
    driftFields.dimsInH = { local: localDimsInH, ebay: ebayHeightIn };
  }

  const ebayImageUrls = ebayInventoryItem.product?.imageUrls || [];
  const localImageUrls = localListing.imageUrls || [];
  const sortedLocal = [...localImageUrls].sort();
  const sortedEbay = [...ebayImageUrls].sort();
  if (JSON.stringify(sortedLocal) !== JSON.stringify(sortedEbay)) {
    driftFields.images = { local: localImageUrls, ebay: ebayImageUrls };
  }

  return {
    hasDrift: Object.keys(driftFields).length > 0,
    driftFields,
  };
}

export interface SyncAllResult {
  offersProcessed: number;
  offersSynced: number;
  offersWithDrift: number;
  errors: Array<{ sku: string; error: string }>;
}

export async function syncAll(
  storage: {
    getListingBySku: (sku: string) => Promise<any>;
    upsertListingFromEbay: (offer: EbayOffer, inventoryItem: EbayInventoryItem, drift: DriftDetectionResult) => Promise<void>;
  }
): Promise<SyncAllResult> {
  const result: SyncAllResult = {
    offersProcessed: 0,
    offersSynced: 0,
    offersWithDrift: 0,
    errors: [],
  };

  try {
    for await (const offerBatch of fetchAllOffers()) {
      for (const offer of offerBatch) {
        result.offersProcessed++;

        try {
          const inventoryItem = await fetchInventoryItem(offer.sku);
          const localListing = await storage.getListingBySku(offer.sku);

          let drift: DriftDetectionResult = { hasDrift: false, driftFields: {} };
          
          if (localListing) {
            drift = detectDrift(localListing, offer, inventoryItem);
            if (drift.hasDrift) {
              result.offersWithDrift++;
            }
          }

          await storage.upsertListingFromEbay(offer, inventoryItem, drift);
          result.offersSynced++;
        } catch (error) {
          result.errors.push({
            sku: offer.sku,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  } catch (error) {
    console.error('[eBaySync] Fatal error during syncAll:', error);
    throw error;
  }

  return result;
}
