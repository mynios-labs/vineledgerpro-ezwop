const AUTHORIZATION_CODE = "v%5E1.1%23i%5E1%23f%5E0%23p%5E3%23r%5E1%23I%5E3%23t%5EUl41XzM6N0U1OTUwRDNCNTlGRUM3MTQ2NTlEMjgwNjcwNDgyODdfMF8xI0VeMTI4NA%3D%3D";

async function exchangeAuthCodeForToken() {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  // For token exchange, use just the RuName, not the full URL
  const redirectUri = "antonio_hailese-antonioh-EZwop--azdszk";

  if (!clientId || !clientSecret || !redirectUri) {
    console.error("❌ Missing required environment variables:");
    console.error("   EBAY_CLIENT_ID:", clientId ? "✓" : "✗");
    console.error("   EBAY_CLIENT_SECRET:", clientSecret ? "✓" : "✗");
    console.error("   EBAY_REDIRECT_URL:", redirectUri ? "✓" : "✗");
    process.exit(1);
  }

  console.log("🔐 Exchanging authorization code for SANDBOX user access token...\n");
  console.log("Configuration:");
  console.log(`  Client ID: ${clientId.substring(0, 20)}...`);
  console.log(`  Redirect URI: ${redirectUri}`);
  console.log(`  Code (first 50 chars): ${AUTHORIZATION_CODE.substring(0, 50)}...\n`);

  const tokenEndpoint = "https://api.sandbox.ebay.com/identity/v1/oauth2/token";
  
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: AUTHORIZATION_CODE,
    redirect_uri: redirectUri,
  });

  try {
    const response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${credentials}`,
      },
      body: body.toString(),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("❌ Token exchange failed:");
      console.error(JSON.stringify(data, null, 2));
      process.exit(1);
    }

    console.log("✅ Token exchange successful!\n");
    console.log("Response:");
    console.log(`  Access Token: ${data.access_token.substring(0, 50)}...`);
    console.log(`  Token Type: ${data.token_type}`);
    console.log(`  Expires In: ${data.expires_in} seconds (${Math.floor(data.expires_in / 3600)} hours)`);
    console.log(`  Refresh Token: ${data.refresh_token ? data.refresh_token.substring(0, 50) + "..." : "N/A"}`);
    
    console.log("\n📋 NEXT STEPS:");
    console.log("1. Copy the access token below");
    console.log("2. Update the EBAY_USER_TOKEN secret in Replit Secrets");
    console.log("3. Ensure EBAY_ENV is set to 'sandbox'\n");
    console.log("═══════════════════════════════════════════════════════");
    console.log("ACCESS TOKEN (copy this entire value):");
    console.log("═══════════════════════════════════════════════════════");
    console.log(data.access_token);
    console.log("═══════════════════════════════════════════════════════\n");

    if (data.refresh_token) {
      console.log("═══════════════════════════════════════════════════════");
      console.log("REFRESH TOKEN (save this for future use):");
      console.log("═══════════════════════════════════════════════════════");
      console.log(data.refresh_token);
      console.log("═══════════════════════════════════════════════════════\n");
    }

  } catch (error) {
    console.error("❌ Error during token exchange:", error);
    process.exit(1);
  }
}

exchangeAuthCodeForToken();
