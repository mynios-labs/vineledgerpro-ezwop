// Helper functions for eBay offer management and idempotent publish flow

export interface OfferComparison {
  hasChanges: boolean;
  revisableChanges: string[];
  nonRevisableChanges: string[];
}

export function compareOffers(
  existingOffer: any,
  newData: {
    priceCents: number;
    categoryId: string;
    title: string;
    description: string;
    fulfillmentPolicyId: string;
    imageUrls: string[];
  }
): OfferComparison {
  const revisableChanges: string[] = [];
  const nonRevisableChanges: string[] = [];

  // Compare price (revisable)
  const existingPrice = parseFloat(existingOffer.pricingSummary?.price?.value || "0");
  const newPrice = newData.priceCents / 100;
  if (Math.abs(existingPrice - newPrice) > 0.01) {
    revisableChanges.push("price");
  }

  // Compare fulfillment policy (revisable)
  const existingFulfillmentPolicy = existingOffer.listingPolicies?.fulfillmentPolicyId;
  if (existingFulfillmentPolicy !== newData.fulfillmentPolicyId) {
    revisableChanges.push("fulfillmentPolicy");
  }

  // Compare category (non-revisable)
  const existingCategory = existingOffer.listing?.categoryId || existingOffer.categoryId;
  if (existingCategory !== newData.categoryId) {
    nonRevisableChanges.push("category");
  }

  // Compare title (non-revisable - requires inventory item update)
  const existingTitle = existingOffer.listing?.title;
  if (existingTitle && existingTitle !== newData.title) {
    nonRevisableChanges.push("title");
  }

  // Compare description (non-revisable - requires inventory item update)
  const existingDescription = existingOffer.listing?.description;
  if (existingDescription && existingDescription !== newData.description) {
    nonRevisableChanges.push("description");
  }

  // Compare images (non-revisable - requires inventory item update)
  const existingImages = existingOffer.listing?.imageUrls || [];
  const imagesChanged = 
    existingImages.length !== newData.imageUrls.length ||
    existingImages.some((url: string, i: number) => url !== newData.imageUrls[i]);
  if (imagesChanged) {
    nonRevisableChanges.push("images");
  }

  return {
    hasChanges: revisableChanges.length > 0 || nonRevisableChanges.length > 0,
    revisableChanges,
    nonRevisableChanges,
  };
}

export async function verifyOfferPublished(
  getOffer: (offerId: string) => Promise<any>,
  offerId: string,
  maxAttempts: number = 3,
  delayMs: number = 2000
): Promise<{ itemId: string | null; status: string }> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const offer = await getOffer(offerId);
    
    if (offer.listing?.listingId && offer.status === "PUBLISHED") {
      return {
        itemId: offer.listing.listingId,
        status: offer.status,
      };
    }

    if (attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  // Return last known state even if verification failed
  const finalOffer = await getOffer(offerId);
  return {
    itemId: finalOffer.listing?.listingId || null,
    status: finalOffer.status || "UNKNOWN",
  };
}
