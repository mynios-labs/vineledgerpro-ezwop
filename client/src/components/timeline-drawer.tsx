import { useQuery } from "@tanstack/react-query";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock, Package, Truck, CheckCircle, XCircle, AlertCircle } from "lucide-react";

interface TimelineEvent {
  timelineId: string;
  eventType: string;
  note: string;
  metadata: Record<string, any>;
  createdAt: string;
}

interface TimelineDrawerProps {
  orderId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TimelineDrawer({ orderId, open, onOpenChange }: TimelineDrawerProps) {
  const { data: events, isLoading } = useQuery<TimelineEvent[]>({
    queryKey: ["/api/orders", orderId, "timeline"],
    enabled: !!orderId && open,
  });

  const getEventIcon = (eventType: string) => {
    switch (eventType) {
      case "rates_quoted":
        return <Clock className="w-4 h-4" />;
      case "label_purchased":
      case "label_reprinted":
        return <Package className="w-4 h-4" />;
      case "tracking_posted":
      case "in_transit":
        return <Truck className="w-4 h-4" />;
      case "confirmed_shipped":
      case "delivered":
        return <CheckCircle className="w-4 h-4" />;
      case "label_voided":
      case "refund_posted":
        return <XCircle className="w-4 h-4" />;
      case "exception":
      case "drift_detected":
        return <AlertCircle className="w-4 h-4" />;
      default:
        return <Clock className="w-4 h-4" />;
    }
  };

  const getEventColor = (eventType: string) => {
    switch (eventType) {
      case "confirmed_shipped":
      case "delivered":
        return "default";
      case "exception":
      case "label_voided":
        return "destructive";
      case "drift_detected":
        return "secondary";
      default:
        return "outline";
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent data-testid="drawer-timeline">
        <DrawerHeader>
          <DrawerTitle>Order Timeline</DrawerTitle>
        </DrawerHeader>
        <div className="px-4 pb-8 max-h-[60vh] overflow-y-auto">
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="flex gap-4">
                  <Skeleton className="w-10 h-10 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : events && events.length > 0 ? (
            <div className="space-y-6">
              {events.map((event, index) => (
                <div
                  key={event.timelineId}
                  className="flex gap-4"
                  data-testid={`timeline-event-${event.eventType}`}
                >
                  <div className="flex flex-col items-center">
                    <div className="flex items-center justify-center w-10 h-10 rounded-full bg-muted">
                      {getEventIcon(event.eventType)}
                    </div>
                    {index < events.length - 1 && (
                      <div className="w-px h-full bg-border mt-2" />
                    )}
                  </div>
                  <div className="flex-1 pb-6">
                    <div className="flex items-start justify-between gap-4 mb-2">
                      <Badge variant={getEventColor(event.eventType)} data-testid={`badge-${event.eventType}`}>
                        {event.eventType.replace(/_/g, ' ')}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(event.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm text-foreground" data-testid={`text-note-${event.timelineId}`}>
                      {event.note}
                    </p>
                    {event.metadata && Object.keys(event.metadata).length > 0 && (
                      <details className="mt-2">
                        <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                          Details
                        </summary>
                        <pre className="mt-2 text-xs bg-muted p-2 rounded overflow-x-auto">
                          {JSON.stringify(event.metadata, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Clock className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No timeline events yet</p>
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
