import assert from "node:assert/strict";
import { test } from "node:test";
import { clerkConfigFromEnv } from "./clerk.ts";

const origins = ["http://localhost:8081"];
const pem = "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA\n-----END PUBLIC KEY-----";

test("no CLERK_JWT_KEY means no Clerk sign-in, not an error", () => {
  assert.equal(clerkConfigFromEnv(origins, {}), null);
});

test("production and Render refuse to start without Clerk authentication", () => {
  for (const env of [{ NODE_ENV: "production" }, { RENDER_GIT_COMMIT: "revision" }]) {
    assert.throws(() => clerkConfigFromEnv(origins, env), /CLERK_JWT_KEY.*required/);
    assert.throws(() => clerkConfigFromEnv(origins, { ...env, CLERK_JWT_KEY: "  " }), /CLERK_JWT_KEY.*required/);
    assert.equal(clerkConfigFromEnv(origins, { ...env, CLERK_JWT_KEY: pem })?.jwtKey, pem);
  }
});

test("the key is a PEM public key, pasted with real newlines or written-out \\n", () => {
  assert.deepEqual(clerkConfigFromEnv(origins, { CLERK_JWT_KEY: pem }), { jwtKey: pem, authorizedParties: origins });
  assert.equal(clerkConfigFromEnv(origins, { CLERK_JWT_KEY: pem.replaceAll("\n", "\\n") })?.jwtKey, pem);
  assert.throws(() => clerkConfigFromEnv(origins, { CLERK_JWT_KEY: "not-a-pem" }), /PEM public key/);
});
