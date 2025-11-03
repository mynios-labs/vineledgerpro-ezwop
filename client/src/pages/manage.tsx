import { useQuery, useMutation } from "@tanstack/react-query";
import { Trash2, AlertTriangle, Database } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import type { Import } from "@shared/schema";

export default function ManagePage() {
  const { toast } = useToast();
  const [clearAllDialogOpen, setClearAllDialogOpen] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const { data: imports, isLoading } = useQuery<Import[]>({
    queryKey: ["/api/imports"],
  });

  const deleteImportMutation = useMutation({
    mutationFn: async (importId: string) => {
      return await apiRequest("DELETE", `/api/imports/${importId}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/imports"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vine-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vine-items/stats"] });
      toast({
        title: "Success",
        description: "Import deleted successfully",
      });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to delete import",
      });
    },
  });

  const clearAllDataMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/imports/clear-all", {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/imports"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vine-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vine-items/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/conflicts"] });
      setClearAllDialogOpen(false);
      setConfirmClearAll(false);
      toast({
        title: "Success",
        description: "All data cleared successfully",
      });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to clear all data",
      });
    },
  });

  const handleClearAll = () => {
    if (confirmClearAll) {
      clearAllDataMutation.mutate();
    }
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground" data-testid="text-page-title">
              Manage Data
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              View and manage your import history
            </p>
          </div>

          <AlertDialog open={clearAllDialogOpen} onOpenChange={setClearAllDialogOpen}>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" data-testid="button-clear-all-trigger">
                <Database className="w-4 h-4 mr-2" />
                Clear All Data
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="w-5 h-5" />
                  Clear All Data?
                </AlertDialogTitle>
                <AlertDialogDescription className="space-y-3">
                  <p className="font-semibold text-foreground">
                    This will permanently delete ALL data from your database:
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    <li>All imports and import rows</li>
                    <li>All Vine items</li>
                    <li>All inventory items</li>
                    <li>All listings</li>
                    <li>All orders and buyers</li>
                    <li>All accounting ledger entries</li>
                    <li>All health events</li>
                  </ul>
                  <p className="font-semibold text-destructive mt-4">
                    This action cannot be undone!
                  </p>
                  {!confirmClearAll && (
                    <div className="mt-4 p-3 bg-muted rounded-md">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={confirmClearAll}
                          onChange={(e) => setConfirmClearAll(e.target.checked)}
                          className="w-4 h-4"
                          data-testid="checkbox-confirm-clear-all"
                        />
                        <span className="text-sm">
                          I understand this will delete all my data permanently
                        </span>
                      </label>
                    </div>
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="button-cancel-clear-all">Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleClearAll}
                  disabled={!confirmClearAll || clearAllDataMutation.isPending}
                  className="bg-destructive hover:bg-destructive/90"
                  data-testid="button-confirm-clear-all"
                >
                  {clearAllDataMutation.isPending ? "Clearing..." : "Clear All Data"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardContent className="p-6">
                  <div className="space-y-3">
                    <Skeleton className="h-5 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : imports && imports.length > 0 ? (
          <div className="space-y-4">
            {imports.map((importRecord) => (
              <Card key={importRecord.id} data-testid={`card-import-${importRecord.id}`}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-lg truncate">{importRecord.filename}</CardTitle>
                      <CardDescription className="mt-1">
                        Uploaded: {new Date(importRecord.uploadedAt).toLocaleString()}
                      </CardDescription>
                    </div>
                    <Badge variant={importRecord.status === "completed" ? "default" : "secondary"}>
                      {importRecord.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between gap-4">
                    <div className="text-sm text-muted-foreground">
                      {importRecord.rowCount} rows processed
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="destructive"
                          size="sm"
                          data-testid={`button-delete-${importRecord.id}`}
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete Import
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Import?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will delete the import record and all associated import rows. 
                            Vine items created from this import will NOT be deleted.
                            <br /><br />
                            <span className="font-semibold text-foreground">File: {importRecord.filename}</span>
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel data-testid={`button-cancel-delete-${importRecord.id}`}>
                            Cancel
                          </AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deleteImportMutation.mutate(importRecord.id)}
                            disabled={deleteImportMutation.isPending}
                            className="bg-destructive hover:bg-destructive/90"
                            data-testid={`button-confirm-delete-${importRecord.id}`}
                          >
                            Delete Import
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="p-12 text-center">
              <Database className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
              <h2 className="text-xl font-semibold mb-2">No Imports Yet</h2>
              <p className="text-muted-foreground">
                Upload your first XLSX file to get started.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
