import { useQuery, useMutation } from "@tanstack/react-query";
import { Package, Truck, CheckCircle, RefreshCw, Printer, Send, XCircle, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Order } from "@shared/schema";
import { useState } from "react";
import { TimelineDrawer } from "@/components/timeline-drawer";

export default function OrdersPage() {
  const { toast } = useToast();
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  const { data: orders, isLoading } = useQuery<(Order & {
    listingTitle: string;
    buyerUsername: string;
  })[]>({
    queryKey: ["/api/orders"],
  });

  const { data: stats } = useQuery<{
    pending: number;
    paid: number;
    shipped: number;
    delivered: number;
  }>({
    queryKey: ["/api/orders/stats"],
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/sync/ebay/orders", {
        method: "POST",
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Sync failed");
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders/stats"] });
      
      toast({
        title: "Sync complete",
        description: `${data.createdCount} new, ${data.updatedCount} updated${data.shippedDetectedCount > 0 ? `, ${data.shippedDetectedCount} drift detected` : ''}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Sync failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const getRatesMutation = useMutation({
    mutationFn: async (orderId: string) => {
      return await apiRequest("POST", `/api/orders/${orderId}/rates`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({
        title: "Rates quoted",
        description: "Shipping rates retrieved successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to get rates",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const buyLabelMutation = useMutation({
    mutationFn: async (orderId: string) => {
      return await apiRequest("POST", `/api/orders/${orderId}/buy`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({
        title: "Label purchased",
        description: "Shipping label purchased successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to buy label",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const confirmShippedMutation = useMutation({
    mutationFn: async (orderId: string) => {
      return await apiRequest("POST", `/api/orders/${orderId}/confirm-shipped`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({
        title: "Marked as shipped",
        description: "Tracking posted to eBay successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to confirm shipment",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const printLabelMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const response = await fetch(`/api/orders/${orderId}/label`);
      if (!response.ok) {
        throw new Error("Failed to get label");
      }
      const data = await response.json();
      window.open(data.labelUrl, '_blank');
      return data;
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to get label",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const voidLabelMutation = useMutation({
    mutationFn: async (orderId: string) => {
      return await apiRequest("POST", `/api/orders/${orderId}/void-label`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({
        title: "Label voided",
        description: "Label has been voided and refund requested",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to void label",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Filter orders by shipping status
  const unshippedOrders = orders?.filter(o => o.shippingStatus === 'unshipped') || [];
  const labelPurchasedOrders = orders?.filter(o => o.shippingStatus === 'label_purchased') || [];
  const shippedOrders = orders?.filter(o => o.shippingStatus === 'shipped') || [];

  const OrderCard = ({ order }: { order: Order & { listingTitle: string; buyerUsername: string } }) => {
    return (
      <Card className="hover-elevate" data-testid={`card-order-${order.orderId}`}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <CardTitle className="text-base font-semibold truncate" data-testid={`text-title-${order.orderId}`}>
                {order.listingTitle || order.title}
              </CardTitle>
              <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground">
                <span className="font-mono" data-testid={`text-order-id-${order.orderId}`}>
                  {order.ebayOrderId.slice(-8)}
                </span>
                <span data-testid={`text-buyer-${order.orderId}`}>
                  {order.buyerUsername}
                </span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-lg font-semibold" data-testid={`text-amount-${order.orderId}`}>
                ${(order.saleGrossCents / 100).toFixed(2)}
              </div>
              {order.shipBy && (
                <div className="text-xs text-muted-foreground mt-1" data-testid={`text-ship-by-${order.orderId}`}>
                  Ship by {new Date(order.shipBy).toLocaleDateString()}
                </div>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Status and info */}
          <div className="flex flex-wrap gap-2">
            {order.serviceLevel && (
              <Badge variant="outline" data-testid={`badge-service-${order.orderId}`}>
                <Truck className="w-3 h-3 mr-1" />
                {order.serviceLevel}
              </Badge>
            )}
            {order.trackingNumber && (
              <Badge variant="outline" data-testid={`badge-tracking-${order.orderId}`}>
                <Package className="w-3 h-3 mr-1" />
                {order.trackingNumber.slice(0, 12)}...
              </Badge>
            )}
            {order.shippingCostCents && (
              <Badge variant="outline" data-testid={`badge-cost-${order.orderId}`}>
                ${(order.shippingCostCents / 100).toFixed(2)}
              </Badge>
            )}
          </div>

          {/* Action buttons based on status */}
          <div className="flex gap-2 flex-wrap">
            {order.shippingStatus === 'unshipped' && (
              <>
                <Button
                  size="sm"
                  onClick={() => getRatesMutation.mutate(order.orderId)}
                  disabled={getRatesMutation.isPending}
                  data-testid={`button-get-rates-${order.orderId}`}
                >
                  <Clock className="w-3 h-3 mr-1" />
                  Get Rates
                </Button>
                {order.shippoRateId && (
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => buyLabelMutation.mutate(order.orderId)}
                    disabled={buyLabelMutation.isPending}
                    data-testid={`button-buy-label-${order.orderId}`}
                  >
                    <Package className="w-3 h-3 mr-1" />
                    Buy Label
                  </Button>
                )}
              </>
            )}

            {order.shippingStatus === 'label_purchased' && (
              <>
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => printLabelMutation.mutate(order.orderId)}
                  disabled={printLabelMutation.isPending}
                  data-testid={`button-print-label-${order.orderId}`}
                >
                  <Printer className="w-3 h-3 mr-1" />
                  Print Label
                </Button>
                <Button
                  size="sm"
                  onClick={() => confirmShippedMutation.mutate(order.orderId)}
                  disabled={confirmShippedMutation.isPending}
                  data-testid={`button-confirm-shipped-${order.orderId}`}
                >
                  <Send className="w-3 h-3 mr-1" />
                  Confirm Shipped
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => voidLabelMutation.mutate(order.orderId)}
                  disabled={voidLabelMutation.isPending}
                  data-testid={`button-void-label-${order.orderId}`}
                >
                  <XCircle className="w-3 h-3 mr-1" />
                  Void Label
                </Button>
              </>
            )}

            {order.shippingStatus === 'shipped' && order.trackingNumber && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => printLabelMutation.mutate(order.orderId)}
                disabled={printLabelMutation.isPending}
                data-testid={`button-reprint-label-${order.orderId}`}
              >
                <Printer className="w-3 h-3 mr-1" />
                Reprint Label
              </Button>
            )}

            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedOrderId(order.orderId)}
              data-testid={`button-timeline-${order.orderId}`}
            >
              Timeline
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  const EmptyState = ({ icon: Icon, message }: { icon: any; message: string }) => (
    <div className="text-center py-12 text-muted-foreground">
      <Icon className="w-12 h-12 mx-auto mb-4 opacity-50" />
      <p>{message}</p>
    </div>
  );

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground" data-testid="text-page-title">Orders</h1>
            <p className="text-sm text-muted-foreground mt-1">Manage your eBay orders and shipping</p>
          </div>
          <Button
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            data-testid="button-sync-orders"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
            {syncMutation.isPending ? "Syncing..." : "Sync now"}
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pending</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold" data-testid="text-pending-orders">
                {stats?.pending ?? 0}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Paid</CardTitle>
              <CheckCircle className="h-4 w-4 text-chart-1" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold text-chart-1" data-testid="text-paid-orders">
                {stats?.paid ?? 0}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Shipped</CardTitle>
              <Truck className="h-4 w-4 text-chart-2" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold text-chart-2" data-testid="text-shipped-orders">
                {stats?.shipped ?? 0}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Delivered</CardTitle>
              <CheckCircle className="h-4 w-4 text-chart-4" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold text-chart-4" data-testid="text-delivered-orders">
                {stats?.delivered ?? 0}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Orders Tabs */}
        <Tabs defaultValue="unshipped" className="space-y-4">
          <TabsList data-testid="tabs-shipping-status">
            <TabsTrigger value="unshipped" data-testid="tab-unshipped">
              <XCircle className="w-4 h-4 mr-2" />
              Unshipped ({unshippedOrders.length})
            </TabsTrigger>
            <TabsTrigger value="label_purchased" data-testid="tab-label-purchased">
              <Package className="w-4 h-4 mr-2" />
              Label Purchased ({labelPurchasedOrders.length})
            </TabsTrigger>
            <TabsTrigger value="shipped" data-testid="tab-shipped">
              <CheckCircle className="w-4 h-4 mr-2" />
              Shipped ({shippedOrders.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="unshipped" className="space-y-4">
            {isLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-40 w-full" />
                ))}
              </div>
            ) : unshippedOrders.length > 0 ? (
              <div className="grid gap-4">
                {unshippedOrders.map((order) => (
                  <OrderCard key={order.orderId} order={order} />
                ))}
              </div>
            ) : (
              <EmptyState icon={XCircle} message="No unshipped orders" />
            )}
          </TabsContent>

          <TabsContent value="label_purchased" className="space-y-4">
            {isLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-40 w-full" />
                ))}
              </div>
            ) : labelPurchasedOrders.length > 0 ? (
              <div className="grid gap-4">
                {labelPurchasedOrders.map((order) => (
                  <OrderCard key={order.orderId} order={order} />
                ))}
              </div>
            ) : (
              <EmptyState icon={Package} message="No orders with labels purchased" />
            )}
          </TabsContent>

          <TabsContent value="shipped" className="space-y-4">
            {isLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-40 w-full" />
                ))}
              </div>
            ) : shippedOrders.length > 0 ? (
              <div className="grid gap-4">
                {shippedOrders.map((order) => (
                  <OrderCard key={order.orderId} order={order} />
                ))}
              </div>
            ) : (
              <EmptyState icon={CheckCircle} message="No shipped orders" />
            )}
          </TabsContent>
        </Tabs>

        {/* Timeline Drawer */}
        <TimelineDrawer
          orderId={selectedOrderId}
          open={!!selectedOrderId}
          onOpenChange={(open: boolean) => !open && setSelectedOrderId(null)}
        />
      </div>
    </div>
  );
}
