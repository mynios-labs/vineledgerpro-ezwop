// Shippo API client utilities
const SHIPPO_API_BASE = "https://api.goshippo.com";

export async function createShipment(params: {
  addressFrom: any;
  addressTo: any;
  parcels: any[];
}): Promise<any> {
  const response = await fetch(`${SHIPPO_API_BASE}/shipments/`, {
    method: "POST",
    headers: {
      Authorization: `ShippoToken ${process.env.SHIPPO_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });

  return response.json();
}

export async function purchaseLabel(rateId: string): Promise<any> {
  const response = await fetch(`${SHIPPO_API_BASE}/transactions/`, {
    method: "POST",
    headers: {
      Authorization: `ShippoToken ${process.env.SHIPPO_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      rate: rateId,
      label_file_type: "PDF",
      async: false,
    }),
  });

  return response.json();
}

export async function estimateShipping(params: {
  weightOz: number;
  length: number;
  width: number;
  height: number;
  zip: string;
}): Promise<{ min: number; max: number }> {
  // Simplified estimation - in production would call Shippo rates API
  const baseRate = Math.max(5.5, params.weightOz * 0.1);
  return {
    min: baseRate,
    max: baseRate * 2,
  };
}

export async function getTracking(carrier: string, trackingNumber: string): Promise<any> {
  const response = await fetch(`${SHIPPO_API_BASE}/tracks/${carrier}/${trackingNumber}`, {
    method: "GET",
    headers: {
      Authorization: `ShippoToken ${process.env.SHIPPO_API_KEY}`,
      "Content-Type": "application/json",
    },
  });

  return response.json();
}

export async function getTransaction(transactionId: string): Promise<any> {
  const response = await fetch(`${SHIPPO_API_BASE}/transactions/${transactionId}`, {
    method: "GET",
    headers: {
      Authorization: `ShippoToken ${process.env.SHIPPO_API_KEY}`,
      "Content-Type": "application/json",
    },
  });

  return response.json();
}

export async function requestRefund(transactionId: string): Promise<any> {
  const response = await fetch(`${SHIPPO_API_BASE}/refunds/`, {
    method: "POST",
    headers: {
      Authorization: `ShippoToken ${process.env.SHIPPO_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      transaction: transactionId,
    }),
  });

  return response.json();
}

export async function listAllTransactions(): Promise<any> {
  const response = await fetch(`${SHIPPO_API_BASE}/transactions?results=100`, {
    method: "GET",
    headers: {
      Authorization: `ShippoToken ${process.env.SHIPPO_API_KEY}`,
      "Content-Type": "application/json",
    },
  });

  return response.json();
}
