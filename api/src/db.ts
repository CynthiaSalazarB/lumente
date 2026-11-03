import { Surreal } from "surrealdb";
import { validateServiceUrl } from "./service-url.ts";

type AuthLevel = "root" | "namespace" | "database";

export type SurrealConfig = {
  url: string;
  namespace: string;
  database: string;
  username: string;
  password: string;
  authLevel: AuthLevel;
};

export type DbCheck = { now: string; ms: number };

const AUTH_LEVELS: readonly AuthLevel[] = ["root", "namespace", "database"];
// A turn's budget is 8 s (CONTRACTS.md §5): a database that can't answer in 5 s fails the request instead.
const QUERY_TIMEOUT_MS = 5_000;

// Bounds one request's database work, including any wait for the connection.
export function queryTimeout(): AbortSignal {
  return AbortSignal.timeout(QUERY_TIMEOUT_MS);
}

function isAuthLevel(level: string): level is AuthLevel {
  return (AUTH_LEVELS as readonly string[]).includes(level);
}

// Null when SURREAL_URL is unset, so the API still starts (and /health still passes) without a database.
export function surrealConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SurrealConfig | null {
  const url = env.SURREAL_URL;
  if (!url) return null;
  validateServiceUrl(url, "SURREAL_URL", env, true);
  const { SURREAL_NAMESPACE: namespace, SURREAL_DATABASE: database, SURREAL_USER: username, SURREAL_PASS: password } = env;
  if (!namespace || !database || !username || !password) {
    throw new Error("SURREAL_URL is set, so SURREAL_NAMESPACE, SURREAL_DATABASE, SURREAL_USER and SURREAL_PASS are required");
  }
  const authLevel = env.SURREAL_AUTH_LEVEL || "root";
  if (!isAuthLevel(authLevel)) throw new Error(`SURREAL_AUTH_LEVEL must be one of: ${AUTH_LEVELS.join(", ")}`);
  return { url, namespace, database, username, password, authLevel };
}

// Startup waits up to 5 s for authentication. After a successful start the SDK reconnects after drops
// (at most 5 s apart); each query has its own deadline while the connection recovers.
export async function connectSurreal({ url, namespace, database, username, password, authLevel }: SurrealConfig): Promise<Surreal> {
  // The level the user was created at: the signin has to name the same namespace and database.
  const authentication =
    authLevel === "root" ? { username, password }
    : authLevel === "namespace" ? { namespace, username, password }
    : { namespace, database, username, password };
  const db = new Surreal();
  db.subscribe("connected", (version) => console.log(`SurrealDB connected (${version})`));
  db.subscribe("disconnected", () => console.warn("SurrealDB disconnected"));
  db.subscribe("error", (error) => console.error("SurrealDB connection error:", error));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      db.connect(url, { namespace, database, authentication, reconnect: { attempts: -1, retryDelayMax: 5_000 } }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("SurrealDB connection timed out after 5 seconds")), QUERY_TIMEOUT_MS);
      }),
    ]);
    return db;
  } catch (error) {
    await db.close();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// Read-only: asks the database for its clock, so a public URL can't be used to write to it.
export function surrealCheck(db: Surreal): () => Promise<DbCheck> {
  return async () => {
    const started = performance.now();
    const [now] = await db.query("RETURN time::now()").json().signal(queryTimeout()).collect<[string]>();
    return { now, ms: Math.round(performance.now() - started) };
  };
}
