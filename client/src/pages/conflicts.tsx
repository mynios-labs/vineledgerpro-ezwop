import { useQuery, useMutation } from "@tanstack/react-query";
import { AlertCircle, Check } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ImportConflict } from "@shared/schema";

export default function ConflictsPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: conflicts, isLoading } = useQuery<ImportConflict[]>({
    queryKey: ["/api/conflicts"],
  });

  const resolveConflictMutation = useMutation({
    mutationFn: async ({ conflictId, selectedEtvCents }: { conflictId: string; selectedEtvCents: number }) => {
      return await apiRequest("POST", `/api/conflicts/${conflictId}/resolve`, {
        selectedEtvCents,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conflicts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vine-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vine-items/stats"] });
      toast({
        title: "Success",
        description: "Conflict resolved successfully",
      });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to resolve conflict",
      });
    },
  });

  const handleResolve = (conflictId: string, selectedEtvCents: number) => {
    resolveConflictMutation.mutate({ conflictId, selectedEtvCents });
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground" data-testid="text-page-title">
              Import Conflicts
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Resolve ETV value conflicts from your import
            </p>
          </div>
          <Button variant="outline" onClick={() => setLocation("/")} data-testid="button-back">
            Back to Inventory
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardContent className="p-6">
                  <div className="space-y-3">
                    <Skeleton className="h-5 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : conflicts && conflicts.length > 0 ? (
          <div className="space-y-4">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Conflicts Detected</AlertTitle>
              <AlertDescription>
                {conflicts.length} items have conflicting ETV values. Please review and select the correct value for each item.
              </AlertDescription>
            </Alert>

            {conflicts.map((conflict) => (
              <Card key={conflict.conflictId} data-testid={`card-conflict-${conflict.conflictId}`}>
                <CardHeader>
                  <CardTitle className="text-lg">{conflict.titleNorm}</CardTitle>
                  <CardDescription className="font-mono">
                    ASIN: {conflict.asin} • Received: {new Date(conflict.receivedDate).toLocaleDateString()}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="text-sm text-muted-foreground">
                    The Estimated Tax Value (ETV) for this item has changed. Please select which value is correct:
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Card className="border-2">
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <Badge variant="outline">Current Value</Badge>
                        </div>
                        <div className="text-3xl font-semibold">
                          ${(conflict.existingEtvCents / 100).toFixed(2)}
                        </div>
                        <Button
                          className="w-full"
                          variant="outline"
                          onClick={() => handleResolve(conflict.conflictId, conflict.existingEtvCents)}
                          disabled={resolveConflictMutation.isPending}
                          data-testid={`button-keep-existing-${conflict.conflictId}`}
                        >
                          <Check className="w-4 h-4 mr-2" />
                          Keep Current Value
                        </Button>
                      </CardContent>
                    </Card>

                    <Card className="border-2 border-primary">
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <Badge variant="default">New Value</Badge>
                        </div>
                        <div className="text-3xl font-semibold text-primary">
                          ${(conflict.newEtvCents / 100).toFixed(2)}
                        </div>
                        <Button
                          className="w-full"
                          onClick={() => handleResolve(conflict.conflictId, conflict.newEtvCents)}
                          disabled={resolveConflictMutation.isPending}
                          data-testid={`button-use-new-${conflict.conflictId}`}
                        >
                          <Check className="w-4 h-4 mr-2" />
                          Use New Value
                        </Button>
                      </CardContent>
                    </Card>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="p-12 text-center">
              <Check className="w-16 h-16 mx-auto mb-4 text-chart-1" />
              <h2 className="text-xl font-semibold mb-2">No Conflicts</h2>
              <p className="text-muted-foreground mb-6">
                All import conflicts have been resolved.
              </p>
              <Button onClick={() => setLocation("/")} data-testid="button-goto-inventory">
                Go to Inventory
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
