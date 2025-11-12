import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, AlertCircle, Info, CheckCircle, XCircle, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { HealthEvent } from "@shared/schema";

interface HealthMetrics {
  lateShipmentRate: number;
  openCases: number;
  policyAlerts: number;
  listingRemovals: number;
  defectRate: number;
}

interface EbayPrerequisitesCheck {
  environment: string;
  timestamp: string;
  checks: {
    sellerPrivileges?: {
      status: string;
      sellerRegistrationCompleted?: boolean;
      restrictions?: any[];
      message: string;
    };
    userIdentity?: {
      status: string;
      username?: string;
      expected?: string;
      message: string;
    };
    paymentPolicies?: {
      status: string;
      totalPolicies: number;
      activePolicies: number;
      policies: any[];
      message: string;
    };
    returnPolicies?: {
      status: string;
      totalPolicies: number;
      activePolicies: number;
      policies: any[];
      message: string;
    };
    fulfillmentPolicies?: {
      status: string;
      totalPolicies: number;
      activePolicies: number;
      policies: any[];
      message: string;
    };
  };
  summary: {
    passed: number;
    failed: number;
    warnings: number;
  };
  overallStatus: string;
  message: string;
}

export default function HealthPage() {
  const { data: metrics, isLoading: metricsLoading } = useQuery<HealthMetrics>({
    queryKey: ["/api/health/metrics"],
  });

  const { data: events, isLoading: eventsLoading } = useQuery<HealthEvent[]>({
    queryKey: ["/api/health/events"],
  });

  const { data: ebayPrereqs, isLoading: ebayPrereqsLoading, refetch: refetchEbayPrereqs } = useQuery<EbayPrerequisitesCheck>({
    queryKey: ["/api/health/ebay-prerequisites"],
    refetchInterval: false,
    retry: 1,
  });

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "critical":
        return "destructive";
      case "warning":
        return "outline";
      default:
        return "secondary";
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case "critical":
        return <AlertCircle className="h-4 w-4" />;
      case "warning":
        return <AlertTriangle className="h-4 w-4" />;
      default:
        return <Info className="h-4 w-4" />;
    }
  };

  const getHealthStatus = () => {
    if (!metrics) return { status: "unknown", color: "text-muted-foreground", label: "Loading..." };
    
    const hasIssues = metrics.lateShipmentRate > 2 || metrics.openCases > 5 || metrics.policyAlerts > 0 || metrics.defectRate > 1;
    const hasWarnings = metrics.lateShipmentRate > 1 || metrics.openCases > 2;

    if (hasIssues) {
      return { status: "poor", color: "text-chart-5", label: "Needs Attention" };
    } else if (hasWarnings) {
      return { status: "fair", color: "text-chart-3", label: "Fair" };
    } else {
      return { status: "good", color: "text-chart-1", label: "Healthy" };
    }
  };

  const healthStatus = getHealthStatus();

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground" data-testid="text-page-title">Account Health</h1>
          <p className="text-sm text-muted-foreground mt-1">Monitor your seller performance and policy compliance</p>
        </div>

        {/* Overall Health Status */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Overall Status</CardTitle>
          </CardHeader>
          <CardContent>
            {metricsLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <div className="flex items-center gap-4">
                {healthStatus.status === "good" ? (
                  <CheckCircle className={`w-12 h-12 ${healthStatus.color}`} />
                ) : healthStatus.status === "fair" ? (
                  <AlertTriangle className={`w-12 h-12 ${healthStatus.color}`} />
                ) : (
                  <AlertCircle className={`w-12 h-12 ${healthStatus.color}`} />
                )}
                <div className="flex-1">
                  <div className={`text-2xl font-semibold ${healthStatus.color}`} data-testid="text-health-status">
                    {healthStatus.label}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">
                    {healthStatus.status === "good" 
                      ? "Your account is in good standing"
                      : healthStatus.status === "fair"
                      ? "Some metrics need attention"
                      : "Immediate action required to maintain seller status"}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* eBay API Prerequisites */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
            <div>
              <CardTitle className="text-lg">eBay API Prerequisites</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Verify your eBay seller account is ready for API listing
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchEbayPrereqs()}
              disabled={ebayPrereqsLoading}
              data-testid="button-refresh-prereqs"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${ebayPrereqsLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {ebayPrereqsLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : ebayPrereqs ? (
              <>
                {/* Overall Status Banner */}
                <Alert 
                  variant={ebayPrereqs.overallStatus === "ready" ? "default" : "destructive"}
                  className={ebayPrereqs.overallStatus === "ready" ? "border-chart-1 bg-chart-1/10" : ""}
                >
                  {ebayPrereqs.overallStatus === "ready" ? (
                    <CheckCircle className="h-4 w-4 text-chart-1" />
                  ) : (
                    <XCircle className="h-4 w-4" />
                  )}
                  <AlertTitle className="flex items-center gap-2">
                    {ebayPrereqs.overallStatus === "ready" ? "Ready to Publish" : "Setup Required"}
                    <Badge variant={ebayPrereqs.overallStatus === "ready" ? "default" : "destructive"} className="text-xs">
                      {ebayPrereqs.environment}
                    </Badge>
                  </AlertTitle>
                  <AlertDescription>
                    <div className="text-sm">{ebayPrereqs.message}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Passed: {ebayPrereqs.summary.passed} | Failed: {ebayPrereqs.summary.failed} | Warnings: {ebayPrereqs.summary.warnings}
                    </div>
                  </AlertDescription>
                </Alert>

                {/* Individual Checks */}
                <div className="space-y-3">
                  {/* Seller Privileges */}
                  {ebayPrereqs.checks.sellerPrivileges && (
                    <div className="flex items-start gap-3 p-3 rounded-lg border bg-card">
                      {ebayPrereqs.checks.sellerPrivileges.status === "pass" ? (
                        <CheckCircle className="w-5 h-5 text-chart-1 flex-shrink-0 mt-0.5" />
                      ) : ebayPrereqs.checks.sellerPrivileges.status === "warning" ? (
                        <AlertTriangle className="w-5 h-5 text-chart-3 flex-shrink-0 mt-0.5" />
                      ) : (
                        <XCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm">Seller Privileges</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {ebayPrereqs.checks.sellerPrivileges.message}
                        </div>
                        {ebayPrereqs.checks.sellerPrivileges.restrictions && ebayPrereqs.checks.sellerPrivileges.restrictions.length > 0 && (
                          <div className="text-xs text-destructive mt-1 font-mono">
                            Restrictions: {JSON.stringify(ebayPrereqs.checks.sellerPrivileges.restrictions)}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* User Identity */}
                  {ebayPrereqs.checks.userIdentity && (
                    <div className="flex items-start gap-3 p-3 rounded-lg border bg-card">
                      {ebayPrereqs.checks.userIdentity.status === "pass" ? (
                        <CheckCircle className="w-5 h-5 text-chart-1 flex-shrink-0 mt-0.5" />
                      ) : ebayPrereqs.checks.userIdentity.status === "warning" ? (
                        <AlertTriangle className="w-5 h-5 text-chart-3 flex-shrink-0 mt-0.5" />
                      ) : (
                        <XCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm">User Identity</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {ebayPrereqs.checks.userIdentity.message}
                        </div>
                        {ebayPrereqs.checks.userIdentity.username && (
                          <div className="text-xs font-mono mt-1">
                            Username: {ebayPrereqs.checks.userIdentity.username}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Business Policies */}
                  {(ebayPrereqs.checks.paymentPolicies || ebayPrereqs.checks.returnPolicies || ebayPrereqs.checks.fulfillmentPolicies) && (
                    <Collapsible>
                      <CollapsibleTrigger asChild>
                        <div className="flex items-center gap-2 p-3 rounded-lg border bg-card cursor-pointer hover-elevate">
                          <div className="flex-1">
                            <div className="font-medium text-sm">Business Policies</div>
                            <div className="text-xs text-muted-foreground mt-1">
                              {[ebayPrereqs.checks.paymentPolicies, ebayPrereqs.checks.returnPolicies, ebayPrereqs.checks.fulfillmentPolicies]
                                .filter(p => p?.status === "pass").length} / 3 configured
                            </div>
                          </div>
                          <Button variant="ghost" size="sm">View Details</Button>
                        </div>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-2 space-y-2 pl-4">
                        {/* Payment Policies */}
                        {ebayPrereqs.checks.paymentPolicies && (
                          <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/50">
                            {ebayPrereqs.checks.paymentPolicies.status === "pass" ? (
                              <CheckCircle className="w-4 h-4 text-chart-1 flex-shrink-0 mt-0.5" />
                            ) : (
                              <XCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-xs">Payment Policies</div>
                              <div className="text-xs text-muted-foreground mt-1">
                                {ebayPrereqs.checks.paymentPolicies.message}
                              </div>
                              {ebayPrereqs.checks.paymentPolicies.policies.length > 0 && (
                                <div className="text-xs font-mono mt-1 space-y-1">
                                  {ebayPrereqs.checks.paymentPolicies.policies.map((policy: any, i: number) => (
                                    <div key={i}>{policy.name} ({policy.id})</div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Return Policies */}
                        {ebayPrereqs.checks.returnPolicies && (
                          <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/50">
                            {ebayPrereqs.checks.returnPolicies.status === "pass" ? (
                              <CheckCircle className="w-4 h-4 text-chart-1 flex-shrink-0 mt-0.5" />
                            ) : (
                              <XCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-xs">Return Policies</div>
                              <div className="text-xs text-muted-foreground mt-1">
                                {ebayPrereqs.checks.returnPolicies.message}
                              </div>
                              {ebayPrereqs.checks.returnPolicies.policies.length > 0 && (
                                <div className="text-xs font-mono mt-1 space-y-1">
                                  {ebayPrereqs.checks.returnPolicies.policies.map((policy: any, i: number) => (
                                    <div key={i}>{policy.name} ({policy.id})</div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Fulfillment Policies */}
                        {ebayPrereqs.checks.fulfillmentPolicies && (
                          <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/50">
                            {ebayPrereqs.checks.fulfillmentPolicies.status === "pass" ? (
                              <CheckCircle className="w-4 h-4 text-chart-1 flex-shrink-0 mt-0.5" />
                            ) : (
                              <XCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-xs">Fulfillment Policies</div>
                              <div className="text-xs text-muted-foreground mt-1">
                                {ebayPrereqs.checks.fulfillmentPolicies.message}
                              </div>
                              {ebayPrereqs.checks.fulfillmentPolicies.policies.length > 0 && (
                                <div className="text-xs font-mono mt-1 space-y-1">
                                  {ebayPrereqs.checks.fulfillmentPolicies.policies.map((policy: any, i: number) => (
                                    <div key={i}>{policy.name} ({policy.id})</div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </div>

                {/* Help Text for Failed Checks */}
                {ebayPrereqs.overallStatus !== "ready" && (
                  <Alert>
                    <Info className="h-4 w-4" />
                    <AlertTitle>Next Steps</AlertTitle>
                    <AlertDescription className="text-xs space-y-2">
                      <p>To fix failed checks:</p>
                      <ol className="list-decimal list-inside space-y-1 ml-2">
                        <li>Open eBay Developer Portal → Your App → User Tokens</li>
                        <li>Click "OAuth (new security)" → "Sign in to Production"</li>
                        <li>Confirm logged in as correct seller account (antonioomar)</li>
                        <li>Grant all required scopes (sell.inventory, sell.fulfillment, sell.account)</li>
                        <li>Copy new refresh token to Replit secrets (EBAY_PROD_REFRESH_TOKEN)</li>
                        <li>Configure business policies in eBay Seller Hub → Business Policies</li>
                        <li>Click Refresh button above to recheck</li>
                      </ol>
                    </AlertDescription>
                  </Alert>
                )}
              </>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Failed to load eBay prerequisites</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Metrics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Late Shipment Rate</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="space-y-2">
              {metricsLoading ? (
                <Skeleton className="h-9 w-20" />
              ) : (
                <>
                  <div className="text-3xl font-semibold" data-testid="text-late-shipment-rate">
                    {metrics?.lateShipmentRate.toFixed(1)}%
                  </div>
                  <Progress value={metrics?.lateShipmentRate || 0} className="h-2" />
                  <div className="text-xs text-muted-foreground">Target: &lt; 2%</div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Open Cases</CardTitle>
              <AlertCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {metricsLoading ? (
                <Skeleton className="h-9 w-16" />
              ) : (
                <div className="text-3xl font-semibold" data-testid="text-open-cases">
                  {metrics?.openCases || 0}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Policy Alerts</CardTitle>
              <AlertTriangle className="h-4 w-4 text-chart-3" />
            </CardHeader>
            <CardContent>
              {metricsLoading ? (
                <Skeleton className="h-9 w-16" />
              ) : (
                <div className={`text-3xl font-semibold ${(metrics?.policyAlerts || 0) > 0 ? 'text-chart-5' : 'text-chart-1'}`} data-testid="text-policy-alerts">
                  {metrics?.policyAlerts || 0}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Defect Rate</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="space-y-2">
              {metricsLoading ? (
                <Skeleton className="h-9 w-20" />
              ) : (
                <>
                  <div className="text-3xl font-semibold" data-testid="text-defect-rate">
                    {metrics?.defectRate.toFixed(1)}%
                  </div>
                  <Progress value={metrics?.defectRate || 0} className="h-2" />
                  <div className="text-xs text-muted-foreground">Target: &lt; 1%</div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Recent Events */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recent Health Events</CardTitle>
          </CardHeader>
          <CardContent>
            {eventsLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            ) : events && events.length > 0 ? (
              <div className="space-y-3">
                {events.map((event) => (
                  <Alert
                    key={event.id}
                    variant={event.severity === "critical" ? "destructive" : "default"}
                    className={event.severity === "warning" ? "border-chart-3 bg-chart-3/10" : ""}
                    data-testid={`event-${event.id}`}
                  >
                    {getSeverityIcon(event.severity)}
                    <AlertTitle className="flex items-center gap-2">
                      <span>{event.kind}</span>
                      <Badge variant={getSeverityColor(event.severity)} data-testid={`badge-severity-${event.id}`}>
                        {event.severity}
                      </Badge>
                    </AlertTitle>
                    <AlertDescription className="mt-2">
                      <div className="text-sm mb-1" data-testid={`text-message-${event.id}`}>{event.message}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(event.createdAt).toLocaleString()}
                      </div>
                    </AlertDescription>
                  </Alert>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <CheckCircle className="w-12 h-12 mx-auto mb-4 opacity-50 text-chart-1" />
                <p>No health events - all systems operating normally</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Action Items */}
        {metrics && (metrics.policyAlerts > 0 || metrics.lateShipmentRate > 2) && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Action Required</AlertTitle>
            <AlertDescription>
              <ul className="list-disc list-inside mt-2 space-y-1">
                {metrics.lateShipmentRate > 2 && (
                  <li>Improve shipping times to reduce late shipment rate below 2%</li>
                )}
                {metrics.policyAlerts > 0 && (
                  <li>Review and resolve {metrics.policyAlerts} policy alert(s)</li>
                )}
              </ul>
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}
