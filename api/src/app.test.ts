import assert from "node:assert/strict";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test, type TestContext } from "node:test";
import { deflateSync, gzipSync } from "node:zlib";
import {
  AGENTS,
  FACT_DESK_REDIRECT,
  MOVE_LABEL,
  MOVE_ORDER,
  Mastery as MasterySchema,
  MemoryView as MemoryViewSchema,
  Session as SessionSchema,
  Transcript as TranscriptSchema,
  Turn as TurnSchema,
  UnexpectedInput,
  advance,
  type Advance,
  type CallAgent,
  type Level,
  type Mastery,
  type MemoryFact,
  type Session,
} from "@build-north/agents";
import memoryView from "@build-north/agents/fixtures/memory-view.json" with { type: "json" };
import sessionOne from "@build-north/agents/fixtures/session-1.json" with { type: "json" };
import { advanceStub, callAgentStub } from "./advance-stub.ts";
import { changedMoves, createApp, learnerWrites, type AppOptions } from "./app.ts";
import { clerkUserFromToken } from "./clerk.ts";
import { createCallAgent, type SendToClaude } from "./call-agent.ts";
import { MemoryError, createLearnerMemory, createMemoryApi, type LearnerMemoryStore, type MemoryApi } from "./memory.ts";
import { initialSession, type AgentLogEntry, type Store } from "./store.ts";

const WEB = "http://localhost:8081";
const KEY = "test-dev-key";
const noDb: AppOptions = {
  corsOrigins: [WEB],
  checkDb: null,
  store: null,
  advance: advanceStub,
  callAgentFor: () => callAgentStub,
  userFromToken: null,
  devKey: KEY,
  memory: null,
};
const as = (user: string, key = KEY) => ({ "x-dev-user": user, "x-dev-key": key });

test("a transcript can restore its owner's original material without changing older responses", async (t) => {
  const url = await start(t, withStore());
  const first = await (await post(url, { concept: "API", material: "Original notes" })).json();
  const path = `${url}/sessions/${first.sessionId}/transcript`;
  assert.equal((await (await fetch(`${path}?material=1`, { headers: as("leo") })).json()).material, "Original notes");
  assert.equal("material" in await (await fetch(path, { headers: as("leo") })).json(), false);
  assert.equal((await fetch(`${path}?material=1`, { headers: as("other") })).status, 404);
});

test("compressed JSON with trailing bytes is rejected before authentication and leaves the API healthy", async (t) => {
  const url = await start(t, noDb);
  for (const [encoding, compress] of [["gzip", gzipSync], ["deflate", deflateSync]] as const) {
    const response = await fetch(`${url}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json", "content-encoding": encoding },
      body: Buffer.concat([compress('{"concept":"API"}'), Buffer.from("trailing")]),
    });
    assert.equal(response.status, 415);
  }
  assert.equal((await fetch(`${url}/health`)).status, 200);
});

// The Store contract kept in memory, so the routes can be tested without a database. `logs` are its agent_log rows.
function memoryStore(): Store & { logs: readonly AgentLogEntry[] } {
  const sessions = new Map<string, Session>();
  const mastery = new Map<string, Mastery>();
  const logs: AgentLogEntry[] = [];
  let created = 0;
  return {
    logs,
    async createSession(user, input) {
      const session: Session = { ...initialSession(user, input), id: `s${++created}`, createdAt: new Date().toISOString() };
      sessions.set(session.id, session);
      return structuredClone(session);
    },
    async getSession(user, id) {
      const session = sessions.get(id);
      return session?.user === user ? structuredClone(session) : null;
    },
    async listSessions(user) {
      return [...sessions.values()]
        .filter((s) => s.user === user && s.lastTurn !== null)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
        .map(({ id, concept, mode, createdAt, result }) => ({ id, concept, mode, createdAt, finished: result !== null, score: result?.score ?? null, predictedScore: result?.predictedScore ?? null }));
    },
    async saveSession(session, previousTurn, progress = []) {
      if (sessions.get(session.id)?.turn !== previousTurn) return false;
      sessions.set(session.id, structuredClone(session));
      // in the same step, as the SurrealDB store's transaction: the level never drops, the successes add up
      const now = await this.getMastery(session.user);
      const moves = now.moves.map((m) => {
        const p = progress.find((step) => step.move === m.move);
        return p ? { move: m.move, level: Math.max(m.level, p.level) as Mastery["moves"][number]["level"], unassistedSuccesses: m.unassistedSuccesses + p.gained } : m;
      });
      if (progress.length > 0) mastery.set(session.user, { moves });
      return true;
    },
    async getMastery(user) {
      const fresh = { moves: MOVE_ORDER.map((move) => ({ move, level: 1 as const, unassistedSuccesses: 0 })) };
      return structuredClone(mastery.get(user) ?? fresh);
    },
    async saveMastery(user, saved) {
      // one row per move, as the SurrealDB store upserts them: the moves given change, the others stay
      const now = await this.getMastery(user);
      mastery.set(user, { moves: now.moves.map((m) => structuredClone(saved.moves.find((s) => s.move === m.move) ?? m)) });
    },
    async logAgentCall(entry) {
      logs.push(entry);
    },
    async finishedConcepts(user) {
      const finished = [...sessions.values()].filter((s) => s.user === user && s.result !== null).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return [...new Set(finished.map((s) => s.concept))];
    },
    async memoryReads(user) {
      return logs
        .filter((entry) => sessions.get(entry.session)?.user === user && (entry.agent === "hint_giver" || entry.agent === "coach"))
        .map((entry) => ((entry.input as { memory?: { facts: { id: string }[] } }).memory?.facts ?? []).map((fact) => fact.id));
    },
    async sessionConcepts(user, ids) {
      return new Map(ids.flatMap((id) => (sessions.get(id)?.user === user ? [[id, sessions.get(id)!.concept] as const] : [])));
    },
    async deleteUserData(user) {
      // the agent_log rows go with their sessions, as `DELETE agent_log WHERE session.user = $user` does
      for (let i = logs.length - 1; i >= 0; i--) if (sessions.get(logs[i]!.session)?.user === user) logs.splice(i, 1);
      for (const [id, session] of sessions) if (session.user === user) sessions.delete(id);
      mastery.delete(user);
    },
  };
}

// The Store as the SurrealDB one reads: a row goes through the Session schema on the way out (store.ts), so a
// saved session that drifted from the contract fails there.
function parsingStore(): Store {
  const store = memoryStore();
  return {
    ...store,
    async getSession(user, id) {
      const session = await store.getSession(user, id);
      return session && SessionSchema.parse(session);
    },
  };
}

const withStore = (): AppOptions => ({ ...noDb, store: memoryStore() });
const post = (url: string, body: unknown, headers: Record<string, string> = as("leo")) =>
  fetch(`${url}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const answer = (url: string, id: string, body: unknown, headers: Record<string, string> = as("leo")) =>
  fetch(`${url}/sessions/${id}/turns`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

// A stand-in Clerk instance: its key pair, and session tokens signed the way Clerk signs them (RS256)
const clerk = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwtKey = clerk.publicKey.export({ type: "spki", format: "pem" }).toString();
const encode = (part: object) => Buffer.from(JSON.stringify(part)).toString("base64url");
function sessionToken(claims: Record<string, unknown> = {}, key: KeyObject = clerk.privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: "RS256", typ: "JWT", kid: "ins_test" })}.${encode({ sub: "user_2leo", sid: "sess_1", iat: now, nbf: now - 5, exp: now + 60, ...claims })}`;
  return `${unsigned}.${sign("sha256", Buffer.from(unsigned), key).toString("base64url")}`;
}
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const withClerk = (): AppOptions => ({ ...withStore(), userFromToken: clerkUserFromToken({ jwtKey, authorizedParties: [WEB] }) });

async function start(t: TestContext, options: AppOptions): Promise<string> {
  const server = createApp(options).listen(0);
  t.after(() => server.close());
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

// Claude, faked behind the real callAgent: each call gets the next reply scripted for its agent (the
// system prompt says which agent is calling, so two calls at once get their own replies)
function fakeClaude(replies: [keyof typeof AGENTS, unknown][], store?: Store) {
  const send: SendToClaude = async ({ system }) => {
    const next = replies.findIndex(([agent]) => AGENTS[agent].system === system);
    if (next < 0) throw new Error("a call the script doesn't have");
    const [, output] = replies.splice(next, 1)[0]!;
    const usage = { input_tokens: 1_000, output_tokens: 500, cache_creation_input_tokens: null, cache_read_input_tokens: null };
    return { message: { content: [{ type: "text", text: JSON.stringify(output) }], stop_reason: "end_turn", usage }, headers: new Headers() };
  };
  const logged: AgentLogEntry[] = [];
  const log = async (entry: AgentLogEntry) => {
    logged.push(entry);
    await store?.logAgentCall(entry);
  };
  const callAgentFor = createCallAgent({ send, model: "claude-opus-5-5", budgetUsd: 10, log });
  return { callAgentFor, logged };
}

test("GET /health answers ok, and says the commit is unknown and memory is off", async (t) => {
  const res = await fetch(`${await start(t, noDb)}/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, commit: null, memory: "off" });
});

test("GET /health names the running commit and says when memory is on", async (t) => {
  const memory = { recall: async () => null, remember: async () => {}, view: async () => ({ concepts: [] }), purge: async () => {} } as unknown as LearnerMemoryStore;
  const res = await fetch(`${await start(t, { ...noDb, memory, commit: "179807e" })}/health`);
  assert.deepEqual(await res.json(), { ok: true, commit: "179807e", memory: "on" });
});

