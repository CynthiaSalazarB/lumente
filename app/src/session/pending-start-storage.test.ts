import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

const modules: Record<string, string> = {
  "react-native": 'export const Platform = { OS: "web" };',
  "expo-crypto": `import { createHash, randomUUID } from 'node:crypto';
    export { randomUUID }; export const CryptoDigestAlgorithm = { SHA256: 'sha256' };
    export async function digestStringAsync(algorithm, text) { return createHash(algorithm).update(text).digest('hex'); }`,
  "expo-file-system": `
    export const files = new Map(); export const Paths = { document: 'test' };
    export const failures = { write: false, move: false };
    export class File {
      constructor(parent, name) { this.name = name; }
      get exists() { return files.has(this.name); }
      textSync() { return files.get(this.name); }
      writeSync(text) { if (failures.write) throw Error('write failed'); files.set(this.name, text); }
      moveSync(to) { if (failures.move) throw Error('move failed'); files.set(to.name, files.get(this.name)); files.delete(this.name); this.name = to.name; }
      delete() { files.delete(this.name); }
    }
    export class Directory { exists = true; create() {} list() { return [...files.keys()].map(name => new File(this, name)); } }
  `,
};
registerHooks({ resolve(specifier, context, next) {
  return modules[specifier] ? { url: `data:text/javascript,${encodeURIComponent(modules[specifier])}`, shortCircuit: true } : next(specifier, context);
} });
const { pendingStartStorage: storage } = await import("./pending-start-storage.ts");
const body = { concept: "democracy" };

test("browser adapter locks concurrent reservations, scopes keys and rejects corrupt storage", async (t) => {
  const values = new Map<string, string>();
  const queues = new Map<string, Promise<unknown>>();
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    get length() { return values.size; }, key: (i: number) => [...values.keys()][i] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key),
  } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: {
    request(name: string, fn: () => unknown) {
      const next = (queues.get(name) ?? Promise.resolve()).then(fn);
      queues.set(name, next.catch(() => {}));
      return next;
    },
  } } });
  t.after(() => {
    for (const [name, descriptor] of [["localStorage", oldStorage], ["navigator", oldNavigator]] as const) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
  const keys = await Promise.all(Array.from({ length: 20 }, () => storage.acquire("api:a", body)));
  assert.equal(new Set(keys).size, 1);
  assert.equal(await storage.acquire("api:a", { concept: " democracy ", material: "  ", mode: "learn" }), keys[0]);
  assert.notEqual(await storage.acquire("api:b", body), keys[0]);
  assert.notEqual(await storage.acquire("other:a", body), keys[0]);
  await storage.complete("api:a", body, "stale-key");
  assert.equal(await storage.acquire("api:a", body), keys[0]);
  const name = [...values.keys()][0]!;
  values.set(name, "corrupted key!");
  await assert.rejects(storage.acquire("api:a", body), /invalid/);
  await storage.clear("api:a");
  assert.equal(values.size, 2);
  Reflect.deleteProperty(navigator, "locks");
  await assert.rejects(storage.acquire("api:a", body), /locking is unavailable/);
});

test("native adapter persists atomically, recovers after recreation, and reports failed writes", async () => {
  const { Platform } = await import("react-native");
  Platform.OS = "ios";
  const nativeModule = "expo-file-system";
  const { files, failures } = await import(nativeModule);
  const key = await storage.acquire("api:a", body);
  const path = "./pending-start-storage.ts?restart";
  const restarted = (await import(path)).pendingStartStorage;
  assert.equal(await restarted.acquire("api:a", body), key);
  assert.equal(files.size, 1);
  failures.move = true;
  await assert.rejects(storage.acquire("api:a", { concept: "planet" }), /move failed/);
  failures.move = false;
  const newKey = await restarted.acquire("api:a", { concept: "planet" });
  assert.match(newKey, /^[a-z0-9-]+$/);
  failures.write = true;
  await assert.rejects(storage.acquire("api:a", { concept: "other" }), /write failed/);
  failures.write = false;
  await storage.clear("api:a");
  assert.equal(files.size, 0);
  Platform.OS = "web";
});
