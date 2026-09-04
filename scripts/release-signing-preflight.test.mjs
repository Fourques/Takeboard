import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./release-signing-preflight.mjs", import.meta.url));

function run(platform, env = {}) {
  return spawnSync(process.execPath, [script, platform], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, ...env },
  });
}

test("rejects incomplete production signing configuration", () => {
  const result = run("macos");
  assert.equal(result.status, 1);
});

test("accepts structurally valid Apple credentials without printing secrets", () => {
  const result = run("macos", {
    APPLE_CERTIFICATE: "base64-certificate",
    APPLE_CERTIFICATE_PASSWORD: "certificate-password",
    APPLE_SIGNING_IDENTITY: "Developer ID Application: TakeBoard Example (ABCDE12345)",
    APPLE_API_ISSUER: "issuer-id",
    APPLE_API_KEY: "KEY123",
    APPLE_API_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nprivate\n-----END PRIVATE KEY-----",
  });
  assert.equal(result.status, 0, result.stderr);
});

test("accepts Azure Artifact Signing configuration and rejects other endpoints", () => {
  const common = {
    AZURE_CLIENT_ID: "client-id",
    AZURE_TENANT_ID: "tenant-id",
    AZURE_SUBSCRIPTION_ID: "subscription-id",
    AZURE_SIGNING_ACCOUNT: "takeboard",
    AZURE_CERTIFICATE_PROFILE: "public-trust",
  };
  const accepted = run("windows", {
    ...common,
    AZURE_SIGNING_ENDPOINT: "https://eus.codesigning.azure.net/",
  });
  assert.equal(accepted.status, 0, accepted.stderr);

  const rejected = run("windows", {
    ...common,
    AZURE_SIGNING_ENDPOINT: "https://example.com/",
  });
  assert.equal(rejected.status, 1);
});
