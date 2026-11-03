// Which client the app uses, from app/.env (Expo inlines EXPO_PUBLIC_* when it bundles, so nothing
// secret goes in them). No EXPO_PUBLIC_API_URL: the app replays the recorded API session with no API.
import { createApiClient } from "./api-client.ts";
import type { SessionClient } from "./client.ts";
import { createFixtureClient } from "./fixture-client.ts";
import { withPendingStarts } from "./pending-start.ts";

const apiUrl = process.env.EXPO_PUBLIC_API_URL;

/** Clerk's publishable key (#22). Without it nobody signs in, and API calls carry the dev headers. */
export const clerkKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() || null;

// local dev only; never set EXPO_PUBLIC_DEV_KEY for the deployed web build
const devUser = process.env.EXPO_PUBLIC_DEV_USER?.trim() || "dev";
const devKey = process.env.EXPO_PUBLIC_DEV_KEY?.trim() || null;

/** The client for an API address: the API with one, the recorded session (demo mode, `offline: true`) without. Pure, so a
 * test can prove that a build exported with EXPO_PUBLIC_API_URL never replays (#163). */
export function clientFor(apiUrl: string | undefined, getToken?: () => Promise<string | null>): SessionClient {
  const baseUrl = apiUrl?.trim();
  if (!baseUrl) return createFixtureClient();
  if (getToken) return createApiClient({ baseUrl, getToken });
  return createApiClient({ baseUrl, devUser, devKey });
}

/** With Clerk, `getToken` gives every API call the signed-in learner's session token instead. */
export function createClient(getToken?: () => Promise<string | null>, userId?: string | null): SessionClient {
  const client = clientFor(apiUrl, getToken);
  const identity = getToken ? userId : devUser;
  if (client.offline || !identity) return client;
  const scope = JSON.stringify([apiUrl!.trim().replace(/\/+$/, ""), getToken ? "clerk" : "dev", identity]);
  return withPendingStarts(client, scope, async () => (await import("./pending-start-storage.ts")).pendingStartStorage);
}
