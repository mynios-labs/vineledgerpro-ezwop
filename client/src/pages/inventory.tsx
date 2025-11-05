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
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { VineItem } from "@shared/schema";

type StatusTab = "available" | "do_not_sell" | "sold_or_live" | "personal_use";
type SortOrder = "recent" | "oldest" | "price_high" | "price_low";

export default function Inventory() {
  const [, setLocation] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("recent");
  const [activeTab, setActiveTab] = useState<StatusTab>("available");
  const [currentPage, setCurrentPage] = useState(1);
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
    reserved: number;
    sold: number;
    do_not_sell: number;
    gone: number;
    returned: number;
    discarded: number;
    personal_use: number;
    sold_or_live: number;
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
  const soldOrLiveCount = stats?.sold_or_live || 0;
  const personalUseCount = stats?.personal_use || 0;

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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
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
              <CardTitle className="text-sm font-medium">Sold/Live</CardTitle>
              <div className="h-3 w-3 rounded-full bg-chart-2" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold text-chart-2" data-testid="text-sold-live-items">
                {soldOrLiveCount}
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
            </SelectContent>
          </Select>
        </div>

        {/* Tabs for status filtering */}
        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
          <TabsList className="grid w-full grid-cols-4" data-testid="tabs-status">
            <TabsTrigger value="available" data-testid="tab-available">
              Available ({availableCount})
            </TabsTrigger>
            <TabsTrigger value="do_not_sell" data-testid="tab-do-not-sell">
              Do Not Sell ({doNotSellCount})
            </TabsTrigger>
            <TabsTrigger value="sold_or_live" data-testid="tab-sold-live">
              Sold/Live ({soldOrLiveCount})
            </TabsTrigger>
            <TabsTrigger value="personal_use" data-testid="tab-personal-use">
              Personal Use ({personalUseCount})
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
                                      item.status === "available"
                                        ? "default"
                                        : item.status === "do_not_sell"
                                        ? "secondary"
                                        : "outline"
                                    }
                                    data-testid={`badge-status-${item.vineItemId}`}
                                  >
                                    {item.status === "do_not_sell" ? "Do Not Sell" : item.status}
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
                                <span data-testid={`text-received-${item.vineItemId}`}>
                                  Received: {new Date(item.receivedDate).toLocaleDateString()}
                                </span>
                              </div>
                            </div>
                            <Button variant="outline" data-testid={`button-select-${item.vineItemId}`}>
                              Create Listing
                            </Button>
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
                              {activeTab !== "do_not_sell" && (
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
                              {activeTab !== "personal_use" && (
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
      </div>
    </div>
  );
}
