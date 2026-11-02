import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryView as MemoryViewSchema, type CallAgent, type Level, type MemoryFact, type Session, type Turn } from "@build-north/agents";
import {
  MEMORY_READ_MS,
  MemoryError,
  createLearnerMemory,
  createMemoryApi,
  dateOf,
  entityOf,
  factOf,
  factText,
  factsOf,
  factsToWrite,
  fillSources,
  memoryConfigFromEnv,
  memoryPurgeConfigFromEnv,
  memoryPurgeOf,
  readCountsOf,
  scopeOf,
  viewOf,
  withMemory,
  type MemoryApi,
  type MemoryEntity,
  type MemoryRow,
} from "./memory.ts";
import { learnerWrites } from "./app.ts";
import { pseudonymOf } from "./export-testers.ts";
import { initialSession } from "./store.ts";

// A finished session on API: two parts moved (one up, one down), 7 guessed and 3 proved, Help on two parts.
const finished: Session = {
  ...initialSession("user_2leo", { concept: "API", material: null, mode: "learn" }),
  id: "s2",
  createdAt: "2026-10-23T14:00:00Z",
  turn: 15,
  phase: "result",
  hintsPerMove: { supraordinate: 0, exclusion: 2, isoordinate: 1, infraordinate: 0 },
  result: {
    predictedScore: 7,
    score: 3,
    maxScore: 8,
    calibrationGap: 4,
    hintsUsed: 3,
    rubric: [
      { move: "supraordinate", points: 2 },
      { move: "exclusion", points: 0 },
      { move: "isoordinate", points: 1 },
      { move: "infraordinate", points: 0 },
    ],
    masteryChanges: [
      { move: "supraordinate", from: 2, to: 3 },
      { move: "exclusion", from: 2, to: 1 },
    ],
    questions: { asked: 0, testing: 0 },
    coach: null,
  },
};
const AT = "2026-10-23T14:05:00Z";

// One row as memory lists it, with the labels the API's writes stamp
const row = (id: string, key: string, value: string, labels: Record<string, string | number>, { since = AT, until = null as string | null, supersedes = null as string | null } = {}): MemoryRow => ({
  id,
  key,
  value,
  createdAt: since,
  validFrom: since,
  validUntil: until,
  supersedes,
  labels: Object.entries(labels).map(([k, v]) => `${k}=${v}`),
  source: { kind: "upsert" },
});
const s1 = { session: "s1", turn: 14 };
const s2 = { session: "s2", turn: 15 };
const EARLIER = "2026-10-22T18:40:05Z";
// what session 1 left on API, then what session 2 wrote over it
const rows: MemoryRow[] = [
  row("attr_sup1", "level_supraordinate", "You moved up to level 2 on 'Bigger group' for API on Oct 22.", { ...s1, writer: "evaluator", move: "supraordinate", level: 2 }, { since: EARLIER, until: AT }),
  row("attr_sup2", "level_supraordinate", "You moved up to level 3 on 'Bigger group' for API on Oct 23.", { ...s2, writer: "evaluator", move: "supraordinate", level: 3 }, { supersedes: "attr_sup1" }),
  row("attr_exc1", "level_exclusion", "You moved up to level 2 on 'What it isn't' for API on Oct 22.", { ...s1, writer: "evaluator", move: "exclusion", level: 2 }, { since: EARLIER }),
  row("attr_gap1", "gap", "Last time on API you guessed 7 and proved 4.", { ...s1, writer: "coach", predicted: 7, score: 4 }, { since: EARLIER, until: AT }),
  row("attr_gap2", "gap", "Last time on API you guessed 7 and proved 3.", { ...s2, writer: "coach", predicted: 7, score: 3 }, { supersedes: "attr_gap1" }),
  row("attr_help_exc1", "help_exclusion", "'What it isn't' took 1 Help on API last time.", { ...s1, writer: "hint_giver", move: "exclusion", helps: 1 }, { since: EARLIER }),
  row("attr_help_iso1", "help_isoordinate", "'What it needs' took 2 Helps on API last time.", { ...s1, writer: "hint_giver", move: "isoordinate", helps: 2 }, { since: EARLIER }),
  row("attr_help_sup1", "help_supraordinate", "'Bigger group' took no Help on API last time.", { ...s1, writer: "hint_giver", move: "supraordinate", helps: 0 }, { since: EARLIER }),
  // rows this API never writes: no session label, or a key it doesn't know
  row("attr_other", "level_exclusion", "Level 4", { writer: "evaluator", move: "exclusion", level: 4 }),
  row("attr_stray", "favourite_colour", "amber", { ...s1 }),
];

/** The store's answer when every session the rows name is one of the learner's on `concept`. */
const allOn = (concept: string) => async (_user: string, ids: readonly string[]) => new Map(ids.map((id) => [id, concept] as const));
const reading = (stored: Record<string, MemoryRow[]>, written: string[] = []): MemoryApi => ({
  async registerScope() {},
  async write(_scope, _labels, triples) {
    written.push(triples[0]!.key);
  },
  async history(entity) {
    return stored[entity.name] ?? [];
  },
  async forgetScope() {
    return 0;
  },
});

test("memory is off by default; on, the endpoint, the context and the key are required and the endpoint must be a URL", () => {
  assert.equal(memoryConfigFromEnv({}), null);
  assert.equal(memoryConfigFromEnv({ AGENT_MEMORY_ENABLED: "false", AGENT_MEMORY_ENDPOINT: "https://m.example", AGENT_MEMORY_CONTEXT: "c", AGENT_MEMORY_API_KEY: "k" }), null);
  assert.throws(() => memoryConfigFromEnv({ AGENT_MEMORY_ENABLED: "true" }), /AGENT_MEMORY_ENDPOINT, AGENT_MEMORY_CONTEXT and AGENT_MEMORY_API_KEY/);
  assert.throws(() => memoryConfigFromEnv({ AGENT_MEMORY_ENABLED: "1", AGENT_MEMORY_ENDPOINT: "not a url", AGENT_MEMORY_CONTEXT: "c", AGENT_MEMORY_API_KEY: "k" }), /not a URL/);
  assert.deepEqual(memoryConfigFromEnv({ AGENT_MEMORY_ENABLED: "true", AGENT_MEMORY_ENDPOINT: "https://m.example/", AGENT_MEMORY_CONTEXT: "c", AGENT_MEMORY_API_KEY: "k", LEARNER_ID_SALT: "pepper" }), {
    endpoint: "https://m.example",
    context: "c",
    apiKey: "k",
    salt: "pepper",
  });
});

