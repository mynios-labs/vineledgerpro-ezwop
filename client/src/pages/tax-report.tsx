import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, Download, FileText, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type YearData = {
  year: number;
  grossSalesCents: number;
  basisCents: number;
  ebayFeesCents: number;
  promotionFeesCents: number;
  shippingCostsCents: number;
  shippingRefundsCents: number;
  salesTaxCollectedCents: number;
  itemsSold: number;
  itemsDefective: number;
  netTaxableIncomeCents: number;
};

type CrossYearItem = {
  title: string;
  receivedYear: number;
  soldYear: number;
  basisCents: number;
  saleCents: number;
};

type TaxReport = {
  annualSummary: YearData[];
  crossYearAnalysis: CrossYearItem[];
  currentInventory: {
    totalItemsUnsold: number;
    totalBasisCents: number;
    byYearReceived: Array<{
      year: number;
      count: number;
      basisCents: number;
    }>;
  };
  defectiveItems: {
    count: number;
    totalBasisCents: number;
  };
  taxNotes: {
    vineProgram: string;
    form1099K: string;
    doubletaxation: string;
    crossYearBasis: string;
    defectiveItems: string;
  };
};

export default function TaxReport() {
  const { data: report, isLoading } = useQuery<TaxReport>({
    queryKey: ["/api/tax-report"],
  });

  const currentYear = new Date().getFullYear();
  const currentYearData = report?.annualSummary.find((y) => y.year === currentYear);

  const formatCurrency = (cents: number) => {
    return `$${(cents / 100).toFixed(2)}`;
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
        </div>
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-6 w-48" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-32 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!report) {
    return (
      <div className="container mx-auto p-6">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>Failed to load tax report data</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold">Tax Report</h1>
          <p className="text-muted-foreground">
            Comprehensive tax documentation for CPA review and filing
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild data-testid="button-export-csv">
            <a href="/api/accounting/export/csv" download>
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </a>
          </Button>
          <Button variant="outline" size="sm" data-testid="button-print">
            <FileText className="w-4 h-4 mr-2" />
            Print Report
          </Button>
        </div>
      </div>

      {/* Critical Tax Notes */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription className="space-y-2">
          <p className="font-semibold">Important Information for Tax Preparer:</p>
          <ul className="list-disc list-inside space-y-1 text-sm">
            <li>{report.taxNotes.vineProgram}</li>
            <li className="text-destructive font-medium">{report.taxNotes.form1099K}</li>
            <li className="text-destructive font-medium">{report.taxNotes.doubletaxation}</li>
            <li>{report.taxNotes.crossYearBasis}</li>
            <li>{report.taxNotes.defectiveItems}</li>
          </ul>
        </AlertDescription>
      </Alert>

      {/* Current Year Tax Liability */}
      {currentYearData && (
        <Card className="border-primary">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {currentYear} Tax Liability (Current Year)
              <Badge variant="default">Year to Date</Badge>
            </CardTitle>
            <CardDescription>
              Your estimated tax liability for {currentYear} based on current sales
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">Gross Sales</div>
                <div className="text-2xl font-bold" data-testid="text-current-gross">
                  {formatCurrency(currentYearData.grossSalesCents)}
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">Cost Basis (ETV)</div>
                <div className="text-2xl font-bold text-destructive">
                  -{formatCurrency(currentYearData.basisCents)}
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">Total Expenses</div>
                <div className="text-2xl font-bold text-destructive">
                  -
                  {formatCurrency(
                    currentYearData.ebayFeesCents +
                      currentYearData.promotionFeesCents +
                      (currentYearData.shippingCostsCents -
                        currentYearData.shippingRefundsCents)
                  )}
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">Net Taxable Income</div>
                <div
                  className={`text-2xl font-bold ${
                    currentYearData.netTaxableIncomeCents >= 0 ? "text-chart-1" : "text-chart-5"
                  }`}
                  data-testid="text-current-net"
                >
                  {formatCurrency(currentYearData.netTaxableIncomeCents)}
                </div>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Items Sold:</span>{" "}
                <span className="font-medium">{currentYearData.itemsSold}</span>
              </div>
              <div>
                <span className="text-muted-foreground">eBay Fees:</span>{" "}
                <span className="font-medium">{formatCurrency(currentYearData.ebayFeesCents)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Shipping Costs:</span>{" "}
                <span className="font-medium">
                  {formatCurrency(
                    currentYearData.shippingCostsCents - currentYearData.shippingRefundsCents
                  )}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Sales Tax Collected:</span>{" "}
                <span className="font-medium">
                  {formatCurrency(currentYearData.salesTaxCollectedCents)}
                </span>
                <Info className="inline-block w-3 h-3 ml-1 text-muted-foreground" />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Annual Summary by Year */}
      <Card>
        <CardHeader>
          <CardTitle>Annual Tax Summary by Year</CardTitle>
          <CardDescription>
            Year-by-year breakdown of sales, expenses, and net taxable income
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Year</TableHead>
                  <TableHead className="text-right">Gross Sales</TableHead>
                  <TableHead className="text-right">Cost Basis</TableHead>
                  <TableHead className="text-right">eBay Fees</TableHead>
                  <TableHead className="text-right">Shipping</TableHead>
                  <TableHead className="text-right">Sales Tax</TableHead>
                  <TableHead className="text-right">Net Income</TableHead>
                  <TableHead className="text-right">Items Sold</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.annualSummary.map((yearData) => (
                  <TableRow key={yearData.year} data-testid={`row-year-${yearData.year}`}>
                    <TableCell className="font-medium">
                      {yearData.year}
                      {yearData.year === currentYear && (
                        <Badge variant="outline" className="ml-2">
                          Current
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(yearData.grossSalesCents)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-destructive">
                      -{formatCurrency(yearData.basisCents)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-destructive">
                      -{formatCurrency(yearData.ebayFeesCents + yearData.promotionFeesCents)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-destructive">
                      -
                      {formatCurrency(
                        yearData.shippingCostsCents - yearData.shippingRefundsCents
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {formatCurrency(yearData.salesTaxCollectedCents)}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono font-semibold ${
                        yearData.netTaxableIncomeCents >= 0 ? "text-chart-1" : "text-chart-5"
                      }`}
                    >
                      {formatCurrency(yearData.netTaxableIncomeCents)}
                    </TableCell>
                    <TableCell className="text-right">{yearData.itemsSold}</TableCell>
                  </TableRow>
                ))}
                {report.annualSummary.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground">
                      No sales data yet
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Cross-Year Analysis */}
      {report.crossYearAnalysis.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Cross-Year Analysis</CardTitle>
            <CardDescription>
              Items received in one year but sold in another (due to 6-month waiting period)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="max-w-[200px]">Item</TableHead>
                    <TableHead>Received Year</TableHead>
                    <TableHead>Sold Year</TableHead>
                    <TableHead className="text-right">Basis (ETV)</TableHead>
                    <TableHead className="text-right">Sale Price</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.crossYearAnalysis.slice(0, 20).map((item, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="max-w-[200px] truncate" title={item.title}>
                        {item.title}
                      </TableCell>
                      <TableCell>{item.receivedYear}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{item.soldYear}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(item.basisCents)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(item.saleCents)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {report.crossYearAnalysis.length > 20 && (
                <p className="text-sm text-muted-foreground mt-2">
                  Showing first 20 of {report.crossYearAnalysis.length} cross-year items
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Current Inventory */}
      <Card>
        <CardHeader>
          <CardTitle>Current Inventory (Unsold Items)</CardTitle>
          <CardDescription>
            Total basis value of items not yet sold - future tax deductions
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">Total Unsold Items</div>
              <div className="text-3xl font-bold" data-testid="text-unsold-count">
                {report.currentInventory.totalItemsUnsold}
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">Total Basis Value</div>
              <div className="text-3xl font-bold" data-testid="text-unsold-basis">
                {formatCurrency(report.currentInventory.totalBasisCents)}
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">Defective Items</div>
              <div className="text-3xl font-bold text-destructive">
                {report.defectiveItems.count}
              </div>
              <div className="text-sm text-muted-foreground">
                Basis: {formatCurrency(report.defectiveItems.totalBasisCents)}
              </div>
            </div>
          </div>

          {report.currentInventory.byYearReceived.length > 0 && (
            <div className="mt-6 pt-6 border-t">
              <h4 className="font-medium mb-3">Inventory by Year Received</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {report.currentInventory.byYearReceived.map((yearData) => (
                  <div key={yearData.year} className="p-3 rounded-md bg-muted/50">
                    <div className="text-sm text-muted-foreground">{yearData.year}</div>
                    <div className="text-lg font-semibold">{yearData.count} items</div>
                    <div className="text-sm">{formatCurrency(yearData.basisCents)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 1099-K Reconciliation Warning */}
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          <p className="font-semibold mb-2">Critical: 1099-K Reconciliation Required</p>
          <p className="text-sm">
            If eBay issues you a Form 1099-K, it will show <strong>gross sales only</strong>. The
            IRS will expect you to report this on Schedule C and deduct your cost basis (ETV) and
            expenses. Use the "Net Taxable Income" figures above to calculate your actual tax
            liability. Provide this entire report to your tax preparer.
          </p>
        </AlertDescription>
      </Alert>
    </div>
  );
}
