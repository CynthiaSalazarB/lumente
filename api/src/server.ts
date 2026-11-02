import Anthropic from "@anthropic-ai/sdk";
import { callAgentStub, orchestratorFor } from "./advance-stub.ts";
import { createApp } from "./app.ts";
import { agentConfigFromEnv, createCallAgent, sendWith } from "./call-agent.ts";
import { clerkConfigFromEnv, clerkUserFromToken } from "./clerk.ts";
import { connectSurreal, surrealCheck, surrealConfigFromEnv } from "./db.ts";
import { createLearnerMemory, createMemoryApi, memoryConfigFromEnv, memoryPurgeConfigFromEnv, memoryPurgeOf } from "./memory.ts";
import { createStore, defineSchema } from "./store.ts";

const port = Number(process.env.PORT || 3000);
// Comma-separated: the Expo dev server, plus the deployed web build once it has a URL.
const corsOrigins = (process.env.CORS_ORIGIN ?? "").split(",").map((origin) => origin.trim()).filter(Boolean);
const surreal = surrealConfigFromEnv();
const db = surreal ? connectSurreal(surreal) : null;
if (db) defineSchema(db).catch((error: unknown) => console.error("SurrealDB schema failed:", error));
const store = db ? createStore(db) : null;
// The Clerk session token signs the caller in (#23); a web build's token must come from one of the CORS origins.
const clerk = clerkConfigFromEnv(corsOrigins);
// x-dev-user works only with a DEV_KEY set, and never in production (CONTRACTS.md section 1).
const devKey = process.env.NODE_ENV === "production" ? null : process.env.DEV_KEY?.trim() || null;
// Claude calls (#10) need ANTHROPIC_API_KEY, a budget, and a database for their agent_log rows. With
// them, Cynthia's orchestrator runs every session (#28); without them, sessions replay the session-1
// fixture, so the app still works against an API with no key. A production process missing one of them
// refuses to start instead (advance-stub.ts).
const agents = agentConfigFromEnv();
const orchestrator = orchestratorFor(process.env, { claude: agents !== null, database: store !== null });
const anthropic = agents && store ? new Anthropic({ maxRetries: 0, timeout: 30_000 }) : null;
const callAgentFor = agents && store && anthropic
  ? createCallAgent({
      ...agents,
      // call-agent owns retries so each paid request gets its own measured cost and agent_log row.
      send: sendWith(anthropic),
      log: (entry) => store.logAgentCall(entry),
    })
  : () => callAgentStub;

// SurrealDB Agent Memory (#112): off unless AGENT_MEMORY_ENABLED is on. It needs the database too: the Memory
// sheet counts who read each fact from agent_log, and the facts come from sessions with a result.
const memoryConfig = memoryConfigFromEnv();
const memory = memoryConfig && store ? createLearnerMemory(createMemoryApi(memoryConfig), { ...memoryConfig, conceptsOf: (user, ids) => store.sessionConcepts(user, ids) }) : null;
// With the flag off, what learners left in memory while it was on still goes with Delete my data
const purgeConfig = memory ? null : memoryPurgeConfigFromEnv();
const purgeMemory = purgeConfig ? memoryPurgeOf(createMemoryApi(purgeConfig), purgeConfig) : null;

createApp({
  corsOrigins,
  checkDb: db ? surrealCheck(db) : null,
  store,
  advance: orchestrator,
  callAgentFor,
  userFromToken: clerk ? clerkUserFromToken(clerk) : null,
  devKey,
  // per IP: a room of testers on one Wi-Fi shares one, so the limit can be raised for the day
  requestsPerMinute: Number(process.env.REQUESTS_PER_MINUTE) || undefined,
  memory,
  purgeMemory,
  // Render sets RENDER_GIT_COMMIT on every deploy (render.com/docs/environment-variables)
  commit: process.env.RENDER_GIT_COMMIT?.trim().slice(0, 7) || null,
}).listen(port, (error) => {
  if (error) throw error;
  const dbInfo = surreal ? `${new URL(surreal.url).host} (${surreal.namespace}/${surreal.database})` : "not configured";
  const claude = agents && store ? `${agents.model}, $${agents.budgetUsd} budget` : "off, sessions replay the session-1 fixture";
  const memoryInfo = memory ? `on (${new URL(memoryConfig!.endpoint).host})` : memoryConfig ? "off, no database" : purgeMemory ? "off; Delete my data still purges it" : "off";
  console.log(
    `api listening on :${port} · CORS: ${corsOrigins.join(", ") || "none"} · SurrealDB: ${dbInfo} · Clerk: ${clerk ? "on" : "off"} · x-dev-user: ${devKey ? "on, with x-dev-key" : "off"} · Claude: ${claude} · Agent Memory: ${memoryInfo}`,
  );
});