test("a learner's scope and entity carry the testers' pseudonym, never the Clerk id, and a concept's name is made safe", () => {
  assert.equal(scopeOf("a1b2c3d4"), "learner/a1b2c3d4");
  assert.deepEqual(entityOf("a1b2c3d4", "Environment Variable"), { type: "topic", name: "a1b2c3d4_environment_variable" });
  assert.equal(entityOf("a1b2c3d4", "API").name, "a1b2c3d4_api");
  assert.equal(dateOf("2026-10-22T23:59:00Z"), "Oct 22");
  // a fact's date follows the team's zone (TZ, else Toronto), the zone the Memory sheet's dates show in Ontario
  assert.equal(dateOf("2026-10-24T01:30:00Z", "America/Toronto"), "Oct 23");
  assert.equal(dateOf("2026-10-24T01:30:00Z", "UTC"), "Oct 24");
});

test("with memory's record given, a finished part with no level row yet gets its baseline level, and the rest nothing extra", () => {
  const played: Session = {
    ...finished,
    moveLog: [
      { move: "supraordinate", points: 2, hints: 0, retries: 0, from: 2, to: 3 },
      { move: "exclusion", points: 0, hints: 2, retries: 1, from: 2, to: 1 },
      { move: "isoordinate", points: 1, hints: 1, retries: 0, from: 5, to: 5 },
      { move: "infraordinate", points: 0, hints: 0, retries: 0, from: 4, to: 4 },
    ],
  };
  // infraordinate is on record already; isoordinate is not, so its level 5 is written as where the learner stood
  const keys = (writes: ReturnType<typeof factsToWrite>) => writes.filter((w) => w.key.startsWith("level_")).map((w) => [w.key, w.value, w.labels.level]);
  assert.deepEqual(keys(factsToWrite(played, AT, new Set(["infraordinate"]))), [
    ["level_supraordinate", "You moved up to level 3 on 'Bigger group' for API on Oct 23.", 3],
    ["level_exclusion", "You moved down to level 1 on 'What it isn't' for API on Oct 23.", 1],
    ["level_isoordinate", "You were at level 5 on 'What it needs' for API on Oct 23.", 5],
  ]);
  // every part on record: the changes only, as without the record
  assert.deepEqual(keys(factsToWrite(played, AT, new Set(["isoordinate", "infraordinate"]))), keys(factsToWrite(played, AT)));
  // a part the session never finished has no level to write
  assert.deepEqual(keys(factsToWrite({ ...played, moveLog: played.moveLog.slice(0, 2) }, AT, new Set())).map(([key]) => key), ["level_supraordinate", "level_exclusion"]);
  // the demo account: level 5 everywhere, nothing changes, and the first session still leaves four level rows
  const settled: Session = { ...played, moveLog: played.moveLog.map((entry) => ({ ...entry, from: 5, to: 5 })), result: { ...played.result!, masteryChanges: [] } };
  assert.deepEqual(keys(factsToWrite(settled, AT, new Set())).map(([key, , level]) => `${key}=${level}`), ["level_supraordinate=5", "level_exclusion=5", "level_isoordinate=5", "level_infraordinate=5"]);
  assert.deepEqual(keys(factsToWrite(settled, AT)), []);
});

test("remembering reads memory first: baselines for the parts it has no level for, and the changes alone when the read fails", async () => {
  const warnings: string[] = [];
  let history: () => Promise<MemoryRow[]> = async () => [row("attr_inf0", "level_infraordinate", "x", { ...s1, writer: "evaluator", move: "infraordinate", level: 4 })];
  const written: string[] = [];
  const api: MemoryApi = {
    async registerScope() {},
    async write(_scope, _labels, triples) {
      written.push(triples[0]!.key);
    },
    history: () => history(),
    async forgetScope() {
      return 0;
    },
  };
  const memory = createLearnerMemory(api, { salt: "pepper", conceptsOf: allOn("API"), warn: (message) => warnings.push(message) });
  const played: Session = {
    ...finished,
    moveLog: [
      { move: "supraordinate", points: 2, hints: 0, retries: 0, from: 2, to: 3 },
      { move: "exclusion", points: 0, hints: 2, retries: 1, from: 2, to: 1 },
      { move: "isoordinate", points: 1, hints: 1, retries: 0, from: 5, to: 5 },
      { move: "infraordinate", points: 0, hints: 0, retries: 0, from: 4, to: 4 },
    ],
  };
  await memory.remember("user_2leo", played);
  assert.deepEqual(written.filter((key) => key.startsWith("level_")), ["level_supraordinate", "level_exclusion", "level_isoordinate"]);
  assert.deepEqual(warnings, []);
  // memory not answering before the write: the changes are still written, and the reason is logged
  written.length = 0;
  history = async () => Promise.reject(new Error("memory answered 503"));
  await memory.remember("user_2leo", played);
  assert.deepEqual(written.filter((key) => key.startsWith("level_")), ["level_supraordinate", "level_exclusion"]);
  assert.match(warnings[0] ?? "", /only level changes are written: memory answered 503/);
});

test("a finished session leaves the level changes, the gap and the Helps, as plain sentences with the numbers in labels", () => {
  assert.deepEqual(factsToWrite(finished, AT), [
    { key: "level_supraordinate", value: "You moved up to level 3 on 'Bigger group' for API on Oct 23.", labels: { writer: "evaluator", move: "supraordinate", level: 3 } },
    { key: "level_exclusion", value: "You moved down to level 1 on 'What it isn't' for API on Oct 23.", labels: { writer: "evaluator", move: "exclusion", level: 1 } },
    { key: "gap", value: "Last time on API you guessed 7 and proved 3.", labels: { writer: "coach", predicted: 7, score: 3 } },
    { key: "help_supraordinate", value: "'Bigger group' took no Help on API last time.", labels: { writer: "hint_giver", move: "supraordinate", helps: 0 } },
    { key: "help_exclusion", value: "'What it isn't' took 2 Helps on API last time.", labels: { writer: "hint_giver", move: "exclusion", helps: 2 } },
    { key: "help_isoordinate", value: "'What it needs' took 1 Help on API last time.", labels: { writer: "hint_giver", move: "isoordinate", helps: 1 } },
    { key: "help_infraordinate", value: "'Its types' took no Help on API last time.", labels: { writer: "hint_giver", move: "infraordinate", helps: 0 } },
  ]);
  // Cynthia's three sentences (#112), word for word
  assert.equal(factText.gap("API", 7, 3), "Last time on API you guessed 7 and proved 3.");
  assert.equal(factText.help("API", "infraordinate", 2), "'Its types' took 2 Helps on API last time.");
  assert.equal(factText.level("API", "exclusion", 2, 3, "2026-10-22T20:00:00Z"), "You moved up to level 3 on 'What it isn't' for API on Oct 22.");
  // a session without a result leaves nothing
  assert.deepEqual(factsToWrite({ ...finished, result: null }, AT), []);
});

