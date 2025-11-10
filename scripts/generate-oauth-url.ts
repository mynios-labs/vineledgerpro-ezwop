const clientId = process.env.EBAY_CLIENT_ID;
const ruName = "antonio_hailese-antonioh-EZwop--azdszk";

// eBay requires production scope URIs even for sandbox environment
const scopes = [
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.inventory.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
].join(" ");

const authUrl = `https://auth.ebay.com/oauth2/authorize?` +
  `client_id=${encodeURIComponent(clientId!)}&` +
  `response_type=code&` +
  `redirect_uri=${encodeURIComponent(ruName)}&` +
  `scope=${encodeURIComponent(scopes)}`;

console.log("\n📝 PRODUCTION OAuth Authorization URL:\n");
console.log(authUrl);
console.log("\n📋 Instructions:");
console.log("1. Copy the URL above");
console.log("2. Paste it into your browser");
console.log("3. Sign in with your PRODUCTION eBay seller account");
console.log("4. Grant permissions");
console.log("5. Copy the FULL redirect URL from your browser (even if it shows an error page)");
console.log("6. Paste that URL back here - I'll extract the code\n");
