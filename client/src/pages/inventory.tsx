import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Search, Upload, Package, AlertCircle, AlertTriangle, X, Check, Trash2, ChevronLeft, ChevronRight, ArrowDownUp, User } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { VineItem } from "@shared/schema";

type StatusTab = "available" | "do_not_sell" | "live_listings" | "sold" | "personal_use";
type SortOrder = "recent" | "oldest" | "price_high" | "price_low" | "six_months_plus";

// Helper function to check if item is less than 6 months old
const isLessThan6MonthsOld = (receivedDate: string): boolean => {
  const received = new Date(receivedDate);
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  return received > sixMonthsAgo;
};

export default function Inventory() {
  const [, setLocation] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("recent");
  const [activeTab, setActiveTab] = useState<StatusTab>("available");
  const [currentPage, setCurrentPage] = useState(1);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [selectedItemForListing, setSelectedItemForListing] = useState<VineItem | null>(null);
  const { toast } = useToast();
  
  const itemsPerPage = 20;

  // Build query string with search, sort, and status parameters
  const buildQueryString = () => {
    const params = new URLSearchParams();
    if (searchQuery) params.set("search", searchQuery);
    if (sortOrder) params.set("sort", sortOrder);
    if (activeTab) params.set("status", activeTab);
    const queryString = params.toString();
    return queryString ? `?${queryString}` : "";
  };

  const { data: vineItems, isLoading } = useQuery<VineItem[]>({
    queryKey: [`/api/vine-items${buildQueryString()}`],
  });

  const { data: stats } = useQuery<{
    total: number;
    available: number;
    do_not_sell: number;
    personal_use: number;
    gone: number;
    returned: number;
    discarded: number;
    live_listings: number;
    sold: number;
  }>({
    queryKey: ["/api/vine-items/stats"],
  });

  const toggleDefectiveMutation = useMutation({
    mutationFn: async ({ vineItemId, defective, currentNotes }: { vineItemId: string; defective: boolean; currentNotes?: string | null }) => {
      return await apiRequest("PATCH", `/api/vine-items/${vineItemId}/defective`, {
        defective,
        defectiveNotes: defective 
          ? (currentNotes || "Marked as defective from inventory page")
          : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && key.startsWith('/api/vine-items');
        }
      });
      queryClient.invalidateQueries({ queryKey: ["/api/vine-items/stats"] });
      toast({
        title: "Success",
        description: "Item defective status updated",
      });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to update item",
      });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ vineItemId, status }: { vineItemId: string; status: string }) => {
      return await apiRequest("PATCH", `/api/vine-items/${vineItemId}/status`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && key.startsWith('/api/vine-items');
        }
      });
      queryClient.invalidateQueries({ queryKey: ["/api/vine-items/stats"] });
      toast({
        title: "Success",
        description: "Item status updated",
      });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to update item status",
      });
    },
  });

  // Items are already filtered by status on the backend
  const filteredItems = vineItems || [];

  // Paginate items
  const totalPages = Math.ceil(filteredItems.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedItems = filteredItems.slice(startIndex, endIndex);

  // Reset to page 1 when changing tabs or search
  const handleTabChange = (value: string) => {
    setActiveTab(value as StatusTab);
    setCurrentPage(1);
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setCurrentPage(1);
  };

  const handleSelectItem = (vineItemId: string) => {
    setLocation(`/draft?vineItemId=${vineItemId}`);
  };

  const handleCreateListingClick = (e: React.MouseEvent, item: VineItem) => {
    e.stopPropagation();
    
    // Check if item is less than 6 months old
    if (isLessThan6MonthsOld(item.receivedDate)) {
      // Show confirmation dialog
      setSelectedItemForListing(item);
      setConfirmDialogOpen(true);
    } else {
      // Proceed directly to listing creation
      setLocation(`/draft?vineItemId=${item.vineItemId}`);
    }
  };

  const handleConfirmCreateListing = () => {
    if (selectedItemForListing) {
      setLocation(`/draft?vineItemId=${selectedItemForListing.vineItemId}`);
      setConfirmDialogOpen(false);
      setSelectedItemForListing(null);
    }
  };

  const handleToggleDefective = (e: React.MouseEvent, item: VineItem) => {
    e.stopPropagation();
    toggleDefectiveMutation.mutate({
      vineItemId: item.vineItemId,
      defective: !item.defective,
      currentNotes: item.defectiveNotes,
    });
  };

  const handleChangeStatus = (e: React.MouseEvent, vineItemId: string, newStatus: string) => {
    e.stopPropagation();
    updateStatusMutation.mutate({ vineItemId, status: newStatus });
  };

  // Use stats from API instead of computing client-side
  const availableCount = stats?.available || 0;
  const doNotSellCount = stats?.do_not_sell || 0;
  const liveListingsCount = stats?.live_listings || 0;
  const soldCount = stats?.sold || 0;
  const personalUseCount = stats?.personal_use || 0;
  const cancelledCount = stats?.cancelled || 0;

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground" data-testid="text-page-title">Inventory</h1>
            <p className="text-sm text-muted-foreground mt-1">Manage your inventory status and create eBay listings</p>
          </div>
          <Button onClick={() => setLocation("/import")} data-testid="button-import">
            <Upload className="w-4 h-4 mr-2" />
            Import XLSX
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Items</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold" data-testid="text-total-items">
                {stats?.total ?? 0}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Available</CardTitle>
              <div className="h-3 w-3 rounded-full bg-chart-1" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold text-chart-1" data-testid="text-available-items">
                {availableCount}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Do Not Sell</CardTitle>
              <div className="h-3 w-3 rounded-full bg-chart-3" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold text-chart-3" data-testid="text-do-not-sell-items">
                {doNotSellCount}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Live Listings</CardTitle>
              <div className="h-3 w-3 rounded-full bg-chart-2" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold text-chart-2" data-testid="text-live-listings-items">
                {liveListingsCount}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Sold</CardTitle>
              <div className="h-3 w-3 rounded-full bg-chart-5" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold text-chart-5" data-testid="text-sold-items">
                {soldCount}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Personal Use</CardTitle>
              <div className="h-3 w-3 rounded-full bg-chart-4" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold text-chart-4" data-testid="text-personal-use-items">
                {personalUseCount}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Cancelled</CardTitle>
              <div className="h-3 w-3 rounded-full bg-destructive" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold text-destructive" data-testid="text-cancelled-items">
                {cancelledCount}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Search and Sort */}
        <div className="flex flex-col gap-3 md:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search by title, ASIN, or UPC..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-9"
              data-testid="input-search"
            />
          </div>
          <Select value={sortOrder} onValueChange={(value: SortOrder) => setSortOrder(value)}>
            <SelectTrigger className="w-full md:w-48" data-testid="select-sort">
              <ArrowDownUp className="w-4 h-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent" data-testid="option-recent">Recent First</SelectItem>
              <SelectItem value="oldest" data-testid="option-oldest">Oldest First</SelectItem>
              <SelectItem value="price_high" data-testid="option-price-high">Price: High to Low</SelectItem>
              <SelectItem value="price_low" data-testid="option-price-low">Price: Low to High</SelectItem>
              <SelectItem value="six_months_plus" data-testid="option-six-months">6+ Months Old</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Tabs for status filtering */}
        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
          <TabsList className="grid w-full grid-cols-6" data-testid="tabs-status">
            <TabsTrigger value="available" data-testid="tab-available">
              Available ({availableCount})
            </TabsTrigger>
            <TabsTrigger value="do_not_sell" data-testid="tab-do-not-sell">
              Do Not Sell ({doNotSellCount})
            </TabsTrigger>
            <TabsTrigger value="live_listings" data-testid="tab-live-listings">
              Live Listings ({liveListingsCount})
            </TabsTrigger>
            <TabsTrigger value="sold" data-testid="tab-sold">
              Sold ({soldCount})
            </TabsTrigger>
            <TabsTrigger value="personal_use" data-testid="tab-personal-use">
              Personal Use ({personalUseCount})
            </TabsTrigger>
            <TabsTrigger value="cancelled" data-testid="tab-cancelled">
              Cancelled ({cancelledCount})
            </TabsTrigger>
          </TabsList>

          <TabsContent value={activeTab} className="mt-6 space-y-4">
            {isLoading ? (
              <div className="space-y-4">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Card key={i}>
                    <CardContent className="p-6">
                      <div className="space-y-3">
                        <Skeleton className="h-5 w-3/4" />
                        <Skeleton className="h-4 w-1/2" />
                        <Skeleton className="h-4 w-1/4" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : paginatedItems.length > 0 ? (
              <>
                <div className="space-y-4">
                  {paginatedItems.map((item) => (
                    <Card
                      key={item.vineItemId}
                      className="hover-elevate cursor-pointer transition-all"
                      onClick={() => handleSelectItem(item.vineItemId)}
                      data-testid={`card-vine-item-${item.vineItemId}`}
                    >
                      <CardContent className="p-6">
                        <div className="flex flex-col gap-4">
                          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                            <div className="flex-1 space-y-2">
                              <div className="flex items-start gap-3 flex-wrap">
                                <h3 className="text-base font-medium text-foreground flex-1" data-testid={`text-item-title-${item.vineItemId}`}>
                                  {item.titleNorm}
                                </h3>
                                <div className="flex gap-2 flex-wrap">
                                  <Badge
                                    variant={
                                      item.status === "cancelled"
                                        ? "destructive"
                                        : item.status === "available"
                                        ? "default"
                                        : item.status === "do_not_sell"
                                        ? "secondary"
                                        : "outline"
                                    }
                                    data-testid={`badge-status-${item.vineItemId}`}
                                  >
                                    {item.status === "cancelled" 
                                      ? "Cancelled by Amazon Vine" 
                                      : item.status === "do_not_sell" 
                                      ? "Do Not Sell" 
                                      : item.status}
                                  </Badge>
                                  {item.defective && (
                                    <Badge variant="destructive" data-testid={`badge-defective-${item.vineItemId}`}>
                                      <AlertTriangle className="w-3 h-3 mr-1" />
                                      Defective
                                    </Badge>
                                  )}
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                                <span className="font-mono" data-testid={`text-asin-${item.vineItemId}`}>
                                  ASIN: {item.asin}
                                </span>
                                {item.upc && (
                                  <span className="font-mono" data-testid={`text-upc-${item.vineItemId}`}>
                                    UPC: {item.upc}
                                  </span>
                                )}
                                <span data-testid={`text-etv-${item.vineItemId}`}>
                                  ETV: ${(item.etvCents / 100).toFixed(2)}
                                </span>
                                {item.status === "cancelled" && item.cancelledAt ? (
                                  <span data-testid={`text-cancelled-${item.vineItemId}`} className="text-destructive font-semibold">
                                    Cancelled: {new Date(item.cancelledAt).toLocaleDateString()}
                                  </span>
                                ) : (
                                  <span data-testid={`text-received-${item.vineItemId}`} className={isLessThan6MonthsOld(item.receivedDate) ? "text-destructive font-semibold" : ""}>
                                    Received: {new Date(item.receivedDate).toLocaleDateString()}
                                    {isLessThan6MonthsOld(item.receivedDate) && (
                                      <Badge variant="destructive" className="ml-2" data-testid={`badge-age-warning-${item.vineItemId}`}>
                                        <AlertTriangle className="w-3 h-3 mr-1" />
                                        Less than 6 months
                                      </Badge>
                                    )}
                                  </span>
                                )}
                              </div>
                            </div>
                            {item.status !== "cancelled" && (
                              <Button 
                                variant="outline" 
                                onClick={(e) => handleCreateListingClick(e, item)}
                                data-testid={`button-select-${item.vineItemId}`}
                              >
                                Create Listing
                              </Button>
                            )}
                          </div>
                          
                          <div className="flex flex-col gap-3 pt-2 border-t">
                            {/* Defective checkbox */}
                            <div className="flex items-center gap-2">
                              <Checkbox
                                id={`defective-${item.vineItemId}`}
                                checked={item.defective}
                                onClick={(e) => handleToggleDefective(e, item)}
                                data-testid={`checkbox-defective-${item.vineItemId}`}
                              />
                              <Label
                                htmlFor={`defective-${item.vineItemId}`}
                                className="text-sm cursor-pointer"
                                onClick={(e) => handleToggleDefective(e, item)}
                              >
                                Mark as defective (excludes from taxable income)
                              </Label>
                            </div>

                            {/* Status action buttons */}
                            <div className="flex gap-2 flex-wrap">
                              {activeTab !== "available" && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={(e) => handleChangeStatus(e, item.vineItemId, "available")}
                                  data-testid={`button-make-available-${item.vineItemId}`}
                                  disabled={updateStatusMutation.isPending}
                                >
                                  <Check className="w-4 h-4 mr-1" />
                                  Make Available
                                </Button>
                              )}
                              {/* Hide Do Not Sell and Personal Use buttons for cancelled items */}
                              {item.status !== "cancelled" && activeTab !== "do_not_sell" && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={(e) => handleChangeStatus(e, item.vineItemId, "do_not_sell")}
                                  data-testid={`button-do-not-sell-${item.vineItemId}`}
                                  disabled={updateStatusMutation.isPending}
                                >
                                  <X className="w-4 h-4 mr-1" />
                                  Do Not Sell
                                </Button>
                              )}
                              {item.status !== "cancelled" && activeTab !== "personal_use" && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={(e) => handleChangeStatus(e, item.vineItemId, "personal_use")}
                                  data-testid={`button-personal-use-${item.vineItemId}`}
                                  disabled={updateStatusMutation.isPending}
                                >
                                  <User className="w-4 h-4 mr-1" />
                                  Personal Use
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between pt-4">
                    <div className="text-sm text-muted-foreground">
                      Showing {startIndex + 1}-{Math.min(endIndex, filteredItems.length)} of {filteredItems.length} items
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        data-testid="button-prev-page"
                      >
                        <ChevronLeft className="w-4 h-4 mr-1" />
                        Previous
                      </Button>
                      <div className="flex items-center gap-2">
                        <span className="text-sm">
                          Page {currentPage} of {totalPages}
                        </span>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        data-testid="button-next-page"
                      >
                        Next
                        <ChevronRight className="w-4 h-4 ml-1" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {searchQuery
                    ? `No ${activeTab.replace("_", " ")} items found matching your search.`
                    : `No ${activeTab.replace("_", " ")} items. Items with this status will appear here.`}
                </AlertDescription>
              </Alert>
            )}
          </TabsContent>
        </Tabs>

        {/* Footer note about 6-month policy */}
        {activeTab === "available" && filteredItems.some(item => isLessThan6MonthsOld(item.receivedDate)) && (
          <Alert variant="destructive" className="mt-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <strong>Policy Reminder:</strong> Items less than 6 months old are highlighted in red. 
              It's recommended to wait at least 6 months before listing to comply with Amazon's terms of service. 
              You can still create listings for these items, but you'll need to confirm your decision.
            </AlertDescription>
          </Alert>
        )}
      </div>

      {/* Confirmation Dialog for items < 6 months old */}
      <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <DialogContent data-testid="dialog-age-confirmation">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              Item Less Than 6 Months Old
            </DialogTitle>
            <DialogDescription>
              This item was received on {selectedItemForListing && new Date(selectedItemForListing.receivedDate).toLocaleDateString()} and is less than 6 months old.
              <br /><br />
              <strong>It's recommended to wait at least 6 months before listing items to comply with Amazon's Vine program terms of service.</strong>
              <br /><br />
              Are you sure you want to create a listing for this item now?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setConfirmDialogOpen(false);
                setSelectedItemForListing(null);
              }}
              data-testid="button-cancel-listing"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmCreateListing}
              data-testid="button-confirm-listing"
            >
              Continue Anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
