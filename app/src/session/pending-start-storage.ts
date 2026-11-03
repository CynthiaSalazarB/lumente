import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { Platform } from "react-native";
import type { CreateSessionBody } from "@build-north/agents";
import type { PendingStarts } from "./pending-start.ts";

const PREFIX = "lumente.start.";
const KEY = /^[A-Za-z0-9_-]{1,128}$/;
const hash = (text: string) => digestStringAsync(CryptoDigestAlgorithm.SHA256, text);
const folder = () => new Directory(Paths.document, "pending-starts");
const file = (name: string) => new File(folder(), name);
const fingerprint = (body: CreateSessionBody) => hash(JSON.stringify([
  body.concept.trim(), body.material?.trim() ? body.material : null, body.mode ?? "learn",
]));

async function locked<T>(scope: string, work: (prefix: string) => T): Promise<T> {
  const prefix = `${PREFIX}${await hash(scope)}.`;
  if (Platform.OS === "web") {
    // Without a cross-tab lock, two windows can persist different keys before either sends.
    if (!globalThis.navigator?.locks) throw new Error("Browser storage locking is unavailable");
    return navigator.locks.request(prefix, () => work(prefix));
  }
  // Native storage operations below are synchronous; no other JS caller can interleave them.
  return work(prefix);
}

function read(name: string): string | null {
  if (Platform.OS === "web") return localStorage.getItem(name);
  const entry = file(name);
  return entry.exists ? entry.textSync() : null;
}

function remove(name: string) {
  if (Platform.OS === "web") localStorage.removeItem(name);
  else {
    const entry = file(name);
    if (entry.exists) entry.delete();
  }
}

export const pendingStartStorage: PendingStarts = {
  async acquire(scope, body) {
    const request = await fingerprint(body);
    return locked(scope, (prefix) => {
      const name = prefix + request;
      const existing = read(name);
      if (existing !== null) {
        if (!KEY.test(existing)) throw new Error("Stored session request key is invalid");
        return existing;
      }
      const key = randomUUID();
      if (Platform.OS === "web") localStorage.setItem(name, key);
      else {
        const dir = folder();
        if (!dir.exists) dir.create();
        // A crash before rename leaves only an unused temp file; no request has been sent yet.
        const temp = file(`${name}.${key}.tmp`);
        temp.writeSync(key);
        temp.moveSync(file(name));
      }
      return key;
    });
  },
  async complete(scope, body, key) {
    const request = await fingerprint(body);
    await locked(scope, (prefix) => {
      const name = prefix + request;
      // A late response must not erase a newer request or another tab's retry.
      if (read(name) === key) remove(name);
    });
  },
  async clear(scope) {
    await locked(scope, (prefix) => {
      if (Platform.OS === "web") {
        const names: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const name = localStorage.key(i);
          if (name?.startsWith(prefix)) names.push(name);
        }
        for (const name of names) remove(name);
      } else {
        const dir = folder();
        if (dir.exists) for (const entry of dir.list()) {
          if (entry instanceof File && entry.name.startsWith(prefix)) entry.delete();
        }
      }
    });
  },
};
