import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Search, Upload, Package, AlertCircle, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { VineItem } from "@shared/schema";

export default function Inventory() {
  const [, setLocation] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const { toast } = useToast();
  
  const { data: vineItems, isLoading } = useQuery<VineItem[]>({
    queryKey: searchQuery 
      ? [`/api/vine-items?search=${encodeURIComponent(searchQuery)}`]
      : ["/api/vine-items"],
  });

  const { data: stats } = useQuery<{
    total: number;
    available: number;
    reserved: number;
    sold: number;
  }>({
    queryKey: ["/api/vine-items/stats"],
  });

  const toggleDefectiveMutation = useMutation({
    mutationFn: async ({ vineItemId, defective, currentNotes }: { vineItemId: string; defective: boolean; currentNotes?: string | null }) => {
      return await apiRequest("PATCH", `/api/vine-items/${vineItemId}/defective`, {
        defective,
        // Preserve existing notes if they exist, otherwise add default note
        defectiveNotes: defective 
          ? (currentNotes || "Marked as defective from inventory page")
          : null,
      });
    },
    onSuccess: () => {
      // Invalidate all vine-items queries (including search queries)
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

  // Backend handles filtering, so just use vineItems directly
  const filteredItems = vineItems;

  const handleSelectItem = (vineItemId: string) => {
    setLocation(`/draft?vineItemId=${vineItemId}`);
  };

  const handleToggleDefective = (e: React.MouseEvent, item: VineItem) => {
    e.stopPropagation(); // Prevent card click
    toggleDefectiveMutation.mutate({
      vineItemId: item.vineItemId,
      defective: !item.defective,
      currentNotes: item.defectiveNotes,
    });
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground" data-testid="text-page-title">Inventory</h1>
            <p className="text-sm text-muted-foreground mt-1">Search and select items to create eBay listings</p>
          </div>
          <Button onClick={() => setLocation("/import")} data-testid="button-import">
            <Upload className="w-4 h-4 mr-2" />
            Import XLSX
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
                {stats?.available ?? 0}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Reserved</CardTitle>
              <div className="h-3 w-3 rounded-full bg-chart-3" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold text-chart-3" data-testid="text-reserved-items">
                {stats?.reserved ?? 0}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Sold</CardTitle>
              <div className="h-3 w-3 rounded-full bg-chart-2" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold text-chart-2" data-testid="text-sold-items">
                {stats?.sold ?? 0}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search by title, ASIN, or UPC..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search"
          />
        </div>

        {/* Items List */}
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
        ) : filteredItems && filteredItems.length > 0 ? (
          <div className="space-y-4">
            {filteredItems.map((item) => (
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
                                  : item.status === "sold"
                                  ? "secondary"
                                  : "outline"
                              }
                              data-testid={`badge-status-${item.vineItemId}`}
                            >
                              {item.status}
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
                    
                    <div className="flex items-center gap-2 pt-2 border-t">
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
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {searchQuery
                ? "No items found matching your search."
                : "No items in inventory. Upload an XLSX file to get started."}
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}
