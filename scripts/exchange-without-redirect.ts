// Try token exchange WITHOUT redirect_uri parameter
const AUTHORIZATION_CODE = "v%5E1.1%23i%5E1%23I%5E3%23f%5E0%23p%5E3%23r%5E1%23t%5EUl41XzQ6Qzg0RDVBNjdBRTc0QUM5OEI4QUUzMzIzQUQ3RjEzNDlfMF8xI0VeMTI4NA%3D%3D";

async function exchangeAuthCodeForToken() {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;

  console.log("🔐 Exchanging authorization code WITHOUT redirect_uri...\n");
  console.log(`  Client ID: ${clientId?.substring(0, 20)}...`);
  console.log(`  Code: ${AUTHORIZATION_CODE.substring(0, 50)}...\n`);

  const tokenEndpoint = "https://api.sandbox.ebay.com/identity/v1/oauth2/token";
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  // Try WITHOUT redirect_uri
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: AUTHORIZATION_CODE,
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

    console.log("✅ SUCCESS! Token exchange worked!\n");
    console.log("═══════════════════════════════════════════════════════");
    console.log("ACCESS TOKEN:");
    console.log("═══════════════════════════════════════════════════════");
    console.log(data.access_token);
    console.log("═══════════════════════════════════════════════════════\n");

    if (data.refresh_token) {
      console.log("═══════════════════════════════════════════════════════");
      console.log("REFRESH TOKEN:");
      console.log("═══════════════════════════════════════════════════════");
      console.log(data.refresh_token);
      console.log("═══════════════════════════════════════════════════════\n");
    }

  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

exchangeAuthCodeForToken();
