import fetch from "node-fetch";
import querystring from "querystring";

const clientId = process.env.EBAY_PROD_CLIENT_ID;
const clientSecret = process.env.EBAY_PROD_CLIENT_SECRET;
const runame = "antonio_hailese-antonioh-EZwop--dsqrcalgf";
const rawCode = process.env.EBAY_AUTH_CODE;

async function main() {
  if (!clientId || !clientSecret || !runame || !rawCode) {
    console.error("Missing EBAY_PROD_CLIENT_ID, EBAY_PROD_CLIENT_SECRET, EBAY_AUTH_CODE, or RuName");
    process.exit(1);
  }

  // The code from the URL is percent-encoded; decode it before sending.
  const code = decodeURIComponent(rawCode);

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const body = querystring.stringify({
    grant_type: "authorization_code",
    code,
    redirect_uri: runame,
  });

  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const text = await res.text();
  console.log("Status:", res.status);
  console.log(text);
}

main().catch(err => {
  console.error("Error exchanging code:", err);
  process.exit(1);
});