test("CORS allows the configured origins only", async (t) => {
  const url = await start(t, noDb);
  const allowed = await fetch(`${url}/health`, { headers: { origin: WEB } });
  assert.equal(allowed.headers.get("access-control-allow-origin"), WEB);
  const other = await fetch(`${url}/health`, { headers: { origin: "https://elsewhere.example" } });
  assert.equal(other.headers.get("access-control-allow-origin"), null);
});

test("CORS lets the web build send the sign-in headers with every method", async (t) => {
  const res = await fetch(`${await start(t, noDb)}/me/data`, {
    method: "OPTIONS",
    headers: { origin: WEB, "access-control-request-method": "DELETE", "access-control-request-headers": "authorization,content-type,x-dev-user,x-dev-key" },
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), WEB);
  assert.match(res.headers.get("access-control-allow-methods") ?? "", /DELETE/);
  assert.match(res.headers.get("access-control-allow-headers") ?? "", /authorization.*x-dev-key/);
});

test("GET /health/db is 503 without SurrealDB", async (t) => {
  const res = await fetch(`${await start(t, noDb)}/health/db`);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).ok, false);
});

test("GET /health/db returns the database's clock and the time it took", async (t) => {
  const check = { now: "2026-10-20T00:00:00Z", ms: 3 };
  const res = await fetch(`${await start(t, { ...noDb, checkDb: async () => check })}/health/db`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, ...check });
});

test("GET /health/db keeps a failure's cause out of the response", async (t) => {
  t.mock.method(console, "error", () => {});
  const failing = async () => {
    throw new Error("authentication failed for user leo");
  };
  const res = await fetch(`${await start(t, { ...noDb, checkDb: failing })}/health/db`);
  assert.equal(res.status, 503);
  assert.doesNotMatch(await res.text(), /authentication failed/);
});

test("POST /sessions starts a session and GET /sessions/:id gives back its Turn", async (t) => {
  const url = await start(t, withStore());
  const res = await post(url, { concept: "democracy" });
  assert.equal(res.status, 201);
  const turn = await res.json();
  assert.equal(turn.turn, 1);
  assert.equal(turn.phase, "predict");
  assert.equal(turn.expects, "prediction");
  assert.match(turn.messages[0].text, /map of democracy in 4 parts/);

  const again = await fetch(`${url}/sessions/${turn.sessionId}`, { headers: as("leo") });
  assert.equal(again.status, 200);
  assert.deepEqual(await again.json(), turn);
});

test("a session is invisible to every other user", async (t) => {
  const url = await start(t, withStore());
  const { sessionId } = await (await post(url, { concept: "inflation" })).json();
  const res = await fetch(`${url}/sessions/${sessionId}`, { headers: as("jonathan") });
  assert.equal(res.status, 404);
});

test("GET /sessions lists the caller's sessions, newest first, and nobody else's", async (t) => {
  const url = await start(t, withStore());
  const empty = await fetch(`${url}/sessions`, { headers: as("leo") });
  assert.equal(empty.status, 200);
  assert.deepEqual(await empty.json(), { sessions: [] });

  const first = await (await post(url, { concept: "API" })).json();
  const second = await (await post(url, { concept: "JWT", mode: "test" })).json();
  await post(url, { concept: "cache" }, as("jonathan"));
  const { sessions } = await (await fetch(`${url}/sessions`, { headers: as("leo") })).json();
  assert.deepEqual(
    sessions.map((s: Record<string, unknown>) => [s.id, s.concept, s.mode, s.finished, s.score, s.predictedScore]),
    [
      [second.sessionId, "JWT", "test", false, null, null],
      [first.sessionId, "API", "learn", false, null, null],
    ],
  );
  const theirs = await (await fetch(`${url}/sessions`, { headers: as("jonathan") })).json();
  assert.deepEqual(theirs.sessions.map((s: Record<string, unknown>) => s.concept), ["cache"]);
});

test("the session routes need a dev user with the right dev key, and never work in production", async (t) => {
  const url = await start(t, withStore());
  assert.equal((await post(url, { concept: "democracy" }, {})).status, 401);
  assert.equal((await post(url, { concept: "democracy" }, { "x-dev-user": "leo" })).status, 401);
  assert.equal((await post(url, { concept: "democracy" }, as("leo", "wrong-key"))).status, 401);
  const production = await start(t, { ...withStore(), devKey: null });
  assert.equal((await post(production, { concept: "democracy" })).status, 401);
  for (const [method, path] of [["POST", "/sessions/s1/turns"], ["GET", "/me/mastery"], ["DELETE", "/me/data"]]) {
    assert.equal((await fetch(`${url}${path}`, { method, headers: { "x-dev-user": "leo" } })).status, 401);
  }
});

test("each IP gets a limited number of requests a minute, but /health is never limited", async (t) => {
  const url = await start(t, { ...withStore(), requestsPerMinute: 2 });
  assert.equal((await post(url, { concept: "a" })).status, 201);
  assert.equal((await post(url, { concept: "b" })).status, 201);
  const third = await post(url, { concept: "c" });
  assert.equal(third.status, 429);
  assert.equal(typeof (await third.json()).error, "string");
  for (let i = 0; i < 3; i++) assert.equal((await fetch(`${url}/health`)).status, 200);
});

test("POST /sessions checks its body", async (t) => {
  const url = await start(t, withStore());
  assert.equal((await post(url, {})).status, 400);
  assert.equal((await post(url, { concept: "democracy", mode: "exam" })).status, 400);
  assert.equal((await post(url, { concept: "democracy", material: "x".repeat(8_001) })).status, 413);
  const broken = await post(url, "{ not json");
  assert.equal(broken.status, 400);
  assert.equal(typeof (await broken.json()).error, "string");
});

test("unknown routes answer 404 in JSON", async (t) => {
  const res = await fetch(`${await start(t, noDb)}/nope`);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "Not found" });
});

test("a new session and its first Turn match the schemas in @build-north/agents", async (t) => {
  const fresh = { ...initialSession("leo", { concept: "democracy", material: null, mode: "learn" }), id: "s1", createdAt: new Date().toISOString() };
  assert.doesNotThrow(() => SessionSchema.parse(fresh));
  const turn = await (await post(await start(t, withStore()), { concept: "democracy" })).json();
  assert.doesNotThrow(() => TurnSchema.parse(turn));
});

test("/turns replays the session-1 fixture one Turn per answer, then the session is over", async (t) => {
  const warned = t.mock.method(console, "warn", () => {});
  const url = await start(t, withStore());
  const first = await (await post(url, { concept: "democracy" })).json();
  // the fixture's Turns, numbered from 1 in this session
  const scripted = (i: number) => ({ ...sessionOne[i]!.turn, sessionId: first.sessionId, turn: i + 1 });
  assert.deepEqual(first, scripted(0));
  let latest = first;
  for (let i = 1; i < sessionOne.length; i++) {
    const res = await answer(url, first.sessionId, { ...sessionOne[i]!.input, turn: latest.turn });
    assert.equal(res.status, 200);
    latest = await res.json();
    assert.deepEqual(latest, scripted(i));
  }
  assert.equal(latest.expects, "none");
  const over = await answer(url, first.sessionId, { turn: latest.turn, action: "help" });
  assert.equal(over.status, 409);
  assert.deepEqual(await over.json(), latest);
  assert.match(String(warned.mock.calls[0]?.arguments[0]), /This session is over/);
  assert.deepEqual(await (await fetch(`${url}/sessions/${first.sessionId}`, { headers: as("leo") })).json(), latest);
});

test("GET /sessions/:id/transcript gives back every saved step in order: each body and the Turn it got, nothing for a resend or a 409", async (t) => {
  t.mock.method(console, "warn", () => {});
  const url = await start(t, withStore());
  const first = await (await post(url, { concept: "democracy" })).json();
  const scripted = (i: number) => ({ ...sessionOne[i]!.turn, sessionId: first.sessionId, turn: i + 1 });
  const bodies: unknown[] = [null];
  let latest = first;
  for (let i = 1; i < sessionOne.length; i++) {
    const body = { ...sessionOne[i]!.input, turn: latest.turn };
    latest = await (await answer(url, first.sessionId, body)).json();
    bodies.push(body);
    // the same answer again is judged already: the latest Turn comes back and nothing is saved
    await answer(url, first.sessionId, body);
  }
  assert.equal((await answer(url, first.sessionId, { turn: latest.turn, action: "help" })).status, 409);

  const res = await fetch(`${url}/sessions/${first.sessionId}/transcript`, { headers: as("leo") });
  assert.equal(res.status, 200);
  const { steps } = TranscriptSchema.parse(await res.json());
  assert.deepEqual(steps.map((step) => step.turn), sessionOne.map((_, i) => scripted(i)));
  assert.deepEqual(steps.map((step) => step.body), bodies);
  assert.equal((await fetch(`${url}/sessions/${first.sessionId}/transcript`, { headers: as("jonathan") })).status, 404);
  assert.equal((await fetch(`${url}/sessions/not-an-id!/transcript`, { headers: as("leo") })).status, 404);
});

test("a Turn whose agent failed adds no step, and a session saved before Oct 25 has an empty transcript", async (t) => {
  const store = memoryStore();
  const failing: Advance = async (state, input, callAgent) =>
    "action" in input && input.action === "start"
      ? advanceStub(state, input, callAgent)
      : { ...state, turn: { ...state.session.lastTurn!, error: { code: "agent_failed", retryable: true } } };
  const url = await start(t, { ...noDb, store, advance: failing });
  const first = await (await post(url, { concept: "democracy" })).json();
  const failed = await (await answer(url, first.sessionId, { turn: 1, prediction: 5 })).json();
  assert.deepEqual(failed.error, { code: "agent_failed", retryable: true });
  const transcript = async () => TranscriptSchema.parse(await (await fetch(`${url}/sessions/${first.sessionId}/transcript`, { headers: as("leo") })).json()).steps;
  assert.deepEqual((await transcript()).map((step) => [step.body, step.turn.turn]), [[null, 1]]);

  const saved = (await store.getSession("leo", first.sessionId))!;
  assert.equal(await store.saveSession({ ...saved, transcript: [] }, saved.turn), true);
  assert.deepEqual(await transcript(), []);
});