test("the facts an agent gets: the level per part, the latest gap, the Helps that cost most, from earlier sessions only, 8 at most", () => {
  // session 2's coach reads what came before session 2: the rows it just wrote are skipped
  const facts = factsOf(rows, "API", "s2");
  assert.deepEqual(
    facts.map((f) => f.id),
    ["attr_sup1", "attr_exc1", "attr_gap1", "attr_help_iso1", "attr_help_exc1", "attr_help_sup1"],
  );
  assert.deepEqual(facts[0], {
    id: "attr_sup1",
    text: "You moved up to level 2 on 'Bigger group' for API on Oct 22.",
    concept: "API",
    move: "supraordinate",
    level: 2,
    since: EARLIER,
    writtenBy: "evaluator",
    sessionId: "s1",
    turn: 14,
  });
  assert.deepEqual(facts[2], { id: "attr_gap1", text: "Last time on API you guessed 7 and proved 4.", concept: "API", since: EARLIER, writtenBy: "coach", sessionId: "s1", turn: 14 });
  // a third session reads the current values, with what they superseded
  const later = factsOf(rows, "API", "s3");
  assert.deepEqual(later.map((f) => f.id), ["attr_sup2", "attr_exc1", "attr_gap2", "attr_help_iso1", "attr_help_exc1", "attr_help_sup1"]);
  assert.equal(later[0]?.supersedes, "attr_sup1");
  // at most 8, so with all four Helps written only the three costliest fit
  const full = [
    ...rows,
    row("attr_iso1", "level_isoordinate", "x", { ...s1, writer: "evaluator", move: "isoordinate", level: 2 }, { since: EARLIER }),
    row("attr_inf1", "level_infraordinate", "x", { ...s1, writer: "evaluator", move: "infraordinate", level: 2 }, { since: EARLIER }),
    row("attr_help_inf1", "help_infraordinate", "x", { ...s1, writer: "hint_giver", move: "infraordinate", helps: 3 }, { since: EARLIER }),
  ];
  const eight = factsOf(full, "API", "s3");
  assert.equal(eight.length, 8);
  assert.deepEqual(eight.slice(5).map((f) => f.id), ["attr_help_inf1", "attr_help_iso1", "attr_help_exc1"]);
  assert.deepEqual(factsOf([], "API", "s1"), []);
});

test("the Memory sheet's view: each part's chain newest first, the superseded row closed, who read it, the latest gap beside the one before", () => {
  const readBy = readCountsOf([["attr_sup1", "attr_gap1"], ["attr_sup1"], []]);
  const api = viewOf("API", rows, readBy);
  assert.doesNotThrow(() => MemoryViewSchema.parse({ concepts: [api] }));
  assert.deepEqual(api.moves[0], {
    move: "supraordinate",
    level: 3,
    history: [
      { level: 3, since: AT, until: null, source: "upsert", writtenBy: "evaluator", readBy: 0 },
      { level: 2, since: EARLIER, until: AT, source: "upsert", writtenBy: "evaluator", readBy: 2 },
    ],
  });
  assert.deepEqual(api.moves[1]?.level, 2);
  assert.deepEqual(api.moves[3], { move: "infraordinate", level: null, history: [] });
  assert.deepEqual(api.gap, {
    latest: { sessionId: "s2", at: AT, predictedScore: 7, score: 3, gap: 4 },
    previous: { sessionId: "s1", at: EARLIER, predictedScore: 7, score: 4, gap: 3 },
  });
});

// A stand-in for memory's REST API: every request it saw, and the answers scripted for it
function fakeMemory(answer: (method: string, path: string, body: unknown) => { status: number; json?: unknown }) {
  const seen: { method: string; path: string; body: unknown; auth: string | null; idempotencyKey: string | null }[] = [];
  const send: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    seen.push({ method: init?.method ?? "GET", path: `${url.pathname}${url.search}`, body, auth: headers.get("authorization"), idempotencyKey: headers.get("idempotency-key") });
    const { status, json } = answer(init?.method ?? "GET", `${url.pathname}${url.search}`, body);
    return new Response(json === undefined ? null : JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  };
  return { seen, api: createMemoryApi({ endpoint: "https://memory.example", context: "ctx1", apiKey: "sp-secret" }, send) };
}
const signal = () => AbortSignal.timeout(1_000);

