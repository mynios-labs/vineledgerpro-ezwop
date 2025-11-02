import { useQuery } from "@tanstack/react-query";
import { DollarSign, TrendingUp, TrendingDown, Download, FileText, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { AccountingLedger } from "@shared/schema";

interface LedgerEntry extends AccountingLedger {
  itemTitle?: string;
  defective?: boolean;
}

interface MoneyStats {
  totalSales: number;
  totalFees: number;
  totalShipping: number;
  totalPayout: number;
  realizedGain: number;
  realizedLoss: number;
}

export default function MoneyPage() {
  const { data: stats, isLoading: statsLoading } = useQuery<MoneyStats>({
    queryKey: ["/api/accounting/stats"],
  });

  const { data: ledger, isLoading: ledgerLoading } = useQuery<LedgerEntry[]>({
    queryKey: ["/api/accounting/ledger"],
  });

  const handleExportCSV = () => {
    window.open("/api/accounting/export/csv", "_blank");
  };

  const handleExportPDF = () => {
    window.open("/api/accounting/export/pdf", "_blank");
  };

  const getEventTypeLabel = (eventType: string) => {
    const labels: Record<string, string> = {
      basis_add: "Basis Added",
      sale: "Sale",
      fee: "eBay Fee",
      shipping_label: "Shipping Label",
      label_refund: "Label Refund",
      return: "Return",
      writeoff: "Write-off",
      payout: "Payout",
      promotion_fee: "Promotion Fee",
      sales_tax_collected_by_marketplace: "Sales Tax (Pass-through)",
    };
    return labels[eventType] || eventType;
  };

  const netProfitLoss = (stats?.realizedGain || 0) - (stats?.realizedLoss || 0);
  const isProfit = netProfitLoss >= 0;

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground" data-testid="text-page-title">Money & Ledger</h1>
            <p className="text-sm text-muted-foreground mt-1">Track sales, expenses, and realized gains/losses</p>
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

        {/* Stats Cards */}
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

        {/* Ledger Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Accounting Ledger</CardTitle>
          </CardHeader>
          <CardContent>
            {ledgerLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : ledger && ledger.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead>Event Type</TableHead>
                      <TableHead>Direction</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Note</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ledger.map((entry) => (
                      <TableRow key={entry.ledgerId} data-testid={`row-ledger-${entry.ledgerId}`}>
                        <TableCell className="font-mono text-sm" data-testid={`text-date-${entry.ledgerId}`}>
                          {new Date(entry.txDate).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="max-w-xs" data-testid={`text-item-${entry.ledgerId}`}>
                          <div className="flex items-center gap-2">
                            <span className="truncate">{entry.itemTitle || "-"}</span>
                            {entry.defective && (
                              <Badge variant="destructive" size="sm" data-testid={`badge-defective-${entry.ledgerId}`}>
                                <AlertTriangle className="w-3 h-3 mr-1" />
                                Defective
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" data-testid={`badge-event-${entry.ledgerId}`}>
                            {getEventTypeLabel(entry.eventType)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={entry.direction === "credit" ? "default" : "secondary"}
                            data-testid={`badge-direction-${entry.ledgerId}`}
                          >
                            {entry.direction}
                          </Badge>
                        </TableCell>
                        <TableCell className={`text-right font-mono font-semibold ${
                          entry.direction === "credit" ? "text-chart-1" : "text-chart-5"
                        }`} data-testid={`text-amount-${entry.ledgerId}`}>
                          {entry.direction === "credit" ? "+" : "-"}${(entry.amountCents / 100).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-xs truncate" data-testid={`text-note-${entry.ledgerId}`}>
                          {entry.note || "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <DollarSign className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No ledger entries yet</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