test("POST /sessions on CORS starts a session about CORS when Cynthia's advance runs; the rig's default, the stub, says democracy (#163)", async (t) => {
  // `advance` is the real orchestrator from @build-north/agents, not the stub the rig's `noDb` passes; a start calls
  // no agent, so an empty script is enough
  const live = await start(t, { ...withStore(), advance, callAgentFor: fakeClaude([]).callAgentFor });
  for (const concept of ["CORS", "my own thing"]) {
    const res = await post(live, { concept });
    assert.equal(res.status, 201);
    const turn = await res.json();
    assert.equal(turn.mentefacto.concept, concept);
    assert.equal(turn.messages[0].text, `You'll build the map of ${concept} in 4 parts, 2 points each. How many of the 8 points do you think you'll get?`);
    const saved = await (await fetch(`${live}/sessions/${turn.sessionId}`, { headers: as("leo") })).json();
    assert.equal(saved.mentefacto.concept, concept);
  }
  // the stub, which server.ts picks with no Claude key or no database, replays democracy whatever the concept: the
  // assertions above only prove anything against the real orchestrator
  const stubbed = await (await post(await start(t, withStore()), { concept: "CORS" })).json();
  assert.equal(stubbed.mentefacto.concept, "democracy");
});

test("a resent answer gets the same Turn back, and advance runs once", async (t) => {
  let calls = 0;
  const counting: Advance = (...args) => {
    calls++;
    return advanceStub(...args);
  };
  const url = await start(t, { ...withStore(), advance: counting });
  const { sessionId } = await (await post(url, { concept: "democracy" })).json();
  const first = await (await answer(url, sessionId, { turn: 1, prediction: 7 })).json();
  const resent = await answer(url, sessionId, { turn: 1, prediction: 7 });
  assert.equal(resent.status, 200);
  assert.deepEqual(await resent.json(), first);
  assert.equal(calls, 2); // the start and the first answer
});

test("two answers to the same Turn at once move the session on once", { timeout: 5_000 }, async (t) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let waiting = 0;
  // Holds both answers inside advance until each request has read the session, and tags each Turn
  // with the answer it got, so a request that lost the save can't pass for the winner.
  const slow: Advance = async (state, input, callAgent) => {
    const next = await advanceStub(state, input, callAgent);
    if (!("prediction" in input)) return next;
    waiting++;
    await gate;
    const tagged = { ...next.turn, messages: [{ agent: "app" as const, kind: "feedback" as const, text: `predicted ${input.prediction}` }] };
    return { ...next, session: { ...next.session, lastTurn: tagged }, turn: tagged };
  };
  const url = await start(t, { ...withStore(), advance: slow });
  const { sessionId } = await (await post(url, { concept: "democracy" })).json();
  const both = [answer(url, sessionId, { turn: 1, prediction: 7 }), answer(url, sessionId, { turn: 1, prediction: 3 })];
  while (waiting < 2) await new Promise((resolve) => setImmediate(resolve));
  release();
  const [a, b] = await Promise.all(both.map(async (res) => (await res).json()));
  assert.deepEqual(a, b);
  const latest = await (await fetch(`${url}/sessions/${sessionId}`, { headers: as("leo") })).json();
  assert.deepEqual(latest, a);
  assert.equal(latest.turn, 2);
});

test("a body the latest Turn doesn't ask for, or a Turn from the future, gets a 409 with the latest Turn", async (t) => {
  const warned = t.mock.method(console, "warn", () => {});
  const url = await start(t, withStore());
  const first = await (await post(url, { concept: "democracy" })).json(); // Turn 1 expects a prediction
  for (const body of [{ turn: 1, text: "A law?" }, { turn: 1, action: "continue" }, { turn: 2, prediction: 7 }]) {
    const res = await answer(url, first.sessionId, body);
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), first);
  }
  // the reason goes to the server log
  assert.deepEqual(
    warned.mock.calls.map((call) => String(call.arguments[0]).replace(/^409 for session \w+: /, "")),
    ["Turn 1 expects prediction, not text", "Turn 1 expects prediction, not continue", "Turn 2 doesn't exist yet; the latest is 1"],
  );
  assert.equal((await answer(url, first.sessionId, { turn: 1, prediction: 7 })).status, 200);
});

test("Help works during the moves only", async (t) => {
  const warned = t.mock.method(console, "warn", () => {});
  const url = await start(t, withStore());
  const first = await (await post(url, { concept: "democracy" })).json();
  const { sessionId } = first;
  const help = (turn: number) => answer(url, sessionId, { turn, action: "help" });
  const refused = await help(1);
  assert.equal(refused.status, 409);
  assert.deepEqual(await refused.json(), first);
  assert.match(String(warned.mock.calls[0]?.arguments[0]), /Help works during the moves/);
  // the prediction, the first attempt and the worked example come before the first move (Turn 4)
  for (const body of [{ turn: 1, prediction: 7 }, { turn: 2, text: "When people vote." }, { turn: 3, action: "continue" }]) {
    assert.equal((await answer(url, sessionId, body)).status, 200);
  }
  assert.equal((await help(4)).status, 200);
});

test("input that advance refuses for the phase changes nothing, and gets a 409 with the latest Turn", async (t) => {
  const warned = t.mock.method(console, "warn", () => {});
  const refusing: Advance = (state, input, callAgent) =>
    "action" in input && input.action === "start" ? advanceStub(state, input, callAgent) : Promise.reject(new UnexpectedInput("not now"));
  const url = await start(t, { ...withStore(), advance: refusing });
  const first = await (await post(url, { concept: "democracy" })).json();
  const res = await answer(url, first.sessionId, { turn: 1, prediction: 7 });
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), first);
  assert.match(String(warned.mock.calls[0]?.arguments[0]), /not now/);
  assert.deepEqual(await (await fetch(`${url}/sessions/${first.sessionId}`, { headers: as("leo") })).json(), first);
});

test("/turns checks its body, and answers only the session's owner", async (t) => {
  const url = await start(t, withStore());
  const { sessionId } = await (await post(url, { concept: "democracy" })).json();
  const empty = await answer(url, sessionId, {});
  assert.equal(empty.status, 400);
  assert.match((await empty.json()).error, /one of/);
  assert.equal((await answer(url, sessionId, { turn: 1, prediction: 9 })).status, 400);
  assert.equal((await answer(url, sessionId, { turn: 1, prediction: 7 }, as("jonathan"))).status, 404);
  assert.equal((await answer(url, "s999", { turn: 1, prediction: 7 })).status, 404);
});

for (const { field, length, error, expects } of [
  { field: "text", length: 2001, error: "Your answer is over 2,000 characters. Shorten it and send it again.", expects: "text" },
  { field: "question", length: 501, error: "Your question is over 500 characters. Shorten it and send it again.", expects: "map" },
]) {
  test(`/turns rejects an overlong ${field} without changing the session or its transcript`, async (t) => {
    // a question goes to the whole map, so that case is a self-test on the real orchestrator: its prediction opens the
    // map with no agent call; the cap stops only a body the Turn would take (code review, Oct 28)
    const url = await start(t, expects === "map" ? { ...withStore(), advance, callAgentFor: fakeClaude([]).callAgentFor } : withStore());
    const headers = as("length-test");
    const first = await (await post(url, { concept: "API", ...(expects === "map" ? { mode: "test" } : {}) }, headers)).json();
    const ready = await (await answer(url, first.sessionId, { turn: first.turn, prediction: 5 }, headers)).json();
    assert.equal(ready.expects, expects);
    const read = async (path: string) => (await fetch(`${url}/sessions/${first.sessionId}${path}`, { headers })).json();
    const transcript = await read("/transcript");

    const res = await answer(url, first.sessionId, { turn: ready.turn, [field]: "x".repeat(length) }, headers);
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error });
    assert.deepEqual(await read(""), ready);
    assert.deepEqual(await read("/transcript"), transcript);
  });
}

test("the length cap stops only a body that would be judged: a resend of a judged Turn gets the latest Turn, and a missing session a 404 (code review, Oct 28)", async (t) => {
  const url = await start(t, withStore());
  const headers = as("length-order");
  const first = await (await post(url, { concept: "API" }, headers)).json();
  const ready = await (await answer(url, first.sessionId, { turn: first.turn, prediction: 5 }, headers)).json();
  // the first Turn was judged already (decision 18): its resend, however long, gets the latest Turn back
  const resent = await answer(url, first.sessionId, { turn: first.turn, text: "x".repeat(2001) }, headers);
  assert.equal(resent.status, 200);
  assert.deepEqual(await resent.json(), ready);
  assert.equal((await answer(url, "s999", { turn: 1, text: "x".repeat(2001) }, headers)).status, 404);
});

test("sessions with older long answers or fact questions can still be reopened with their transcript", async (t) => {
  const store = parsingStore();
  const url = await start(t, { ...noDb, store });
  const headers = as("history-test");
  for (const body of [{ turn: 2, text: "x".repeat(2001) }, { turn: 2, question: "x".repeat(501) }]) {
    const session = await store.createSession("history-test", { concept: "democracy", material: null, mode: "learn" });
    const turn = TurnSchema.parse({ ...sessionOne[2]!.turn, sessionId: session.id });
    const transcript = [{ body, turn }];
    await store.saveSession({ ...session, turn: turn.turn, lastTurn: turn, phase: turn.phase, move: turn.move, transcript }, session.turn);

    const latest = await fetch(`${url}/sessions/${session.id}`, { headers });
    assert.equal(latest.status, 200);
    assert.deepEqual(await latest.json(), turn);
    const history = await fetch(`${url}/sessions/${session.id}/transcript`, { headers });
    assert.equal(history.status, 200);
    assert.deepEqual(TranscriptSchema.parse(await history.json()), { steps: transcript });
  }
});