test("the REST calls: a triple write with its scope, labels and idempotency key, a history walked page by page, a scope registered once, a purge", async () => {
  const { seen, api } = fakeMemory((method, path) => {
    if (method === "POST" && path.endsWith("/scopes")) return { status: 409, json: { message: "scope exists" } };
    if (method === "POST" && path.endsWith("/facts")) return { status: 200, json: { mode: "triples", sessionId: "sess_m", turnId: "turn_m" } };
    if (method === "GET" && path.includes("/history?limit=200&cursor=")) return { status: 200, json: { history: [rows[1]], page: { hasMore: false } } };
    if (method === "GET" && path.includes("/history")) return { status: 200, json: { history: [rows[0]], page: { hasMore: true, nextCursor: "c2" } } };
    if (method === "POST" && path.endsWith("/scopes/forget")) return { status: 200, json: { forgotten: 9 } };
    return { status: 404, json: { message: "no" } };
  });
  await api.registerScope("learner/a1b2c3d4", signal());
  const entity = entityOf("a1b2c3d4", "API");
  await api.write("learner/a1b2c3d4", ["session=s1", "writer=coach"], [{ entity, key: "gap", value: "Last time on API you guessed 7 and proved 4.", occurred_at: AT }], signal(), "write-s1-gap");
  assert.deepEqual(await api.history(entity, signal()), [rows[0], rows[1]]);
  assert.equal(await api.forgetScope("learner/a1b2c3d4", signal()), 9);

  assert.deepEqual(
    seen.map((call) => `${call.method} ${call.path}`),
    [
      "POST /api/v1/ctx1/scopes",
      "POST /api/v1/ctx1/facts",
      "GET /api/v1/ctx1/entities/topic/a1b2c3d4_api/history?limit=200",
      "GET /api/v1/ctx1/entities/topic/a1b2c3d4_api/history?limit=200&cursor=c2",
      "POST /api/v1/ctx1/scopes/forget",
    ],
  );
  assert.ok(seen.every((call) => call.auth === "Bearer sp-secret"));
  assert.equal(seen[1]?.idempotencyKey, "write-s1-gap");
  assert.deepEqual(seen[0]?.body, { path: "learner/a1b2c3d4" });
  // no `text`, no model: the triples go in as they are, scoped to the learner
  assert.deepEqual(seen[1]?.body, {
    infer: "triples",
    scopes: [["learner/a1b2c3d4"]],
    memory_category: "knowledge",
    labels: ["session=s1", "writer=coach"],
    triples: [{ entity: { type: "topic", name: "a1b2c3d4_api" }, key: "gap", value: "Last time on API you guessed 7 and proved 4.", occurred_at: AT }],
  });
  assert.deepEqual(seen[4]?.body, { path: "learner/a1b2c3d4" });
});

test("an entity memory doesn't have is an empty history, a scope never registered purges nothing, and an error keeps memory's message", async () => {
  const { api } = fakeMemory((method, path) => {
    if (path.includes("/history")) return { status: 404, json: { message: "entity not found" } };
    if (path.endsWith("/scopes/forget")) return { status: 404, json: { message: "unknown scope node" } };
    if (path.endsWith("/facts")) return { status: 422, json: { message: "unknown scope node learner/x" } };
    return { status: 500 };
  });
  assert.deepEqual(await api.history(entityOf("a1b2c3d4", "API"), signal()), []);
  assert.equal(await api.forgetScope("learner/nobody", signal()), 0);
  await assert.rejects(api.write("learner/x", [], [], signal(), "write-x"), { name: "MemoryError", status: 422, message: "memory answered 422: unknown scope node learner/x" });
  await assert.rejects(api.registerScope("learner/x", signal()), { status: 500, message: "memory answered 500" });
});

test(`a read gives up after ${MEMORY_READ_MS} ms, and the agent runs without memory; so does a read that fails`, async () => {
  assert.equal(MEMORY_READ_MS, 1_500);
  const warnings: string[] = [];
  const slow: typeof fetch = (_input, init) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(new Response(JSON.stringify({ history: rows }), { status: 200 })), 500);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(init.signal?.reason);
      });
    });
  const late = createLearnerMemory(createMemoryApi({ endpoint: "https://memory.example", context: "c", apiKey: "k" }, slow), { salt: "", conceptsOf: allOn("API"), readMs: 30, warn: (m) => warnings.push(m) });
  assert.equal(await late.recall("user_2leo", "API", "s9"), undefined);
  assert.match(warnings[0] ?? "", /memory read skipped after \d+ ms: .*(abort|timeout)/i);

  const down: typeof fetch = async () => {
    throw new TypeError("fetch failed");
  };
  const failing = createLearnerMemory(createMemoryApi({ endpoint: "https://memory.example", context: "c", apiKey: "k" }, down), { salt: "", conceptsOf: allOn("API"), warn: (m) => warnings.push(m) });
  assert.equal(await failing.recall("user_2leo", "API", "s9"), undefined);
  assert.match(warnings[1] ?? "", /fetch failed/);

  // in time: the facts, from earlier sessions than the one asking
  const quick = createLearnerMemory(createMemoryApi({ endpoint: "https://memory.example", context: "c", apiKey: "k" }, async () => new Response(JSON.stringify({ history: rows }), { status: 200 })), { salt: "", conceptsOf: allOn("API") });
  const memory = await quick.recall("user_2leo", "API", "s2");
  assert.deepEqual(memory?.facts.map((f) => f.id), ["attr_sup1", "attr_exc1", "attr_gap1", "attr_help_iso1", "attr_help_exc1", "attr_help_sup1"]);
  // nothing on this concept: no memory, not an empty one, so the user message stays as before memory existed
  const empty = createLearnerMemory(createMemoryApi({ endpoint: "https://memory.example", context: "c", apiKey: "k" }, async () => new Response(JSON.stringify({ history: [] }), { status: 200 })), { salt: "", conceptsOf: allOn("API") });
  assert.equal(await empty.recall("user_2leo", "API", "s2"), undefined);
});

test("remembering a session registers its learner's scope once, writes one triple per fact with the session on it, one after another, and reports a write that failed", async () => {
  const calls: { method: string; path: string; body: unknown }[] = [];
  let failWrites = false;
  const api: MemoryApi = {
    async registerScope(path) {
      calls.push({ method: "scope", path, body: null });
    },
    async write(scope, labels, triples) {
      calls.push({ method: "write", path: scope, body: { labels, triples } });
      if (failWrites) throw new MemoryError(503, "memory answered 503");
    },
    async history() {
      return [];
    },
    async forgetScope(path) {
      calls.push({ method: "forget", path, body: null });
      return 7;
    },
  };
  const memory = createLearnerMemory(api, { salt: "pepper", conceptsOf: allOn("API") });
  await memory.remember("user_2leo", finished);
  await memory.remember("user_2leo", { ...finished, id: "s3", turn: 16 });
  const writes = calls.filter((c) => c.method === "write");
  assert.equal(calls.filter((c) => c.method === "scope").length, 1);
  assert.equal(writes.length, 14);
  const expectedScope = scopeOf(entityOf("", "x").name.split("_")[0]!);
  assert.notEqual(writes[0]?.path, "learner/user_2leo", "the scope never names the Clerk id");
  assert.equal(expectedScope, "learner/");
  assert.deepEqual(writes[0]?.body, {
    labels: ["session=s2", "turn=15", "writer=evaluator", "move=supraordinate", "level=3"],
    triples: [{ entity: { type: "topic", name: `${writes[0]!.path.slice("learner/".length)}_api` }, key: "level_supraordinate", value: `You moved up to level 3 on 'Bigger group' for API on ${dateOf(new Date())}.`, occurred_at: (writes[0]!.body as { triples: { occurred_at: string }[] }).triples[0]!.occurred_at }],
  });
  assert.deepEqual(writes[7]?.body && (writes[7].body as { labels: string[] }).labels.slice(0, 2), ["session=s3", "turn=16"]);
  // a session with no result leaves nothing to write
  await memory.remember("user_2leo", { ...finished, result: null });
  assert.equal(calls.filter((c) => c.method === "write").length, 14);
  failWrites = true;
  await assert.rejects(memory.remember("user_2leo", finished), /memory answered 503/);
  // the purge, and the scope is registered again afterwards
  await memory.purge("user_2leo");
  assert.equal(calls.at(-1)?.method, "forget");
  assert.equal(calls.at(-1)?.path, writes[0]?.path);
  failWrites = false;
  await memory.remember("user_2leo", finished);
  assert.equal(calls.filter((c) => c.method === "scope").length, 2);
});

