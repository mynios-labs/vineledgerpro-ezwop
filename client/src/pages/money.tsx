import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { DollarSign, TrendingUp, TrendingDown, Download, FileText, AlertTriangle, Package, ArrowUpDown, RotateCcw, Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ItemFinancials {
  inventoryId: string;
  title: string;
  asin: string;
  status: string;
  receivedDate: string;
  publishedAt?: string;
  orderDate?: string;
  shippedAt?: string;
  orderStatus?: string;
  basisCents: number;
  listPriceCents: number;
  saleCents: number;
  feesCents: number;
  shippingCostsCents: number;
  netProfitCents: number;
  defective: boolean;
  defectiveNotes?: string;
  tracking?: string;
  carrier?: string;
  orderId?: string;
}

interface MoneyStats {
  totalSales: number;
  totalFees: number;
  totalShipping: number;
  totalPayout: number;
  realizedGain: number;
  realizedLoss: number;
  totalListings: number;
  activeListings: number;
  totalOrders: number;
  pendingShipments: number;
  defectiveItems: number;
}

type SortField = "receivedDate" | "publishedAt" | "orderDate" | "netProfitCents" | "saleCents";
type SortDirection = "asc" | "desc";

export default function MoneyPage() {
  const { toast } = useToast();
  const [sortField, setSortField] = useState<SortField>("receivedDate");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selectedTracking, setSelectedTracking] = useState<{ carrier: string; trackingNumber: string } | null>(null);

  const { data: stats, isLoading: statsLoading } = useQuery<MoneyStats>({
    queryKey: ["/api/accounting/stats"],
  });

  const { data: items, isLoading: itemsLoading } = useQuery<ItemFinancials[]>({
    queryKey: ["/api/accounting/items"],
  });

  const { data: trackingData, isLoading: trackingLoading } = useQuery({
    queryKey: [`/api/shippo/tracking/${selectedTracking?.carrier}/${selectedTracking?.trackingNumber}`],
    enabled: !!selectedTracking,
  });

  const returnToInventoryMutation = useMutation({
    mutationFn: async ({ inventoryId, reason }: { inventoryId: string; reason: string }) => {
      return apiRequest(`/api/inventory/${inventoryId}/return`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounting/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounting/stats"] });
      toast({ title: "Success", description: "Item returned to inventory" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleExportCSV = () => {
    window.open("/api/accounting/export/csv", "_blank");
  };

  const handleExportPDF = () => {
    window.open("/api/accounting/export/pdf", "_blank");
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const handleReturnToInventory = (inventoryId: string, title: string) => {
    const reason = prompt(`Return "${title}" to inventory. Reason (optional):`);
    if (reason !== null) {
      returnToInventoryMutation.mutate({ inventoryId, reason: reason || "Manual return" });
    }
  };

  const sortedItems = items ? [...items].sort((a, b) => {
    let aVal: any = a[sortField];
    let bVal: any = b[sortField];

    if (sortField === "receivedDate" || sortField === "publishedAt" || sortField === "orderDate") {
      aVal = aVal ? new Date(aVal).getTime() : 0;
      bVal = bVal ? new Date(bVal).getTime() : 0;
    }

    if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
    if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
    return 0;
  }) : [];

  const netProfitLoss = (stats?.realizedGain || 0) - (stats?.realizedLoss || 0);
  const isProfit = netProfitLoss >= 0;

  const getStatusBadge = (item: ItemFinancials) => {
    if (item.defective) {
      return <Badge variant="destructive" data-testid={`badge-status-${item.inventoryId}`}>Defective</Badge>;
    }
    if (item.orderStatus === "shipped" || item.orderStatus === "delivered") {
      return <Badge variant="default" data-testid={`badge-status-${item.inventoryId}`}>Completed</Badge>;
    }
    if (item.orderStatus === "paid") {
      return <Badge variant="secondary" data-testid={`badge-status-${item.inventoryId}`}>Pending Ship</Badge>;
    }
    if (item.orderStatus === "cancelled") {
      return <Badge variant="outline" data-testid={`badge-status-${item.inventoryId}`}>Cancelled</Badge>;
    }
    if (item.publishedAt) {
      return <Badge variant="outline" data-testid={`badge-status-${item.inventoryId}`}>Listed</Badge>;
    }
    return <Badge variant="secondary" data-testid={`badge-status-${item.inventoryId}`}>Available</Badge>;
  };

  const canReturnToInventory = (item: ItemFinancials) => {
    return item.orderStatus === "cancelled" || (item.publishedAt && !item.orderDate);
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground" data-testid="text-page-title">Money & Ledger</h1>
            <p className="text-sm text-muted-foreground mt-1">Track sales, expenses, and item lifecycle financials</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleExportCSV} data-testid="button-export-csv">
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
            <Button variant="outline" onClick={handleExportPDF} data-testid="button-export-pdf">
              <FileText className="w-4 h-4 mr-2" />
              Export PDF
            </Button>
          </div>
        </div>

        {/* Primary Financial Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Sales</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Skeleton className="h-9 w-24" />
              ) : (
                <div className="text-3xl font-semibold text-chart-1" data-testid="text-total-sales">
                  ${((stats?.totalSales || 0) / 100).toFixed(2)}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Fees</CardTitle>
              <TrendingDown className="h-4 w-4 text-chart-5" />
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Skeleton className="h-9 w-24" />
              ) : (
                <div className="text-3xl font-semibold text-chart-5" data-testid="text-total-fees">
                  ${((stats?.totalFees || 0) / 100).toFixed(2)}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Shipping Costs</CardTitle>
              <TrendingDown className="h-4 w-4 text-chart-3" />
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Skeleton className="h-9 w-24" />
              ) : (
                <div className="text-3xl font-semibold text-chart-3" data-testid="text-shipping-costs">
                  ${((stats?.totalShipping || 0) / 100).toFixed(2)}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Secondary Performance Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Payouts</CardTitle>
              <DollarSign className="h-4 w-4 text-chart-4" />
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Skeleton className="h-9 w-24" />
              ) : (
                <div className="text-3xl font-semibold text-chart-4" data-testid="text-total-payouts">
                  ${((stats?.totalPayout || 0) / 100).toFixed(2)}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Realized Gains</CardTitle>
              <TrendingUp className="h-4 w-4 text-chart-1" />
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Skeleton className="h-9 w-24" />
              ) : (
                <div className="text-3xl font-semibold text-chart-1" data-testid="text-realized-gains">
                  ${((stats?.realizedGain || 0) / 100).toFixed(2)}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Net Profit/Loss</CardTitle>
              {isProfit ? (
                <TrendingUp className="h-4 w-4 text-chart-1" />
              ) : (
                <TrendingDown className="h-4 w-4 text-chart-5" />
              )}
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Skeleton className="h-9 w-24" />
              ) : (
                <div className={`text-3xl font-semibold ${isProfit ? "text-chart-1" : "text-chart-5"}`} data-testid="text-net-profit-loss">
                  {isProfit ? "+" : ""}${(netProfitLoss / 100).toFixed(2)}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Business Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Listed</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Skeleton className="h-9 w-16" />
              ) : (
                <div className="text-3xl font-semibold" data-testid="text-total-listings">
                  {stats?.totalListings || 0}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active</CardTitle>
              <Package className="h-4 w-4 text-chart-1" />
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Skeleton className="h-9 w-16" />
              ) : (
                <div className="text-3xl font-semibold" data-testid="text-active-listings">
                  {stats?.activeListings || 0}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Sold</CardTitle>
              <DollarSign className="h-4 w-4 text-chart-1" />
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Skeleton className="h-9 w-16" />
              ) : (
                <div className="text-3xl font-semibold" data-testid="text-total-orders">
                  {stats?.totalOrders || 0}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pending Ship</CardTitle>
              <Package className="h-4 w-4 text-chart-3" />
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Skeleton className="h-9 w-16" />
              ) : (
                <div className="text-3xl font-semibold" data-testid="text-pending-shipments">
                  {stats?.pendingShipments || 0}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Defective</CardTitle>
              <AlertTriangle className="h-4 w-4 text-chart-5" />
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Skeleton className="h-9 w-16" />
              ) : (
                <div className="text-3xl font-semibold" data-testid="text-defective-items">
                  {stats?.defectiveItems || 0}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg Profit</CardTitle>
              <TrendingUp className="h-4 w-4 text-chart-1" />
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Skeleton className="h-9 w-16" />
              ) : (
                <div className="text-3xl font-semibold" data-testid="text-avg-profit">
                  ${stats?.totalOrders && stats.totalOrders > 0 ? (netProfitLoss / stats.totalOrders / 100).toFixed(0) : "0"}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Item-Centric Financial Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Item Lifecycle Financials</CardTitle>
          </CardHeader>
          <CardContent>
            {itemsLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : sortedItems && sortedItems.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-64">Title</TableHead>
                      <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort("receivedDate")}>
                        <div className="flex items-center gap-1">
                          Received
                          <ArrowUpDown className="w-3 h-3" />
                        </div>
                      </TableHead>
                      <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort("publishedAt")}>
                        <div className="flex items-center gap-1">
                          Listed
                          <ArrowUpDown className="w-3 h-3" />
                        </div>
                      </TableHead>
                      <TableHead className="cursor-pointer hover-elevate" onClick={() => handleSort("orderDate")}>
                        <div className="flex items-center gap-1">
                          Sold
                          <ArrowUpDown className="w-3 h-3" />
                        </div>
                      </TableHead>
                      <TableHead>Ship Date</TableHead>
                      <TableHead className="text-right cursor-pointer hover-elevate" onClick={() => handleSort("saleCents")}>
                        <div className="flex items-center justify-end gap-1">
                          Sale Price
                          <ArrowUpDown className="w-3 h-3" />
                        </div>
                      </TableHead>
                      <TableHead className="text-right">Fees</TableHead>
                      <TableHead className="text-right">Shipping</TableHead>
                      <TableHead className="text-right cursor-pointer hover-elevate" onClick={() => handleSort("netProfitCents")}>
                        <div className="flex items-center justify-end gap-1">
                          Net P/L
                          <ArrowUpDown className="w-3 h-3" />
                        </div>
                      </TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedItems.map((item) => (
                      <TableRow key={item.inventoryId} data-testid={`row-item-${item.inventoryId}`}>
                        <TableCell>
                          {getStatusBadge(item)}
                        </TableCell>
                        <TableCell className="w-64">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="flex flex-col gap-1 cursor-help">
                                  <span className="truncate font-medium" data-testid={`text-title-${item.inventoryId}`}>
                                    {item.title}
                                  </span>
                                  {item.defective && item.defectiveNotes && (
                                    <span className="text-xs text-muted-foreground truncate">
                                      {item.defectiveNotes}
                                    </span>
                                  )}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-md text-base p-4">
                                <p className="font-medium">{item.title}</p>
                                {item.defective && item.defectiveNotes && (
                                  <p className="text-sm text-muted-foreground mt-2">{item.defectiveNotes}</p>
                                )}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </TableCell>
                        <TableCell className="font-mono text-sm" data-testid={`text-received-${item.inventoryId}`}>
                          {new Date(item.receivedDate).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="font-mono text-sm" data-testid={`text-listed-${item.inventoryId}`}>
                          {item.publishedAt ? new Date(item.publishedAt).toLocaleDateString() : "-"}
                        </TableCell>
                        <TableCell className="font-mono text-sm" data-testid={`text-sold-${item.inventoryId}`}>
                          {item.orderDate ? new Date(item.orderDate).toLocaleDateString() : "-"}
                        </TableCell>
                        <TableCell className="font-mono text-sm" data-testid={`text-shipped-${item.inventoryId}`}>
                          {item.shippedAt ? new Date(item.shippedAt).toLocaleDateString() : "-"}
                        </TableCell>
                        <TableCell className="text-right font-mono" data-testid={`text-sale-${item.inventoryId}`}>
                          {item.saleCents > 0 ? `$${(item.saleCents / 100).toFixed(2)}` : "-"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-chart-5" data-testid={`text-fees-${item.inventoryId}`}>
                          {item.feesCents > 0 ? `-$${(item.feesCents / 100).toFixed(2)}` : "-"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-chart-5" data-testid={`text-shipping-${item.inventoryId}`}>
                          {item.shippingCostsCents > 0 && item.tracking && item.carrier ? (
                            <button
                              onClick={() => setSelectedTracking({ carrier: item.carrier!, trackingNumber: item.tracking! })}
                              className="hover-elevate px-2 py-1 rounded-sm transition-colors"
                              data-testid={`button-tracking-${item.inventoryId}`}
                            >
                              <span className="underline decoration-dotted underline-offset-4">
                                -${(item.shippingCostsCents / 100).toFixed(2)}
                              </span>
                            </button>
                          ) : item.shippingCostsCents > 0 ? (
                            `-$${(item.shippingCostsCents / 100).toFixed(2)}`
                          ) : (
                            "-"
                          )}
                        </TableCell>
                        <TableCell className={`text-right font-mono font-semibold ${
                          item.netProfitCents >= 0 ? "text-chart-1" : "text-chart-5"
                        }`} data-testid={`text-profit-${item.inventoryId}`}>
                          {item.netProfitCents !== 0 ? (
                            <>{item.netProfitCents > 0 ? "+" : ""}${(item.netProfitCents / 100).toFixed(2)}</>
                          ) : "-"}
                        </TableCell>
                        <TableCell>
                          {canReturnToInventory(item) && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleReturnToInventory(item.inventoryId, item.title)}
                              data-testid={`button-return-${item.inventoryId}`}
                            >
                              <RotateCcw className="w-3 h-3 mr-1" />
                              Return
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <Package className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No items yet</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tracking Modal */}
      <Dialog open={!!selectedTracking} onOpenChange={(open) => !open && setSelectedTracking(null)}>
        <DialogContent className="max-w-2xl" data-testid="dialog-tracking">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="w-5 h-5" />
              Shipment Tracking
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {trackingLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
              </div>
            ) : trackingData ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Carrier</p>
                    <p className="font-medium">{selectedTracking?.carrier?.toUpperCase()}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Tracking Number</p>
                    <p className="font-mono">{selectedTracking?.trackingNumber}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Status</p>
                    <Badge variant={trackingData.tracking_status?.status === "DELIVERED" ? "default" : "secondary"}>
                      {trackingData.tracking_status?.status || "UNKNOWN"}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">ETA</p>
                    <p>{trackingData.eta ? new Date(trackingData.eta).toLocaleDateString() : "N/A"}</p>
                  </div>
                </div>
                {trackingData.tracking_history && trackingData.tracking_history.length > 0 && (
                  <div>
                    <h4 className="font-medium mb-3">Tracking History</h4>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {trackingData.tracking_history.map((event: any, idx: number) => (
                        <div key={idx} className="flex gap-4 text-sm border-l-2 border-muted pl-4 py-2">
                          <div className="min-w-32 text-muted-foreground">
                            {new Date(event.status_date).toLocaleString()}
                          </div>
                          <div>
                            <p className="font-medium">{event.status}</p>
                            {event.location && (
                              <p className="text-muted-foreground">{event.location.city}, {event.location.state}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-muted-foreground">Unable to load tracking information</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