test("GET /me/mastery lists the four moves, and DELETE /me/data removes only the caller's data", async (t) => {
  const store = memoryStore();
  const url = await start(t, { ...noDb, store });
  const call = (path: string, method = "GET", user = "leo") => fetch(`${url}${path}`, { method, headers: as(user) });
  const levels = async () => MasterySchema.parse(await (await call("/me/mastery")).json()).moves.map((m) => m.level);

  assert.deepEqual(await levels(), [1, 1, 1, 1]);
  const raised = await store.getMastery("leo");
  raised.moves[1] = { move: "exclusion", level: 3, unassistedSuccesses: 1 };
  await store.saveMastery("leo", raised);
  assert.deepEqual(await levels(), [1, 3, 1, 1]);

  const mine = await (await post(url, { concept: "democracy" })).json();
  const theirs = await (await post(url, { concept: "inflation" }, as("jonathan"))).json();
  assert.equal((await call("/me/data", "DELETE")).status, 204);
  assert.deepEqual(await levels(), [1, 1, 1, 1]);
  assert.equal((await call(`/sessions/${mine.sessionId}`)).status, 404);
  assert.equal((await call(`/sessions/${theirs.sessionId}`, "GET", "jonathan")).status, 200);
});

test("a Clerk session token signs the caller in, and their rows are keyed by the Clerk user id", async (t) => {
  const store = memoryStore();
  const url = await start(t, { ...withClerk(), store });
  // the web build's token names its origin; the native app's names none
  const res = await post(url, { concept: "democracy" }, bearer(sessionToken({ azp: WEB })));
  assert.equal(res.status, 201);
  const { sessionId } = await res.json();
  assert.notEqual(await store.getSession("user_2leo", sessionId), null);
  assert.equal((await fetch(`${url}/me/mastery`, { headers: bearer(sessionToken()) })).status, 200);
});

test("an expired, forged or foreign token gets 401, and never falls back to the dev headers", async (t) => {
  t.mock.method(console, "warn", () => {});
  const url = await start(t, withClerk());
  const now = Math.floor(Date.now() / 1000);
  const tokens = [
    sessionToken({ iat: now - 180, nbf: now - 180, exp: now - 120 }),
    sessionToken({}, generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey),
    sessionToken({ azp: "https://elsewhere.example" }),
    "not-a-token",
  ];
  for (const token of tokens) {
    assert.equal((await post(url, { concept: "democracy" }, { ...as("leo"), ...bearer(token) })).status, 401, token.slice(0, 20));
  }
});

test("in production only a Clerk token gets in, and without CLERK_JWT_KEY no token does", async (t) => {
  const production = await start(t, { ...withClerk(), devKey: null });
  assert.equal((await post(production, { concept: "democracy" }, bearer(sessionToken()))).status, 201);
  assert.equal((await post(production, { concept: "democracy" })).status, 401);
  const noClerk = await start(t, withStore());
  assert.equal((await post(noClerk, { concept: "democracy" }, bearer(sessionToken()))).status, 401);
});

test("Cynthia's advance runs the democracy session through callAgent: 4 moves, 2 Helps, 5/8, the coach's message, an agent_log row per call", async (t) => {
  const item = (value: string, note: string | null = null) => ({ value, note });
  const judged = (verdict: string, quality: number, accepted: ReturnType<typeof item>[], feedback: string, issue = "none") => ({
    verdict,
    quality,
    accepted,
    issue,
    reason: "scripted",
    feedback,
  });
  const hint = (text: string) => ({ step: "hint", text, revealed: null });
  const coach = { message: "You found the bigger group and a real exclusion. 'What it needs' is next.", nextFocus: "isoordinate" };
  // What Claude answers, per agent and in order: session 1 from agents/test/advance.test.ts
  const replies: [keyof typeof AGENTS, unknown][] = [
    ["questioner", { question: "Democracy is one example of a bigger group. What group?", scaffold: null }],
    ["evaluator", judged("incorrect", 0, [], "Not quite: a law is one rule, and democracy isn't a rule. So what kind of thing is it?", "not_a_class")],
    ["questioner", { question: "What looks close to democracy but isn't one?", scaffold: null }],
    ["hint_giver", hint("Think of monarchy and dictatorship. What are all three examples of?")],
    ["evaluator", judged("correct", 2, [item("form of government")], "Yes: monarchy, dictatorship and democracy are all forms of government.")],
    ["evaluator", judged("partial", 1, [item("dictatorship")], "Dictatorship is close, and it isn't a democracy.")],
    ["questioner", { question: "What does a country need to count as a democracy?", scaffold: null }],
    ["evaluator", judged("correct", 2, [item("dictatorship", "who holds the power")], "Yes: in a dictatorship one person or group holds the power.")],
    ["evaluator", judged("partial", 1, [], "Elections are part of it, but not enough on their own. What else does a country need?")],
    ["questioner", { question: "What kinds of democracy are there?", scaffold: null }],
    ["hint_giver", hint("North Korea holds elections. Is it a democracy? What's missing?")],
    ["evaluator", judged("correct", 2, [item("free elections"), item("rights"), item("more than one party")], "Yes: free elections, rights and more than one party.")],
    ["evaluator", judged("partial", 1, [item("direct democracy")], "Direct democracy is one type, where people vote on laws themselves. Is that the only way it can work?")],
    ["evaluator", judged("correct", 2, [item("direct democracy"), item("representative democracy")], "Yes: direct and representative democracy.")],
    ["coach", coach],
  ];
  const { callAgentFor, logged } = fakeClaude(replies);
  const url = await start(t, { ...withStore(), advance, callAgentFor });

  let latest = await (await post(url, { concept: "democracy" })).json();
  const inputs = [
    { prediction: 7 },
    { text: "When people vote." },
    { action: "continue" },
    { text: "A law?" },
    { action: "help" },
    { text: "Forms of government." },
    { text: "Dictatorship." },
    { text: "Who holds the power." },
    { text: "Elections." },
    { action: "help" },
    { text: "Free elections, rights, other parties." },
    { text: "Direct?" },
    { text: "Direct and representative." },
    // the result shows first; the app asks for the coach's words at once
    { action: "continue" },
  ];
  for (const input of inputs) {
    const body = { ...input, turn: latest.turn };
    const next = await (await answer(url, latest.sessionId, body)).json();
    assert.equal(next.error, null, `Turn ${next.turn}`);
    // the same answer sent again gets the same Turn, and advance isn't run again (the script would run out)
    assert.deepEqual(await (await answer(url, latest.sessionId, body)).json(), next);
    latest = next;
  }
  assert.equal(replies.length, 0);
  assert.equal(latest.expects, "none");
  const { predictedScore, score, calibrationGap, hintsUsed, rubric } = latest.result;
  assert.deepEqual({ predictedScore, score, calibrationGap, hintsUsed }, { predictedScore: 7, score: 5, calibrationGap: 2, hintsUsed: 2 });
  assert.deepEqual(rubric.map((r: { points: number }) => r.points), [1, 2, 1, 1]);
  // the result carries the coach's words, and the coach's message closes the last Turn
  assert.deepEqual(latest.result.coach, coach);
  assert.deepEqual(latest.messages.at(-1), { agent: "coach", kind: "summary", text: coach.message });
  // one agent_log row per Claude call, each with its session and its cost
  assert.equal(logged.length, 15);
  assert.ok(logged.every((row) => row.session === latest.sessionId && row.usd > 0));
  // the coach's agent_log row holds what it was sent: the final map, and the result its words complete
  const sent = logged.at(-1)!;
  const { result: numbers, ...rest } = sent.input as { result: object };
  assert.equal(sent.agent, "coach");
  assert.deepEqual(rest, { concept: "democracy", mentefacto: latest.mentefacto });
  assert.deepEqual({ ...numbers, coach }, latest.result);
  const mastery = await (await fetch(`${url}/me/mastery`, { headers: as("leo") })).json();
  assert.deepEqual(mastery.moves.map((m: { level: number }) => m.level), [2, 3, 2, 3]);
});

