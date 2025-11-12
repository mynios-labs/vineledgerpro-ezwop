import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CheckCircle2, XCircle, Loader2, ChevronDown, ExternalLink } from "lucide-react";
import { useState } from "react";

interface ApiTrace {
  step: string;
  endpoint?: string;
  method?: string;
  status?: number;
  statusText?: string;
  logicalFailure?: boolean;
  timestamp: string;
}

interface PublishModalProps {
  isOpen: boolean;
  onClose: () => void;
  publishState: "idle" | "loading" | "success" | "error";
  result?: {
    success?: boolean;
    offerId?: string;
    itemId?: string;
    viewUrl?: string;
    trace?: ApiTrace[];
    error?: string;
    failedStep?: string;
    details?: string[];
  };
}

export function PublishModal({ isOpen, onClose, publishState, result }: PublishModalProps) {
  const [traceExpanded, setTraceExpanded] = useState(false);

  const renderTraceStep = (trace: ApiTrace, index: number) => {
    const isError = trace.status && trace.status >= 400;
    const isLogicalFailure = trace.logicalFailure;
    const isFailed = isError || isLogicalFailure;

    return (
      <div
        key={index}
        className={`p-3 rounded-md border ${
          isFailed ? "border-destructive bg-destructive/5" : "border-border"
        }`}
        data-testid={`trace-step-${index}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-medium">{trace.step}</span>
              {isFailed && (
                <Badge variant="destructive" className="text-xs">
                  Failed
                </Badge>
              )}
            </div>
            {trace.endpoint && (
              <div className="text-xs text-muted-foreground font-mono truncate">
                {trace.method} {trace.endpoint}
              </div>
            )}
          </div>
          {trace.status && (
            <Badge variant={isFailed ? "destructive" : "secondary"} className="shrink-0">
              {trace.status}
            </Badge>
          )}
        </div>
        {trace.statusText && (
          <div className="text-xs text-muted-foreground mt-2">{trace.statusText}</div>
        )}
      </div>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl" data-testid="publish-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {publishState === "loading" && (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Publishing to eBay
              </>
            )}
            {publishState === "success" && (
              <>
                <CheckCircle2 className="w-5 h-5 text-green-600" />
                Published Successfully
              </>
            )}
            {publishState === "error" && (
              <>
                <XCircle className="w-5 h-5 text-destructive" />
                Publish Failed
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {publishState === "loading" && "Please wait while your listing is published to eBay..."}
            {publishState === "success" && "Your listing is now live on eBay."}
            {publishState === "error" && "There was an error publishing your listing."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Success State */}
          {publishState === "success" && result?.itemId && (
            <div className="space-y-3">
              <div className="p-4 rounded-lg border bg-card space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">eBay Item ID</span>
                  <span className="text-sm font-mono" data-testid="text-item-id">
                    {result.itemId}
                  </span>
                </div>
                {result.offerId && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Offer ID</span>
                    <span className="text-sm font-mono text-muted-foreground">{result.offerId}</span>
                  </div>
                )}
              </div>

              {result.viewUrl && (
                <Button
                  variant="default"
                  className="w-full"
                  asChild
                  data-testid="button-view-listing"
                >
                  <a href={result.viewUrl} target="_blank" rel="noopener noreferrer">
                    View Listing on eBay
                    <ExternalLink className="w-4 h-4 ml-2" />
                  </a>
                </Button>
              )}
            </div>
          )}

          {/* Error State */}
          {publishState === "error" && result?.error && (
            <div className="p-4 rounded-lg border border-destructive bg-destructive/5">
              <p className="text-sm font-medium text-destructive mb-2" data-testid="text-error-message">
                {result.error}
              </p>
              {result.details && result.details.length > 0 && (
                <ul className="text-sm text-muted-foreground space-y-1 mt-2">
                  {result.details.map((detail, i) => (
                    <li key={i}>• {detail}</li>
                  ))}
                </ul>
              )}
              {result.failedStep && (
                <p className="text-xs text-muted-foreground mt-3">
                  Failed at: <span className="font-mono">{result.failedStep}</span>
                </p>
              )}
            </div>
          )}

          {/* API Trace (Success or Error) */}
          {(publishState === "success" || publishState === "error") && result?.trace && result.trace.length > 0 && (
            <Collapsible open={traceExpanded} onOpenChange={setTraceExpanded}>
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  className="w-full justify-between"
                  data-testid="button-toggle-trace"
                >
                  <span className="text-sm">API Trace ({result.trace.length} steps)</span>
                  <ChevronDown className={`w-4 h-4 transition-transform ${traceExpanded ? "rotate-180" : ""}`} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ScrollArea className="h-[300px] rounded-md border p-4">
                  <div className="space-y-2">
                    {result.trace.map((trace, index) => renderTraceStep(trace, index))}
                  </div>
                </ScrollArea>
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* Loading State - Progressive Trace */}
          {publishState === "loading" && result?.trace && result.trace.length > 0 && (
            <ScrollArea className="h-[200px] rounded-md border p-4">
              <div className="space-y-2">
                {result.trace.map((trace, index) => renderTraceStep(trace, index))}
              </div>
            </ScrollArea>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2">
            {publishState === "error" && (
              <Button variant="outline" onClick={onClose} data-testid="button-close-error">
                Close
              </Button>
            )}
            {publishState === "success" && (
              <Button onClick={onClose} data-testid="button-close-success">
                Done
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
