import { useQuery } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { ArrowLeft, FileSpreadsheet } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocation } from "wouter";
import type { ImportRow } from "@shared/schema";

interface ImportDetailsResponse {
  import: {
    id: string;
    filename: string;
    uploadedAt: string;
    rowCount: number;
    status: string;
  };
  rows: ImportRow[];
  hasMore: boolean;
}

export default function ImportDetailsPage() {
  const [, params] = useRoute("/manage/:importId");
  const [, setLocation] = useLocation();
  const importId = params?.importId;

  const { data, isLoading } = useQuery<ImportDetailsResponse>({
    queryKey: ["/api/imports", importId, "details"],
    enabled: !!importId,
  });

  if (!importId) {
    return null;
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLocation("/manage")}
              className="mb-2"
              data-testid="button-back"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Manage Data
            </Button>
            <h1 className="text-2xl font-semibold text-foreground" data-testid="text-page-title">
              Import Details
            </h1>
            {data && (
              <p className="text-sm text-muted-foreground mt-1">
                {data.import.filename} • {new Date(data.import.uploadedAt).toLocaleString()}
              </p>
            )}
          </div>
          {data && (
            <Badge variant={data.import.status === "completed" ? "default" : "secondary"}>
              {data.import.status}
            </Badge>
          )}
        </div>

        {isLoading ? (
          <Card>
            <CardContent className="p-6">
              <div className="space-y-3">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
              </div>
            </CardContent>
          </Card>
        ) : data ? (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Import Summary</CardTitle>
                <CardDescription>
                  {data.import.rowCount} rows processed
                  {data.hasMore && " (showing first 100)"}
                </CardDescription>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Imported Data</CardTitle>
                <CardDescription>Preview of imported rows</CardDescription>
              </CardHeader>
              <CardContent>
                {data.rows.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm" data-testid="table-import-rows">
                      <thead className="border-b">
                        <tr>
                          <th className="text-left p-2 font-semibold">ASIN</th>
                          <th className="text-left p-2 font-semibold">Title</th>
                          <th className="text-left p-2 font-semibold">ETV</th>
                          <th className="text-left p-2 font-semibold">Received Date</th>
                          <th className="text-left p-2 font-semibold">UPC</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.rows.map((row, index) => (
                          <tr
                            key={row.id}
                            className="border-b hover-elevate"
                            data-testid={`row-${index}`}
                          >
                            <td className="p-2 font-mono text-xs">{row.asin}</td>
                            <td className="p-2 max-w-md truncate">{row.titleRaw}</td>
                            <td className="p-2">
                              {row.etvCents ? `$${(row.etvCents / 100).toFixed(2)}` : "-"}
                            </td>
                            <td className="p-2 text-muted-foreground">
                              {row.receivedDate
                                ? new Date(row.receivedDate).toLocaleDateString()
                                : "-"}
                            </td>
                            <td className="p-2 font-mono text-xs">{row.upc || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {data.hasMore && (
                      <div className="mt-4 text-center text-sm text-muted-foreground">
                        Showing first 100 rows of {data.import.rowCount} total
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <FileSpreadsheet className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p>No rows found in this import</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        ) : (
          <Card>
            <CardContent className="p-12 text-center">
              <FileSpreadsheet className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
              <h2 className="text-xl font-semibold mb-2">Import Not Found</h2>
              <p className="text-muted-foreground mb-6">
                The requested import could not be found.
              </p>
              <Button onClick={() => setLocation("/manage")} data-testid="button-back-to-manage">
                Back to Manage Data
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