test("a test session starts at level 5, { question } gets the fact desk's answer, { mentefacto } the whole-map evaluator's score, and mastery is unchanged", async (t) => {
  const store = memoryStore();
  const before = await store.getMastery("leo");
  before.moves[1] = { move: "exclusion", level: 3, unassistedSuccesses: 1 };
  await store.saveMastery("leo", before);
  const masterySaves = t.mock.method(store, "saveMastery");
  const replies: [keyof typeof AGENTS, unknown][] = [
    ["fact_desk", { kind: "fact", answer: "Yes, when the fish, the plants and the water act on one another.", questionType: "breaking_case" }],
    // the model's words give the bigger group away; the learner only ever sees the fixed redirect (decision 17)
    ["fact_desk", { kind: "redirect", answer: "It's a kind of system.", questionType: "asks_for_structure" }],
    ["evaluator_full", { rubric: MOVE_ORDER.map((move) => ({ move, quality: move === "isoordinate" ? 1 : 2, feedback: `Scripted ${move}.` })) }],
    ["coach", { message: "Scripted coach.", nextFocus: "isoordinate" }],
  ];
  const claude = fakeClaude(replies);
  const url = await start(t, { ...noDb, store, advance, callAgentFor: claude.callAgentFor });
  // answers the latest Turn with `body` and returns the next one
  const next = async (latest: { sessionId: string; turn: number }, body: object) => {
    const res = await answer(url, latest.sessionId, { ...body, turn: latest.turn });
    assert.equal(res.status, 200);
    const turn = await res.json();
    assert.equal(turn.error, null, `Turn ${turn.turn}`);
    return turn;
  };

  const first = await (await post(url, { concept: "ecosystem", mode: "test" })).json();
  // straight from the prediction to the whole map: no first attempt, no worked example, no questioner
  const map = await next(first, { prediction: 5 });
  assert.deepEqual([map.phase, map.move, map.level, map.expects], ["move", null, 5, "map"]);
  assert.equal(map.messages[0].text, "Build the mentefacto for ecosystem. Ask me any facts you need.");

  const fact = await next(map, { question: "Is a fish tank an ecosystem?" });
  assert.deepEqual(fact.messages, [{ agent: "fact_desk", kind: "fact", text: "Yes, when the fish, the plants and the water act on one another." }]);
  assert.equal(fact.expects, "map");
  const redirect = await next(fact, { question: "What's the bigger group of ecosystem?" });
  assert.deepEqual(redirect.messages, [{ agent: "fact_desk", kind: "redirect", text: FACT_DESK_REDIRECT }]);

  const item = (value: string, note: string | null = null) => ({ value, note });
  const mentefacto = {
    concept: "ecosystem",
    supraordinate: item("system"),
    exclusion: [item("habitat", "a habitat is only the place, without what lives there")],
    isoordinate: [item("living things"), item("their surroundings")],
    infraordinate: [item("aquatic ecosystem"), item("land ecosystem")],
  };
  // the result shows first, without the coach's words; continue brings them and ends the session
  const done = await next(redirect, { mentefacto });
  assert.deepEqual([done.expects, done.result.coach], ["continue", null]);
  const coached = await next(done, { action: "continue" });
  assert.deepEqual([coached.expects, coached.result.coach], ["none", { message: "Scripted coach.", nextFocus: "isoordinate" }]);
  const { score, calibrationGap, rubric, masteryChanges, questions } = done.result;
  assert.deepEqual(
    { score, calibrationGap, rubric, masteryChanges, questions },
    {
      score: 7,
      calibrationGap: -2,
      rubric: MOVE_ORDER.map((move) => ({ move, points: move === "isoordinate" ? 1 : 2 })),
      masteryChanges: [],
      questions: { asked: 2, testing: 1 },
    },
  );
  // each move's feedback, after its plain label
  assert.deepEqual(
    done.messages.filter((m: { agent: string }) => m.agent === "evaluator").map((m: { text: string }) => m.text),
    MOVE_ORDER.map((move) => `${MOVE_LABEL[move]}: Scripted ${move}.`),
  );
  assert.equal(replies.length, 0);
  // the fact desk's agent_log rows are the questions metric; the evaluator's row holds the map Claude scored
  const id = first.sessionId;
  assert.deepEqual(
    claude.logged.map((row) => [row.agent, row.session]),
    [["fact_desk", id], ["fact_desk", id], ["evaluator_full", id], ["coach", id]],
  );
  assert.deepEqual(claude.logged[2]!.input, { concept: "ecosystem", material: null, mentefacto });
  // the mastery from before the session, which the session never wrote
  assert.deepEqual(await (await fetch(`${url}/me/mastery`, { headers: as("leo") })).json(), before);
  assert.equal(masterySaves.mock.callCount(), 0);
});

test("when the coach call fails, the session still ends, with fixed text built from the numbers", async (t) => {
  t.mock.method(console, "error", () => {});
  const claude = fakeClaude([
    ["evaluator_full", { rubric: MOVE_ORDER.map((move) => ({ move, quality: move === "supraordinate" ? 0 : 2, feedback: "Scripted." })) }],
    // off the coach's schema, so callAgent refuses it and advance falls back
    ["coach", { message: 6, nextFocus: "the bigger group" }],
  ]);
  const url = await start(t, { ...withStore(), advance, callAgentFor: claude.callAgentFor });
  const first = await (await post(url, { concept: "inflation", mode: "test" })).json();
  const map = await (await answer(url, first.sessionId, { turn: first.turn, prediction: 7 })).json();
  // every part filled, so the rubric's points stand (an empty part scores 0 whatever it says)
  const item = (value: string, note: string | null = null) => ({ value, note });
  const filled = { concept: "inflation", supraordinate: item("money"), exclusion: [item("deflation", "prices fall")], isoordinate: [item("prices rise")], infraordinate: [item("demand-pull"), item("cost-push")] };
  const shown = await (await answer(url, first.sessionId, { turn: map.turn, mentefacto: filled })).json();
  const done = await (await answer(url, first.sessionId, { turn: shown.turn, action: "continue" })).json();

  const fixed = { message: 'You scored 6 of 8 and used 0 hints. Next, work on "Bigger group".', nextFocus: "supraordinate" };
  assert.deepEqual([done.error, done.expects, done.result.score], [null, "none", 6]);
  assert.deepEqual(done.result.coach, fixed);
  assert.deepEqual(done.messages.at(-1), { agent: "coach", kind: "summary", text: fixed.message });
  assert.deepEqual(await (await fetch(`${url}/sessions/${first.sessionId}`, { headers: as("leo") })).json(), done);
});

test("mastery is written only for the moves a Turn changed, and an error Turn writes nothing", async (t) => {
  const before: Mastery = { moves: MOVE_ORDER.map((move) => ({ move, level: 1, unassistedSuccesses: 0 })) };
  const after: Mastery = {
    moves: before.moves.map((m) => (m.move === "exclusion" ? { ...m, level: 2 } : m.move === "infraordinate" ? { ...m, unassistedSuccesses: 1 } : m)),
  };
  assert.deepEqual(changedMoves(before, after), [
    { move: "exclusion", level: 2, gained: 0 },
    { move: "infraordinate", level: 1, gained: 1 },
  ]);
  assert.deepEqual(changedMoves(before, before), []);

  // the stub orchestrator never raises a level: a start and an answer write mastery zero times
  const store = memoryStore();
  const masterySaves = t.mock.method(store, "saveMastery");
  const sessionSaves = t.mock.method(store, "saveSession");
  const url = await start(t, { ...noDb, store });
  const first = await (await post(url, { concept: "democracy" })).json();
  assert.equal((await answer(url, first.sessionId, { turn: 1, prediction: 7 })).status, 200);
  assert.equal(masterySaves.mock.callCount(), 0);
  assert.equal(sessionSaves.mock.callCount(), 2);

  // a Claude call that fails: the error Turn goes back, and neither the session nor mastery is written, so
  // nothing stale can overwrite what a parallel request saved meanwhile
  const claude = fakeClaude([]);
  const failing = await start(t, { ...noDb, store, advance, callAgentFor: claude.callAgentFor });
  const session = await (await post(failing, { concept: "ecosystem" })).json();
  // the steps before the moves (the guess, the first attempt, the example) need no Claude call; the first one
  // that does (the evaluator, or the questioner) fails, and that Turn comes back with error and writes nothing
  let latest = session;
  let failed: { turn: number; error: unknown } | null = null;
  for (let step = 0; step < 8 && !failed; step++) {
    const body =
      latest.expects === "prediction" ? { prediction: 5 } : latest.expects === "text" ? { text: "a web of living things" } : latest.expects === "continue" ? { action: "continue" } : null;
    assert.ok(body, "expects " + latest.expects);
    const before = { sessions: sessionSaves.mock.callCount(), mastery: masterySaves.mock.callCount() };
    const res = await answer(failing, latest.sessionId, { turn: latest.turn, ...body });
    assert.equal(res.status, 200);
    const turn = await res.json();
    if (turn.error) {
      failed = turn;
      assert.equal(turn.turn, latest.turn);
      assert.equal(sessionSaves.mock.callCount(), before.sessions);
      assert.equal(masterySaves.mock.callCount(), before.mastery);
    } else latest = turn;
  }
  assert.ok(failed, "no step called Claude");
});

const atLevel = (level: Level): Mastery => ({ moves: MOVE_ORDER.map((move) => ({ move, level, unassistedSuccesses: 0 })) });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// A guided session at level 2 on every move: the questioner asks for the bigger group, the evaluator takes the answer
// as right (2 points, a level up), and the questioner asks the next part ahead
const guidedReplies = (): [keyof typeof AGENTS, unknown][] => [
  ["questioner", { question: "What kind of thing is democracy?", scaffold: null }],
  ["evaluator", { verdict: "correct", quality: 2, accepted: [{ value: "form of government", note: null }], issue: "none", reason: "The closest class.", feedback: "Yes: a form of government." }],
  ["questioner", { question: "What is close to democracy, but isn't it?", scaffold: null }],
];
/** The guess and the first explanation answered: the Turn that asks for the bigger group. */
async function toFirstQuestion(url: string) {
  const first = await (await post(url, { concept: "democracy" })).json();
  const attempt = await (await answer(url, first.sessionId, { turn: first.turn, prediction: 5 })).json();
  return (await answer(url, first.sessionId, { turn: attempt.turn, text: "people vote for who governs" })).json();
}

