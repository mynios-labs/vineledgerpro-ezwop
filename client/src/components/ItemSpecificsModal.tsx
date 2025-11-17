import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { useState } from "react";

interface ItemSpecificsModalProps {
  isOpen: boolean;
  onClose: () => void;
  requiredFields: string[];
  onSubmit: (specifics: Record<string, string[]>) => void;
  isSubmitting?: boolean;
}

export function ItemSpecificsModal({
  isOpen,
  onClose,
  requiredFields,
  onSubmit,
  isSubmitting = false,
}: ItemSpecificsModalProps) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    requiredFields.forEach(field => {
      initial[field] = "";
    });
    return initial;
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Convert to eBay format: { "Type": ["value"] }
    const specifics: Record<string, string[]> = {};
    Object.entries(values).forEach(([key, value]) => {
      if (value.trim()) {
        specifics[key] = [value.trim()];
      }
    });
    
    onSubmit(specifics);
  };

  const isValid = requiredFields.every(field => values[field]?.trim());

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md" data-testid="item-specifics-modal">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Required Item Specifics</DialogTitle>
            <DialogDescription>
              eBay requires additional information for this category. Please fill in the required fields below.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {requiredFields.map((field) => (
              <div key={field} className="space-y-2">
                <Label htmlFor={`specific-${field}`}>
                  {field} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id={`specific-${field}`}
                  value={values[field] || ""}
                  onChange={(e) => setValues(prev => ({ ...prev, [field]: e.target.value }))}
                  placeholder={`Enter ${field}`}
                  data-testid={`input-specific-${field.toLowerCase()}`}
                  disabled={isSubmitting}
                  required
                />
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
              data-testid="button-cancel-specifics"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!isValid || isSubmitting}
              data-testid="button-submit-specifics"
            >
              {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Continue Publishing
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
