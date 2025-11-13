import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Badge } from "@/components/ui/badge";
import { AlertCircle } from "lucide-react";

interface DriftDrawerProps {
  listing: any | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DriftDrawer({ listing, open, onOpenChange }: DriftDrawerProps) {
  if (!listing || !listing.driftSnapshot) {
    return null;
  }

  const driftEntries = Object.entries(listing.driftSnapshot as Record<string, { local: any; ebay: any }>);

  const formatValue = (key: string, value: any) => {
    if (key === "priceCents") {
      return `$${(value / 100).toFixed(2)}`;
    }
    return String(value);
  };

  const getFieldLabel = (key: string) => {
    const labels: Record<string, string> = {
      title: "Title",
      priceCents: "Price",
      categoryId: "Category ID",
      description: "Description",
    };
    return labels[key] || key;
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent data-testid="drawer-drift">
        <DrawerHeader>
          <DrawerTitle className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-destructive" />
            Drift Detected: {listing.title}
          </DrawerTitle>
        </DrawerHeader>
        <div className="px-4 pb-8 max-h-[60vh] overflow-y-auto">
          {driftEntries.length > 0 ? (
            <div className="space-y-4">
              {driftEntries.map(([key, values]) => (
                <div
                  key={key}
                  className="border rounded-lg p-4"
                  data-testid={`drift-field-${key}`}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <Badge variant="outline" className="font-mono text-xs">
                      {getFieldLabel(key)}
                    </Badge>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-1">
                        Local Value
                      </div>
                      <div
                        className="text-sm p-2 rounded bg-muted break-words"
                        data-testid={`drift-local-${key}`}
                      >
                        {formatValue(key, values.local)}
                      </div>
                    </div>
                    
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-1">
                        eBay Value
                      </div>
                      <div
                        className="text-sm p-2 rounded bg-muted break-words"
                        data-testid={`drift-ebay-${key}`}
                      >
                        {formatValue(key, values.ebay)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No drift detected
            </div>
          )}
          
          <div className="mt-6 p-4 rounded-lg bg-muted">
            <div className="text-sm">
              <p className="font-medium mb-2">About Drift Detection</p>
              <p className="text-xs text-muted-foreground">
                Drift occurs when eBay values differ from local cached values. 
                The sync process automatically updates local values to match eBay (eBay is authoritative).
                This view shows what changed during the last sync.
              </p>
            </div>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
