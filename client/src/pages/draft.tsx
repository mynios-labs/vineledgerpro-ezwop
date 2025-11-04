import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowLeft, Upload, X, AlertTriangle, CheckCircle, Sparkles, RefreshCw, Edit2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { VineItem, Listing } from "@shared/schema";

export default function DraftPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const params = new URLSearchParams(window.location.search);
  const vineItemId = params.get("vineItemId");
  const listingId = params.get("listingId");

  const [selectedPhotos, setSelectedPhotos] = useState<File[]>([]);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [selectedTitle, setSelectedTitle] = useState<number>(0);
  const [editableTitles, setEditableTitles] = useState<string[]>([]);
  const [price, setPrice] = useState("");
  const [suggestedPrice, setSuggestedPrice] = useState("");
  const [weightOz, setWeightOz] = useState("");
  const [dimsL, setDimsL] = useState("");
  const [dimsW, setDimsW] = useState("");
  const [dimsH, setDimsH] = useState("");
  const [regenerateCount, setRegenerateCount] = useState(0);
  const [shippingEstimate, setShippingEstimate] = useState<{ low: number; high: number } | null>(null);
  const [editingTitleIndex, setEditingTitleIndex] = useState<number | null>(null);
  const [hoveredTitleIndex, setHoveredTitleIndex] = useState<number | null>(null);

  const { data: vineItem } = useQuery<VineItem>({
    queryKey: [`/api/vine-items/${vineItemId}`],
    enabled: !!vineItemId,
  });

  const { data: listing } = useQuery<Listing>({
    queryKey: [`/api/listings/${listingId}`],
    enabled: !!listingId,
  });

  const { data: titleSuggestions, isLoading: generatingTitles } = useQuery<{
    titles: string[];
    description: string;
    categoryId: string;
    categoryName: string;
    privacyWarnings: string[];
    similarityScore: number;
    suggestedPrice?: number;
  }>({
    queryKey: [`/api/listings/generate-copy?vineItemId=${vineItemId}&_refresh=${regenerateCount}`],
    enabled: !!vineItemId,
    staleTime: 0,
  });

  // Initialize editable titles when suggestions load (only once or on regenerate)
  useEffect(() => {
    if (titleSuggestions && vineItem && editableTitles.length === 0) {
      // Include original title + AI-generated titles
      const allTitles = [vineItem.titleNorm, ...titleSuggestions.titles];
      setEditableTitles(allTitles);
    }
  }, [titleSuggestions, vineItem]);

  // Re-initialize titles when regenerating (regenerateCount changes)
  useEffect(() => {
    if (regenerateCount > 0 && titleSuggestions && vineItem) {
      const allTitles = [vineItem.titleNorm, ...titleSuggestions.titles];
      setEditableTitles(allTitles);
    }
  }, [regenerateCount]);

  // Set suggested price when available
  useEffect(() => {
    if (titleSuggestions?.suggestedPrice && !price) {
      setSuggestedPrice(titleSuggestions.suggestedPrice.toFixed(2));
      setPrice(titleSuggestions.suggestedPrice.toFixed(2));
    }
  }, [titleSuggestions]);

  // Fetch shipping estimate when dimensions are provided
  useEffect(() => {
    const fetchShippingEstimate = async () => {
      if (weightOz && dimsL && dimsW && dimsH) {
        try {
          const response = await fetch(
            `/api/shipping/estimate?weightOz=${weightOz}&length=${dimsL}&width=${dimsW}&height=${dimsH}`
          );
          if (response.ok) {
            const data = await response.json();
            if (data.low && data.high) {
              setShippingEstimate(data);
            } else {
              // Fallback if API response is malformed
              setShippingEstimate(null);
            }
          } else {
            setShippingEstimate(null);
          }
        } catch (error) {
          console.error("Failed to fetch shipping estimate:", error);
          setShippingEstimate(null);
        }
      } else {
        setShippingEstimate(null);
      }
    };

    const timeoutId = setTimeout(fetchShippingEstimate, 500);
    return () => clearTimeout(timeoutId);
  }, [weightOz, dimsL, dimsW, dimsH]);

  const regenerateTitles = () => {
    setEditableTitles([]); // Clear editable titles so they refresh
    setRegenerateCount(prev => prev + 1);
    setSelectedTitle(0); // Reset to first title
  };

  const handleTitleEdit = (index: number, newTitle: string) => {
    const updated = [...editableTitles];
    updated[index] = newTitle;
    setEditableTitles(updated);
  };

  const publishMutation = useMutation({
    mutationFn: async () => {
      if (!titleSuggestions || selectedPhotos.length < 2 || editableTitles.length === 0) {
        throw new Error("Please add at least 2 photos");
      }

      const formData = new FormData();
      selectedPhotos.forEach((photo) => formData.append("photos", photo));
      formData.append("vineItemId", vineItemId!);
      formData.append("title", editableTitles[selectedTitle]);
      formData.append("description", titleSuggestions.description);
      formData.append("categoryId", titleSuggestions.categoryId);
      formData.append("priceCents", String(Math.round(parseFloat(price) * 100)));
      formData.append("weightOz", weightOz);
      formData.append("dimsL", dimsL);
      formData.append("dimsW", dimsW);
      formData.append("dimsH", dimsH);

      return apiRequest("POST", "/api/listings/publish", formData);
    },
    onSuccess: () => {
      toast({
        title: "Listing published!",
        description: "Your item is now live on eBay",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
      setLocation("/orders");
    },
    onError: (error: Error) => {
      toast({
        title: "Publish failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (selectedPhotos.length + files.length > 12) {
      toast({
        title: "Too many photos",
        description: "Maximum 12 photos allowed",
        variant: "destructive",
      });
      return;
    }
    
    setSelectedPhotos([...selectedPhotos, ...files]);
    files.forEach((file) => {
      const url = URL.createObjectURL(file);
      setPhotoUrls((prev) => [...prev, url]);
    });
  };

  const removePhoto = (index: number) => {
    setSelectedPhotos((prev) => prev.filter((_, i) => i !== index));
    URL.revokeObjectURL(photoUrls[index]);
    setPhotoUrls((prev) => prev.filter((_, i) => i !== index));
  };

  const hasPrivacyWarnings = titleSuggestions?.privacyWarnings && titleSuggestions.privacyWarnings.length > 0;
  const hasSimilarityIssue = titleSuggestions?.similarityScore && titleSuggestions.similarityScore > 0.7;
  const canPublish = selectedPhotos.length >= 2 && !hasPrivacyWarnings && !hasSimilarityIssue && price && weightOz;

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/")} data-testid="button-back">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-semibold text-foreground" data-testid="text-page-title">Draft Listing</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {vineItem?.titleNorm || "Loading..."}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column - Form */}
          <div className="space-y-6">
            {/* Item Info */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Item Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="text-muted-foreground">ASIN</div>
                    <div className="font-mono font-medium" data-testid="text-asin">{vineItem?.asin}</div>
                  </div>
                  {vineItem?.upc && (
                    <div>
                      <div className="text-muted-foreground">UPC</div>
                      <div className="font-mono font-medium" data-testid="text-upc">{vineItem.upc}</div>
                    </div>
                  )}
                  <div>
                    <div className="text-muted-foreground">ETV (Basis)</div>
                    <div className="font-medium" data-testid="text-etv">${(vineItem?.etvCents || 0) / 100}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Received</div>
                    <div className="font-medium" data-testid="text-received">
                      {vineItem ? new Date(vineItem.receivedDate).toLocaleDateString() : "-"}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Category & Specifics */}
            {titleSuggestions && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Category</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-chart-1" />
                    <span className="font-medium" data-testid="text-category">{titleSuggestions.categoryName}</span>
                    <Badge variant="outline" className="ml-auto font-mono text-xs">
                      {titleSuggestions.categoryId}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Title Options */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-lg">Title Options</CardTitle>
                  <CardDescription>Select and customize your listing title</CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => regenerateTitles()}
                  disabled={generatingTitles}
                  data-testid="button-regenerate-titles"
                >
                  <RefreshCw className={`w-4 h-4 ${generatingTitles ? 'animate-spin' : ''}`} />
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                {editableTitles.map((title, index) => (
                  <div
                    key={index}
                    className={`p-3 rounded-lg border-2 transition-all ${
                      selectedTitle === index
                        ? "border-primary bg-accent"
                        : "border-border"
                    }`}
                    data-testid={`option-title-${index}`}
                    onMouseEnter={() => setHoveredTitleIndex(index)}
                    onMouseLeave={() => setHoveredTitleIndex(null)}
                  >
                    <div className="flex items-start gap-2">
                      <div 
                        className={`mt-1 w-4 h-4 rounded-full border-2 flex-shrink-0 cursor-pointer ${
                          selectedTitle === index ? "bg-primary border-primary" : "border-muted-foreground"
                        }`}
                        onClick={() => setSelectedTitle(index)}
                      />
                      <div className="flex-1 space-y-2">
                        {index === 0 && (
                          <Badge variant="outline" className="text-xs mb-1">
                            Original Amazon Title
                          </Badge>
                        )}
                        {editingTitleIndex === index ? (
                          <Input
                            value={title}
                            onChange={(e) => handleTitleEdit(index, e.target.value)}
                            onBlur={() => setEditingTitleIndex(null)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                setEditingTitleIndex(null);
                              }
                            }}
                            autoFocus
                            className="text-sm"
                            placeholder="Enter title..."
                            data-testid={`input-title-${index}`}
                          />
                        ) : (
                          <div className="flex items-start gap-2 group">
                            <p className="text-sm flex-1 leading-relaxed" data-testid={`text-title-${index}`}>
                              {title}
                            </p>
                            <Button
                              variant="ghost"
                              size="icon"
                              className={`h-6 w-6 flex-shrink-0 transition-opacity ${
                                hoveredTitleIndex === index ? 'opacity-100' : 'opacity-0'
                              }`}
                              onClick={() => setEditingTitleIndex(index)}
                              data-testid={`button-edit-title-${index}`}
                            >
                              <Edit2 className="w-3 h-3" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {generatingTitles && (
                  <div className="text-center py-4 text-sm text-muted-foreground">
                    <RefreshCw className="w-4 h-4 animate-spin inline mr-2" />
                    Generating unique titles...
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Description */}
            {titleSuggestions && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Description</CardTitle>
                </CardHeader>
                <CardContent>
                  <Textarea
                    value={titleSuggestions.description}
                    readOnly
                    className="min-h-[120px] font-sans resize-none"
                    data-testid="textarea-description"
                  />
                </CardContent>
              </Card>
            )}

            {/* Privacy & Similarity Checks */}
            {hasPrivacyWarnings && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Privacy Violations Detected</AlertTitle>
                <AlertDescription className="mt-2">
                  <ul className="list-disc list-inside space-y-1">
                    {titleSuggestions.privacyWarnings.map((warning, i) => (
                      <li key={i} className="text-sm" data-testid={`warning-${i}`}>{warning}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {hasSimilarityIssue && (
              <Alert className="border-chart-3 bg-chart-3/10">
                <AlertTriangle className="h-4 w-4 text-chart-3" />
                <AlertTitle className="text-chart-3">High Similarity to Amazon Text</AlertTitle>
                <AlertDescription>
                  {Math.round(titleSuggestions.similarityScore * 100)}% match detected. Regenerate titles for better uniqueness.
                </AlertDescription>
              </Alert>
            )}

            {/* Photos */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Photos</CardTitle>
                <CardDescription>
                  Upload at least 2 photos (up to 12)
                  {selectedPhotos.length > 0 && ` - ${selectedPhotos.length}/12 uploaded`}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  {photoUrls.map((url, index) => (
                    <div key={index} className="relative aspect-square rounded-lg overflow-hidden border-2 border-border group">
                      <img src={url} alt={`Photo ${index + 1}`} className="w-full h-full object-cover" />
                      <button
                        onClick={() => removePhoto(index)}
                        className="absolute top-2 right-2 p-1 rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                        data-testid={`button-remove-photo-${index}`}
                      >
                        <X className="w-4 h-4" />
                      </button>
                      {index === 0 && (
                        <div className="absolute bottom-2 left-2">
                          <Badge variant="secondary" className="text-xs">Cover</Badge>
                        </div>
                      )}
                    </div>
                  ))}
                  {selectedPhotos.length < 12 && (
                    <label className="aspect-square rounded-lg border-2 border-dashed border-border flex flex-col items-center justify-center cursor-pointer hover-elevate transition-all">
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={handlePhotoUpload}
                        className="hidden"
                        data-testid="input-photos"
                      />
                      <Upload className="w-8 h-8 text-muted-foreground mb-2" />
                      <span className="text-xs text-muted-foreground">Upload</span>
                    </label>
                  )}
                </div>
                {selectedPhotos.length < 2 && (
                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>At least 2 photos required</AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>

            {/* Pricing & Shipping */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Pricing & Shipping</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="price">
                      Price ($)
                      {suggestedPrice && (
                        <Badge variant="secondary" className="ml-2 text-xs">
                          <Sparkles className="w-3 h-3 mr-1" />
                          AI Suggested
                        </Badge>
                      )}
                    </Label>
                    <Input
                      id="price"
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      data-testid="input-price"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="weight">Weight (oz)</Label>
                    <Input
                      id="weight"
                      type="number"
                      placeholder="0"
                      value={weightOz}
                      onChange={(e) => setWeightOz(e.target.value)}
                      data-testid="input-weight"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="dims-l">Length (in)</Label>
                    <Input
                      id="dims-l"
                      type="number"
                      placeholder="0"
                      value={dimsL}
                      onChange={(e) => setDimsL(e.target.value)}
                      data-testid="input-length"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="dims-w">Width (in)</Label>
                    <Input
                      id="dims-w"
                      type="number"
                      placeholder="0"
                      value={dimsW}
                      onChange={(e) => setDimsW(e.target.value)}
                      data-testid="input-width"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="dims-h">Height (in)</Label>
                    <Input
                      id="dims-h"
                      type="number"
                      placeholder="0"
                      value={dimsH}
                      onChange={(e) => setDimsH(e.target.value)}
                      data-testid="input-height"
                    />
                  </div>
                </div>
                {shippingEstimate && (
                  <Alert className="border-chart-2 bg-chart-2/10">
                    <Sparkles className="h-4 w-4 text-chart-2" />
                    <AlertDescription className="text-sm">
                      Estimated shipping cost: <span className="font-semibold">
                        ${shippingEstimate.low.toFixed(2)} - ${shippingEstimate.high.toFixed(2)}
                      </span>
                      <div className="text-xs text-muted-foreground mt-1">
                        Via Shippo API • USPS Priority Mail
                      </div>
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right Column - Preview */}
          <div className="lg:sticky lg:top-6 lg:h-fit">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">eBay Preview</CardTitle>
                <CardDescription>How your listing will appear to buyers</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {photoUrls.length > 0 && (
                  <div className="aspect-[4/3] rounded-lg overflow-hidden border border-border">
                    <img src={photoUrls[0]} alt="Product" className="w-full h-full object-cover" />
                  </div>
                )}
                {titleSuggestions && editableTitles.length > 0 && (
                  <>
                    <div>
                      <h3 className="font-semibold text-lg mb-2" data-testid="text-preview-title">
                        {editableTitles[selectedTitle]}
                      </h3>
                      {price && (
                        <div className="text-2xl font-bold text-chart-1" data-testid="text-preview-price">
                          ${parseFloat(price).toFixed(2)}
                        </div>
                      )}
                    </div>
                    <Separator />
                    <div className="text-sm space-y-2">
                      <div className="font-semibold">Description</div>
                      <p className="text-muted-foreground whitespace-pre-wrap" data-testid="text-preview-description">
                        {titleSuggestions.description}
                      </p>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Button
              className="w-full mt-4"
              size="lg"
              disabled={!canPublish || publishMutation.isPending}
              onClick={() => publishMutation.mutate()}
              data-testid="button-publish"
            >
              {publishMutation.isPending ? "Publishing..." : "Approve & Publish to eBay"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
