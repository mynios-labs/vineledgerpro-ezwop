import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, AlertCircle, Info, CheckCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import type { HealthEvent } from "@shared/schema";

interface HealthMetrics {
  lateShipmentRate: number;
  openCases: number;
  policyAlerts: number;
  listingRemovals: number;
  defectRate: number;
}

export default function HealthPage() {
  const { data: metrics, isLoading: metricsLoading } = useQuery<HealthMetrics>({
    queryKey: ["/api/health/metrics"],
  });

  const { data: events, isLoading: eventsLoading } = useQuery<HealthEvent[]>({
    queryKey: ["/api/health/events"],
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
