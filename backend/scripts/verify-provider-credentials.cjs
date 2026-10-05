const dotenv = require("dotenv");
const RazorpayModule = require("razorpay");

dotenv.config({ quiet: true });

const Razorpay = RazorpayModule.default || RazorpayModule;

async function verifyGoogleMaps() {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key || key === "REPLACE_ME") {
    throw new Error("GOOGLE_MAPS_SERVER_KEY is missing");
  }

  const response = await fetch(
    "https://routes.googleapis.com/directions/v2:computeRoutes",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
      },
      body: JSON.stringify({
        origin: {
          location: {
            latLng: {
              latitude: 17.4401,
              longitude: 78.3489,
            },
          },
        },
        destination: {
          location: {
            latLng: {
              latitude: 17.385,
              longitude: 78.4867,
            },
          },
        },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE",
      }),
      signal: AbortSignal.timeout(8_000),
    },
  );

  if (!response.ok) {
    throw new Error(`Google Routes returned HTTP ${response.status}`);
  }

  const data = await response.json();
  if (!data.routes?.[0]) {
    throw new Error("Google Routes returned no route");
  }
}

async function verifyRazorpay() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (
    !keyId ||
    !keySecret ||
    keyId === "rzp_test_REPLACE_ME" ||
    keySecret === "REPLACE_ME"
  ) {
    throw new Error("Razorpay API credentials are missing");
  }

  if (
    !keyId.startsWith("rzp_test_") &&
    process.env.ALLOW_LIVE_PROVIDER_CHECK !== "1"
  ) {
    throw new Error("Refusing to check non-test Razorpay credentials");
  }

  const razorpay = new Razorpay({
    key_id: keyId,
    key_secret: keySecret,
  });

  // A list request validates the pair without creating a provider order.
  await razorpay.orders.all({ count: 1 });
}

async function main() {
  const checks = await Promise.allSettled([
    verifyGoogleMaps(),
    verifyRazorpay(),
  ]);
  const names = ["Google Maps Routes API", "Razorpay Test API"];
  let failed = false;

  checks.forEach((result, index) => {
    if (result.status === "fulfilled") {
      console.log(`PASS ${names[index]} credentials`);
    } else {
      failed = true;
      console.error(`FAIL ${names[index]}: ${result.reason.message}`);
    }
  });

  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret || webhookSecret === "REPLACE_ME") {
    failed = true;
    console.error("FAIL Razorpay webhook secret: missing");
  } else {
    console.log("PASS Razorpay webhook secret is configured locally");
  }

  if (failed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`FAIL provider verification: ${error.message}`);
  process.exitCode = 1;
});
