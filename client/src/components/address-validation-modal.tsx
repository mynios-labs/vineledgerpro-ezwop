import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";

interface AddressError {
  type: "ship_to" | "ship_from";
  messages: Array<{
    source?: string;
    code?: string;
    type?: string;
    text: string;
  }>;
  address: any;
}

interface AddressValidationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  addressErrors: AddressError[];
  onRetry?: () => void;
}

export function AddressValidationModal({
  open,
  onOpenChange,
  addressErrors,
  onRetry,
}: AddressValidationModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="dialog-address-validation">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-destructive" />
            Address Validation Failed
          </DialogTitle>
          <DialogDescription>
            One or more shipping addresses could not be validated. Please review the errors below.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
          {addressErrors.map((addrError, index) => (
            <div key={index} className="space-y-3">
              <div className="font-semibold text-sm">
                {addrError.type === "ship_to" ? "Shipping Address (Ship-To)" : "Ship-From Address"}
              </div>

              {/* Address Display */}
              <div className="bg-muted p-3 rounded-md text-sm">
                <div>{addrError.address.name}</div>
                {addrError.address.company && <div>{addrError.address.company}</div>}
                <div>{addrError.address.street1}</div>
                {addrError.address.street2 && <div>{addrError.address.street2}</div>}
                <div>
                  {addrError.address.city}, {addrError.address.state} {addrError.address.zip}
                </div>
                <div>{addrError.address.country}</div>
              </div>

              {/* Validation Messages */}
              <div className="space-y-2">
                {addrError.messages.map((msg, msgIndex) => (
                  <Alert key={msgIndex} variant="destructive" data-testid={`alert-validation-${index}-${msgIndex}`}>
                    <AlertDescription>
                      {msg.source && <span className="font-semibold">{msg.source}: </span>}
                      {msg.text}
                    </AlertDescription>
                  </Alert>
                ))}
              </div>

              {/* Guidance */}
              <div className="text-sm text-muted-foreground">
                {addrError.type === "ship_to" ? (
                  <p>
                    This is the customer's shipping address from eBay. If it's incorrect, you may need to contact the buyer or request address correction through eBay.
                  </p>
                ) : (
                  <p>
                    This is your ship-from address. You can update it in Settings → Address Profiles.
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-close-validation">
            Close
          </Button>
          {onRetry && (
            <Button onClick={() => { onRetry(); onOpenChange(false); }} data-testid="button-retry-rates">
              Retry After Fixing
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
