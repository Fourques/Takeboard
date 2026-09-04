const platform = process.argv[2];

const requirements = {
  macos: [
    "APPLE_CERTIFICATE",
    "APPLE_CERTIFICATE_PASSWORD",
    "APPLE_SIGNING_IDENTITY",
    "APPLE_API_ISSUER",
    "APPLE_API_KEY",
    "APPLE_API_PRIVATE_KEY",
  ],
  windows: [
    "AZURE_CLIENT_ID",
    "AZURE_TENANT_ID",
    "AZURE_SUBSCRIPTION_ID",
    "AZURE_SIGNING_ENDPOINT",
    "AZURE_SIGNING_ACCOUNT",
    "AZURE_CERTIFICATE_PROFILE",
  ],
};

if (!(platform in requirements)) {
  console.error("Usage: node scripts/release-signing-preflight.mjs <macos|windows>");
  process.exit(2);
}

const missing = requirements[platform].filter((name) => !process.env[name]?.trim());
if (missing.length > 0) {
  console.error(`Production ${platform} signing is not configured: ${missing.join(", ")}`);
  process.exit(1);
}

if (platform === "macos") {
  if (!process.env.APPLE_SIGNING_IDENTITY.startsWith("Developer ID Application:")) {
    console.error("APPLE_SIGNING_IDENTITY must be a Developer ID Application identity");
    process.exit(1);
  }
  if (!process.env.APPLE_API_PRIVATE_KEY.includes("BEGIN PRIVATE KEY")) {
    console.error("APPLE_API_PRIVATE_KEY is not an App Store Connect .p8 private key");
    process.exit(1);
  }
}

if (platform === "windows") {
  let endpoint;
  try {
    endpoint = new URL(process.env.AZURE_SIGNING_ENDPOINT);
  } catch {
    console.error("AZURE_SIGNING_ENDPOINT must be an HTTPS URL");
    process.exit(1);
  }
  if (endpoint.protocol !== "https:" || !endpoint.hostname.endsWith(".codesigning.azure.net")) {
    console.error("AZURE_SIGNING_ENDPOINT must be an Azure Artifact Signing HTTPS endpoint");
    process.exit(1);
  }
}

console.log(`Production ${platform} signing configuration is present and structurally valid.`);
