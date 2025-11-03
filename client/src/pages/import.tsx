import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Upload, CheckCircle, AlertCircle, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLocation } from "wouter";

export default function ImportPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [reconciliation, setReconciliation] = useState<{
    added: number;
    unchanged: number;
    conflicts: number;
  } | null>(null);

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      
      setUploadProgress(50);
      const response = await apiRequest("POST", "/api/imports/upload", formData);
      setUploadProgress(100);
      return response;
    },
    onSuccess: (data) => {
      setReconciliation(data.reconciliation);
      queryClient.invalidateQueries({ queryKey: ["/api/vine-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vine-items/stats"] });
      toast({
        title: "Import successful",
        description: `Added ${data.reconciliation.added} new items`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Import failed",
        description: error.message,
        variant: "destructive",
      });
      setUploadProgress(0);
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (!selectedFile.name.endsWith(".xlsx") && !selectedFile.name.endsWith(".xls")) {
        toast({
          title: "Invalid file type",
          description: "Please select an Excel file (.xlsx or .xls)",
          variant: "destructive",
        });
        return;
      }
      setFile(selectedFile);
      setReconciliation(null);
      setUploadProgress(0);
    }
  };

  const handleUpload = () => {
    if (file) {
      importMutation.mutate(file);
    }
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground" data-testid="text-page-title">Import Vine Items</h1>
            <p className="text-sm text-muted-foreground mt-1">Upload your Amazon Vine XLSX spreadsheet</p>
          </div>
          <Button variant="outline" onClick={() => setLocation("/")} data-testid="button-back">
            Back to Inventory
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Upload Spreadsheet</CardTitle>
            <CardDescription>
              Select your Vine items Excel file. The system will automatically deduplicate and reconcile with existing data.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div
              className="border-2 border-dashed border-border rounded-lg p-12 text-center hover-elevate cursor-pointer transition-all"
              onClick={() => document.getElementById("file-input")?.click()}
              data-testid="dropzone-file-upload"
            >
              <input
                id="file-input"
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileChange}
                className="hidden"
                data-testid="input-file"
              />
              <FileSpreadsheet className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-base font-medium mb-2">
                {file ? file.name : "Click to select an Excel file"}
              </p>
              <p className="text-sm text-muted-foreground">
                Supports .xlsx and .xls formats
              </p>
            </div>

            {file && (
              <>
                {uploadProgress > 0 && uploadProgress < 100 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Uploading...</span>
                      <span className="font-medium">{uploadProgress}%</span>
                    </div>
                    <Progress value={uploadProgress} data-testid="progress-upload" />
                  </div>
                )}

                <Button
                  onClick={handleUpload}
                  disabled={importMutation.isPending}
                  className="w-full"
                  data-testid="button-upload"
                >
                  {importMutation.isPending ? (
                    <>Processing...</>
                  ) : (
                    <>
                      <Upload className="w-4 h-4 mr-2" />
                      Import File
                    </>
                  )}
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        {reconciliation && (
          <Alert className="border-chart-1 bg-chart-1/10">
            <CheckCircle className="h-4 w-4 text-chart-1" />
            <AlertTitle className="text-chart-1">Import Completed</AlertTitle>
            <AlertDescription className="mt-2 space-y-2">
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <div className="font-semibold text-foreground" data-testid="text-added-count">{reconciliation.added}</div>
                  <div className="text-muted-foreground">Added</div>
                </div>
                <div>
                  <div className="font-semibold text-foreground" data-testid="text-unchanged-count">{reconciliation.unchanged}</div>
                  <div className="text-muted-foreground">Unchanged</div>
                </div>
                <div>
                  <div className="font-semibold text-foreground" data-testid="text-conflicts-count">{reconciliation.conflicts}</div>
                  <div className="text-muted-foreground">Conflicts</div>
                </div>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {reconciliation && reconciliation.conflicts > 0 && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Conflicts Detected</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>{reconciliation.conflicts} items have conflicting ETV values. Please review and resolve these conflicts.</p>
              <Button
                variant="outline"
                className="mt-2"
                onClick={() => setLocation("/conflicts")}
                data-testid="button-resolve-conflicts"
              >
                Resolve Conflicts
              </Button>
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}
