import { db } from "../db";
import { orders, orderTimelineEvents, config } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { purchaseLabel } from "../lib/shippo";
import { ebayClient } from "../lib/EbayClient";
import { z } from "zod";

// Zod schemas for eBay order validation (shared with routes)
const ebayOrderLineItemSchema = z.object({
  lineItemId: z.string().min(1).optional(),
  quantity: z.number().int().positive(),
  legacyItemId: z.string().min(1).optional(),
}).refine(
  (data) => data.lineItemId || data.legacyItemId,
  { message: "Either lineItemId or legacyItemId must be provided" }
);

const ebayOrderSchema = z.object({
  orderId: z.string(),
  lineItems: z.array(ebayOrderLineItemSchema).min(1),
  buyer: z.object({
    username: z.string().optional(),
  }).optional(),
});

export class AutomationService {
  /**
   * Schedule auto-buy label after rates are quoted
   * Triggers asynchronously after response completes
   */
  static async scheduleAutoBuy(orderId: string, responseHandler: any) {
    responseHandler.on('finish', () => {
      setImmediate(async () => {
        try {
          // Check if auto-buy is enabled
          const autoBuyConfig = await db.query.config.findFirst({
            where: eq(config.configKey, "autoBuyLabels"),
          });

          if (!autoBuyConfig || autoBuyConfig.value !== true) {
            console.log("[Automation] Auto-buy disabled, skipping");
            return;
          }

          console.log("[Automation] Auto-buy enabled, purchasing label for order:", orderId);

          // Execute buy logic
          const result = await this.executeBuyLabel(orderId);

          if (result.success) {
            console.log("[Automation] Auto-buy successful:", result);
            
            // Schedule auto-confirm if enabled
            await this.scheduleAutoConfirmImmediate(orderId);
          } else {
            console.error("[Automation] Auto-buy failed:", result.error);
            
            // Write failure timeline event
            await db.insert(orderTimelineEvents).values({
              orderId,
              eventType: "exception" as any,
              note: `Auto-buy failed: ${result.error}`,
              metadata: { automation: true, error: result.error },
            });
          }
        } catch (error: any) {
          console.error("[Automation] Auto-buy exception:", error);
          
          // Write exception timeline event
          await db.insert(orderTimelineEvents).values({
            orderId,
            eventType: "exception" as any,
            note: `Auto-buy exception: ${error.message}`,
            metadata: { automation: true, exception: error.message },
          });
        }
      });
    });
  }

  /**
   * Schedule auto-confirm shipped after label purchase
   * Triggers asynchronously after response completes
   */
  static async scheduleAutoConfirm(orderId: string, responseHandler: any) {
    responseHandler.on('finish', () => {
      setImmediate(async () => {
        await this.scheduleAutoConfirmImmediate(orderId);
      });
    });
  }

  /**
   * Execute auto-confirm immediately (used by auto-buy chain)
   */
  private static async scheduleAutoConfirmImmediate(orderId: string) {
    try {
      // Check if auto-confirm is enabled
      const autoConfirmConfig = await db.query.config.findFirst({
        where: eq(config.configKey, "autoMarkShipped"),
      });

      if (!autoConfirmConfig || autoConfirmConfig.value !== true) {
        console.log("[Automation] Auto-confirm disabled, skipping");
        return;
      }

      console.log("[Automation] Auto-confirm enabled, confirming shipment for order:", orderId);

      // Execute confirm shipped logic
      const result = await this.executeConfirmShipped(orderId);

      if (result.success) {
        console.log("[Automation] Auto-confirm successful:", result);
      } else {
        console.error("[Automation] Auto-confirm failed:", result.error);
        
        // Write failure timeline event
        await db.insert(orderTimelineEvents).values({
          orderId,
          eventType: "exception" as any,
          note: `Auto-confirm failed: ${result.error}`,
          metadata: { automation: true, error: result.error },
        });
      }
    } catch (error: any) {
      console.error("[Automation] Auto-confirm exception:", error);
      
      // Write exception timeline event
      await db.insert(orderTimelineEvents).values({
        orderId,
        eventType: "exception" as any,
        note: `Auto-confirm exception: ${error.message}`,
        metadata: { automation: true, exception: error.message },
      });
    }
  }

