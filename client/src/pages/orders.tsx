import { useQuery } from "@tanstack/react-query";
import { Package, Truck, CheckCircle, Printer, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Order } from "@shared/schema";

export default function OrdersPage() {
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

  const getStatusColor = (status: string) => {
    switch (status) {
      case "delivered":
        return "default";
      case "shipped":
        return "secondary";
      case "paid":
        return "outline";
      default:
        return "outline";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "delivered":
        return <CheckCircle className="w-4 h-4" />;
      case "shipped":
        return <Truck className="w-4 h-4" />;
      default:
        return <Package className="w-4 h-4" />;
    }
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground" data-testid="text-page-title">Orders</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage your eBay orders and shipping</p>
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

        {/* Orders Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recent Orders</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-4">
                    <Skeleton className="h-12 w-12 rounded" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : orders && orders.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order ID</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead>Buyer</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Ship By</TableHead>
                      <TableHead>Tracking</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((order) => (
                      <TableRow key={order.orderId} data-testid={`row-order-${order.orderId}`}>
                        <TableCell className="font-mono text-sm" data-testid={`text-order-id-${order.orderId}`}>
                          {order.ebayOrderId.slice(-8)}
                        </TableCell>
                        <TableCell className="max-w-xs truncate" data-testid={`text-listing-title-${order.orderId}`}>
                          {order.listingTitle}
                        </TableCell>
                        <TableCell className="font-mono text-sm" data-testid={`text-buyer-${order.orderId}`}>
                          {order.buyerUsername}
                        </TableCell>
                        <TableCell className="font-semibold" data-testid={`text-amount-${order.orderId}`}>
                          ${(order.saleGrossCents / 100).toFixed(2)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={getStatusColor(order.status)} data-testid={`badge-status-${order.orderId}`}>
                            <span className="flex items-center gap-1">
                              {getStatusIcon(order.status)}
                              {order.status}
                            </span>
                          </Badge>
                        </TableCell>
                        <TableCell data-testid={`text-ship-by-${order.orderId}`}>
                          {order.shipBy ? new Date(order.shipBy).toLocaleDateString() : "-"}
                        </TableCell>
                        <TableCell>
                          {order.tracking ? (
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs" data-testid={`text-tracking-${order.orderId}`}>
                                {order.tracking.slice(0, 12)}...
                              </span>
                              <Button variant="ghost" size="icon" className="h-6 w-6" data-testid={`button-track-${order.orderId}`}>
                                <ExternalLink className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-sm">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="outline" size="sm" data-testid={`button-print-slip-${order.orderId}`}>
                            <Printer className="w-3 h-3 mr-1" />
                            Slip
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <Package className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No orders yet</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
