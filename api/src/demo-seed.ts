import { DemoSeed, type Session } from "@build-north/agents";
import demoSeed from "@build-north/agents/fixtures/demo-seed.json" with { type: "json" };
import { connectSurreal, surrealConfigFromEnv } from "./db.ts";
import { createStore, defineSchema, type Store } from "./store.ts";

// Cynthia's demo profile (#32) under one user (#44), through the Store the API reads: the seed's mastery
// (level 5 on every move) and its CORS session, waiting at the whole-map Turn with the prediction
// made. The session gets its id from SurrealDB like any other, since the API only accepts those ids. A
// second run resets the mastery and adds a fresh session; the earlier sessions stay.
export async function loadDemoSeed(store: Store, user: string): Promise<Session> {
  const { mastery, session: seeded } = DemoSeed.parse(demoSeed);
  await store.saveMastery(user, mastery);
  const created = await store.createSession(user, { concept: seeded.concept, material: seeded.material, mode: seeded.mode });
  const session: Session = {
    ...seeded,
    id: created.id,
    user,
    createdAt: created.createdAt,
    lastTurn: seeded.lastTurn && { ...seeded.lastTurn, sessionId: created.id },
  };
  if (!(await store.saveSession(session, created.turn))) throw new Error(`Session ${created.id} changed while it was being seeded`);
  return session;
}

// npm run seed:demo -w api -- <user id>: seeds the database the SURREAL_* variables name.
async function main(user: string | undefined): Promise<number> {
  if (!user) {
    console.error("Usage: npm run seed:demo -w api -- <user id> (the x-dev-user name, or the demo account's Clerk user id)");
    return 2;
  }
  const config = surrealConfigFromEnv();
  if (!config) {
    console.error("SURREAL_URL is unset: set the SURREAL_* variables for the database to seed");
    return 2;
  }
  const db = await connectSurreal(config);
  try {
    // the tables the API defines at startup, in case it hasn't started against this database yet
    await defineSchema(db);
    const session = await loadDemoSeed(createStore(db), user);
    console.log(
      `Seeded ${user} in ${new URL(config.url).host} (${config.namespace}/${config.database}): level 5 on every move, and the ${session.concept} session ${session.id} waiting at the whole map`,
    );
    return 0;
  } finally {
    await db.close();
  }
}

if (import.meta.main) process.exitCode = await main(process.argv[2]?.trim());