test("the Memory sheet reads each concept's history and leaves out the ones memory holds nothing on", async () => {
  const api: MemoryApi = {
    async registerScope() {},
    async write() {},
    async history(entity) {
      return entity.name.endsWith("_api") ? rows : [];
    },
    async forgetScope() {
      return 0;
    },
  };
  const memory = createLearnerMemory(api, { salt: "", conceptsOf: allOn("API") });
  const view = await memory.view("user_2leo", ["JWT", "API"], [["attr_sup1"]]);
  assert.deepEqual(view.concepts.map((c) => c.concept), ["API"]);
  assert.equal(view.concepts[0]?.moves[0]?.history[1]?.readBy, 1);
  assert.deepEqual(await memory.view("user_2leo", [], []), { concepts: [] });
});

test("only the hint giver and the coach receive memory, read once per Turn, and the sources of what they cite are filled in", async () => {
  const facts: MemoryFact[] = [
    { id: "attr_gap1", text: "Last time on API you guessed 7 and proved 4.", concept: "API", since: EARLIER, writtenBy: "coach", sessionId: "s1" },
    { id: "attr_exc1", text: "You moved up to level 2 on 'What it isn't' for API on Oct 22.", concept: "API", move: "exclusion", level: 2, since: EARLIER, writtenBy: "evaluator", sessionId: "s1" },
  ];
  let reads = 0;
  const received: [string, unknown][] = [];
  const callAgent: CallAgent = async (agent, input) => {
    received.push([agent, input]);
    return {};
  };
  const turnMemory = withMemory(callAgent, async () => {
    reads++;
    return { facts };
  });
  assert.deepEqual(turnMemory.given(), []);
  await turnMemory.callAgent("questioner", { q: 1 });
  assert.equal(reads, 0);
  await turnMemory.callAgent("hint_giver", { step: "hint" });
  await turnMemory.callAgent("coach", { concept: "API" });
  assert.equal(reads, 1);
  assert.deepEqual(received, [
    ["questioner", { q: 1 }],
    ["hint_giver", { step: "hint", memory: { facts } }],
    ["coach", { concept: "API", memory: { facts } }],
  ]);
  assert.deepEqual(turnMemory.given(), facts);

  // with nothing in memory the input is the one the orchestrator built
  const without = withMemory(callAgent, async () => undefined);
  await without.callAgent("coach", { concept: "API" });
  assert.deepEqual(received.at(-1), ["coach", { concept: "API" }]);
  assert.deepEqual(without.given(), []);

  const turn = {
    messages: [
      { agent: "coach", kind: "summary", text: "Closer than last time.", cites: ["attr_gap1", "attr_made_up"] },
      { agent: "hint_giver", kind: "hint", text: "Look again.", hintStep: "hint", cites: [] },
      { agent: "app", kind: "question", text: "What group?" },
    ],
  } as unknown as Turn;
  fillSources(turn, facts);
  assert.deepEqual(turn.messages[0]?.sources, [{ id: "attr_gap1", text: "Last time on API you guessed 7 and proved 4." }]);
  assert.equal("sources" in turn.messages[1]!, false);
  assert.equal("sources" in turn.messages[2]!, false);
});

// ---------- What the prize page points at (wiki/context/surrealdb-sponsor-prize.md): the chain, the keys, the order ----------

// A stand-in for the store behind memory's REST API, doing to a second write of a key what the live context did on
// Oct 23: the new row carries `supersedes`, and the earlier row of the same key is closed by `validUntil`.
function supersedingMemory() {
  const stored = new Map<string, MemoryRow[]>();
  let ids = 0;
  const { seen, api } = fakeMemory((method, path, body) => {
    if (method === "POST" && path.endsWith("/scopes")) return { status: 201, json: body };
    if (method === "POST" && path.endsWith("/facts")) {
      const { labels, triples } = body as { labels: string[]; triples: { entity: MemoryEntity; key: string; value: string; occurred_at: string }[] };
      for (const { entity, key, value, occurred_at } of triples) {
        const rows = stored.get(entity.name) ?? [];
        const earlier = rows.find((candidate) => candidate.key === key && !candidate.validUntil);
        if (earlier) earlier.validUntil = occurred_at;
        rows.push({ id: `attr_${++ids}`, key, value, createdAt: occurred_at, validFrom: occurred_at, validUntil: null, supersedes: earlier?.id ?? null, labels, source: { kind: "upsert" } });
        stored.set(entity.name, rows);
      }
      return { status: 200, json: { mode: "triples" } };
    }
    if (method === "GET" && path.includes("/history")) {
      const name = decodeURIComponent(path.slice(path.indexOf("/topic/") + "/topic/".length, path.indexOf("/history")));
      const rows = stored.get(name);
      return rows ? { status: 200, json: { history: rows, page: { hasMore: false } } } : { status: 404, json: { message: "entity not found" } };
    }
    return { status: 404, json: { message: "no" } };
  });
  return { seen, api, stored };
}

