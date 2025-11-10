// Exchange OAuth authorization code for user access token
const readline = require("readline");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function exchangeCodeForToken() {
  const isProduction = process.env.EBAY_ENV === "production";
  const clientId = isProduction ? process.env.EBAY_PROD_CLIENT_ID : process.env.EBAY_CLIENT_ID;
  const clientSecret = isProduction ? process.env.EBAY_PROD_CLIENT_SECRET : process.env.EBAY_CLIENT_SECRET;
  const ruName = "antonio_hailese-antonioh-EZwop--azdszk";
  const EBAY_API_BASE = isProduction ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";
  
  console.log(`\n🔐 ${isProduction ? 'PRODUCTION' : 'SANDBOX'} OAuth Token Exchange\n`);
  
  rl.question("Paste the full redirect URL here: ", async (redirectUrl: string) => {
    try {
      // Extract code from URL
      const url = new URL(redirectUrl);
      const code = url.searchParams.get("code");
      
      if (!code) {
        console.error("❌ No authorization code found in URL");
        process.exit(1);
      }
      
      console.log("\n⏳ Exchanging code for access token...\n");
      
      // Exchange code for token
      const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
      
      const response = await fetch(`${EBAY_API_BASE}/identity/v1/oauth2/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${credentials}`,
        },
        body: `grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(ruName)}`,
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error("❌ Token exchange failed:", response.status, errorText);
        process.exit(1);
      }
      
      const data = await response.json();
      
      console.log("✅ Success! Token obtained:\n");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log(`Access Token: ${data.access_token.substring(0, 50)}...`);
      console.log(`Expires in: ${data.expires_in} seconds (~${Math.floor(data.expires_in / 60)} minutes)`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
      
      console.log("📋 Next steps:");
      console.log("1. Add this token to your secrets as EBAY_USER_TOKEN");
      console.log("2. Run the production test scripts:\n");
      console.log("   tsx scripts/production-test-1-inventory.ts --confirm");
      console.log("   tsx scripts/production-test-2-offer.ts --confirm");
      console.log("   tsx scripts/production-test-3-cleanup.ts --confirm\n");
      
      console.log("🔑 Copy this token (valid for ~2 hours):\n");
      console.log(data.access_token);
      console.log("");
      
    } catch (error: any) {
      console.error("❌ Error:", error.message);
    } finally {
      rl.close();
    }
  });
}

exchangeCodeForToken();