test("a Turn's mastery goes in its session's save, so a save that fails keeps neither and the same answer sent again keeps both", async (t) => {
  t.mock.method(console, "error", () => {});
  const store = memoryStore();
  await store.saveMastery("leo", atLevel(2));
  const masterySaves = t.mock.method(store, "saveMastery");
  // the answer is judged twice: once for the save that fails, once for the one sent again
  const claude = fakeClaude([...guidedReplies(), ...guidedReplies().slice(1)], store);
  const url = await start(t, { ...noDb, store, advance, callAgentFor: claude.callAgentFor });
  const saves = t.mock.method(store, "saveSession");
  const asked = await toFirstQuestion(url);
  assert.equal(asked.move, "supraordinate");
  saves.mock.mockImplementationOnce(async () => Promise.reject(new Error("SurrealDB timed out")), saves.mock.callCount());
  const body = { turn: asked.turn, text: "a form of government" };
  assert.equal((await answer(url, asked.sessionId, body)).status, 500);
  // nothing moved: the session is still at its question, and the level is where it was
  assert.equal((await (await fetch(`${url}/sessions/${asked.sessionId}`, { headers: as("leo") })).json()).turn, asked.turn);
  assert.deepEqual(await store.getMastery("leo"), atLevel(2));

  const next = await (await answer(url, asked.sessionId, body)).json();
  assert.deepEqual([next.turn, next.error, next.move], [asked.turn + 1, null, "exclusion"]);
  assert.deepEqual((await store.getMastery("leo")).moves[0], { move: "supraordinate", level: 3, unassistedSuccesses: 1 });
  assert.deepEqual(saves.mock.calls.at(-1)?.arguments[2], [{ move: "supraordinate", level: 3, gained: 1 }]);
  assert.equal(masterySaves.mock.callCount(), 0);
});

test("a Turn that read mastery before another session saved a higher level keeps that level, and adds its own success", async (t) => {
  const store = memoryStore();
  await store.saveMastery("leo", atLevel(2));
  const claude = fakeClaude(guidedReplies(), store);
  const reached = Promise.withResolvers<void>();
  const held = Promise.withResolvers<void>();
  const callAgentFor = (id: string): CallAgent => {
    const call = claude.callAgentFor(id);
    return async (agent, input) => {
      if (agent === "evaluator") {
        reached.resolve();
        await held.promise;
      }
      return call(agent, input);
    };
  };
  const url = await start(t, { ...noDb, store, advance, callAgentFor });
  const asked = await toFirstQuestion(url);
  const judged = answer(url, asked.sessionId, { turn: asked.turn, text: "a form of government" });
  await reached.promise;
  // while the evaluator thinks, another session takes the bigger group to level 4
  await store.saveMastery("leo", { moves: [{ move: "supraordinate", level: 4, unassistedSuccesses: 3 }] });
  held.resolve();
  assert.equal((await judged).status, 200);
  assert.deepEqual((await store.getMastery("leo")).moves[0], { move: "supraordinate", level: 4, unassistedSuccesses: 4 });
});

test("Delete my data waits for a Turn in flight, so nothing it saved outlives the 204: its session, its mastery, its agent_log rows", async (t) => {
  const store = memoryStore();
  await store.saveMastery("leo", atLevel(2));
  const claude = fakeClaude(guidedReplies(), store);
  const url = await start(t, { ...noDb, store, advance, callAgentFor: claude.callAgentFor });
  const asked = await toFirstQuestion(url);
  // the answer's save lands, then its request stalls before it answers (where mastery used to be written on its own)
  const saved = Promise.withResolvers<void>();
  const held = Promise.withResolvers<void>();
  const save = store.saveSession;
  t.mock.method(store, "saveSession", async function (this: Store, ...args: Parameters<Store["saveSession"]>) {
    const ok = await save.apply(this, args);
    saved.resolve();
    await held.promise;
    return ok;
  });
  const judged = answer(url, asked.sessionId, { turn: asked.turn, text: "a form of government" });
  await saved.promise;
  let answered = false;
  const deleting = fetch(`${url}/me/data`, { method: "DELETE", headers: as("leo") }).then((res) => ((answered = true), res));
  await sleep(50);
  assert.equal(answered, false, "the delete waits for the Turn in flight");
  held.resolve();
  const [turn, deleted] = await Promise.all([judged, deleting]);
  assert.deepEqual([turn.status, deleted.status], [200, 204]);
  assert.deepEqual(await store.getMastery("leo"), atLevel(1));
  assert.deepEqual(await store.listSessions("leo"), []);
  assert.equal(store.logs.length, 0);
});

test("an agent_log row still being written when Delete my data comes is written first, and deleted with the rest", async (t) => {
  const store = memoryStore();
  const writing = Promise.withResolvers<void>();
  const held = Promise.withResolvers<void>();
  const log = store.logAgentCall;
  t.mock.method(store, "logAgentCall", async function (this: Store, entry: AgentLogEntry) {
    if (entry.agent === "fact_desk") {
      writing.resolve();
      await held.promise;
    }
    return log.call(this, entry);
  });
  const claude = fakeClaude([["fact_desk", { kind: "fact", answer: "Yes, a pond is one.", questionType: "fact" }]], store);
  const url = await start(t, { ...noDb, store, advance, callAgentFor: claude.callAgentFor });
  const first = await (await post(url, { concept: "ecosystem", mode: "test" })).json();
  const map = await (await answer(url, first.sessionId, { turn: first.turn, prediction: 5 })).json();
  const asking = answer(url, first.sessionId, { turn: map.turn, question: "Is a pond an ecosystem?" });
  await writing.promise;
  const deleting = fetch(`${url}/me/data`, { method: "DELETE", headers: as("leo") });
  await sleep(50);
  held.resolve();
  const [asked, deleted] = await Promise.all([asking, deleting]);
  assert.deepEqual([asked.status, deleted.status], [200, 204]);
  assert.equal(store.logs.length, 0);
});

test("a call that outlives its Turn (the next question asked ahead, when the evaluator fails fast) still lands before Delete my data, which deletes its row too", async (t) => {
  t.mock.method(console, "error", () => {});
  const usage = { input_tokens: 1_000, output_tokens: 500, cache_creation_input_tokens: null, cache_read_input_tokens: null };
  const question = JSON.stringify({ question: "What kind of thing is democracy?", scaffold: null });
  // the evaluator fails at once; the second question of each session (the one asked ahead) waits for `held`
  const setup = async (gateMastery: boolean) => {
    const store = memoryStore();
    await store.saveMastery("leo", atLevel(2));
    const asked = Promise.withResolvers<void>();
    const held = Promise.withResolvers<void>();
    let questions = 0;
    const send: SendToClaude = async ({ system }) => {
      if (system === AGENTS.evaluator.system) throw new Error("connection reset");
      if (system === AGENTS.questioner.system && ++questions === 2) {
        asked.resolve();
        await held.promise;
      }
      return { message: { content: [{ type: "text", text: question }], stop_reason: "end_turn", usage }, headers: new Headers() };
    };
    const callAgentFor = createCallAgent({
      send,
      model: "claude-opus-5-5",
      budgetUsd: 10,
      log: (entry) => store.logAgentCall(entry),
    });
    const url = await start(t, { ...noDb, store, advance, callAgentFor });
    const first = await toFirstQuestion(url);
    // optionally hold the Turn before its agent calls, so the delete begins before they start
    const reading = Promise.withResolvers<void>();
    const readHeld = Promise.withResolvers<void>();
    if (gateMastery) {
      const read = store.getMastery;
      t.mock.method(store, "getMastery", async function (this: Store, user: string) {
        reading.resolve();
        await readHeld.promise;
        return read.call(this, user);
      });
    }
    return { store, url, first, asked, held, reading, readHeld };
  };
  const deleteWhile = (url: string) => {
    const state = { answered: false };
    const res = fetch(`${url}/me/data`, { method: "DELETE", headers: as("leo") }).then((r) => ((state.answered = true), r));
    return { state, res };
  };

  // the Turn answers with its error while the question asked ahead is still running; the delete comes after
  const late = await setup(false);
  const failed = await (await answer(late.url, late.first.sessionId, { turn: late.first.turn, text: "a form of government" })).json();
  assert.equal(failed.error?.code, "agent_failed");
  await late.asked.promise;
  const first = deleteWhile(late.url);
  await sleep(50);
  assert.equal(first.state.answered, false, "the delete waits for the call still running");
  late.held.resolve();
  assert.equal((await first.res).status, 204);
  assert.equal(late.store.logs.length, 0);

  // the delete begins before the Turn starts its calls: it also waits for the calls the Turn starts afterwards
  const early = await setup(true);
  const turn = answer(early.url, early.first.sessionId, { turn: early.first.turn, text: "a form of government" });
  await early.reading.promise;
  const second = deleteWhile(early.url);
  await sleep(50);
  early.readHeld.resolve();
  assert.equal((await (await turn).json()).error?.code, "agent_failed");
  await early.asked.promise;
  await sleep(50);
  assert.equal(second.state.answered, false, "the delete waits for the call the Turn left running");
  early.held.resolve();
  assert.equal((await second.res).status, 204);
  assert.equal(early.store.logs.length, 0);
});

// Memory as the API sees it, in memory: the facts written, and every call in order. The first write waits for `held`.
function slowMemory() {
  const facts: string[] = [];
  const calls: string[] = [];
  const writing = Promise.withResolvers<void>();
  const held = Promise.withResolvers<void>();
  const api: MemoryApi = {
    async registerScope() {},
    async write(_scope, _labels, triples) {
      calls.push(`write ${triples[0]!.key}`);
      if (calls.filter((c) => c.startsWith("write")).length === 1) {
        writing.resolve();
        await held.promise;
      }
      facts.push(triples[0]!.key);
    },
    async history() {
      return [];
    },
    async forgetScope() {
      calls.push("forget");
      return facts.splice(0).length;
    },
  };
  return { memory: createLearnerMemory(api, { salt: "", conceptsOf: async () => new Map() }), facts, calls, writing, held };
}

const wholeMap = { concept: "ecosystem", supraordinate: { value: "system", note: null }, exclusion: [{ value: "habitat", note: "only the place" }], isoordinate: [{ value: "living things", note: null }], infraordinate: [{ value: "aquatic ecosystem", note: null }] };

