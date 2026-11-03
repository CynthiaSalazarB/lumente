import type { CreateSessionBody } from "@build-north/agents";
import { ClientError, type SessionClient } from "./client.ts";

export type PendingStarts = {
  acquire(scope: string, body: CreateSessionBody): Promise<string>;
  complete(scope: string, body: CreateSessionBody, key: string): Promise<void>;
  clear(scope: string): Promise<void>;
};

/** The same intent survives an uncertain response and client recreation. */
export function withPendingStarts(client: SessionClient, scope: string, storage: () => Promise<PendingStarts>): SessionClient {
  return {
    ...client,
    async start(body) {
      let pending: PendingStarts;
      let key: string;
      try {
        pending = await storage();
        key = await pending.acquire(scope, body);
      } catch {
        throw new ClientError("Could not save this session request on your device. Try again.", null, true);
      }
      const first = await client.start(body, key);
      const latest = await client.resume(first.sessionId);
      // Keep successful keys too: another tab may still have an uncertain response.
      if (latest.phase !== "result") return latest;
      try {
        await pending.complete(scope, body, key);
        key = await pending.acquire(scope, body);
      } catch {
        throw new ClientError("Could not prepare a new session on your device. Try again.", null, true);
      }
      return client.start(body, key);
    },
    async deleteData() {
      await client.deleteData();
      try {
        await (await storage()).clear(scope);
      } catch {
        throw new ClientError("Your server data was deleted, but this device's pending requests could not be removed. Try deleting again.", null, true);
      }
    },
  };
}
