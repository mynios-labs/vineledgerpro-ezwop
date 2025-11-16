import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, getApiErrorPayload } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Edit2, Trash2, ExternalLink, RefreshCw, AlertCircle, User, Mail, Hash } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { formatDistanceToNow } from "date-fns";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { DriftDrawer } from "@/components/drift-drawer";

const editListingSchema = z.object({
  title: z.string().min(10).max(80),
  description: z.string().min(20),
  priceCents: z.number().int().positive(),
  ebaySku: z.string().min(1).max(50).regex(/^[a-zA-Z0-9]+$/, "SKU must be alphanumeric only"),
  categoryId: z.string().optional(),
  fulfillmentPolicyId: z.string().optional(),
  weightOz: z.number().positive().optional(),
  dimsL: z.number().positive().optional(),
  dimsW: z.number().positive().optional(),
  dimsH: z.number().positive().optional(),
  quantity: z.number().int().positive().min(1).optional(),
});

type EditListingFormData = z.infer<typeof editListingSchema>;

export default function ListingsPage() {
  const { toast } = useToast();
  const [editingListing, setEditingListing] = useState<any>(null);
  const [deletingListing, setDeletingListing] = useState<any>(null);
  const [syncErrors, setSyncErrors] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("live");
  const [driftFilter, setDriftFilter] = useState<boolean | null>(null);
  const [driftDrawerListing, setDriftDrawerListing] = useState<any>(null);

  // Fetch all listings
  const { data: listings = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/listings"],
  });

  // Fetch eBay account information
  const { data: accountInfo, isLoading: isAccountLoading } = useQuery<{
    username: string;
    userId: string;
    email: string;
    registrationMarketplace: string;
    status: string;
  }>({
    queryKey: ["/api/ebay/account"],
  });

  // Fetch fulfillment policies for dropdown
  const { data: fulfillmentPolicies = [] } = useQuery<any[]>({
    queryKey: ["/api/ebay/fulfillment-policies"],
    enabled: !!editingListing,
  });

  // Edit listing mutation
  const editMutation = useMutation({
    mutationFn: async (data: EditListingFormData & { listingId: string }) => {
      const { listingId, ...updates } = data;
      return await apiRequest("PUT", `/api/listings/${listingId}/edit`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
      toast({
        title: "Listing updated",
        description: "Your eBay listing has been updated successfully.",
      });
      setEditingListing(null);
    },
    onError: (error: any) => {
      toast({
        title: "Update failed",
        description: error.message || "Failed to update listing",
        variant: "destructive",
      });
    },
  });

  // End listing mutation
  const endMutation = useMutation({
    mutationFn: async (listingId: string) => {
      return await apiRequest("POST", `/api/listings/${listingId}/end`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
      toast({
        title: "Listing ended",
        description: "Your eBay listing has been ended successfully.",
      });
      setDeletingListing(null);
    },
    onError: (error: any) => {
      toast({
        title: "End listing failed",
        description: error.message || "Failed to end listing",
        variant: "destructive",
      });
    },
  });

  // Sync all listings mutation
  const syncAllMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/listings/sync-from-ebay", {});
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ebay/account"] });
      if (data.errors && data.errors.length > 0) {
        setSyncErrors(data.errors);
      }
      toast({
        title: "Sync complete",
        description: `Synced ${data.synced} of ${data.total} listings${data.failed > 0 ? ` (${data.failed} failed)` : ""}`,
        variant: data.failed > 0 ? "destructive" : "default",
      });
    },
    onError: (error: any) => {
      console.error("Sync failed:", error);
      const { title, description } = getApiErrorPayload(error);
      toast({
        title,
        description,
        variant: "destructive",
      });
    },
  });

  // Sync single listing mutation
  const syncSingleMutation = useMutation({
    mutationFn: async (listingId: string) => {
      return await apiRequest("POST", `/api/listings/${listingId}/sync-from-ebay`, {});
    },
    onSuccess: (data: any, listingId: string) => {
      queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
      toast({
        title: "Listing synced",
        description: data.drift ? "Drift detected - check listing details" : "Listing is up to date",
        variant: data.drift ? "default" : "default",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Sync failed",
        description: error.message || "Failed to sync listing",
        variant: "destructive",
      });
    },
  });

  // Calculate last synced time
  const lastSyncedAt = listings
    .filter((l: any) => l.lastSyncedAt)
    .map((l: any) => new Date(l.lastSyncedAt))
    .sort((a, b) => b.getTime() - a.getTime())[0];

  // Filter listings
  const filteredListings = listings.filter((listing: any) => {
    // Status filter
    if (statusFilter !== "all" && listing.state !== statusFilter) {
      return false;
    }
    
    // Drift filter
    if (driftFilter !== null) {
      const hasDrift = listing.driftSnapshot && Object.keys(listing.driftSnapshot).length > 0;
      if (driftFilter && !hasDrift) return false;
      if (!driftFilter && hasDrift) return false;
    }
    
    return true;
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">eBay Listings</h1>
          <p className="text-muted-foreground">Manage your active eBay listings</p>
        </div>
        <div className="flex items-center gap-3">
          {lastSyncedAt && (
            <div className="text-sm text-muted-foreground" data-testid="text-last-synced">
              Last synced {formatDistanceToNow(lastSyncedAt, { addSuffix: true })}
            </div>
          )}
          <Button
            onClick={() => syncAllMutation.mutate()}
            disabled={syncAllMutation.isPending}
            data-testid="button-sync-all"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${syncAllMutation.isPending ? 'animate-spin' : ''}`} />
            Sync now
          </Button>
        </div>
      </div>

      {/* Account Information */}
      <Card data-testid="card-account-info">
        <CardContent className="pt-6">
          {isAccountLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <RefreshCw className="w-4 h-4 animate-spin" />
              Loading account information...
            </div>
          ) : accountInfo ? (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="flex items-center gap-2" data-testid="text-account-username">
                  <User className="w-4 h-4 text-muted-foreground" />
                  <div className="flex flex-col">
                    <span className="text-xs text-muted-foreground">Username</span>
                    <span className="text-sm font-medium">{accountInfo.username}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2" data-testid="text-account-email">
                  <Mail className="w-4 h-4 text-muted-foreground" />
                  <div className="flex flex-col">
                    <span className="text-xs text-muted-foreground">Email</span>
                    <span className="text-sm font-medium">{accountInfo.email}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2" data-testid="text-account-userid">
                  <Hash className="w-4 h-4 text-muted-foreground" />
                  <div className="flex flex-col">
                    <span className="text-xs text-muted-foreground">User ID</span>
                    <span className="text-sm font-medium">{accountInfo.userId}</span>
                  </div>
                </div>
              </div>
              <div className="pt-2 border-t">
                <div className="text-sm text-muted-foreground">
                  <span className="font-medium">Synced listings:</span> {listings.length}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              Unable to load account information
            </div>
          )}
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Label className="text-sm font-medium">Status:</Label>
          <div className="flex items-center gap-1">
            <Button
              variant={statusFilter === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter("all")}
              data-testid="button-filter-all"
            >
              All
            </Button>
            <Button
              variant={statusFilter === "live" ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter("live")}
              data-testid="button-filter-live"
            >
              Live
            </Button>
            <Button
              variant={statusFilter === "ended" ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter("ended")}
              data-testid="button-filter-ended"
            >
              Ended
            </Button>
            <Button
              variant={statusFilter === "draft" ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter("draft")}
              data-testid="button-filter-draft"
            >
              Draft
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Label className="text-sm font-medium">Drift:</Label>
          <div className="flex items-center gap-1">
            <Button
              variant={driftFilter === null ? "default" : "outline"}
              size="sm"
              onClick={() => setDriftFilter(null)}
              data-testid="button-filter-drift-all"
            >
              All
            </Button>
            <Button
              variant={driftFilter === true ? "default" : "outline"}
              size="sm"
              onClick={() => setDriftFilter(true)}
              data-testid="button-filter-drift-yes"
            >
              Has Drift
            </Button>
            <Button
              variant={driftFilter === false ? "default" : "outline"}
              size="sm"
              onClick={() => setDriftFilter(false)}
              data-testid="button-filter-drift-no"
            >
              No Drift
            </Button>
          </div>
        </div>

        <div className="ml-auto text-sm text-muted-foreground" data-testid="text-listing-count">
          {filteredListings.length} of {listings.length} listings
        </div>
      </div>

      {syncErrors.length > 0 && (
        <Card className="border-destructive" data-testid="card-sync-errors">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-destructive" />
              <CardTitle className="text-base">Sync Errors</CardTitle>
            </div>
            <CardDescription>
              {syncErrors.length} listing{syncErrors.length > 1 ? 's' : ''} failed to sync
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {syncErrors.map((err: any, idx: number) => (
                <div key={idx} className="text-sm p-2 rounded bg-muted" data-testid={`text-sync-error-${idx}`}>
                  <div className="font-medium">{err.listingId}</div>
                  <div className="text-xs text-muted-foreground">{err.error}</div>
                </div>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => setSyncErrors([])}
              data-testid="button-dismiss-errors"
            >
              Dismiss
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredListings?.map((listing: any) => (
          <Card key={listing.listingId} data-testid={`card-listing-${listing.listingId}`}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <CardTitle className="text-base line-clamp-2">{listing.title}</CardTitle>
                  </div>
                  <CardDescription className="text-xs">
                    ${(listing.priceCents / 100).toFixed(2)}
                  </CardDescription>
                  {listing.driftSnapshot && Object.keys(listing.driftSnapshot).length > 0 && (
                    <div className="flex items-center gap-1 mt-2">
                      <Badge
                        variant="destructive"
                        className="text-xs cursor-pointer hover-elevate"
                        onClick={() => setDriftDrawerListing(listing)}
                        data-testid={`badge-drift-${listing.listingId}`}
                      >
                        <AlertCircle className="w-3 h-3 mr-1" />
                        Drift detected
                      </Badge>
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-1 items-end">
                  <Badge 
                    variant={
                      listing.state === "live" ? "default" : 
                      listing.state === "ended" ? "destructive" : 
                      "secondary"
                    }
                    className={listing.state === "live" ? "bg-green-600 hover:bg-green-700" : ""}
                  >
                    {listing.state}
                  </Badge>
                  {listing.ebayOfferId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => syncSingleMutation.mutate(listing.listingId)}
                      disabled={syncSingleMutation.isPending}
                      data-testid={`button-pull-fresh-${listing.listingId}`}
                    >
                      <RefreshCw className={`w-3 h-3 ${syncSingleMutation.isPending ? 'animate-spin' : ''}`} />
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {listing.photos?.[0] && (
                <img 
                  src={listing.photos[0]} 
                  alt={listing.title}
                  className="w-full h-32 object-cover rounded-md"
                />
              )}
              
              <div className="space-y-2 text-xs text-muted-foreground">
                {listing.ebayItemId && (
                  <div className="flex items-center gap-2">
                    <span>Item ID: {listing.ebayItemId}</span>
                    <a
                      href={`https://www.ebay.com/itm/${listing.ebayItemId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}
                {listing.publishedAt && (
                  <div>Published: {new Date(listing.publishedAt).toLocaleDateString()}</div>
                )}
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => setEditingListing(listing)}
                  data-testid={`button-edit-listing-${listing.listingId}`}
                >
                  <Edit2 className="w-4 h-4 mr-1" />
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDeletingListing(listing)}
                  data-testid={`button-delete-listing-${listing.listingId}`}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Edit Listing Dialog */}
      {editingListing && (
        <EditListingDialog
          listing={editingListing}
          fulfillmentPolicies={fulfillmentPolicies || []}
          onClose={() => setEditingListing(null)}
          onSubmit={(data) => editMutation.mutate({ ...data, listingId: editingListing.listingId })}
          isSubmitting={editMutation.isPending}
        />
      )}

      {/* Drift Details Drawer */}
      <DriftDrawer
        listing={driftDrawerListing}
        open={!!driftDrawerListing}
        onOpenChange={(open) => !open && setDriftDrawerListing(null)}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deletingListing} onOpenChange={() => setDeletingListing(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End eBay Listing?</AlertDialogTitle>
            <AlertDialogDescription>
              This will end the listing "{deletingListing?.title}" on eBay. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => endMutation.mutate(deletingListing.listingId)}
              disabled={endMutation.isPending}
            >
              {endMutation.isPending ? "Ending..." : "End Listing"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EditListingDialog({ 
  listing, 
  fulfillmentPolicies,
  onClose, 
  onSubmit,
  isSubmitting 
}: {
  listing: any;
  fulfillmentPolicies: any[];
  onClose: () => void;
  onSubmit: (data: EditListingFormData) => void;
  isSubmitting: boolean;
}) {
  const form = useForm<EditListingFormData>({
    resolver: zodResolver(editListingSchema),
    defaultValues: {
      title: listing.title,
      description: listing.description,
      priceCents: listing.priceCents,
      ebaySku: listing.ebaySku || "",
      categoryId: listing.categoryId || "",
      fulfillmentPolicyId: listing.fulfillmentPolicyId || "",
      weightOz: listing.weightOz,
      dimsL: listing.dimsL,
      dimsW: listing.dimsW,
      dimsH: listing.dimsH,
      quantity: listing.quantity || 1,
    },
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Listing</DialogTitle>
          <DialogDescription>
            Make changes to your eBay listing. Changes will be synced with eBay.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input {...field} data-testid="input-edit-title" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="ebaySku"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>SKU</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="Alphanumeric only, max 50 characters"
                      data-testid="input-edit-sku"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea {...field} className="min-h-[100px]" data-testid="textarea-edit-description" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="priceCents"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Price ($)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      value={(field.value / 100).toFixed(2)}
                      onChange={(e) => field.onChange(Math.round(parseFloat(e.target.value) * 100))}
                      data-testid="input-edit-price"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="fulfillmentPolicyId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fulfillment Policy</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-edit-fulfillment">
                        <SelectValue placeholder="Select fulfillment policy" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {fulfillmentPolicies.map((policy: any) => (
                        <SelectItem key={policy.fulfillmentPolicyId} value={policy.fulfillmentPolicyId}>
                          {policy.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-4 gap-4">
              <FormField
                control={form.control}
                name="weightOz"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Weight (oz)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        {...field}
                        onChange={(e) => field.onChange(parseFloat(e.target.value))}
                        data-testid="input-edit-weight"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="dimsL"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Length (in)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        {...field}
                        onChange={(e) => field.onChange(parseFloat(e.target.value))}
                        data-testid="input-edit-length"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="dimsW"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Width (in)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        {...field}
                        onChange={(e) => field.onChange(parseFloat(e.target.value))}
                        data-testid="input-edit-width"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="dimsH"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Height (in)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        {...field}
                        onChange={(e) => field.onChange(parseFloat(e.target.value))}
                        data-testid="input-edit-height"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="quantity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Quantity</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      {...field}
                      onChange={(e) => field.onChange(parseInt(e.target.value))}
                      data-testid="input-edit-quantity"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting} data-testid="button-submit-edit">
                {isSubmitting ? "Updating..." : "Update Listing"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
