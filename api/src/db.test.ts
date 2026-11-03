import assert from "node:assert/strict";
import { test } from "node:test";
import { Surreal } from "surrealdb";
import { connectSurreal, surrealConfigFromEnv } from "./db.ts";

const full = {
  SURREAL_URL: "wss://example.surreal.cloud",
  SURREAL_NAMESPACE: "build_north",
  SURREAL_DATABASE: "dev",
  SURREAL_USER: "api",
  SURREAL_PASS: "secret",
};

test("no SURREAL_URL means no database, not an error", () => {
  assert.equal(surrealConfigFromEnv({}), null);
});

test("a full config signs in as a root user by default", () => {
  assert.equal(surrealConfigFromEnv(full)?.authLevel, "root");
  assert.equal(surrealConfigFromEnv({ ...full, SURREAL_AUTH_LEVEL: "database" })?.authLevel, "database");
});

test("a half-filled config fails at startup instead of at the first request", () => {
  assert.throws(() => surrealConfigFromEnv({ ...full, SURREAL_URL: "example.surreal.cloud" }), /not a URL/);
  assert.throws(() => surrealConfigFromEnv({ ...full, SURREAL_PASS: "" }), /SURREAL_PASS/);
  assert.throws(() => surrealConfigFromEnv({ ...full, SURREAL_AUTH_LEVEL: "admin" }), /SURREAL_AUTH_LEVEL/);
});

test("database credentials require a supported encrypted remote transport", () => {
  for (const url of ["ftp://db.example", "http://db.example", "ws://db.example", "wss://user:pass@db.example", "wss://db.example/#secret"]) {
    assert.throws(() => surrealConfigFromEnv({ ...full, SURREAL_URL: url }), /SURREAL_URL/);
  }
  for (const url of ["https://db.example", "wss://db.example", "http://127.0.0.1:8000", "ws://localhost:8000", "ws://[::1]:8000"]) {
    assert.equal(surrealConfigFromEnv({ ...full, SURREAL_URL: url })?.url, url);
  }
  for (const env of [{ NODE_ENV: "production" }, { RENDER_GIT_COMMIT: "revision" }]) {
    assert.throws(() => surrealConfigFromEnv({ ...full, ...env, SURREAL_URL: "ws://127.0.0.1:8000" }), /SURREAL_URL/);
  }
});

test("connection failures reject startup and close the retrying client", async (t) => {
  const failure = new Error("database unavailable");
  t.mock.method(Surreal.prototype, "connect", async () => { throw failure; });
  const close = t.mock.method(Surreal.prototype, "close", async () => true);
  await assert.rejects(async () => await connectSurreal(surrealConfigFromEnv(full)!), failure);
  assert.equal(close.mock.callCount(), 1);
});

test("connection readiness waits for authentication to finish", async (t) => {
  const connected = Promise.withResolvers<true>();
  t.mock.method(Surreal.prototype, "connect", () => connected.promise);
  let ready = false;
  const connection = Promise.resolve(connectSurreal(surrealConfigFromEnv(full)!)).then((db) => { ready = true; return db; });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(ready, false);
  connected.resolve(true);
  assert.ok(await connection instanceof Surreal);
});

test("a hung connection times out and closes its retrying client", async (t) => {
  t.mock.method(Surreal.prototype, "connect", () => new Promise<true>(() => {}));
  const close = t.mock.method(Surreal.prototype, "close", async () => true);
  await assert.rejects(connectSurreal(surrealConfigFromEnv(full)!), /timed out after 5 seconds/);
  assert.equal(close.mock.callCount(), 1);
});