test("Delete my data stops the memory write a result started: the write in flight lands, the purge comes after it, and memory keeps nothing", async (t) => {
  const { memory, facts, calls, writing, held } = slowMemory();
  const store = memoryStore();
  const claude = fakeClaude([["evaluator_full", { rubric: MOVE_ORDER.map((move) => ({ move, quality: 2, feedback: "Scripted." })) }]], store);
  const url = await start(t, { ...noDb, store, advance, callAgentFor: claude.callAgentFor, memory });
  const first = await (await post(url, { concept: "ecosystem", mode: "test" })).json();
  const map = await (await answer(url, first.sessionId, { turn: first.turn, prediction: 5 })).json();
  const done = await (await answer(url, first.sessionId, { turn: map.turn, mentefacto: wholeMap })).json();
  assert.equal(done.result.score, 8);
  await writing.promise;
  const deleting = fetch(`${url}/me/data`, { method: "DELETE", headers: as("leo") });
  await sleep(50);
  assert.deepEqual(calls, ["write level_supraordinate"], "the purge waits for the write in flight");
  held.resolve();
  assert.equal((await deleting).status, 204);
  await sleep(50);
  assert.deepEqual(calls, ["write level_supraordinate", "forget"]);
  assert.deepEqual(facts, []);
});

test("a result saved while Delete my data waits for it leaves nothing for memory to write", async (t) => {
  const { memory, facts, calls } = slowMemory();
  const remembers = t.mock.method(memory, "remember");
  const store = memoryStore();
  const claude = fakeClaude([["evaluator_full", { rubric: MOVE_ORDER.map((move) => ({ move, quality: 2, feedback: "Scripted." })) }]], store);
  const reached = Promise.withResolvers<void>();
  const held = Promise.withResolvers<void>();
  const callAgentFor = (id: string): CallAgent => {
    const call = claude.callAgentFor(id);
    return async (agent, input) => {
      if (agent === "evaluator_full") {
        reached.resolve();
        await held.promise;
      }
      return call(agent, input);
    };
  };
  const url = await start(t, { ...noDb, store, advance, callAgentFor, memory });
  const first = await (await post(url, { concept: "ecosystem", mode: "test" })).json();
  const map = await (await answer(url, first.sessionId, { turn: first.turn, prediction: 5 })).json();
  const submitting = answer(url, first.sessionId, { turn: map.turn, mentefacto: wholeMap });
  await reached.promise;
  const deleting = fetch(`${url}/me/data`, { method: "DELETE", headers: as("leo") });
  await sleep(20);
  held.resolve();
  const [submitted, deleted] = await Promise.all([submitting, deleting]);
  assert.deepEqual([submitted.status, deleted.status], [200, 204]);
  await sleep(50);
  assert.equal(remembers.mock.callCount(), 0);
  assert.deepEqual(calls, ["forget"]);
  assert.deepEqual(facts, []);
  assert.deepEqual(await store.listSessions("leo"), []);
});

test("learnerWrites: a delete waits for the learner's writes in flight and stops them, their next writes wait for it, other learners don't", async () => {
  const writes = learnerWrites();
  const order: string[] = [];
  const held = Promise.withResolvers<void>();
  const seen: { stop?: AbortSignal } = {};
  const turn = writes.run("leo", async (stop) => {
    seen.stop = stop;
    await held.promise;
    order.push("turn");
  });
  const erase = writes.erase("leo", async () => {
    order.push("erase");
  });
  assert.equal(seen.stop?.aborted, true);
  const later = writes.run("leo", async (stop) => {
    assert.equal(stop.aborted, false);
    order.push("later");
  });
  await writes.run("kim", async () => {
    order.push("other");
  });
  assert.deepEqual(order, ["other"]);
  held.resolve();
  await Promise.all([turn, erase, later]);
  assert.deepEqual(order, ["other", "turn", "erase", "later"]);
  // a delete that fails says so, and the learner's writes go on afterwards
  await assert.rejects(
    writes.erase("leo", async () => Promise.reject(new Error("memory answered 503"))),
    /memory answered 503/,
  );
  assert.equal(await writes.run("leo", async () => "written"), "written");
});

test("learnerWrites: a slow deletion returns an error without releasing its fence", async () => {
  const writes = learnerWrites(20);
  const held = Promise.withResolvers<void>();
  const erased = Promise.withResolvers<void>();
  const turn = writes.run("leo", () => held.promise);
  const deleting = writes.erase("leo", async () => erased.resolve()).then(() => null, (error: Error) => error);
  const later = writes.run("leo", async () => "must not start").then(() => null, (error: Error) => error);
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 50));
  const [deletionResult, writeResult] = await Promise.all([Promise.race([deleting, timeout]), Promise.race([later, timeout])]);

  held.resolve();
  await Promise.all([turn, erased.promise, deleting, later]);
  assert.ok(deletionResult instanceof Error && deletionResult.name !== "MemoryError" && "status" in deletionResult && deletionResult.status === 503);
  assert.ok(writeResult instanceof Error && writeResult.name !== "MemoryError" && "status" in writeResult && writeResult.status === 503);
});

test("a Turn off the contract is never saved: the learner gets the latest Turn again with error set, and the session stays readable", async (t) => {
  const errors = t.mock.method(console, "error", () => {});
  // An orchestrator that puts a scaffold with no blanks on the Turn, the shape #139 found: valid for the questioner's
  // output, off the Turn contract (blanks >= 1). Saved, it would fail the store's Session.parse on every read after it.
  let drift = true;
  const drifting: Advance = async (state, input, callAgent) => {
    const next = await advanceStub(state, input, callAgent);
    if (!drift || !("prediction" in input)) return next;
    const turn = { ...next.turn, scaffold: { given: ["moon", "asteroid"], blanks: 0 } };
    return { ...next, session: { ...next.session, lastTurn: turn }, turn };
  };
  const store = parsingStore();
  const sessionSaves = t.mock.method(store, "saveSession");
  const masterySaves = t.mock.method(store, "saveMastery");
  const url = await start(t, { ...noDb, store, advance: drifting });
  const first = await (await post(url, { concept: "democracy" })).json();
  const res = await answer(url, first.sessionId, { turn: 1, prediction: 7 });
  // the session reads back as it was: the next read, and the retry, still work
  const read = await fetch(`${url}/sessions/${first.sessionId}`, { headers: as("leo") });
  assert.equal(read.status, 200);
  assert.deepEqual(await read.json(), first);
  // the answer is the latest Turn with error set (CONTRACTS.md section 5), nothing was written, and the reason is logged
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ...first, error: { code: "agent_failed", retryable: true } });
  assert.equal(sessionSaves.mock.callCount(), 1); // the start only
  assert.equal(masterySaves.mock.callCount(), 0);
  assert.match(String(errors.mock.calls[0]?.arguments[0]), /Turn 2 of session s1 is off the contract and wasn't saved: scaffold\.blanks/);
  // the same answer sent again, once the orchestrator behaves, moves the session on as usual
  drift = false;
  const retried = await (await answer(url, first.sessionId, { turn: 1, prediction: 7 })).json();
  assert.deepEqual([retried.turn, retried.error], [2, null]);
  assert.doesNotThrow(() => TurnSchema.parse(retried));
  assert.equal(sessionSaves.mock.callCount(), 2);
});

