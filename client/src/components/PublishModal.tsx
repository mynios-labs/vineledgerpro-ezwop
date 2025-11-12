import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CheckCircle2, XCircle, Loader2, ChevronDown, ExternalLink, Copy, Check } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

interface ApiTraceStep {
  step: string;
  method: string;
  url: string;
  timestamp: string;
  requestHeaders?: Record<string, string>;
  requestBody?: any;
  responseStatus?: number;
  responseHeaders?: Record<string, string>;
  responseBody?: any;
  correlationId?: string;
  error?: string;
  durationMs?: number;
}

interface EbayError {
  errorId?: string;
  message?: string;
  longMessage?: string;
  parameters?: { name: string; value: string }[];
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
    reusingExistingOffer?: boolean;
    diagnostics?: {
      sku?: string;
      packageWeightAndSize?: any;
      fulfillmentPolicyId?: string;
      categoryId?: string;
      priceCents?: number;
    };
    trace?: ApiTraceStep[];
    error?: string;
    failedStep?: ApiTraceStep;
    details?: string[];
    ebayErrors?: EbayError[];
    ebayErrorDetails?: any;
  };
}

export function PublishModal({ isOpen, onClose, publishState, result }: PublishModalProps) {
  const [traceExpanded, setTraceExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const copyAllToClipboard = () => {
    if (!result?.trace) return;

    const traceText = result.trace.map((step, index) => {
      const lines = [
        `========== STEP ${index + 1}: ${step.step} ==========`,
        `Method: ${step.method}`,
        `URL: ${step.url}`,
        `Timestamp: ${step.timestamp}`,
        step.durationMs !== undefined ? `Duration: ${step.durationMs}ms` : null,
        step.correlationId ? `Correlation ID: ${step.correlationId}` : null,
        '',
        'REQUEST HEADERS:',
        step.requestHeaders ? JSON.stringify(step.requestHeaders, null, 2) : 'N/A',
        '',
        'REQUEST BODY:',
        step.requestBody ? JSON.stringify(step.requestBody, null, 2) : 'N/A',
        '',
        step.responseStatus !== undefined ? `Response Status: ${step.responseStatus}` : null,
        '',
        'RESPONSE HEADERS:',
        step.responseHeaders ? JSON.stringify(step.responseHeaders, null, 2) : 'N/A',
        '',
        'RESPONSE BODY:',
        step.responseBody !== null && step.responseBody !== undefined ? JSON.stringify(step.responseBody, null, 2) : 'N/A',
        '',
        step.error ? `ERROR: ${step.error}` : null,
        '',
      ].filter(Boolean);
      return lines.join('\n');
    }).join('\n\n');

    navigator.clipboard.writeText(traceText).then(() => {
      setCopied(true);
      toast({
        title: "Copied to clipboard",
        description: "Full API trace copied to clipboard",
      });
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const renderTraceStep = (trace: ApiTraceStep, index: number) => {
    const isError = trace.responseStatus && trace.responseStatus >= 400;
    const hasError = !!trace.error;
    const isFailed = isError || hasError;

    return (
      <div
        key={index}
        className={`p-4 rounded-md border ${
          isFailed ? "border-destructive bg-destructive/5" : "border-border"
        }`}
        data-testid={`trace-step-${index}`}
      >
        <div className="space-y-3">
          {/* Step Header */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-semibold">{trace.step}</span>
                {isFailed && (
                  <Badge variant="destructive" className="text-xs">
                    Failed
                  </Badge>
                )}
              </div>
              <div className="text-xs font-mono text-muted-foreground">
                {trace.method} {trace.url}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {trace.durationMs !== undefined && (
                <span className="text-xs text-muted-foreground">{trace.durationMs}ms</span>
              )}
              {trace.responseStatus && (
                <Badge variant={isFailed ? "destructive" : "secondary"}>
                  {trace.responseStatus}
                </Badge>
              )}
            </div>
          </div>

          {/* Correlation ID */}
          {trace.correlationId && (
            <div className="text-xs">
              <span className="text-muted-foreground">Correlation ID:</span>{" "}
              <code className="font-mono bg-muted px-1 py-0.5 rounded">{trace.correlationId}</code>
            </div>
          )}

          {/* Request Headers - Always shown */}
          <div className="space-y-1">
            <div className="text-xs font-semibold">Request Headers:</div>
            <pre className="text-xs font-mono bg-muted p-2 rounded overflow-x-auto">
              {trace.requestHeaders && Object.keys(trace.requestHeaders).length > 0
                ? JSON.stringify(trace.requestHeaders, null, 2)
                : 'N/A'}
            </pre>
          </div>

          {/* Request Body - Always shown */}
          <div className="space-y-1">
            <div className="text-xs font-semibold">Request Body:</div>
            <pre className="text-xs font-mono bg-muted p-2 rounded overflow-x-auto">
              {trace.requestBody
                ? (typeof trace.requestBody === 'string' ? trace.requestBody : JSON.stringify(trace.requestBody, null, 2))
                : 'N/A'}
            </pre>
          </div>

          {/* Response Headers - Always shown */}
          <div className="space-y-1">
            <div className="text-xs font-semibold">Response Headers:</div>
            <pre className="text-xs font-mono bg-muted p-2 rounded overflow-x-auto">
              {trace.responseHeaders && Object.keys(trace.responseHeaders).length > 0
                ? JSON.stringify(trace.responseHeaders, null, 2)
                : 'N/A'}
            </pre>
          </div>

          {/* Response Body - Always shown */}
          <div className="space-y-1">
            <div className="text-xs font-semibold">Response Body:</div>
            <pre className="text-xs font-mono bg-muted p-2 rounded overflow-x-auto">
              {trace.responseBody !== null && trace.responseBody !== undefined
                ? (typeof trace.responseBody === 'string' ? trace.responseBody : JSON.stringify(trace.responseBody, null, 2))
                : 'N/A'}
            </pre>
          </div>

          {/* Error */}
          {trace.error && (
            <div className="p-2 bg-destructive/10 border border-destructive rounded">
              <div className="text-xs font-semibold text-destructive mb-1">Error:</div>
              <div className="text-xs text-destructive">{trace.error}</div>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-[900px] max-h-[80vh] flex flex-col" data-testid="publish-modal">
        <DialogHeader className="flex-shrink-0">
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

        <div className="flex-1 overflow-auto space-y-4 pr-2">
          {/* Success State */}
          {publishState === "success" && result?.itemId && (
            <div className="space-y-3">
              <div className="p-4 rounded-lg border bg-card space-y-3">
                <div className="space-y-2">
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
                  {result.reusingExistingOffer !== undefined && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Offer Status</span>
                      <Badge variant={result.reusingExistingOffer ? "secondary" : "default"} className="text-xs">
                        {result.reusingExistingOffer ? "Reused Existing" : "Created New"}
                      </Badge>
                    </div>
                  )}
                </div>

                {result.diagnostics && (
                  <div className="pt-3 border-t space-y-2">
                    <div className="text-xs font-semibold text-muted-foreground">Diagnostics</div>
                    {result.diagnostics.packageWeightAndSize && (
                      <div className="text-xs font-mono text-muted-foreground">
                        Weight: {result.diagnostics.packageWeightAndSize.weight?.value} {result.diagnostics.packageWeightAndSize.weight?.unit} | 
                        Dims: {result.diagnostics.packageWeightAndSize.dimensions?.length}×{result.diagnostics.packageWeightAndSize.dimensions?.width}×{result.diagnostics.packageWeightAndSize.dimensions?.height} {result.diagnostics.packageWeightAndSize.dimensions?.unit}
                      </div>
                    )}
                    {result.diagnostics.fulfillmentPolicyId && (
                      <div className="text-xs font-mono text-muted-foreground">
                        Fulfillment Policy: {result.diagnostics.fulfillmentPolicyId}
                      </div>
                    )}
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
            <div className="space-y-3">
              <div className="p-4 rounded-lg border border-destructive bg-destructive/5 space-y-3">
                <p className="text-sm font-medium text-destructive" data-testid="text-error-message">
                  {result.error}
                </p>
                
                {/* Structured eBay Errors */}
                {result.ebayErrors && result.ebayErrors.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-destructive">eBay Error Details:</div>
                    {result.ebayErrors.map((err, i) => (
                      <div key={i} className="p-2 bg-background rounded border border-destructive/30 space-y-1">
                        {err.errorId && (
                          <div className="text-xs font-mono text-destructive">[{err.errorId}]</div>
                        )}
                        <div className="text-sm">{err.message || err.longMessage}</div>
                        {err.parameters && err.parameters.length > 0 && (
                          <div className="text-xs font-mono text-muted-foreground">
                            {err.parameters.map((p, j) => (
                              <span key={j}>{p.name}: {p.value}{j < err.parameters!.length - 1 ? ', ' : ''}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Fallback generic details */}
                {!result.ebayErrors && result.details && result.details.length > 0 && (
                  <ul className="text-sm text-muted-foreground space-y-1">
                    {result.details.map((detail, i) => (
                      <li key={i}>• {detail}</li>
                    ))}
                  </ul>
                )}

                {result.failedStep && typeof result.failedStep === 'object' && (
                  <p className="text-xs text-muted-foreground pt-2 border-t">
                    Failed at: <span className="font-mono">{result.failedStep.step}</span>
                  </p>
                )}
              </div>

              {/* Complete eBay Error Response */}
              {result.ebayErrorDetails && (
                <Collapsible>
                  <CollapsibleTrigger asChild>
                    <Button variant="outline" className="w-full justify-between" size="sm">
                      <span className="text-xs">Complete eBay Error Response</span>
                      <ChevronDown className="w-4 h-4" />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="mt-2 p-3 bg-muted rounded border">
                      <pre className="text-xs font-mono overflow-x-auto">
                        {JSON.stringify(result.ebayErrorDetails, null, 2)}
                      </pre>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </div>
          )}

          {/* API Trace (Always Shown) */}
          {((publishState === "success" || publishState === "error") && result?.trace && result.trace.length > 0) && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Collapsible open={traceExpanded} onOpenChange={setTraceExpanded} className="flex-1">
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
                    <div className="mt-2 space-y-2 max-h-[400px] overflow-y-auto pr-2">
                      {result.trace.map((trace, index) => renderTraceStep(trace, index))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={copyAllToClipboard}
                  className="ml-2"
                  data-testid="button-copy-trace"
                >
                  {copied ? (
                    <>
                      <Check className="w-4 h-4 mr-2" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 mr-2" />
                      Copy All
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Loading State - Progressive Trace */}
          {publishState === "loading" && result?.trace && result.trace.length > 0 && (
            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
              {result.trace.map((trace, index) => renderTraceStep(trace, index))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 flex-shrink-0 pt-4 border-t">
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
      </DialogContent>
    </Dialog>
  );
}
