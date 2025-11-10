// Test if our Client ID/Secret work with Client Credentials flow
async function getApplicationToken() {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("❌ Missing credentials");
    process.exit(1);
  }

  console.log("🔐 Testing Client Credentials flow (Application Token)...\n");
  console.log(`  Client ID: ${clientId.substring(0, 20)}...`);

  const tokenEndpoint = "https://api.sandbox.ebay.com/identity/v1/oauth2/token";
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "https://api.ebay.com/oauth/api_scope/sell.inventory",
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
      console.error("❌ Token request failed:");
      console.error(JSON.stringify(data, null, 2));
      process.exit(1);
    }

    console.log("✅ Client credentials are VALID!\n");
    console.log(`Access Token: ${data.access_token.substring(0, 50)}...`);
    console.log(`Expires In: ${data.expires_in} seconds`);
    console.log("\nThis confirms your Client ID and Secret are correct.");
    console.log("The issue must be with the OAuth authorization code flow.\n");

  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

getApplicationToken();
