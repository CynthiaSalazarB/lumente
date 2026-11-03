import { verifyToken } from "@clerk/backend";

// Clerk sign-in for the API (#23): the app sends the Clerk session token as Authorization: Bearer
// <token>, and the API checks it with the instance's PEM public key, with no network call.

export type ClerkConfig = { jwtKey: string; authorizedParties: string[] };

// Null without CLERK_JWT_KEY: then no token can sign anyone in, and only dev users get in (never in
// production). Render's environment form keeps a PEM on one line, so written-out \n become newlines.
export function clerkConfigFromEnv(authorizedParties: string[], env: NodeJS.ProcessEnv = process.env): ClerkConfig | null {
  const jwtKey = env.CLERK_JWT_KEY?.trim().replaceAll("\\n", "\n");
  if (!jwtKey) {
    if (env.NODE_ENV === "production" || env.RENDER_GIT_COMMIT) {
      throw new Error("CLERK_JWT_KEY is required in production or on Render; no learner could sign in");
    }
    return null;
  }
  if (!jwtKey.startsWith("-----BEGIN PUBLIC KEY-----")) {
    throw new Error("CLERK_JWT_KEY must be the PEM public key (Clerk dashboard, API keys, Show JWT public key)");
  }
  return { jwtKey, authorizedParties };
}

// The Clerk user id a session token belongs to, or null when the token doesn't hold up: a bad
// signature, expired, or made by a web build this API doesn't serve. A web build's token names its
// origin in azp and must be one of the CORS origins; the native app's token has no origin to name.
export function clerkUserFromToken({ jwtKey, authorizedParties }: ClerkConfig) {
  return async (token: string): Promise<string | null> => {
    // the package's verifyToken returns the token's claims, and throws for a token that doesn't hold up
    const claims = await verifyToken(token, { jwtKey }).catch((error: unknown) => {
      console.warn(`Clerk token refused: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    });
    if (!claims) return null;
    if (claims.azp && !authorizedParties.includes(claims.azp)) {
      console.warn(`Clerk token refused: made for ${claims.azp}, which isn't in CORS_ORIGIN`);
      return null;
    }
    return claims.sub || null;
  };
}
