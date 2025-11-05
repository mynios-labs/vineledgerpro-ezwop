import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, Download, FileText, Info, Plus, Edit2, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useState } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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

type Amazon1099Entry = {
  id: number;
  taxYear: number;
  amountCents: number;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type Ebay1099Entry = {
  id: number;
  taxYear: number;
  amountCents: number;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
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
  amazon1099: {
    entries: Amazon1099Entry[];
    etvReceivedByYear: Array<{
      year: number;
      calculatedEtvCents: number;
      reported1099Cents: number | null;
      hasDiscrepancy: boolean;
    }>;
  };
  ebay1099: {
    entries: Ebay1099Entry[];
    salesByYear: Array<{
      year: number;
      calculatedGrossSalesCents: number;
      reported1099KCents: number | null;
      hasDiscrepancy: boolean;
    }>;
  };
  taxNotes: {
    vineProgram: string;
    amazon1099: string;
    ebay1099K: string;
    doubleTaxationRisk: string;
    properTreatment: string;
    crossYearBasis: string;
    reconciliation: string;
    defectiveItems: string;
  };
};

function Amazon1099Dialog({
  year,
  existingAmount,
  existingNotes,
}: {
  year: number;
  existingAmount?: number;
  existingNotes?: string;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(existingAmount ? (existingAmount / 100).toFixed(2) : "");
  const [notes, setNotes] = useState(existingNotes || "");
  const { toast } = useToast();

  const saveMutation = useMutation({
    mutationFn: async () => {
      const amountCents = Math.round(parseFloat(amount) * 100);
      return apiRequest("/api/amazon-1099", "POST", {
        taxYear: year,
        amountCents,
        notes: notes.trim() || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tax-report"] });
      toast({
        title: "Amazon 1099 saved",
        description: `Successfully saved ${year} Amazon 1099 data`,
      });
      setOpen(false);
    },
    onError: (error: any) => {
      toast({
        title: "Error saving data",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          data-testid={`button-edit-1099-${year}`}
        >
          {existingAmount ? <Edit2 className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          <span className="ml-2">{existingAmount ? "Edit" : "Add"} {year}</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Amazon 1099 for {year}</DialogTitle>
          <DialogDescription>
            Enter the total amount from your Amazon Vine 1099-MISC or 1099-NEC for tax year {year}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="amount">Amount from 1099</Label>
            <Input
              id="amount"
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              data-testid="input-1099-amount"
            />
            <p className="text-sm text-muted-foreground">
              Enter the total ETV amount from your Amazon 1099 form
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (Optional)</Label>
            <Textarea
              id="notes"
              placeholder="Any notes about this tax year..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              data-testid="input-1099-notes"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={!amount || saveMutation.isPending}
            data-testid="button-save-1099"
          >
            {saveMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Ebay1099Dialog({
  year,
  existingAmount,
  existingNotes,
}: {
  year: number;
  existingAmount?: number;
  existingNotes?: string;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(existingAmount ? (existingAmount / 100).toFixed(2) : "");
  const [notes, setNotes] = useState(existingNotes || "");
  const { toast } = useToast();

  const saveMutation = useMutation({
    mutationFn: async () => {
      const amountCents = Math.round(parseFloat(amount) * 100);
      return apiRequest("/api/ebay-1099", "POST", {
        taxYear: year,
        amountCents,
        notes: notes.trim() || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tax-report"] });
      toast({
        title: "eBay 1099-K saved",
        description: `Successfully saved ${year} eBay 1099-K data`,
      });
      setOpen(false);
    },
    onError: (error: any) => {
      toast({
        title: "Error saving data",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          data-testid={`button-edit-ebay-1099-${year}`}
        >
          {existingAmount ? <Edit2 className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          <span className="ml-2">{existingAmount ? "Edit" : "Add"} {year}</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>eBay 1099-K for {year}</DialogTitle>
          <DialogDescription>
            Enter the total amount from your eBay 1099-K form for tax year {year}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="ebay-amount">Amount from 1099-K</Label>
            <Input
              id="ebay-amount"
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              data-testid="input-ebay-1099-amount"
            />
            <p className="text-sm text-muted-foreground">
              Enter the gross proceeds amount from your eBay 1099-K form
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ebay-notes">Notes (Optional)</Label>
            <Textarea
              id="ebay-notes"
              placeholder="Any notes about this tax year..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              data-testid="input-ebay-1099-notes"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            data-testid="button-cancel-ebay"
          >
            Cancel
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={!amount || saveMutation.isPending}
            data-testid="button-save-ebay-1099"
          >
            {saveMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
        <AlertDescription className="space-y-3">
          <p className="font-semibold text-base">Critical Tax Information - READ CAREFULLY:</p>
          <div className="space-y-2">
            <div>
              <p className="font-medium text-sm">Vine Program Basics:</p>
              <p className="text-sm">{report.taxNotes.vineProgram}</p>
            </div>
            <div className="border-l-4 border-destructive pl-3">
              <p className="font-medium text-sm text-destructive">Amazon 1099 (First Taxation):</p>
              <p className="text-sm">{report.taxNotes.amazon1099}</p>
            </div>
            <div className="border-l-4 border-destructive pl-3">
              <p className="font-medium text-sm text-destructive">eBay 1099-K (Second Taxation Risk):</p>
              <p className="text-sm">{report.taxNotes.ebay1099K}</p>
            </div>
            <div className="bg-destructive/10 p-3 rounded-md">
              <p className="font-semibold text-sm text-destructive uppercase">Double Taxation Risk:</p>
              <p className="text-sm font-medium">{report.taxNotes.doubleTaxationRisk}</p>
            </div>
            <div className="bg-primary/10 p-3 rounded-md">
              <p className="font-medium text-sm">Proper Tax Treatment:</p>
              <p className="text-sm">{report.taxNotes.properTreatment}</p>
            </div>
            <div>
              <p className="font-medium text-sm">Cross-Year Basis:</p>
              <p className="text-sm">{report.taxNotes.crossYearBasis}</p>
            </div>
            <div>
              <p className="font-medium text-sm">Reconciliation:</p>
              <p className="text-sm">{report.taxNotes.reconciliation}</p>
            </div>
            <div>
              <p className="font-medium text-sm">Defective Items:</p>
              <p className="text-sm">{report.taxNotes.defectiveItems}</p>
            </div>
          </div>
        </AlertDescription>
      </Alert>

      {/* Amazon 1099 Reconciliation */}
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Amazon 1099 Reconciliation
          </CardTitle>
          <CardDescription>
            Track Amazon Vine 1099-MISC/NEC forms and reconcile with calculated ETV to prevent double taxation
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tax Year</TableHead>
                  <TableHead className="text-right">Calculated ETV</TableHead>
                  <TableHead className="text-right">Amazon 1099 Amount</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.amazon1099.etvReceivedByYear.map((yearData) => {
                  const existing1099 = report.amazon1099.entries.find(
                    (e) => e.taxYear === yearData.year
                  );
                  const variance = yearData.reported1099Cents
                    ? yearData.calculatedEtvCents - yearData.reported1099Cents
                    : null;

                  return (
                    <TableRow
                      key={yearData.year}
                      data-testid={`row-1099-${yearData.year}`}
                      className={yearData.hasDiscrepancy ? "bg-destructive/5" : ""}
                    >
                      <TableCell className="font-medium">
                        {yearData.year}
                        {yearData.hasDiscrepancy && (
                          <Badge variant="destructive" className="ml-2">
                            Discrepancy
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(yearData.calculatedEtvCents)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {yearData.reported1099Cents ? (
                          formatCurrency(yearData.reported1099Cents)
                        ) : (
                          <span className="text-muted-foreground">Not entered</span>
                        )}
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono ${
                          variance && Math.abs(variance) > 100
                            ? "text-destructive font-semibold"
                            : "text-muted-foreground"
                        }`}
                      >
                        {variance !== null ? (
                          <>
                            {variance > 0 ? "+" : ""}
                            {formatCurrency(variance)}
                          </>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Amazon1099Dialog
                          year={yearData.year}
                          existingAmount={existing1099?.amountCents}
                          existingNotes={existing1099?.notes || undefined}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
                {report.amazon1099.etvReceivedByYear.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      No Vine items received yet
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-sm">
              <p className="font-medium mb-1">How to use this section:</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>
                  "Calculated ETV" shows the total ETV of Vine items you received each year (from
                  your imports)
                </li>
                <li>
                  When you receive your Amazon 1099 form at year-end, click "Add" to enter the
                  reported amount
                </li>
                <li>
                  Compare the two values - small differences are normal due to timing, but large
                  discrepancies should be investigated
                </li>
                <li>
                  Provide both this report AND your Amazon 1099 forms to your CPA to ensure proper
                  cost basis deductions
                </li>
              </ol>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* eBay 1099-K Reconciliation */}
      <Card className="border-primary">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            eBay 1099-K Reconciliation
          </CardTitle>
          <CardDescription>
            Track eBay 1099-K forms and reconcile with calculated gross sales to ensure accurate tax reporting
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tax Year</TableHead>
                  <TableHead className="text-right">Calculated Gross Sales</TableHead>
                  <TableHead className="text-right">eBay 1099-K Amount</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.ebay1099.salesByYear.map((yearData) => {
                  const existing1099 = report.ebay1099.entries.find(
                    (e) => e.taxYear === yearData.year
                  );
                  const variance = yearData.reported1099KCents
                    ? yearData.calculatedGrossSalesCents - yearData.reported1099KCents
                    : null;

                  return (
                    <TableRow
                      key={yearData.year}
                      data-testid={`row-ebay-1099-${yearData.year}`}
                      className={yearData.hasDiscrepancy ? "bg-primary/5" : ""}
                    >
                      <TableCell className="font-medium">
                        {yearData.year}
                        {yearData.hasDiscrepancy && (
                          <Badge variant="default" className="ml-2">
                            Discrepancy
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(yearData.calculatedGrossSalesCents)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {yearData.reported1099KCents ? (
                          formatCurrency(yearData.reported1099KCents)
                        ) : (
                          <span className="text-muted-foreground">Not entered</span>
                        )}
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono ${
                          variance && Math.abs(variance) > 100
                            ? "text-primary font-semibold"
                            : "text-muted-foreground"
                        }`}
                      >
                        {variance !== null ? (
                          <>
                            {variance > 0 ? "+" : ""}
                            {formatCurrency(variance)}
                          </>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Ebay1099Dialog
                          year={yearData.year}
                          existingAmount={existing1099?.amountCents}
                          existingNotes={existing1099?.notes || undefined}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
                {report.ebay1099.salesByYear.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      No sales recorded yet
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-sm">
              <p className="font-medium mb-1">How to use this section:</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>
                  "Calculated Gross Sales" shows the total eBay sales each year (from your order
                  data)
                </li>
                <li>
                  When you receive your eBay 1099-K form at year-end, click "Add" to enter the
                  reported gross proceeds
                </li>
                <li>
                  Compare the two values - they should match closely. Discrepancies may indicate
                  missing order data
                </li>
                <li>
                  Remember: eBay 1099-K shows GROSS sales only - you must deduct ETV (cost basis)
                  and expenses to calculate taxable income
                </li>
              </ol>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

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