test("a later session's write of the same key supersedes the earlier one: the view shows the chain closed, and the next session's facts name what they replaced", async (t) => {
  // the API stamps each write with its clock, so the clock is set per session
  t.mock.timers.enable({ apis: ["Date"], now: new Date(EARLIER) });
  const { api, stored } = supersedingMemory();
  const memory = createLearnerMemory(api, { salt: "pepper", conceptsOf: allOn("API") });
  // session 1 on API: 'Bigger group' to level 2, 7 guessed and 4 proved; then session 2 (above): to level 3, 'What it isn't' down to 1, 7 and 3
  await memory.remember("user_2leo", { ...finished, id: "s1", turn: 14, result: { ...finished.result!, score: 4, calibrationGap: 3, masteryChanges: [{ move: "supraordinate", from: 1, to: 2 }] } });
  t.mock.timers.setTime(new Date(AT).getTime());
  await memory.remember("user_2leo", finished);
  const iso = (at: string) => new Date(at).toISOString();
  const [rows] = [...stored.values()];
  // memory holds both rows of the key: the earlier one closed the instant the later one started, the later one naming it
  const chain = rows!.filter((entry) => entry.key === "level_supraordinate");
  assert.deepEqual(
    chain.map((entry) => [entry.validFrom, entry.validUntil, entry.supersedes]),
    [
      [iso(EARLIER), iso(AT), null],
      [iso(AT), null, chain[0]!.id],
    ],
  );
  // 13 rows: level_supraordinate twice, level_exclusion once, gap twice, each help_<move> twice; 6 of them replaced one
  assert.equal(rows!.length, 13);
  assert.equal(rows!.filter((entry) => entry.supersedes).length, 6);
  // the Memory sheet: the chain newest first, the old level closed when the new one started, with who read each row
  const view = await memory.view("user_2leo", ["API"], [[chain[0]!.id], [chain[0]!.id, chain[1]!.id]]);
  assert.deepEqual(view.concepts[0]?.moves[0], {
    move: "supraordinate",
    level: 3,
    history: [
      { level: 3, since: iso(AT), until: null, source: "upsert", writtenBy: "evaluator", readBy: 1 },
      { level: 2, since: iso(EARLIER), until: iso(AT), source: "upsert", writtenBy: "evaluator", readBy: 2 },
    ],
  });
  assert.deepEqual(view.concepts[0]?.moves[1], { move: "exclusion", level: 1, history: [{ level: 1, since: iso(AT), until: null, source: "upsert", writtenBy: "evaluator", readBy: 0 }] });
  assert.deepEqual(view.concepts[0]?.gap, {
    latest: { sessionId: "s2", at: iso(AT), predictedScore: 7, score: 3, gap: 4 },
    previous: { sessionId: "s1", at: iso(EARLIER), predictedScore: 7, score: 4, gap: 3 },
  });
  // a third session reads the current value of each key, with the id it replaced
  const third = await memory.recall("user_2leo", "API", "s3");
  const level = third?.facts.find((fact) => fact.move === "supraordinate" && fact.writtenBy === "evaluator");
  assert.deepEqual([level?.id, level?.level, level?.supersedes, level?.sessionId], [chain[1]!.id, 3, chain[0]!.id, "s2"]);
  assert.equal(third?.facts.length, 7);
  // session 2's own coach reads only what session 1 left, none of which replaced anything
  const own = await memory.recall("user_2leo", "API", "s2");
  assert.equal(own?.facts.length, 6);
  assert.ok(own?.facts.every((fact) => fact.sessionId === "s1" && fact.supersedes === undefined));
});

test("the view's chain is newest first whatever order memory lists the rows, a tie on since goes to the later row, and a row with less on it still reads", () => {
  const listed = [...rows].reverse();
  assert.deepEqual(viewOf("API", listed, readCountsOf([])), viewOf("API", rows, readCountsOf([])));
  assert.deepEqual(factsOf(listed, "API", "s3").map((fact) => fact.id), factsOf(rows, "API", "s3").map((fact) => fact.id));
  // two rows current from the same instant: the one memory created later is the current one
  const tie = [
    row("attr_iso_a", "level_isoordinate", "x", { ...s1, writer: "evaluator", move: "isoordinate", level: 2 }, { since: EARLIER }),
    { ...row("attr_iso_b", "level_isoordinate", "x", { ...s2, writer: "evaluator", move: "isoordinate", level: 3 }, { since: EARLIER }), createdAt: AT },
  ];
  assert.deepEqual(viewOf("API", tie, readCountsOf([])).moves[2]?.history.map((entry) => entry.level), [3, 2]);
  assert.equal(viewOf("API", [...tie].reverse(), readCountsOf([])).moves[2]?.level, 3);
  // a row with no validFrom starts at createdAt, a source kind the contract doesn't know reads as upsert, and a row with
  // no writer label is written by the agent whose work that kind of fact records
  const bare: MemoryRow = { id: "attr_bare", key: "level_infraordinate", value: "x", createdAt: AT, labels: ["session=s2", "level=4"], source: { kind: "something_new" } };
  assert.deepEqual(viewOf("API", [bare], readCountsOf([])).moves[3], { move: "infraordinate", level: 4, history: [{ level: 4, since: AT, until: null, source: "upsert", writtenBy: "evaluator", readBy: 0 }] });
  assert.equal(factOf(bare, "API")?.since, AT);
  // the read counts: one per agent call that received the row, whatever else the call received
  const counts = readCountsOf([["attr_sup1", "attr_gap1"], ["attr_sup1"], ["attr_sup2", "attr_sup1"], []]);
  assert.deepEqual([...counts], [["attr_sup1", 3], ["attr_gap1", 1], ["attr_sup2", 1]]);
  assert.deepEqual(viewOf("API", rows, counts).moves[0]?.history.map((entry) => entry.readBy), [1, 3]);
});

test("what one concept left never reaches another's agents: C# history stays out of a C++ session", async () => {
  const csharp = entityOf(pseudonymOf("user_2leo", ""), "C#").name;
  const read: string[] = [];
  const api: MemoryApi = {
    async registerScope() {},
    async write() {},
    async history(entity) {
      read.push(entity.name);
      return entity.name === csharp ? rows : [];
    },
    async forgetScope() {
      return 0;
    },
  };
  const memory = createLearnerMemory(api, { salt: "", conceptsOf: allOn("C#") });
  assert.equal(await memory.recall("user_2leo", "C++", "s9"), undefined);
  assert.ok(((await memory.recall("user_2leo", "C#", "s9"))?.facts.length ?? 0) > 0);
  // each read takes the concept's own name first, then the name before Oct 27 they shared
  assert.notEqual(read[0], read[2]);
  assert.deepEqual([read[1], read[3]], [`${pseudonymOf("user_2leo", "")}_c`, `${pseudonymOf("user_2leo", "")}_c`]);
});

