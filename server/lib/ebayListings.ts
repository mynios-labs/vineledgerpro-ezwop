// server/lib/ebayListings.ts
import { XMLParser } from "fast-xml-parser";

type EbayAuth = { accessToken: string; marketplaceId: string };
type UnifiedListing = {
  source: "inventory.offer" | "listing.v1" | "trading";
  offerId?: string;
  sku?: string | null;
  itemId?: string | null;
  title?: string | null;
  price?: number | null;
  quantity?: number | null;
  status: "live" | "ended" | "draft";
  raw: any;
};

const EBAY = "https://api.ebay.com";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function fetchJSON(url: string, auth: EbayAuth, init: RequestInit = {}, retries = 4): Promise<any> {
  const headers = {
    "Authorization": `Bearer ${auth.accessToken}`,
    "Accept": "application/json",
    "Content-Type": "application/json",
    "X-EBAY-C-MARKETPLACE-ID": auth.marketplaceId,
    ...(init.headers || {})
  };
  const res = await fetch(url, { ...init, headers });
  if (res.status === 429 && retries > 0) {
    const ra = Number(res.headers.get("Retry-After") || "2");
    await sleep(Math.min(ra * 1000, 10000));
    return fetchJSON(url, auth, init, retries - 1);
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`eBay ${res.status} ${res.statusText}: ${txt.slice(0, 500)}`);
  }
  return res.json();
}

function qs(params: Record<string, any>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) u.set(k, String(v));
  return u.toString();
}

// 1) Inventory API offers
export async function fetchInventoryOffers(auth: EbayAuth): Promise<UnifiedListing[]> {
  const out: UnifiedListing[] = [];
  const limit = 200;
  let offset = 0;
  while (true) {
    const data = await fetchJSON(`${EBAY}/sell/inventory/v1/offer?${qs({ limit, offset })}`, auth);
    const offers = Array.isArray(data.offers) ? data.offers : [];
    for (const offer of offers) {
      const listing = offer.listing || {};
      const published = offer.status === "PUBLISHED";
      const ended = offer.status === "ENDED";
      out.push({
        source: "inventory.offer",
        offerId: offer.offerId,
        sku: offer.sku ?? null,
        itemId: listing.listingId ?? null,
        title: listing.title ?? null,
        price: offer.pricingSummary?.price?.value ? Number(offer.pricingSummary.price.value) : null,
        quantity: typeof offer.availableQuantity === "number" ? offer.availableQuantity : null,
        status: published ? "live" : ended ? "ended" : "draft",
        raw: offer
      });
    }
    if (offers.length < limit) break;
    offset += limit;
  }
  return out;
}

// 2) Listings v1, optional
export async function fetchSellListingsV1(auth: EbayAuth): Promise<UnifiedListing[]> {
  const out: UnifiedListing[] = [];
  const limit = 200;
  let offset = 0;
  while (true) {
    try {
      const data = await fetchJSON(`${EBAY}/sell/listing/v1/item?${qs({ limit, offset })}`, auth);
      const items = Array.isArray(data.items) ? data.items : [];
      for (const it of items) {
        const st = it.status === "ACTIVE" ? "live" : it.status === "ENDED" ? "ended" : "draft";
        out.push({
          source: "listing.v1",
          itemId: it.itemId ?? null,
          sku: it.sku ?? null,
          title: it.title ?? null,
          price: it.price?.value ? Number(it.price.value) : null,
          quantity: typeof it.availableQuantity === "number" ? it.availableQuantity : null,
          status: st,
          raw: it
        });
      }
      if (items.length < limit) break;
      offset += limit;
    } catch (e: any) {
      if (String(e.message || "").includes(" 404 ")) return [];
      throw e;
    }
  }
  return out;
}

// 3) Trading API fallback for legacy UI listings, with paging
export async function fetchTradingActive(auth: EbayAuth): Promise<UnifiedListing[]> {
  const out: UnifiedListing[] = [];
  const parser = new XMLParser({ ignoreAttributes: false });

  let page = 1;
  let totalPages = 1;

  do {
    const body = `<?xml version="1.0" encoding="utf-8"?>
    <GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
      <ActiveList>
        <Include>true</Include>
        <Pagination>
          <EntriesPerPage>200</EntriesPerPage>
          <PageNumber>${page}</PageNumber>
        </Pagination>
      </ActiveList>
      <OutputSelector>ActiveList</OutputSelector>
      <OutputSelector>PaginationResult</OutputSelector>
    </GetMyeBaySellingRequest>`;

    const res = await fetch("https://api.ebay.com/ws/api.dll", {
      method: "POST",
      headers: {
        "Content-Type": "text/xml",
        "X-EBAY-API-CALL-NAME": "GetMyeBaySelling",
        "X-EBAY-API-SITEID": "0",
        "X-EBAY-API-COMPATIBILITY-LEVEL": "1143",
        "X-EBAY-API-IAF-TOKEN": auth.accessToken
      },
      body
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      if (res.status === 403 || res.status === 404) return [];
      throw new Error(`Trading ${res.status} ${res.statusText}: ${txt.slice(0, 500)}`);
    }

    const xml = await res.text();
    const json = parser.parse(xml);
    const items = json?.GetMyeBaySellingResponse?.ActiveList?.ItemArray?.Item;
    const pr = json?.GetMyeBaySellingResponse?.PaginationResult;
    totalPages = Number(pr?.TotalNumberOfPages || 1);

    const arr = !items ? [] : Array.isArray(items) ? items : [items];
    for (const it of arr) {
      out.push({
        source: "trading",
        itemId: it?.ItemID ?? null,
        sku: it?.SKU ?? null,
        title: it?.Title ?? null,
        price: it?.BuyItNowPrice?._ ? Number(it.BuyItNowPrice._) : null,
        quantity: it?.QuantityAvailable ? Number(it.QuantityAvailable) : null,
        status: "live",
        raw: it
      });
    }

    page += 1;
  } while (page <= totalPages);

  return out;
}

function mergeListings(...groups: UnifiedListing[][]): UnifiedListing[] {
  const map = new Map<string, UnifiedListing>();
  for (const g of groups) {
    for (const x of g) {
      const key = x.itemId || x.sku || `${x.source}:${x.offerId}`;
      if (!key) continue;
      if (!map.has(key)) map.set(key, x);
    }
  }
  return [...map.values()];
}

export async function fetchAllEbayListings(auth: EbayAuth): Promise<UnifiedListing[]> {
  const [offers, sellV1, trading] = await Promise.all([
    fetchInventoryOffers(auth),
    fetchSellListingsV1(auth),
    fetchTradingActive(auth)
  ]);
  return mergeListings(offers, sellV1, trading);
}