test("with memory on, the hint giver and the coach get what earlier sessions left and the app gets the sources of what they cite; the result writes the session's facts; the sheet reads; Delete my data purges first", async (t) => {
  const warned = t.mock.method(console, "warn", () => {});
  // what the learner's earlier session on ecosystem left, as the reader returns it
  const facts: MemoryFact[] = [
    { id: "attr_sup1", text: "You moved up to level 3 on 'Bigger group' for ecosystem on Oct 22.", concept: "ecosystem", move: "supraordinate", level: 3, since: "2026-10-22T18:40:05Z", writtenBy: "evaluator", sessionId: "s0" },
    { id: "attr_gap1", text: "Last time on ecosystem you guessed 7 and proved 4.", concept: "ecosystem", since: "2026-10-22T18:45:12Z", writtenBy: "coach", sessionId: "s0" },
  ];
  const view = MemoryViewSchema.parse(memoryView);
  const calls: string[] = [];
  const memory: LearnerMemoryStore = {
    async recall(user, concept, sessionId) {
      calls.push(`recall ${user} ${concept} ${sessionId}`);
      return { facts };
    },
    async remember(user, session) {
      calls.push(`remember ${user} ${session.id} ${session.result?.score}`);
    },
    async view(user, concepts, reads) {
      calls.push(`view ${user} ${concepts.join("+")} ${JSON.stringify(reads)}`);
      return view;
    },
    async purge(user) {
      calls.push(`purge ${user}`);
    },
  };
  const store = memoryStore();
  const deletes = t.mock.method(store, "deleteUserData");
  const replies: [keyof typeof AGENTS, unknown][] = [
    // the hint giver leans on the level fact, and makes an id up
    ["hint_giver", { step: "nudge", text: "You found this part alone last time. What kind of thing is an ecosystem?", revealed: null, cites: ["attr_sup1", "attr_made_up"] }],
    ["evaluator_full", { rubric: MOVE_ORDER.map((move) => ({ move, quality: 1, feedback: `Scripted ${move}.` })) }],
    ["coach", { message: "Closer than last time: your guess was 1 off.", nextFocus: "exclusion", cites: ["attr_gap1"] }],
  ];
  const claude = fakeClaude(replies, store);
  const url = await start(t, { ...noDb, store, advance, callAgentFor: claude.callAgentFor, memory });
  const next = async (latest: { sessionId: string; turn: number }, body: object) => {
    const res = await answer(url, latest.sessionId, { ...body, turn: latest.turn });
    assert.equal(res.status, 200);
    const turn = await res.json();
    assert.equal(turn.error, null, `Turn ${turn.turn}`);
    return turn;
  };

  const first = await (await post(url, { concept: "ecosystem", mode: "test" })).json();
  const map = await next(first, { prediction: 5 });
  // the prediction calls no agent, so memory wasn't read
  assert.deepEqual(calls, []);
  const hinted = await next(map, { action: "help" });
  const hint = hinted.messages[0];
  assert.deepEqual([hint.kind, hint.hintStep, hint.cites, hint.sources], ["hint", "nudge", ["attr_sup1"], [{ id: "attr_sup1", text: facts[0]!.text }]]);
  // read once for the Turn, skipping this session's own rows
  assert.deepEqual(calls, [`recall leo ecosystem ${first.sessionId}`]);
  // the hint giver received the facts, and the id it made up went to its log row as dropped
  const hintRow = claude.logged.find((row) => row.agent === "hint_giver")!;
  assert.deepEqual((hintRow.input as { memory?: unknown }).memory, { facts });
  assert.deepEqual((hintRow.output as { cites: string[] }).cites, ["attr_sup1"]);
  assert.deepEqual(hintRow.dropped, ["attr_made_up"]);
  assert.match(String(warned.mock.calls[0]?.arguments[0]), /hint_giver cited 1 fact id\(s\) it wasn't given/);
  // the saved Turn carries the sources too, so resuming shows the line
  const saved = await (await fetch(`${url}/sessions/${first.sessionId}`, { headers: as("leo") })).json();
  assert.deepEqual(saved.messages[0].sources, hint.sources);

  const item = (value: string, note: string | null = null) => ({ value, note });
  const mentefacto = { concept: "ecosystem", supraordinate: item("system"), exclusion: [item("habitat", "only the place")], isoordinate: [item("living things")], infraordinate: [item("aquatic ecosystem")] };
  const done = await next(hinted, { mentefacto });
  // the result Turn writes the session's facts (the whole-map evaluator never reads memory)
  assert.deepEqual([done.expects, done.result.score], ["continue", 4]);
  assert.deepEqual(calls.slice(1), [`remember leo ${first.sessionId} 4`]);
  const coached = await next(done, { action: "continue" });
  assert.deepEqual(coached.messages.at(-1), {
    agent: "coach",
    kind: "summary",
    text: "Closer than last time: your guess was 1 off.",
    cites: ["attr_gap1"],
    sources: [{ id: "attr_gap1", text: facts[1]!.text }],
  });
  assert.equal(calls.at(-1), `recall leo ecosystem ${first.sessionId}`);
  assert.deepEqual(claude.logged.find((row) => row.agent === "coach")?.dropped, undefined);

  // the Memory sheet: the finished concepts and the ids each hint giver or coach call received, then memory's view
  const sheet = await (await fetch(`${url}/me/memory`, { headers: as("leo") })).json();
  assert.deepEqual(sheet, view);
  assert.equal(calls.at(-1), `view leo ecosystem ${JSON.stringify([["attr_sup1", "attr_gap1"], ["attr_sup1", "attr_gap1"]])}`);
  assert.equal((await fetch(`${url}/me/memory`)).status, 401);

  // Delete my data purges memory, then the tables
  assert.equal((await fetch(`${url}/me/data`, { method: "DELETE", headers: as("leo") })).status, 204);
  assert.equal(calls.at(-1), "purge leo");
  assert.equal(deletes.mock.callCount(), 1);

  // a purge that fails fails the request, and the tables stay
  t.mock.method(console, "error", () => {});
  const keeping = memoryStore();
  const kept = t.mock.method(keeping, "deleteUserData");
  const failing = await start(t, { ...noDb, store: keeping, memory: { ...memory, purge: async () => Promise.reject(new Error("memory answered 503")) } });
  assert.equal((await fetch(`${failing}/me/data`, { method: "DELETE", headers: as("leo") })).status, 500);
  assert.equal(kept.mock.callCount(), 0);

  // with memory off the sheet is empty, and nothing is read or written
  const off = await start(t, withStore());
  assert.deepEqual(await (await fetch(`${off}/me/memory`, { headers: as("leo") })).json(), { concepts: [] });
});

test("a memory read slower than its budget leaves the hint giver without memory, and the Turn comes back as with memory off", async (t) => {
  t.mock.method(console, "warn", () => {});
  const warnings: string[] = [];
  // memory never answers in time: the read is abandoned at the budget, and the hint giver runs without it
  const late: typeof fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    });
  const memory = createLearnerMemory(createMemoryApi({ endpoint: "https://memory.example", context: "c", apiKey: "k" }, late), { salt: "", conceptsOf: async () => new Map(), readMs: 20, warn: (message) => warnings.push(message) });
  const store = memoryStore();
  // the hint giver cites a fact anyway; with none given, the id is dropped
  const claude = fakeClaude([["hint_giver", { step: "nudge", text: "What kind of thing is an ecosystem?", revealed: null, cites: ["attr_sup1"] }]], store);
  const url = await start(t, { ...noDb, store, advance, callAgentFor: claude.callAgentFor, memory });
  const first = await (await post(url, { concept: "ecosystem", mode: "test" })).json();
  const map = await (await answer(url, first.sessionId, { turn: first.turn, prediction: 5 })).json();
  const res = await answer(url, first.sessionId, { turn: map.turn, action: "help" });
  assert.equal(res.status, 200);
  const hinted = await res.json();
  assert.equal(hinted.error, null);
  const hint = hinted.messages[0];
  assert.deepEqual([hint.kind, hint.hintStep, "cites" in hint, "sources" in hint], ["hint", "nudge", false, false]);
  assert.match(warnings[0] ?? "", /memory read skipped after \d+ ms/);
  const hintRow = claude.logged.find((row) => row.agent === "hint_giver")!;
  assert.equal("memory" in (hintRow.input as object), false);
  assert.deepEqual(hintRow.dropped, ["attr_sup1"]);
  // the Turn was saved as it went out
  assert.deepEqual(await (await fetch(`${url}/sessions/${first.sessionId}`, { headers: as("leo") })).json(), hinted);
});

test("memory failing is a 502 in the API's words, never memory's status or text; body-parser's 400 still says what was wrong (code review, Oct 28)", async (t) => {
  const errors = t.mock.method(console, "error", () => {});
  const memory: LearnerMemoryStore = {
    async recall() {
      return undefined;
    },
    async remember() {},
    async view() {
      throw new MemoryError(401, "memory answered 401: invalid api key for context ctx");
    },
    async purge() {
      throw new MemoryError(403, "memory answered 403: scope learner/1a2b3c4d is not writable by this key");
    },
  };
  const store = memoryStore();
  const deletes = t.mock.method(store, "deleteUserData");
  const url = await start(t, { ...noDb, store, memory });
  // a key memory refuses is the API's problem, not the learner's sign-in (the app reads a 401 as "sign in again")
  const sheet = await fetch(`${url}/me/memory`, { headers: as("leo") });
  assert.equal(sheet.status, 502);
  const sheetBody = JSON.stringify(await sheet.json());
  assert.doesNotMatch(sheetBody, /memory answered|api key|401/);
  // a purge memory refuses fails the delete as one worth trying again, and the tables stay
  const deleted = await fetch(`${url}/me/data`, { method: "DELETE", headers: as("leo") });
  assert.equal(deleted.status, 502);
  assert.doesNotMatch(JSON.stringify(await deleted.json()), /memory answered|scope|403/);
  assert.equal(deletes.mock.callCount(), 0);
  // the cause goes to the server log
  assert.match(errors.mock.calls.map((call) => String(call.arguments[0])).join("\n"), /memory answered 401/);
  // body-parser's own errors still tell the caller what was wrong
  const broken = await post(url, "{not json");
  assert.equal(broken.status, 400);
  assert.notEqual((await broken.json()).error, undefined);
});

test("with memory off but set up, Delete my data still purges what the learner left there, and nothing else touches memory (code review, Oct 28)", async (t) => {
  const order: string[] = [];
  const store = memoryStore();
  const deleteUserData = store.deleteUserData;
  t.mock.method(store, "deleteUserData", async (user: string) => {
    order.push(`tables ${user}`);
    await deleteUserData(user);
  });
  const url = await start(t, { ...noDb, store, memory: null, purgeMemory: async (user) => void order.push(`purge ${user}`) });
  assert.deepEqual(await (await fetch(`${url}/health`)).json(), { ok: true, commit: null, memory: "off" });
  assert.deepEqual(await (await fetch(`${url}/me/memory`, { headers: as("leo") })).json(), { concepts: [] });
  assert.equal((await fetch(`${url}/me/data`, { method: "DELETE", headers: as("leo") })).status, 204);
  assert.deepEqual(order, ["purge leo", "tables leo"]);
});

test("every agent_log row names the learner it was for, so Delete my data finds it even once its session is gone (code review, Oct 28)", async (t) => {
  const store = memoryStore();
  const claude = fakeClaude([["hint_giver", { step: "nudge", text: "What kind of thing is an ecosystem?", revealed: null }]], store);
  const url = await start(t, { ...noDb, store, advance, callAgentFor: claude.callAgentFor });
  const first = await (await post(url, { concept: "ecosystem", mode: "test" })).json();
  const map = await (await answer(url, first.sessionId, { turn: first.turn, prediction: 5 })).json();
  assert.equal((await (await answer(url, first.sessionId, { turn: map.turn, action: "help" })).json()).error, null);
  assert.deepEqual(store.logs.map((row) => [row.agent, row.session, row.user]), [["hint_giver", first.sessionId, "leo"]]);
});