test("the keys memory holds are level_<move>, gap and help_<move>, under an entity name any concept can take; a row under another key is never a fact", () => {
  // lowercase letters, digits and underscores only, so memory's own name rules (a dot folds to an underscore) change
  // nothing; a plain concept keeps the name it had before Oct 27, so the memory written under it stays its own
  for (const [concept, name] of [["Node.js", "node_js"], ["  CORS  ", "cors"], ["Env-Var 1", "env_var_1"], ["Rate  Limiting", "rate_limiting"], ["OAuth 2.0", "oauth_2_0"]] as const) {
    assert.equal(entityOf("a1b2c3d4", concept).name, `a1b2c3d4_${name}`);
  }
  // what the slug can't keep gets a hash of the concept: two concepts never share their history (code review, Oct 26)
  const names = ["C++", "C#", "C", "東京", "서울", "¿Qué es?", "!!!", "Environment Variable!"].map((concept) => entityOf("a1b2c3d4", concept).name);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.every((name) => /^a1b2c3d4_[a-z0-9_]+$/.test(name)), names.join(" "));
  assert.match(names[0]!, /^a1b2c3d4_c_[0-9a-f]{12}$/);
  assert.match(names[3]!, /^a1b2c3d4_concept_[0-9a-f]{12}$/);
  // the same concept, however it is cased or spaced, is the same entity
  assert.equal(entityOf("a1b2c3d4", " c++ ").name, names[0]);
  assert.equal(entityOf("a1b2c3d4", "Node.JS").name, entityOf("a1b2c3d4", "node.js").name);
  assert.deepEqual(
    factsToWrite(finished, AT).map((write) => write.key),
    ["level_supraordinate", "level_exclusion", "gap", "help_supraordinate", "help_exclusion", "help_isoordinate", "help_infraordinate"],
  );
  // a row is a fact only under one of those keys, with a part the method knows, and with the session that wrote it
  const labels = { ...s1, writer: "evaluator", level: 2 };
  assert.equal(factOf(row("attr_1", "level_spelling", "x", labels), "API"), null);
  assert.equal(factOf(row("attr_2", "help_", "x", labels), "API"), null);
  assert.equal(factOf(row("attr_3", "mood", "x", labels), "API"), null);
  assert.equal(factOf(row("attr_4", "gap", "x", { writer: "coach", predicted: 7, score: 3 }), "API"), null);
  // a gap fact has no part and no level, and names the gap it replaced
  const gap = factOf(rows[4]!, "API");
  assert.deepEqual([gap?.move, gap?.level, gap?.supersedes, gap?.writtenBy], [undefined, undefined, "attr_gap1", "coach"]);
});

test("with the flag off, memory that is set up still purges: what a learner left there while it was on goes with Delete my data (code review, Oct 28)", async () => {
  const vars = { AGENT_MEMORY_ENDPOINT: "https://m.example/", AGENT_MEMORY_CONTEXT: "c", AGENT_MEMORY_API_KEY: "k", LEARNER_ID_SALT: "pepper" };
  const config = { endpoint: "https://m.example", context: "c", apiKey: "k", salt: "pepper" };
  assert.deepEqual(memoryPurgeConfigFromEnv(vars), config);
  assert.deepEqual(memoryPurgeConfigFromEnv({ ...vars, AGENT_MEMORY_ENABLED: "false" }), config);
  // never set up, set up halfway, or an endpoint that isn't one: nothing to purge from
  assert.equal(memoryPurgeConfigFromEnv({}), null);
  assert.equal(memoryPurgeConfigFromEnv({ ...vars, AGENT_MEMORY_API_KEY: " " }), null);
  assert.equal(memoryPurgeConfigFromEnv({ ...vars, AGENT_MEMORY_ENDPOINT: "not a url" }), null);
  // the purge is the learner's scope under their pseudonym, as the full client's
  const forgotten: string[] = [];
  const api: MemoryApi = {
    async registerScope() {},
    async write() {},
    async history() {
      return [];
    },
    async forgetScope(path) {
      forgotten.push(path);
      return 3;
    },
  };
  await memoryPurgeOf(api, { salt: "pepper" })("user_2leo");
  assert.deepEqual(forgotten, [scopeOf(pseudonymOf("user_2leo", "pepper"))]);
});

test("a concept's history is the rows its own sessions wrote: C++'s rows from before Oct 27, under the name C still reads, stay out of C and still reach C++ (code review, Oct 28)", async () => {
  const p = pseudonymOf("user_2leo", "");
  const gap = (id: string, session: string, text: string) => row(id, "gap", text, { session, turn: 9, writer: "coach", predicted: 7, score: 2 });
  const stored = {
    // the name C++ and C# wrote under before Oct 27, and the one C writes under still
    [`${p}_c`]: [gap("attr_old_cpp", "old_cpp", "Last time on C++ pointers you guessed 7 and proved 2."), gap("attr_c", "c1", "Last time on C you guessed 7 and proved 2."), gap("attr_ghost", "gone", "Last time on ? you guessed 7 and proved 2.")],
    [entityOf(p, "C++").name]: [row("attr_new_cpp", "level_supraordinate", "You moved up to level 2 on 'Bigger group' for C++ on Oct 27.", { session: "new_cpp", turn: 9, writer: "evaluator", move: "supraordinate", level: 2 })],
  };
  const sessions = new Map([["old_cpp", "C++"], ["new_cpp", "c++"], ["c1", "C"]]);
  const asked: string[][] = [];
  const memory = createLearnerMemory(reading(stored), {
    salt: "",
    conceptsOf: async (_user, ids) => {
      asked.push([...ids].sort());
      return new Map(ids.flatMap((id) => (sessions.has(id) ? [[id, sessions.get(id)!] as const] : [])));
    },
  });
  assert.deepEqual((await memory.recall("user_2leo", "C", "s9"))?.facts.map((f) => f.id), ["attr_c"]);
  // the lookup is asked about the sessions the rows name, and a session the learner doesn't have counts for nothing
  assert.deepEqual(asked[0], ["c1", "gone", "old_cpp"]);
  assert.deepEqual((await memory.recall("user_2leo", "C++", "s9"))?.facts.map((f) => f.id), ["attr_new_cpp", "attr_old_cpp"]);
});

