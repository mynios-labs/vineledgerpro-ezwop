import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowLeft, Upload, X, AlertTriangle, CheckCircle, Sparkles, RefreshCw, Edit2, Search } from "lucide-react";
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
import { PublishModal } from "@/components/PublishModal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type StructuredDescription = {
  intro: string;
  bullets: string[];
  closing: string;
};

// Helper: Convert structured description to eBay-formatted plaintext
function serializeDescription(desc: StructuredDescription): string {
  const bulletList = desc.bullets.map(b => `• ${b}`).join('\n');
  return `${desc.intro}\n\n${bulletList}\n\n${desc.closing}`;
}

// Helper: Check if title exceeds eBay's 80-character limit
function isTitleOverLimit(title: string): boolean {
  return title.length > 80;
}

// Helper: Infer shipping mode from fulfillment policy name
function inferShippingModeFromPolicy(policyName: string | null): "separate" | "included" {
  if (!policyName) return "separate";
  const lowerName = policyName.toLowerCase();
  if (lowerName.includes("free") && lowerName.includes("shipping")) {
    return "included";
  }
  if (lowerName.includes("buyer") && lowerName.includes("pay")) {
    return "separate";
  }
  return "separate"; // Default
}

// Helper: Find matching policy for shipping mode
function findPolicyForShippingMode(
  policies: Array<{ fulfillmentPolicyId: string; name: string }> | undefined,
  mode: "separate" | "included"
): { fulfillmentPolicyId: string; name: string } | null {
  if (!policies || policies.length === 0) return null;
  
  const targetKeywords = mode === "included" 
    ? ["free", "shipping"]
    : ["buyer", "pay"];
  
  const match = policies.find(p => {
    const lowerName = p.name.toLowerCase();
    return targetKeywords.every(kw => lowerName.includes(kw));
  });
  
  return match || null;
}

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
  const [weightOz, setWeightOz] = useState("");
  const [dimsL, setDimsL] = useState("");
  const [dimsW, setDimsW] = useState("");
  const [dimsH, setDimsH] = useState("");
  const [regenerateCount, setRegenerateCount] = useState(0);
  const [shippingEstimate, setShippingEstimate] = useState<{ low: number; high: number } | null>(null);
  const [editingTitleIndex, setEditingTitleIndex] = useState<number | null>(null);
  const [hoveredTitleIndex, setHoveredTitleIndex] = useState<number | null>(null);
  const [shippingMode, setShippingMode] = useState<"separate" | "included">("separate");
  const [totalPriceInput, setTotalPriceInput] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedCategoryName, setSelectedCategoryName] = useState<string | null>(null);
  const [categorySearch, setCategorySearch] = useState<string>("");
  const [debouncedCategorySearch, setDebouncedCategorySearch] = useState<string>("");
  const [userOverrodeCategory, setUserOverrodeCategory] = useState<boolean>(false);
  const [editableDescription, setEditableDescription] = useState<StructuredDescription | null>(null);
  const [selectedFulfillmentPolicyId, setSelectedFulfillmentPolicyId] = useState<string | null>(null);
  const [selectedFulfillmentPolicyName, setSelectedFulfillmentPolicyName] = useState<string | null>(null);
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [publishState, setPublishState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [publishResult, setPublishResult] = useState<any>(null);
  const [generatedSku, setGeneratedSku] = useState<string>("");
  const [userEditedSku, setUserEditedSku] = useState<boolean>(false);

  const { data: vineItem } = useQuery<VineItem>({
    queryKey: [`/api/vine-items/${vineItemId}`],
    enabled: !!vineItemId,
  });

  const { data: listing } = useQuery<any>({
    queryKey: [`/api/listings/${listingId}`],
    enabled: !!listingId,
  });

  // Pre-populate form when editing an existing listing
  useEffect(() => {
    if (listing && listingId) {
      console.log("[EDIT MODE] Pre-populating form with listing data:", listing);
      
      // Set title
      if (listing.title && editableTitles.length === 0) {
        setEditableTitles([listing.title]);
        setSelectedTitle(0);
      }
      
      // Set price
      if (listing.priceCents) {
        setPrice((listing.priceCents / 100).toString());
      }
      
      // Set dimensions and weight
      if (listing.dimsL) setDimsL(listing.dimsL.toString());
      if (listing.dimsW) setDimsW(listing.dimsW.toString());
      if (listing.dimsH) setDimsH(listing.dimsH.toString());
      if (listing.weightOz) setWeightOz(listing.weightOz.toString());
      
      // Set category
      if (listing.categoryId) {
        setSelectedCategoryId(listing.categoryId);
      }
      
      // Set fulfillment policy
      if (listing.fulfillmentPolicyId) {
        setSelectedFulfillmentPolicyId(listing.fulfillmentPolicyId);
      }
      
      // Set description (try to parse if structured, otherwise use plain text)
      if (listing.description) {
        try {
          // Try to parse as structured description
          const lines = listing.description.split('\n');
          const bullets: string[] = [];
          let intro = "";
          let closing = "";
          let inBullets = false;
          
          for (const line of lines) {
            if (line.trim().startsWith('•')) {
              bullets.push(line.trim().substring(1).trim());
              inBullets = true;
            } else if (!inBullets && line.trim()) {
              intro += (intro ? '\n' : '') + line.trim();
            } else if (inBullets && line.trim()) {
              closing += (closing ? '\n' : '') + line.trim();
            }
          }
          
          if (bullets.length > 0) {
            setEditableDescription({ intro, bullets, closing });
          } else {
            // Fallback to simple structure
            setEditableDescription({
              intro: listing.description,
              bullets: [],
              closing: ""
            });
          }
        } catch {
          setEditableDescription({
            intro: listing.description,
            bullets: [],
            closing: ""
          });
        }
      }
      
      // Set SKU
      if (listing.ebaySku) {
        setGeneratedSku(listing.ebaySku);
        setUserEditedSku(true); // Prevent auto-generation from overwriting
      }
      
      // Set photos (convert URLs to display)
      if (listing.photos && listing.photos.length > 0) {
        setPhotoUrls(listing.photos);
      }
    }
  }, [listing, listingId]);

  const { data: titleSuggestions, isLoading: generatingTitles } = useQuery<{
    titles: string[];
    originalTitleLengths: number[];
    description: StructuredDescription;
    categoryId: string;
    categoryName: string;
    privacyWarnings: string[];
    similarityScore: number;
  }>({
    queryKey: [`/api/listings/generate-copy?vineItemId=${vineItemId}&_refresh=${regenerateCount}`],
    enabled: !!vineItemId,
    staleTime: 0,
  });

  // Fulfillment policies
  const { data: fulfillmentPolicies, isLoading: loadingPolicies, error: policiesError } = useQuery<Array<{
    fulfillmentPolicyId: string;
    name: string;
    shippingOptions?: Array<{ shippingServiceCode?: string }>;
  }>>({
    queryKey: ["/api/ebay/fulfillment-policies"],
    staleTime: 15 * 60 * 1000, // 15 minutes (matches backend cache)
  });

  // Reset category and fulfillment policy state when switching to a different item
  // Only reset when creating (vineItemId), not when editing (listingId)
  useEffect(() => {
    if (!listingId) {
      setSelectedCategoryId(null);
      setSelectedCategoryName(null);
      setUserOverrodeCategory(false);
      setCategorySearch("");
      setSelectedFulfillmentPolicyId(null);
      setSelectedFulfillmentPolicyName(null);
    }
  }, [vineItemId, listingId]);

  // Auto-generate SKU with guaranteed uniqueness using full vineItemId
  useEffect(() => {
    if (userEditedSku) return;
    if (!vineItemId) return;

    const currentTitle = editableTitles[selectedTitle];
    if (!currentTitle) return;

    // Use first 4 letters of title as prefix for readability
    const prefix = currentTitle.replace(/[^a-zA-Z]/g, '').substring(0, 4).toUpperCase() || 'ITEM';
    
    // Use the FULL vineItemId (with hyphens removed) to guarantee true uniqueness
    // eBay allows SKUs up to 50 chars, and vineItemId is 32 hex chars (36 with hyphens)
    const uniqueId = vineItemId.replace(/-/g, '');
    
    const sku = `${prefix}-${uniqueId}`;
    
    setGeneratedSku(sku);
  }, [editableTitles, selectedTitle, userEditedSku, vineItemId]);

  // Auto-select fulfillment policy if only one available
  useEffect(() => {
    if (fulfillmentPolicies && fulfillmentPolicies.length === 1 && !selectedFulfillmentPolicyId) {
      setSelectedFulfillmentPolicyId(fulfillmentPolicies[0].fulfillmentPolicyId);
      setSelectedFulfillmentPolicyName(fulfillmentPolicies[0].name);
    }
  }, [fulfillmentPolicies, selectedFulfillmentPolicyId]);

  // Load stored fulfillment policy ID if editing an existing listing
  useEffect(() => {
    if (listing && listing.fulfillmentPolicyId && !selectedFulfillmentPolicyId) {
      setSelectedFulfillmentPolicyId(listing.fulfillmentPolicyId);
    }
  }, [listing, selectedFulfillmentPolicyId]);

  // Hydrate fulfillment policy name once policies are loaded and ID is set
  useEffect(() => {
    if (selectedFulfillmentPolicyId && fulfillmentPolicies && !selectedFulfillmentPolicyName) {
      const policy = fulfillmentPolicies.find(p => p.fulfillmentPolicyId === selectedFulfillmentPolicyId);
      if (policy) {
        setSelectedFulfillmentPolicyName(policy.name);
      }
    }
  }, [selectedFulfillmentPolicyId, fulfillmentPolicies, selectedFulfillmentPolicyName]);

  // Load fulfillment policy and shipping mode from localStorage on page load (with validation)
  useEffect(() => {
    if (!vineItemId || !fulfillmentPolicies || fulfillmentPolicies.length === 0) return;
    
    const storageKey = `draft_${vineItemId}`;
    const savedData = localStorage.getItem(storageKey);
    
    if (savedData) {
      try {
        const { fulfillmentPolicyId, shippingMode: savedShippingMode } = JSON.parse(savedData);
        
        // Validate policy is still active BEFORE applying
        if (fulfillmentPolicyId) {
          const isValid = fulfillmentPolicies.some(p => p.fulfillmentPolicyId === fulfillmentPolicyId);
          
          if (isValid && !selectedFulfillmentPolicyId) {
            setSelectedFulfillmentPolicyId(fulfillmentPolicyId);
            // Shipping mode will be synced automatically by the policy→mode effect
          } else if (!isValid) {
            toast({
              title: "Saved fulfillment policy no longer active",
              description: "The previously selected policy is no longer available. Please choose another one.",
              variant: "destructive",
            });
            localStorage.removeItem(storageKey);
          }
        } else if (savedShippingMode && !listing) {
          // Only restore shipping mode if no policy was saved
          setShippingMode(savedShippingMode);
        }
      } catch (e) {
        console.error("Failed to load draft from localStorage:", e);
      }
    }
  }, [vineItemId, listing, selectedFulfillmentPolicyId, fulfillmentPolicies, toast]);

  // Sync fulfillment policy → shipping mode (when policy name changes)
  useEffect(() => {
    if (!selectedFulfillmentPolicyName) return;
    
    const inferredMode = inferShippingModeFromPolicy(selectedFulfillmentPolicyName);
    
    // Only update if different to avoid triggering unnecessary re-renders
    if (inferredMode !== shippingMode) {
      setShippingMode(inferredMode);
    }
  }, [selectedFulfillmentPolicyName, shippingMode]);

  // Save fulfillment policy and shipping mode to localStorage (debounced)
  useEffect(() => {
    if (!vineItemId) return;
    
    const timeoutId = setTimeout(() => {
      const storageKey = `draft_${vineItemId}`;
      const dataToSave = {
        fulfillmentPolicyId: selectedFulfillmentPolicyId,
        shippingMode,
      };
      localStorage.setItem(storageKey, JSON.stringify(dataToSave));
    }, 500); // Debounce to avoid excessive writes
    
    return () => clearTimeout(timeoutId);
  }, [vineItemId, selectedFulfillmentPolicyId, shippingMode]);

  // Debounce category search (300ms delay)
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebouncedCategorySearch(categorySearch);
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [categorySearch]);

  // Category search results (uses debounced search)
  const { data: categorySearchResults, isLoading: searchingCategories, error: categorySearchError } = useQuery<Array<{ categoryId: string; categoryName: string }>>({
    queryKey: [`/api/ebay/categories?q=${debouncedCategorySearch}`],
    enabled: debouncedCategorySearch.length > 2,
    staleTime: 60000, // Cache for 1 minute
  });

  // Initialize editable titles when suggestions load (only once or on regenerate)
  useEffect(() => {
    if (titleSuggestions && vineItem && editableTitles.length === 0) {
      // Include original title + AI-generated titles
      const allTitles = [vineItem.titleNorm, ...titleSuggestions.titles];
      setEditableTitles(allTitles);
    }
  }, [titleSuggestions, vineItem]);

  // Fallback: If AI generation fails, still show the original vine item title
  useEffect(() => {
    if (vineItem && editableTitles.length === 0 && !generatingTitles) {
      // After a delay, if we still don't have titles, use just the original
      const timeoutId = setTimeout(() => {
        if (editableTitles.length === 0) {
          setEditableTitles([vineItem.titleNorm]);
        }
      }, 3000); // Wait 3 seconds for AI generation before falling back
      return () => clearTimeout(timeoutId);
    }
  }, [vineItem, editableTitles.length, generatingTitles]);

  // Re-initialize titles when regenerating (regenerateCount changes)
  useEffect(() => {
    if (regenerateCount > 0 && titleSuggestions && vineItem) {
      const allTitles = [vineItem.titleNorm, ...titleSuggestions.titles];
      setEditableTitles(allTitles);
    }
  }, [regenerateCount]);

  // Initialize category when suggestions load
  useEffect(() => {
    if (titleSuggestions && selectedCategoryId === null) {
      setSelectedCategoryId(titleSuggestions.categoryId);
      setSelectedCategoryName(titleSuggestions.categoryName);
    }
  }, [titleSuggestions]);

  // Re-initialize category when regenerating (regenerateCount changes)
  // Skip if user manually selected a category
  useEffect(() => {
    if (regenerateCount > 0 && titleSuggestions && !userOverrodeCategory) {
      setSelectedCategoryId(titleSuggestions.categoryId);
      setSelectedCategoryName(titleSuggestions.categoryName);
    }
  }, [regenerateCount, titleSuggestions?.categoryId, userOverrodeCategory]);

  // Initialize editable description when suggestions load
  useEffect(() => {
    if (titleSuggestions && !editableDescription) {
      setEditableDescription(titleSuggestions.description);
    }
  }, [titleSuggestions]);

  // Re-initialize description when regenerating (regenerateCount changes)
  useEffect(() => {
    if (regenerateCount > 0 && titleSuggestions) {
      setEditableDescription(titleSuggestions.description);
    }
  }, [regenerateCount, titleSuggestions?.description]);

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

  // Sync total price input when item price or shipping estimate changes
  useEffect(() => {
    if (shippingMode === "included" && price && shippingEstimate) {
      const total = parseFloat(price) + shippingEstimate.high;
      setTotalPriceInput(total.toFixed(2));
    }
  }, [price, shippingEstimate, shippingMode]);

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

  // Handler: Update shipping mode and attempt to find matching fulfillment policy
  const handleShippingModeChange = (newMode: "separate" | "included") => {
    // Update shipping mode
    setShippingMode(newMode);
    
    // Try to find a matching policy
    const matchingPolicy = findPolicyForShippingMode(fulfillmentPolicies, newMode);
    
    if (matchingPolicy) {
      // Only update if it's different from current selection
      if (matchingPolicy.fulfillmentPolicyId !== selectedFulfillmentPolicyId) {
        setSelectedFulfillmentPolicyId(matchingPolicy.fulfillmentPolicyId);
        setSelectedFulfillmentPolicyName(matchingPolicy.name);
      }
    }
    // If no matching policy found, keep current selection (user might have only one policy)
  };

  // Handler: Update fulfillment policy and sync shipping mode
  const handleFulfillmentPolicyChange = (policyId: string) => {
    setSelectedFulfillmentPolicyId(policyId);
    const policy = fulfillmentPolicies?.find(p => p.fulfillmentPolicyId === policyId);
    setSelectedFulfillmentPolicyName(policy?.name || null);
    // Shipping mode will be synced automatically by the useEffect
  };

  const publishMutation = useMutation({
    mutationFn: async () => {
      // When editing, photos are optional (already on eBay)
      if (!listingId && (!editableDescription || selectedPhotos.length < 2 || editableTitles.length === 0)) {
        throw new Error("Please add at least 2 photos");
      }

      if (!editableDescription || editableTitles.length === 0) {
        throw new Error("Missing required fields");
      }

      if (!selectedCategoryId || selectedCategoryId === "0") {
        throw new Error("Please select a valid category");
      }

      if (!selectedFulfillmentPolicyId) {
        throw new Error("Please select a fulfillment policy");
      }

      // Validate title length (eBay limit is 80 characters)
      const selectedTitleText = editableTitles[selectedTitle];
      if (!selectedTitleText || selectedTitleText.length > 80) {
        throw new Error("Title must be between 1 and 80 characters. Please select a different title.");
      }

      // DEBUG: Log title selection details
      console.log("[PUBLISH DEBUG] Title selection:", {
        selectedTitleIndex: selectedTitle,
        allTitles: editableTitles,
        selectedTitleText,
        selectedTitleLength: selectedTitleText?.length,
        editMode: !!listingId,
      });

      // When editing, use JSON body instead of FormData (no photo uploads)
      if (listingId) {
        const payload = {
          title: editableTitles[selectedTitle],
          description: serializeDescription(editableDescription),
          categoryId: selectedCategoryId,
          fulfillmentPolicyId: selectedFulfillmentPolicyId,
          priceCents: Math.round(parseFloat(price) * 100),
          weightOz: parseFloat(weightOz),
          dimsL: parseFloat(dimsL),
          dimsW: parseFloat(dimsW),
          dimsH: parseFloat(dimsH),
        };

        setPublishModalOpen(true);
        setPublishState("loading");
        setPublishResult(null);

        return apiRequest("PUT", `/api/listings/${listingId}/edit`, payload);
      }

      // Creating new listing - use FormData for photos
      const formData = new FormData();
      selectedPhotos.forEach((photo) => formData.append("photos", photo));
      formData.append("vineItemId", vineItemId!);
      formData.append("title", editableTitles[selectedTitle]);
      formData.append("description", serializeDescription(editableDescription));
      formData.append("categoryId", selectedCategoryId);
      formData.append("fulfillmentPolicyId", selectedFulfillmentPolicyId);
      formData.append("priceCents", String(Math.round(parseFloat(price) * 100)));
      formData.append("weightOz", weightOz);
      formData.append("dimsL", dimsL);
      formData.append("dimsW", dimsW);
      formData.append("dimsH", dimsH);
      formData.append("sku", generatedSku);

      // Open modal and set loading state
      setPublishModalOpen(true);
      setPublishState("loading");
      setPublishResult(null);

      return apiRequest("POST", "/api/listings/publish", formData);
    },
    onSuccess: (data: any) => {
      setPublishState("success");
      setPublishResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
    },
    onError: (error: any) => {
      setPublishState("error");
      setPublishResult({
        error: error.message,
        details: error.details || [error.message],
        failedStep: error.failedStep,
        trace: error.trace,
      });
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

  const hasPrivacyWarnings = !listingId && titleSuggestions?.privacyWarnings && titleSuggestions.privacyWarnings.length > 0;
  const hasSimilarityIssue = !listingId && titleSuggestions?.similarityScore && titleSuggestions.similarityScore > 0.7;
  // When editing, photos are optional (already on eBay). When creating, need 2+ photos.
  const hasRequiredPhotos = listingId ? true : selectedPhotos.length >= 2;
  const canPublish = hasRequiredPhotos && !hasPrivacyWarnings && !hasSimilarityIssue && price && weightOz;

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/listings")} data-testid="button-back">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-semibold text-foreground" data-testid="text-page-title">
              {listingId ? "Edit Listing" : "Draft Listing"}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {listingId ? (listing?.title || "Loading...") : (vineItem?.titleNorm || "Loading...")}
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

            {/* Category Selector */}
            {(vineItem || listing) && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Category</CardTitle>
                  <CardDescription>Search or use AI-suggested category{titleSuggestions ? "" : " (AI suggestion unavailable - please search manually)"}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-2">
                    <Label>Selected Category</Label>
                    <div className="flex items-center gap-2 p-3 rounded-lg border bg-muted/50">
                      <CheckCircle className="w-4 h-4 text-chart-1 flex-shrink-0" />
                      <div className="flex-1">
                        <div className="font-medium text-sm" data-testid="text-category">{selectedCategoryName || "No category selected"}</div>
                        <div className="text-xs text-muted-foreground font-mono">ID: {selectedCategoryId || "—"}</div>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Search Categories</Label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        value={categorySearch}
                        onChange={(e) => setCategorySearch(e.target.value)}
                        placeholder="Search for category..."
                        className="pl-9"
                        data-testid="input-category-search"
                      />
                    </div>
                    {searchingCategories && debouncedCategorySearch.length > 2 && (
                      <div className="border rounded-lg p-3 text-center text-sm text-muted-foreground">
                        <RefreshCw className="w-4 h-4 animate-spin inline mr-2" />
                        Searching categories...
                      </div>
                    )}
                    {categorySearchError && debouncedCategorySearch.length > 2 && (
                      <div className="border border-destructive/50 rounded-lg p-3 text-center text-sm text-destructive">
                        <AlertTriangle className="w-4 h-4 inline mr-2" />
                        Failed to search categories. Please try again.
                      </div>
                    )}
                    {!searchingCategories && !categorySearchError && categorySearchResults && categorySearchResults.length > 0 && (
                      <div className="border rounded-lg max-h-48 overflow-y-auto" data-testid="list-category-results">
                        {categorySearchResults.map((cat) => (
                          <button
                            key={cat.categoryId}
                            onClick={() => {
                              setSelectedCategoryId(cat.categoryId);
                              setSelectedCategoryName(cat.categoryName);
                              setCategorySearch("");
                              setUserOverrodeCategory(true); // Mark as manually selected
                            }}
                            className="w-full p-2 text-left text-sm hover-elevate active-elevate-2 transition-colors"
                            data-testid={`button-select-category-${cat.categoryId}`}
                          >
                            <div className="font-medium">{cat.categoryName}</div>
                            <div className="text-xs text-muted-foreground font-mono">ID: {cat.categoryId}</div>
                          </button>
                        ))}
                      </div>
                    )}
                    {!searchingCategories && !categorySearchError && debouncedCategorySearch.length > 2 && categorySearchResults && categorySearchResults.length === 0 && (
                      <div className="border rounded-lg p-3 text-center text-sm text-muted-foreground">
                        No categories found. Try different keywords.
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Fulfillment Policy Selector */}
            {(vineItem || listing) && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Fulfillment Policy</CardTitle>
                  <CardDescription>Select shipping policy for this listing</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {loadingPolicies && (
                    <div className="border rounded-lg p-3 text-center text-sm text-muted-foreground">
                      <RefreshCw className="w-4 h-4 animate-spin inline mr-2" />
                      Loading policies...
                    </div>
                  )}
                  {policiesError && (
                    <div className="border border-destructive/50 rounded-lg p-3 text-center text-sm text-destructive">
                      <AlertTriangle className="w-4 h-4 inline mr-2" />
                      Failed to load policies. Please refresh the page.
                    </div>
                  )}
                  {!loadingPolicies && !policiesError && (!fulfillmentPolicies || fulfillmentPolicies.length === 0) && (
                    <div className="border border-destructive/50 rounded-lg p-3 text-center text-sm text-destructive">
                      <AlertTriangle className="w-4 h-4 inline mr-2" />
                      No fulfillment policies found. Please create one in eBay Seller Hub.
                    </div>
                  )}
                  {!loadingPolicies && !policiesError && fulfillmentPolicies && fulfillmentPolicies.length > 0 && (
                    <div className="space-y-2">
                      <Label>Selected Policy</Label>
                      <Select
                        value={selectedFulfillmentPolicyId || undefined}
                        onValueChange={handleFulfillmentPolicyChange}
                      >
                        <SelectTrigger data-testid="select-fulfillment-policy">
                          <SelectValue placeholder="Choose fulfillment policy..." />
                        </SelectTrigger>
                        <SelectContent>
                          {fulfillmentPolicies.map((policy) => (
                            <SelectItem 
                              key={policy.fulfillmentPolicyId} 
                              value={policy.fulfillmentPolicyId}
                              data-testid={`option-policy-${policy.fulfillmentPolicyId}`}
                            >
                              {policy.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {selectedFulfillmentPolicyName && (
                        <div className="flex items-center gap-2 p-3 rounded-lg border bg-muted/50">
                          <CheckCircle className="w-4 h-4 text-chart-1 flex-shrink-0" />
                          <div className="flex-1">
                            <div className="font-medium text-sm" data-testid="text-policy">{selectedFulfillmentPolicyName}</div>
                            <div className="text-xs text-muted-foreground">ID: {selectedFulfillmentPolicyId}</div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
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
                {editableTitles.map((title, index) => {
                  const isTooLong = title.length > 80;
                  return <label
                    key={index}
                    className={`p-3 rounded-lg border-2 transition-all ${
                      isTooLong 
                        ? "border-destructive/30 bg-destructive/5 cursor-not-allowed opacity-60" 
                        : selectedTitle === index
                          ? "border-primary bg-accent cursor-pointer"
                          : "border-border cursor-pointer"
                    }`}
                    data-testid={`option-title-${index}`}
                    onMouseEnter={() => !isTooLong && setHoveredTitleIndex(index)}
                    onMouseLeave={() => setHoveredTitleIndex(null)}
                    onClick={(e) => {
                      if (isTooLong) {
                        e.preventDefault();
                      }
                    }}
                  >
                      <div className="flex items-start gap-2">
                        <input
                          type="radio"
                          name="title-selection"
                          value={index}
                          checked={selectedTitle === index}
                          onChange={() => !isTooLong && setSelectedTitle(index)}
                          disabled={isTooLong}
                          className="mt-1 w-4 h-4 flex-shrink-0 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50"
                          data-testid={`radio-title-${index}`}
                        />
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            {index === 0 && (
                              <Badge variant="outline" className="text-xs">
                                Original Amazon Title
                              </Badge>
                            )}
                            {isTooLong && (
                              <Badge variant="destructive" className="text-xs">
                                Reference only
                              </Badge>
                            )}
                          </div>
                        {editingTitleIndex === index ? (
                          <div className="space-y-1">
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
                              maxLength={80}
                              className="text-sm"
                              placeholder="Enter title..."
                              data-testid={`input-title-${index}`}
                            />
                            <div className={`text-xs ${title.length > 80 ? 'text-destructive font-medium' : title.length > 70 ? 'text-chart-3' : 'text-muted-foreground'}`}>
                              {title.length}/80 characters {title.length > 80 && '(too long!)'}
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-1">
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
                                onClick={() => {
                                  setSelectedTitle(index);
                                  setEditingTitleIndex(index);
                                }}
                                data-testid={`button-edit-title-${index}`}
                              >
                                <Edit2 className="w-3 h-3" />
                              </Button>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className={`text-xs ${title.length > 80 ? 'text-destructive font-medium' : title.length > 70 ? 'text-chart-3' : 'text-muted-foreground'}`}>
                                {title.length}/80 characters
                              </div>
                              {titleSuggestions?.originalTitleLengths?.[index] && titleSuggestions.originalTitleLengths[index] > 80 && (
                                <Badge variant="outline" className="text-xs">
                                  Truncated from {titleSuggestions.originalTitleLengths[index]}
                                </Badge>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </label>;
                })}
                {generatingTitles && (
                  <div className="text-center py-4 text-sm text-muted-foreground">
                    <RefreshCw className="w-4 h-4 animate-spin inline mr-2" />
                    Generating unique titles...
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Description */}
            {titleSuggestions && editableDescription && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Description</CardTitle>
                  <CardDescription>Edit your listing description</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Opening Paragraph</Label>
                    <Textarea
                      value={editableDescription.intro}
                      onChange={(e) => setEditableDescription({ ...editableDescription, intro: e.target.value })}
                      className="min-h-[80px] font-sans"
                      placeholder="Benefit-focused opening paragraph..."
                      data-testid="textarea-description-intro"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Key Features (Bullets)</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setEditableDescription({
                          ...editableDescription,
                          bullets: [...editableDescription.bullets, ""]
                        })}
                        data-testid="button-add-bullet"
                      >
                        Add Bullet
                      </Button>
                    </div>
                    {editableDescription.bullets.map((bullet, index) => (
                      <div key={index} className="flex gap-2">
                        <Input
                          value={bullet}
                          onChange={(e) => {
                            const updated = [...editableDescription.bullets];
                            updated[index] = e.target.value;
                            setEditableDescription({ ...editableDescription, bullets: updated });
                          }}
                          placeholder={`Feature ${index + 1}...`}
                          data-testid={`input-bullet-${index}`}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            const updated = editableDescription.bullets.filter((_, i) => i !== index);
                            setEditableDescription({ ...editableDescription, bullets: updated });
                          }}
                          data-testid={`button-remove-bullet-${index}`}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <Label>Closing Statement</Label>
                    <Input
                      value={editableDescription.closing}
                      onChange={(e) => setEditableDescription({ ...editableDescription, closing: e.target.value })}
                      placeholder="Call-to-action or confidence statement..."
                      data-testid="input-description-closing"
                    />
                  </div>
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
          </div>

          {/* Right Column - Pricing & Preview */}
          <div className="space-y-6">
            {/* Pricing & Shipping */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Pricing & Shipping</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription className="text-sm">
                    <strong>Dimensions not recorded.</strong> Please enter weight and dimensions manually to calculate shipping.
                  </AlertDescription>
                </Alert>
                {shippingMode === "included" && shippingEstimate ? (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="item-price">Item Price ($)</Label>
                        <Input
                          id="item-price"
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          value={price}
                          onChange={(e) => {
                            const val = e.target.value;
                            setPrice(val);
                            // Update total price when item price changes
                            if (val && shippingEstimate) {
                              const itemPrice = parseFloat(val);
                              if (!isNaN(itemPrice)) {
                                const total = itemPrice + shippingEstimate.high;
                                setTotalPriceInput(total.toFixed(2));
                              }
                            }
                          }}
                          data-testid="input-item-price"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="total-price">Total Price ($)</Label>
                        <Input
                          id="total-price"
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          value={totalPriceInput}
                          onChange={(e) => {
                            setTotalPriceInput(e.target.value);
                          }}
                          onBlur={(e) => {
                            const val = e.target.value;
                            if (val && shippingEstimate) {
                              const total = parseFloat(val);
                              if (!isNaN(total) && total >= 0) {
                                const itemPrice = Math.max(0, total - shippingEstimate.high);
                                setPrice(itemPrice.toFixed(2));
                              }
                            }
                          }}
                          data-testid="input-total-price"
                        />
                        {price && shippingEstimate && (
                          <div className="text-xs text-muted-foreground">
                            Item ${parseFloat(price).toFixed(2)} + Ship ${shippingEstimate.high.toFixed(2)}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
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
                  </>
                ) : (
                  <>
                    {/* SKU Field */}
                    <div className="space-y-2">
                      <Label htmlFor="sku">
                        SKU (Stock Keeping Unit)
                        <span className="text-xs text-muted-foreground ml-2">• Auto-generated</span>
                      </Label>
                      <Input
                        id="sku"
                        value={generatedSku}
                        onChange={(e) => {
                          setGeneratedSku(e.target.value);
                          setUserEditedSku(true);
                        }}
                        placeholder="AUTO-EZWOP-1234"
                        className="font-mono text-sm"
                        data-testid="input-sku"
                      />
                      <p className="text-xs text-muted-foreground">
                        This unique code tracks your inventory. Auto-generated but you can customize it.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="price">Item Price ($)</Label>
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
                  </>
                )}
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
                  <div className="space-y-3">
                    <Alert className="border-chart-2 bg-chart-2/10">
                      <Sparkles className="h-4 w-4 text-chart-2" />
                      <AlertDescription className="text-sm">
                        Estimated shipping cost: <span className="font-semibold">
                          ${shippingEstimate.low.toFixed(2)} - ${shippingEstimate.high.toFixed(2)}
                        </span>
                        <div className="text-xs text-muted-foreground mt-1">
                          Via Shippo API • UPS • Includes 5% cushion
                        </div>
                      </AlertDescription>
                    </Alert>
                    
                    <div className="space-y-3">
                      <Label>Shipping Pricing</Label>
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          onClick={() => handleShippingModeChange("separate")}
                          className={`p-3 rounded-lg border-2 text-left transition-all ${
                            shippingMode === "separate"
                              ? "border-primary bg-accent"
                              : "border-border hover-elevate"
                          }`}
                          data-testid="button-shipping-separate"
                        >
                          <div className="font-medium text-sm">Charge Separately</div>
                          <div className="text-xs text-muted-foreground mt-1">
                            Buyer pays shipping
                          </div>
                        </button>
                        <button
                          onClick={() => handleShippingModeChange("included")}
                          className={`p-3 rounded-lg border-2 text-left transition-all ${
                            shippingMode === "included"
                              ? "border-primary bg-accent"
                              : "border-border hover-elevate"
                          }`}
                          data-testid="button-shipping-included"
                        >
                          <div className="font-medium text-sm">Include in Price</div>
                          <div className="text-xs text-muted-foreground mt-1">
                            "Free shipping"
                          </div>
                        </button>
                      </div>
                      {shippingMode === "included" && price && (
                        <Alert className="border-chart-1 bg-chart-1/10">
                          <AlertDescription className="text-sm">
                            <div className="font-medium mb-1">Suggested Total Price</div>
                            <div className="text-lg font-bold text-chart-1">
                              ${(parseFloat(price) + shippingEstimate.high).toFixed(2)}
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                              Item price + estimated shipping (high end for safety)
                            </div>
                          </AlertDescription>
                        </Alert>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* eBay Preview */}
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
                          {shippingMode === "included" && shippingEstimate ? (
                            <>
                              ${(parseFloat(price) + shippingEstimate.high).toFixed(2)}
                              <div className="text-xs text-muted-foreground font-normal mt-1">
                                Free shipping
                              </div>
                            </>
                          ) : (
                            `$${parseFloat(price).toFixed(2)}`
                          )}
                        </div>
                      )}
                    </div>
                    <Separator />
                    {editableDescription && (
                      <div className="text-sm space-y-2">
                        <div className="font-semibold">Description</div>
                        <div className="text-muted-foreground whitespace-pre-wrap" data-testid="text-preview-description">
                          <p className="mb-3">{editableDescription.intro}</p>
                          {editableDescription.bullets.length > 0 && (
                            <ul className="space-y-1 mb-3">
                              {editableDescription.bullets.map((bullet, i) => (
                                <li key={i}>• {bullet}</li>
                              ))}
                            </ul>
                          )}
                          <p>{editableDescription.closing}</p>
                        </div>
                      </div>
                    )}
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
              {publishMutation.isPending 
                ? (listingId ? "Updating..." : "Publishing...") 
                : (listingId ? "Update Listing" : "Approve & Publish to eBay")}
            </Button>
          </div>
        </div>
      </div>

      {/* Publish Modal */}
      <PublishModal
        isOpen={publishModalOpen}
        onClose={() => {
          setPublishModalOpen(false);
          setPublishState("idle");
          setPublishResult(null);
          // Navigate to orders page on success
          if (publishState === "success") {
            setLocation("/orders");
          }
        }}
        publishState={publishState}
        result={publishResult}
      />
    </div>
  );
}