  /**
   * Execute buy label logic (extracted from endpoint)
   */
  private static async executeBuyLabel(orderId: string): Promise<{ success: boolean; error?: string; transactionId?: string }> {
    try {
      // Fetch order
      const order = await db.query.orders.findFirst({
        where: eq(orders.orderId, orderId),
      });

      if (!order) {
        return { success: false, error: "Order not found" };
      }

      // Validate order is in Paid status
      if (order.status !== "paid") {
        return { success: false, error: `Order must be in Paid status (current: ${order.status})` };
      }

      // Idempotency: Check if label already purchased
      if (order.shippoTransactionId && order.labelUrl) {
        console.log("[Automation] Label already purchased, skipping:", order.shippoTransactionId);
        return { success: true, transactionId: order.shippoTransactionId };
      }

      // Validate shippoRateId exists
      if (!order.shippoRateId) {
        return { success: false, error: "No rate selected. Call POST /api/orders/:id/rates first" };
      }

      // Purchase label from Shippo (OUTSIDE transaction)
      const transaction = await purchaseLabel(order.shippoRateId);

      if (!transaction || transaction.status !== "SUCCESS") {
        return { 
          success: false, 
          error: transaction?.messages ? JSON.stringify(transaction.messages) : "Label purchase failed" 
        };
      }

      // Extract normalized fields with strict validation
      const labelUrl = transaction.label_url || null;
      const trackingNumber = transaction.tracking_number || null;
      const transactionId = transaction.object_id;

      // Carrier and service extraction (normalize)
      const carrier = transaction.carrier_account
        ? (transaction.carrier_account.carrier || transaction.carrier_account)
        : (transaction.rate?.carrier || transaction.rate?.provider || null);

      const service = transaction.servicelevel
        ? (transaction.servicelevel.name || transaction.servicelevel_name || transaction.servicelevel.token)
        : (transaction.rate?.servicelevel_name || transaction.rate?.servicelevel?.name || null);

      // Cost extraction with validation
      let costCents = null;
      if (transaction.rate?.amount) {
        const amountFloat = parseFloat(transaction.rate.amount);
        if (!isNaN(amountFloat) && isFinite(amountFloat)) {
          costCents = Math.round(amountFloat * 100);
        }
      }

      const purchasedAt = new Date();

      // Atomic transaction: persist label data, update status, write timeline event
      await db.transaction(async (tx) => {
        await tx
          .update(orders)
          .set({
            shippingStatus: "label_purchased",
            labelId: transaction.label?.object_id || transactionId,
            labelUrl: labelUrl,
            shippoTransactionId: transactionId,
            trackingNumber,
            carrier: carrier,
            serviceLevel: service,
            trackingProvider: carrier,
            shippingCostCents: costCents,
            labelPurchasedAt: purchasedAt,
          })
          .where(and(
            eq(orders.orderId, orderId),
            eq(orders.ebayOrderId, order.ebayOrderId)
          ));

        await tx.insert(orderTimelineEvents).values({
          orderId,
          eventType: "label_purchased",
          note: `Label purchased via automation. Carrier: ${carrier}, Service: ${service}, Cost: $${costCents ? (costCents / 100).toFixed(2) : 'N/A'}`,
          metadata: {
            transactionId,
            trackingNumber,
            carrier,
            service,
            costCents,
            automation: true,
          },
        });
      });

      return { success: true, transactionId };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Execute confirm shipped logic (extracted from endpoint)
   */
  private static async executeConfirmShipped(orderId: string): Promise<{ success: boolean; error?: string; fulfillmentId?: string }> {
    try {
      // Fetch order
      const order = await db.query.orders.findFirst({
        where: eq(orders.orderId, orderId),
      });

      if (!order) {
        return { success: false, error: "Order not found" };
      }

      // Validate order has tracking and is in label_purchased status
      if (!order.trackingNumber) {
        return { success: false, error: "Order missing tracking number" };
      }

      if (order.shippingStatus === "shipped") {
        console.log("[Automation] Order already shipped, skipping");
        return { success: true };
      }

      if (order.shippingStatus !== "label_purchased") {
        return { success: false, error: `Invalid status for shipping: ${order.shippingStatus}` };
      }

      // Map Shippo carrier to eBay carrier code
      const carrierMapping: Record<string, string> = {
        "usps": "USPS",
        "ups": "UPS",
        "fedex": "FedEx",
        "dhl": "DHL",
      };

      const shippoCarrierLower = (order.carrier || "").toLowerCase();
      const ebayCarrierCode = carrierMapping[shippoCarrierLower] || "OTHER";

      // Prepare line items - use cached or fetch fresh
      let validatedOrder: any = null;
      let lineItems: Array<{ lineItemId: string; quantity: number }> = [];
      let shouldCacheValidatedOrder = false;

      // Try cached order first
      if (order.ebayOrderJson) {
        try {
          const cachedData = typeof order.ebayOrderJson === 'string' 
            ? JSON.parse(order.ebayOrderJson)
            : order.ebayOrderJson;
          
          const parseResult = ebayOrderSchema.safeParse(cachedData);
          if (parseResult.success) {
            validatedOrder = parseResult.data;
            lineItems = validatedOrder.lineItems
              .filter((item: any) => item.lineItemId || item.legacyItemId)
              .map((item: any) => ({
                lineItemId: item.lineItemId || item.legacyItemId!,
                quantity: item.quantity,
              }));
            
            if (lineItems.length === 0) {
              validatedOrder = null;
              lineItems = [];
            }
          }
        } catch (parseError) {
          console.log("[Automation] Cached JSON parse error, will fetch fresh");
        }
      }

      // Fetch fresh if needed
      if (lineItems.length === 0) {
        const ebay = await import("../lib/ebay");
        const freshOrder = await ebay.getOrder(order.ebayOrderId);

        const parseResult = ebayOrderSchema.safeParse(freshOrder);
        if (!parseResult.success) {
          return { success: false, error: "Invalid eBay order data" };
        }

        validatedOrder = parseResult.data;
        lineItems = validatedOrder.lineItems
          .filter((item: any) => item.lineItemId || item.legacyItemId)
          .map((item: any) => ({
            lineItemId: item.lineItemId || item.legacyItemId!,
            quantity: item.quantity,
          }));

        if (lineItems.length === 0) {
          return { success: false, error: "No identifiable line items in order" };
        }

        shouldCacheValidatedOrder = true;
      }

      const shippedAtTime = new Date();

      // Post fulfillment to eBay (OUTSIDE transaction)
      const fulfillmentResult = await ebayClient.createShippingFulfillment({
        orderId: order.ebayOrderId,
        trackingNumber: order.trackingNumber!,
        shippingCarrierCode: ebayCarrierCode,
        lineItems,
        shippedTime: shippedAtTime.toISOString(),
      });

      if (!fulfillmentResult || !fulfillmentResult.fulfillmentId) {
        return { success: false, error: "eBay fulfillment failed" };
      }

      // Atomic transaction: update status, write timeline events, cache order
      await db.transaction(async (tx) => {
        await tx
          .update(orders)
          .set({
            shippingStatus: "shipped",
            shippedAt: shippedAtTime,
          })
          .where(and(
            eq(orders.orderId, orderId),
            eq(orders.ebayOrderId, order.ebayOrderId)
          ));

        await tx.insert(orderTimelineEvents).values({
          orderId,
          eventType: "tracking_posted",
          note: `Tracking posted to eBay via automation: ${order.trackingNumber}`,
          metadata: {
            trackingNumber: order.trackingNumber,
            carrier: ebayCarrierCode,
            fulfillmentId: fulfillmentResult.fulfillmentId,
            automation: true,
          },
        });

        await tx.insert(orderTimelineEvents).values({
          orderId,
          eventType: "confirmed_shipped",
          note: `Order marked as shipped via automation`,
          metadata: {
            from: "label_purchased",
            to: "shipped",
            automation: true,
          },
        });

        if (shouldCacheValidatedOrder && validatedOrder) {
          await tx
            .update(orders)
            .set({ ebayOrderJson: validatedOrder })
            .where(and(
              eq(orders.orderId, orderId),
              eq(orders.ebayOrderId, order.ebayOrderId)
            ));
        }
      });

      return { success: true, fulfillmentId: fulfillmentResult.fulfillmentId };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}