test("memory left on a concept the old name couldn't keep is still found: recalled, on the sheet, and on record before a write (code review, Oct 28)", async () => {
  const p = pseudonymOf("user_2leo", "");
  const old = `${p}_dijkstra_s_algorithm`;
  assert.notEqual(entityOf(p, "Dijkstra's algorithm").name, old);
  const stored = { [old]: [row("attr_lvl", "level_isoordinate", "You moved up to level 3 on 'What it needs' for Dijkstra's algorithm on Oct 24.", { session: "d1", turn: 12, writer: "evaluator", move: "isoordinate", level: 3 }, { since: EARLIER })] };
  const written: string[] = [];
  const memory = createLearnerMemory(reading(stored, written), { salt: "", conceptsOf: allOn("Dijkstra's algorithm") });
  assert.deepEqual((await memory.recall("user_2leo", "Dijkstra's algorithm", "d2"))?.facts.map((f) => f.id), ["attr_lvl"]);
  assert.equal((await memory.view("user_2leo", ["Dijkstra's algorithm"], [])).concepts[0]?.moves[2]?.level, 3);
  // 'What it needs' has its level on record already, so only 'Bigger group' gets a baseline
  const steady = (move: "supraordinate" | "isoordinate", level: Level) => ({ move, points: 1 as const, hints: 0, retries: 0, from: level, to: level });
  await memory.remember("user_2leo", { ...finished, id: "d2", concept: "Dijkstra's algorithm", result: { ...finished.result!, masteryChanges: [] }, moveLog: [steady("supraordinate", 1), steady("isoordinate", 3)] });
  assert.deepEqual(written.filter((key) => key.startsWith("level_")), ["level_supraordinate"]);
});

test("the Memory sheet shows a concept once however it was typed: CORS and cors are one history (code review, Oct 28)", async () => {
  const read: string[] = [];
  const api = reading({});
  api.history = async (entity) => {
    read.push(entity.name);
    return entity.name.endsWith("_cors") ? rows : [];
  };
  const memory = createLearnerMemory(api, { salt: "", conceptsOf: allOn("CORS") });
  const view = await memory.view("user_2leo", ["CORS", "cors", "JWT"], []);
  assert.deepEqual(view.concepts.map((c) => c.concept), ["CORS"]);
  assert.equal(read.filter((name) => name.endsWith("_cors")).length, 1);
});

test("the read before an agent keeps its budget with the session lookup in it: a lookup too slow leaves the agent without memory (code review, Oct 28)", async () => {
  const warnings: string[] = [];
  const slowLookup = () => new Promise<Map<string, string>>((resolve) => setTimeout(() => resolve(new Map([["s1", "API"], ["s2", "API"]])), 300));
  const memory = createLearnerMemory(reading({ [entityOf(pseudonymOf("user_2leo", ""), "API").name]: rows }), { salt: "", readMs: 30, warn: (m) => warnings.push(m), conceptsOf: slowLookup });
  const started = performance.now();
  assert.equal(await memory.recall("user_2leo", "API", "s9"), undefined);
  assert.ok(performance.now() - started < 250, "gave up at the budget");
  assert.match(warnings[0] ?? "", /memory read skipped after \d+ ms/);
});

test("transient fact failures stop after three tries per fact and release the learner", async () => {
  for (const failure of [new MemoryError(503, "unavailable"), new MemoryError(429, "limited"), new TypeError("network")]) {
    const api = reading({});
    let attempts = 0;
    api.write = async () => { attempts++; throw failure; };
    const memory = createLearnerMemory(api, { salt: "", conceptsOf: allOn("API") });
    const writes = learnerWrites();
    await assert.rejects(writes.run("u", stop => memory.remember("u", finished, stop)), /Memory fact writes failed/);
    assert.ok(attempts > 0 && attempts % 3 === 0);
    await writes.erase("u", async () => {});
    assert.equal(await writes.run("u", async () => "available"), "available");
  }
});

test("scope registration stops after three attempts", async () => {
  const api = reading({});
  let attempts = 0;
  api.registerScope = async () => { attempts++; throw new MemoryError(503, "unavailable"); };
  const memory = createLearnerMemory(api, { salt: "", conceptsOf: allOn("API") });
  await assert.rejects(memory.remember("u", finished), /unavailable/);
  assert.equal(attempts, 3);
});

test("one rejected fact does not prevent later facts", async () => {
  const api = reading({});
  let attempts = 0;
  api.write = async () => { if (++attempts === 1) throw new MemoryError(422, "bad fact"); };
  const memory = createLearnerMemory(api, { salt: "", conceptsOf: allOn("API") });
  await assert.rejects(memory.remember("u", finished), /bad fact/);
  assert.ok(attempts > 1);
});

test("an ambiguous fact ends when deletion stops retries", async () => {
  const api = reading({});
  const stop = new AbortController();
  let attempts = 0;
  api.write = async () => { attempts++; stop.abort(); throw new TypeError("network"); };
  const memory = createLearnerMemory(api, { salt: "", conceptsOf: allOn("API") });
  await assert.rejects(memory.remember("u", finished, stop.signal), /Memory fact writes failed/);
  assert.equal(attempts, 1);
});

test("a fact write that timed out as Delete my data began holds the purge one more write's time, so a late apply is purged too (code review, Oct 28)", async () => {
  const events: string[] = [];
  const held: string[] = [];
  const inFlight = Promise.withResolvers<void>();
  const timeOut = Promise.withResolvers<void>();
  const api = reading({});
  api.write = async (_scope, _labels, triples) => {
    if (triples[0]!.key !== "gap") return;
    inFlight.resolve();
    await timeOut.promise;
    // memory stops answering in time, and applies the write a little later anyway
    setTimeout(() => {
      held.push("gap");
      events.push("applied late");
    }, 20);
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  };
  api.forgetScope = async () => {
    events.push(`purge, ${held.length} held`);
    return held.splice(0).length;
  };
  const memory = createLearnerMemory(api, { salt: "", conceptsOf: allOn("API"), writeMs: 80 });
  const writes = learnerWrites();
  const remembering = writes.run("user_2leo", (stop) => memory.remember("user_2leo", finished, stop)).catch(() => {});
  await inFlight.promise;
  const erasing = writes.erase("user_2leo", async () => {
    await memory.purge("user_2leo");
    events.push("erased");
  });
  timeOut.resolve();
  await Promise.all([remembering, erasing]);
  assert.deepEqual(events, ["applied late", "purge, 1 held", "erased"]);
  assert.deepEqual(held, []);
});
