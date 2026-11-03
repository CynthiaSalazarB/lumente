import assert from "node:assert/strict";
import { test } from "node:test";
import { createApiClient } from "./api-client.ts";
import { withPendingStarts, type PendingStarts } from "./pending-start.ts";
import { Turn } from "@build-north/agents";
import fixture from "@build-north/agents/fixtures/session-1.json" with { type: "json" };

const first = Turn.parse(fixture[0]!.turn);
const body = { concept: "democracy" };
function memory() {
  const records = new Map<string, string>();
  let count = 0;
  const id = (scope: string, body: unknown) => `${scope}:${JSON.stringify(body)}`;
  const storage: PendingStarts = {
    async acquire(scope, body) {
      const name = id(scope, body);
      if (!records.has(name)) records.set(name, `key-${++count}`);
      return records.get(name)!;
    },
    async complete(scope, body, key) {
      if (records.get(id(scope, body)) === key) records.delete(id(scope, body));
    },
    async clear(scope) {
      for (const name of records.keys()) if (name.startsWith(`${scope}:`)) records.delete(name);
    },
  };
  return { storage, records };
}

test("a lost start response survives recreation; only a completed session permits a fresh key", async () => {
  const { storage, records } = memory();
  const keys: string[] = [];
  let finished = false;
  const fetch: typeof globalThis.fetch = async (_url, init) => {
    if (init?.method === "GET") return Response.json(finished ? Turn.parse(fixture.at(-1)!.turn) : first);
    keys.push(new Headers(init?.headers).get("Idempotency-Key")!);
    if (keys.length === 1) throw new Error("response lost after commit");
    return Response.json(first, { status: 201 });
  };
  const client = () => withPendingStarts(createApiClient({ baseUrl: "https://api.test", fetch }), "api:user", async () => storage);
  await assert.rejects(client().start(body), /connection/);
  assert.equal(records.size, 1);
  assert.deepEqual(await client().start(body), first);
  assert.equal(records.size, 1);
  await client().start(body);
  assert.deepEqual(keys, ["key-1", "key-1", "key-1"]);
  finished = true;
  await client().start(body);
  assert.deepEqual(keys, ["key-1", "key-1", "key-1", "key-1", "key-2"]);
});

test("one successful tab cannot erase the key needed by another tab with a lost response", async () => {
  const { storage } = memory();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let posts = 0;
  const keys: string[] = [];
  const fetch: typeof globalThis.fetch = async (_url, init) => {
    if (init?.method === "POST") {
      const index = ++posts;
      keys.push(new Headers(init.headers).get("Idempotency-Key")!);
      if (index === 2) { await gate; throw new Error("lost response"); }
    }
    return Response.json(first);
  };
  const client = () => withPendingStarts(createApiClient({ baseUrl: "https://api.test", fetch }), "api:user", async () => storage);
  const a = client().start(body);
  const b = client().start(body);
  const failed = assert.rejects(b, /connection/);
  await a;
  release();
  await failed;
  await client().start(body);
  assert.deepEqual(keys, ["key-1", "key-1", "key-1"]);
});

test("storage failure prevents sending; cleanup failure preserves recovery key", async () => {
  const { storage } = memory();
  let sends = 0;
  const api = createApiClient({ baseUrl: "https://api.test", fetch: async () => { sends++; return Response.json(first); } });
  const broken = withPendingStarts(api, "api:user", async () => ({ ...storage, acquire: async () => { throw new Error("disk full"); } }));
  await assert.rejects(broken.start(body), /Could not save/);
  assert.equal(sends, 0);
  const key = await storage.acquire("api:user", body);
  const finishedApi = createApiClient({ baseUrl: "https://api.test", fetch: async (_url, init) => Response.json(init?.method === "GET" ? fixture.at(-1)!.turn : first) });
  const cleanup = withPendingStarts(finishedApi, "api:user", async () => ({ ...storage, complete: async () => { throw new Error("disk full"); } }));
  await assert.rejects(cleanup.start(body), /Could not prepare/);
  assert.equal(await storage.acquire("api:user", body), key);
});

test("pending starts separate learner, API and body; deletion clears only its scope", async () => {
  const { storage, records } = memory();
  const keys = await Promise.all([
    storage.acquire("api:a", body), storage.acquire("api:b", body),
    storage.acquire("other:a", body), storage.acquire("api:a", { concept: "planet" }),
  ]);
  assert.equal(new Set(keys).size, 4);
  const api = createApiClient({ baseUrl: "https://api.test", fetch: async () => new Response(null, { status: 204 }) });
  await withPendingStarts(api, "api:a", async () => storage).deleteData();
  assert.equal(records.size, 2);
});
