import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test, type TestContext } from "node:test";
import { DemoSeed, MOVE_ORDER, Session as SessionSchema, advance, type CallAgent, type Level } from "@build-north/agents";
import demoSeed from "@build-north/agents/fixtures/demo-seed.json" with { type: "json" };
import { RecordId, Surreal } from "surrealdb";
import { advanceStub, callAgentStub } from "./advance-stub.ts";
import { createApp } from "./app.ts";
import { loadDemoSeed } from "./demo-seed.ts";
import { finishedTestSessions, sheetOf } from "./export-testers.ts";
import { createStore, defineSchema, initialSession } from "./store.ts";

// Needs a real SurrealDB and a root user, for example a local container:
//   docker run --rm -p 8000:8000 surrealdb/surrealdb:latest start --user root --pass <pass> memory
//   SURREAL_TEST_URL=ws://127.0.0.1:8000 SURREAL_TEST_USER=root SURREAL_TEST_PASS=<pass> npm test -w api
// It works in its own namespace (store_test) and empties it first. Never point it at the cloud.
const url = process.env.SURREAL_TEST_URL;

test("the store against a real SurrealDB", { skip: url ? false : "set SURREAL_TEST_URL to run it" }, async (t) => {
  const db = new Surreal();
  await db.connect(url!, {
    authentication: { username: process.env.SURREAL_TEST_USER ?? "root", password: process.env.SURREAL_TEST_PASS ?? "root" },
  });
  t.after(() => db.close());
  await db.query("REMOVE NAMESPACE IF EXISTS store_test; DEFINE NAMESPACE store_test; USE NS store_test; DEFINE DATABASE main;").collect();
  await db.use({ namespace: "store_test", database: "main" });
  await defineSchema(db);
  const store = createStore(db);

  await t.test("start keys survive concurrent API instances and a lost insert acknowledgement", { timeout: 10_000 }, async (st) => {
    let arrivals = 0;
    let release!: () => void;
    const bothInserting = new Promise<void>((resolve) => { release = resolve; });
    const concurrentStore = {
      ...store,
      async insertSession(session: Parameters<typeof store.insertSession>[0]) {
        if (++arrivals === 2) release();
        await bothInserting;
        await store.insertSession(session);
      },
    };
    const serve = async (backing: typeof store) => {
      const server = createApp({ corsOrigins: [], checkDb: null, store: backing, advance, callAgentFor: () => callAgentStub, userFromToken: null, devKey: "k", memory: null }).listen(0);
      st.after(() => server.close());
      await once(server, "listening");
      return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    };
    const left = await serve(concurrentStore);
    const right = await serve(concurrentStore);
    const headers = { "content-type": "application/json", "x-dev-user": "start-retry", "x-dev-key": "k", "idempotency-key": "concurrent-start" };
    const start = (api: string, key = headers["idempotency-key"]) => fetch(`${api}/sessions`, { method: "POST", headers: { ...headers, "idempotency-key": key }, body: JSON.stringify({ concept: "API" }) });
    const responses = await Promise.all([start(left), start(right)]);
    assert.deepEqual(responses.map((response) => response.status), [201, 201]);
    const turns = await Promise.all(responses.map((response) => response.json()));
    assert.deepEqual(turns[0], turns[1]);
    assert.equal(arrivals, 2); // both processes passed the initial read before either inserted
    assert.equal((await store.listSessions("start-retry")).length, 1);

    const ambiguous = await serve({
      ...store,
      async insertSession(session) {
        await store.insertSession(session);
        throw new Error("Database acknowledgement lost after commit");
      },
    });
    const committed = await start(ambiguous, "lost-acknowledgement");
    assert.equal(committed.status, 201);
    const first = await committed.json();
    const restarted = await serve(createStore(db));
    const replay = await start(restarted, "lost-acknowledgement");
    assert.equal(replay.status, 201);
    assert.deepEqual(await replay.json(), first);
    assert.equal((await store.listSessions("start-retry")).length, 2);
  });

  await t.test("initialized session insertion is atomic and never replaces an existing session", async () => {
    const fresh = { ...initialSession("atomic-start", { concept: "API", material: null, mode: "learn" }), id: "atomicstart", createdAt: new Date().toISOString() };
    const next = await advance({ session: fresh, mastery: await store.getMastery(fresh.user) }, { action: "start" }, callAgentStub);
    next.session.transcript.push({ body: null, turn: next.turn });
    await store.insertSession(next.session);
    const saved = (await store.getSession(fresh.user, fresh.id))!;
    assert.deepEqual(saved.lastTurn, next.turn);
    assert.deepEqual(saved.transcript, next.session.transcript);
    assert.equal((await store.listSessions(fresh.user)).length, 1);
    await assert.rejects(store.insertSession({ ...next.session, material: "must not overwrite" }));
    assert.deepEqual(await store.getSession(fresh.user, fresh.id), saved);
    await assert.rejects(store.insertSession({ ...fresh, id: "invalidstart" }), /matching first Turn/);
    assert.equal(await store.getSession(fresh.user, "invalidstart"), null);
  });

  await t.test("a session is written, read back by its owner only, and saved once per Turn", async () => {
    const session = await store.createSession("leo", { concept: "democracy", material: null, mode: "learn" });
    assert.match(session.id, /^[a-z0-9]+$/);
    assert.equal(session.turn, 0);
    assert.equal(await store.getSession("jonathan", session.id), null);
    assert.equal(await store.getSession("leo", "doesnotexist0000000"), null);

    const next = await advanceStub({ session, mastery: await store.getMastery("leo") }, { action: "start" }, callAgentStub);
    assert.equal(await store.saveSession(next.session, session.turn), true);
    const saved = await store.getSession("leo", session.id);
    assert.equal(saved?.turn, 1);
    assert.deepEqual(saved?.lastTurn, next.turn);
    assert.equal(saved?.createdAt, session.createdAt);
    // a second answer to Turn 0 lost the race: its save is refused and changes nothing
    assert.equal(await store.saveSession({ ...next.session, phase: "result" }, session.turn), false);
    assert.equal((await store.getSession("leo", session.id))?.phase, "predict");
    // what comes back from the database still fits Cynthia's Session schema, so `advance` can trust it
    assert.doesNotThrow(() => SessionSchema.parse(session));
    assert.doesNotThrow(() => SessionSchema.parse(saved));
  });

  await t.test("a turn claim admits one owner, can be renewed or reclaimed after expiry, and fences stale saves", async () => {
    const session = await store.createSession("turn-claim", { concept: "democracy", material: null, mode: "learn" });
    const claims = await Promise.all([
      store.claimTurn("turn-claim", session.id, session.turn, "claim-a"),
      store.claimTurn("turn-claim", session.id, session.turn, "claim-b"),
    ]);
    assert.deepEqual([...claims].sort((a, b) => (a ?? 0) - (b ?? 0)), [null, 1]);
    assert.equal((await store.getSession("turn-claim", session.id))?.turn, 0, "active lease fields stay out of the strict Session contract");
    const owner = claims[0] === 1 ? "claim-a" : "claim-b";
    const stale = owner === "claim-a" ? "claim-b" : "claim-a";
    assert.deepEqual(await store.turnClaimState("turn-claim", session.id, session.turn), { active: true });
    assert.equal(await store.renewTurnClaim("turn-claim", session.id, session.turn, owner), true);
    assert.equal(await store.renewTurnClaim("turn-claim", session.id, session.turn, stale), false);
    const next = await advanceStub({ session, mastery: await store.getMastery("turn-claim") }, { action: "start" }, callAgentStub);
    assert.equal(await store.saveSession(next.session, session.turn), false, "an unclaimed writer cannot clear an active lease");

    await db.query("UPDATE $id SET activeTurnClaimUntil = time::now() - 1s", { id: new RecordId("session", session.id) }).collect();
    assert.deepEqual(await store.turnClaimState("turn-claim", session.id, session.turn), { active: false });
    assert.equal(await store.claimTurn("turn-claim", session.id, session.turn, "recovered", true), 2);
    assert.deepEqual(await store.turnClaimState("turn-claim", session.id, session.turn), { active: true });
    assert.equal(await store.saveSession(next.session, session.turn, [], owner), false, "an expired owner cannot commit after reclamation");
    assert.equal(await store.saveSession(next.session, session.turn, [], "recovered"), true);
    assert.equal(await store.turnClaimState("turn-claim", session.id, session.turn), null, "a saved next Turn has no claim state for the old Turn");
    assert.equal((await store.getSession("turn-claim", session.id))?.turn, 1);
    assert.equal(await store.claimTurn("turn-claim", session.id, 1, "next-turn"), 1, "the next Turn gets a fresh first attempt");
  });

  await t.test("a waiting request takes a Turn over once, and the learner's next send claims it again, including after a store reconnect", async () => {
    const session = await store.createSession("turn-next-send", { concept: "democracy", material: null, mode: "learn" });
    const id = new RecordId("session", session.id);
    const expire = () => db.query("UPDATE $id SET activeTurnClaimUntil = time::now() - 1s", { id }).collect();
    assert.equal(await store.claimTurn("turn-next-send", session.id, session.turn, "first"), 1);
    await expire();
    assert.equal(await store.claimTurn("turn-next-send", session.id, session.turn, "one-recovery", true), 2);
    await expire();
    assert.equal(await createStore(db).claimTurn("turn-next-send", session.id, session.turn, "second-recovery", true), null);
    assert.equal(await createStore(db).claimTurn("turn-next-send", session.id, session.turn, "next-send"), 1, "earlier failures don't refuse a new send");
    assert.equal(await store.claimTurn("turn-next-send", session.id, session.turn, "while-held"), null, "the new send holds the lease");
  });

  // The routes over this database for one learner, with `call` answering for Claude.
  const routesFor = async (st: TestContext, call: CallAgent, user: string) => {
    const server = createApp({ corsOrigins: [], checkDb: null, store, advance, callAgentFor: () => call, userFromToken: null, devKey: "k", memory: null }).listen(0);
    st.after(() => server.close());
    await once(server, "listening");
    const api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return async (path: string, body: unknown) =>
      (await fetch(`${api}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-dev-user": user, "x-dev-key": "k" }, body: JSON.stringify(body) })).json();
  };
  const wholeMap = { concept: "API", supraordinate: { value: "interface", note: null }, exclusion: [{ value: "implementation", note: "different" }], isoordinate: [{ value: "contract", note: null }], infraordinate: [{ value: "web API", note: null }] };
  const evaluated = { rubric: MOVE_ORDER.map((move) => ({ move, quality: 2, feedback: "correct" })) };

  // Audit, Nov 2: the route-level case, through the real orchestrator and this database.
  await t.test("a provider outage that fails a Turn twice doesn't block the learner's next send", async (st) => {
    let outage = true;
    const calls: string[] = [];
    const send = await routesFor(st, async (agent) => {
      calls.push(agent);
      if (outage) throw new Error("temporary provider outage");
      if (agent === "evaluator_full") return evaluated;
      throw new Error(`unexpected agent ${agent}`);
    }, "outage");
    const first = await send("/sessions", { concept: "API", mode: "test" });
    const map = await send(`/sessions/${first.sessionId}/turns`, { turn: first.turn, prediction: 5 });
    assert.equal(map.expects, "map");
    for (let i = 0; i < 2; i++) {
      const failed = await send(`/sessions/${first.sessionId}/turns`, { turn: map.turn, question: "What is a protocol?" });
      assert.deepEqual([failed.turn, failed.error], [map.turn, { code: "agent_failed", retryable: true }]);
    }
    outage = false;
    const result = await send(`/sessions/${first.sessionId}/turns`, { turn: map.turn, mentefacto: wholeMap });
    assert.deepEqual([result.phase, result.error], ["result", null]);
    assert.deepEqual(calls, ["fact_desk", "fact_desk", "evaluator_full"]);
  });

  // Audit, Nov 2: the export parsed rows with the strict Session schema, which refused the lease fields a Turn leaves.
  await t.test("the tester export reads a test session the API finished, lease fields and all", async (st) => {
    const send = await routesFor(st, async (agent) => {
      if (agent === "evaluator_full") return evaluated;
      throw new Error(`unexpected agent ${agent}`);
    }, "exported");
    const first = await send("/sessions", { concept: "API", mode: "test" });
    const map = await send(`/sessions/${first.sessionId}/turns`, { turn: first.turn, prediction: 5 });
    assert.equal((await send(`/sessions/${first.sessionId}/turns`, { turn: map.turn, mentefacto: wholeMap })).phase, "result");
    const [lease] = await db
      .query("SELECT turnClaimFor, turnClaimAttempts FROM ONLY $id", { id: new RecordId("session", first.sessionId) })
      .json()
      .collect<[unknown]>();
    assert.deepEqual(lease, { turnClaimFor: map.turn, turnClaimAttempts: 1 }, "the finished row keeps the API's lease fields");
    const { rows } = sheetOf(await finishedTestSessions(db), "");
    assert.equal(rows.filter((row) => row.notes.endsWith(`session ${first.sessionId}`)).length, 1);
  });

  await t.test("a Turn's progress lands with its session or not at all, never lowers a stored level, and adds to the stored successes", async () => {
    const session = await store.createSession("climber", { concept: "democracy", material: null, mode: "learn" });
    const started = await advanceStub({ session, mastery: await store.getMastery("climber") }, { action: "start" }, callAgentStub);
    const exclusion = async () => (await store.getMastery("climber")).moves[1];
    assert.equal(await store.saveSession(started.session, session.turn, [{ move: "exclusion", level: 3, gained: 1 }]), true);
    assert.deepEqual(await exclusion(), { move: "exclusion", level: 3, unassistedSuccesses: 1 });
    // a save that loses the race brings no progress with it
    assert.equal(await store.saveSession({ ...started.session, phase: "result" }, session.turn, [{ move: "exclusion", level: 5, gained: 1 }]), false);
    assert.deepEqual(await exclusion(), { move: "exclusion", level: 3, unassistedSuccesses: 1 });
    // another session raised the level meanwhile: a Turn that read the older one can't take it back down
    await store.saveMastery("climber", { moves: [{ move: "exclusion", level: 4, unassistedSuccesses: 1 }] });
    const second = { ...started.session, turn: started.session.turn + 1 };
    assert.equal(await store.saveSession(second, started.session.turn, [{ move: "exclusion", level: 3, gained: 1 }]), true);
    assert.deepEqual(await exclusion(), { move: "exclusion", level: 4, unassistedSuccesses: 2 });
    // progress the database refuses (a level past 5) fails the whole save: the session stays where it was
    const third = { ...second, turn: second.turn + 1, phase: "result" as const };
    await assert.rejects(store.saveSession(third, second.turn, [{ move: "isoordinate", level: 9 as unknown as Level, gained: 0 }]), /level/);
    const kept = await store.getSession("climber", session.id);
    assert.deepEqual([kept?.turn, kept?.phase], [second.turn, second.phase]);
    assert.equal((await store.getMastery("climber")).moves[2]?.level, 1);
    // two sessions saving progress on the same move at once: the conflict runs one again, and both count
    const racing = await Promise.all(["one", "two"].map((concept) => store.createSession("racer", { concept, material: null, mode: "learn" })));
    const saves = await Promise.all(racing.map((s) => store.saveSession({ ...s, turn: 1 }, 0, [{ move: "infraordinate", level: 2, gained: 1 }])));
    assert.deepEqual(saves, [true, true]);
    assert.deepEqual((await store.getMastery("racer")).moves[3], { move: "infraordinate", level: 2, unassistedSuccesses: 2 });
  });

  await t.test("every field the orchestrator changes is saved, the fields it added to Session included", async () => {
    const session = await store.createSession("leo", { concept: "democracy", material: null, mode: "learn" });
    assert.deepEqual(session.transcript, []);
    const started = await advanceStub({ session, mastery: await store.getMastery("leo") }, { action: "start" }, callAgentStub);
    const changed: typeof session = {
      ...session,
      turn: 6,
      phase: "move",
      move: "exclusion",
      hintStep: "nudge",
      recent: [{ from: "app", text: "How is democracy different from monarchy?" }, { from: "learner", text: "Kings?" }],
      retries: 1,
      lastIssue: "too_broad",
      nextQuestion: { move: "isoordinate", level: 2, question: "What other kinds of government are there?", scaffold: null },
      questions: { asked: 1, testing: 0 },
      moveLog: [{ move: "supraordinate", points: 2, hints: 1, retries: 1, from: 2, to: 3 }],
      // the API's record of the conversation: the start (no body), then an answer and the Turn it got
      transcript: [
        { body: null, turn: started.turn },
        { body: { turn: 1, prediction: 5 }, turn: { ...started.turn, turn: 2 } },
      ],
    };
    assert.equal(await store.saveSession(changed, session.turn), true);
    assert.deepEqual(await store.getSession("leo", session.id), changed);
  });

  await t.test("a row that drifted from the contract fails as soon as the store reads it", async () => {
    const session = await store.createSession("leo", { concept: "drift", material: null, mode: "learn" });
    await db.query("UPDATE $id SET phase = 'lost'", { id: new RecordId("session", session.id) }).collect();
    await assert.rejects(store.getSession("leo", session.id));
  });

  await t.test("GET /sessions lists the user's sessions that have a Turn, newest first, finished or not, and nobody else's", async () => {
    const result = { predictedScore: 7, score: 3, maxScore: 8 as const, calibrationGap: 4, hintsUsed: 0, rubric: [], masteryChanges: [], questions: { asked: 0, testing: 0 }, coach: null };
    const first = await store.createSession("lister", { concept: "API", material: null, mode: "learn" });
    const started = await advanceStub({ session: first, mastery: await store.getMastery("lister") }, { action: "start" }, callAgentStub);
    assert.equal(await store.saveSession(started.session, first.turn), true);
    const second = await store.createSession("lister", { concept: "JWT", material: null, mode: "test" });
    const over = await advanceStub({ session: second, mastery: await store.getMastery("lister") }, { action: "start" }, callAgentStub);
    assert.equal(await store.saveSession({ ...over.session, phase: "result", result }, second.turn), true);
    // never started (the agent failed on the first Turn): nothing to show
    await store.createSession("lister", { concept: "CORS", material: null, mode: "learn" });
    await store.createSession("someone-else", { concept: "cache", material: null, mode: "learn" });

    const listed = await store.listSessions("lister");
    assert.deepEqual(listed, [
      { id: second.id, concept: "JWT", mode: "test", createdAt: second.createdAt, finished: true, score: 3, predictedScore: 7 },
      { id: first.id, concept: "API", mode: "learn", createdAt: first.createdAt, finished: false, score: null, predictedScore: null },
    ]);
    assert.deepEqual(await store.listSessions("nobody"), []);
    await store.deleteUserData("lister");
    await store.deleteUserData("someone-else");
  });

  await t.test("mastery starts at level 1 and saves all four moves", async () => {
    const fresh = await store.getMastery("cynthia");
    assert.deepEqual(fresh.moves.map((m) => m.level), [1, 1, 1, 1]);
    fresh.moves[1] = { move: "exclusion", level: 3, unassistedSuccesses: 1 };
    await store.saveMastery("cynthia", fresh);
    assert.deepEqual((await store.getMastery("cynthia")).moves[1], { move: "exclusion", level: 3, unassistedSuccesses: 1 });
  });

  await t.test("the schema refuses a level outside 1 to 5 and a mode it doesn't know", async () => {
    const bad = await store.getMastery("kyle");
    bad.moves[0] = { move: "supraordinate", level: 9 as 5, unassistedSuccesses: 0 };
    await assert.rejects(store.saveMastery("kyle", bad));
    await assert.rejects(store.createSession("kyle", { concept: "x", material: null, mode: "exam" as "test" }));
  });

  // Nov 2: Render deploys a merge while the previous release still serves, and a rollback runs that release on this
  // schema; its agent_log rows have none of the attempt fields.
  await t.test("the schema still takes the previous release's agent_log rows, and still refuses a bad attempt", async () => {
    const owner = await store.createSession("previous-release", { concept: "x", material: null, mode: "learn" });
    const row = { session: new RecordId("session", owner.id), user: "previous-release", agent: "questioner", input: {}, output: {}, ms: 1, usd: 0 };
    await db.query("CREATE agent_log CONTENT $row RETURN NONE", { row }).collect();
    await assert.rejects(db.query("CREATE agent_log CONTENT $row RETURN NONE", { row: { ...row, callId: "c", attempt: 0, outcome: "success", costStatus: "measured" } }).collect());
    await assert.rejects(db.query("CREATE agent_log CONTENT $row RETURN NONE", { row: { ...row, callId: "c", attempt: 1, outcome: "maybe", costStatus: "measured" } }).collect());
    await db.query("DELETE agent_log WHERE user = 'previous-release'").collect();
  });

  await t.test("the Memory sheet's two reads: the finished concepts, each once, and the fact ids each hint giver or coach call received", async () => {
    const result = { predictedScore: 7, score: 3, maxScore: 8 as const, calibrationGap: 4, hintsUsed: 0, rubric: [], masteryChanges: [], questions: { asked: 0, testing: 0 }, coach: null };
    const api1 = await store.createSession("reader", { concept: "API", material: null, mode: "learn" });
    const jwt = await store.createSession("reader", { concept: "JWT", material: null, mode: "learn" });
    const api2 = await store.createSession("reader", { concept: "API", material: null, mode: "learn" });
    await store.createSession("reader", { concept: "CORS", material: null, mode: "learn" });
    const theirs = await store.createSession("other", { concept: "cache", material: null, mode: "learn" });
    for (const s of [api1, jwt, api2, theirs]) assert.equal(await store.saveSession({ ...s, turn: 1, phase: "result", result }, s.turn), true);
    assert.deepEqual([...(await store.finishedConcepts("reader"))].sort(), ["API", "JWT"]);
    assert.deepEqual(await store.finishedConcepts("nobody"), []);

    const facts = (...ids: string[]) => ({ memory: { facts: ids.map((id) => ({ id })) } });
    const entry = (session: string, agent: string, input: unknown = {}, output: unknown = {}) => ({
      session, agent, input, output, ms: 1, usd: 0, callId: "test-call", attempt: 1,
      outcome: "success" as const, costStatus: "measured" as const,
    });
    const pending = {
      ...entry(api1.id, "coach", facts("in_flight_fact"), { status: "in_flight" }),
      user: "reader", ms: 0, usd: 0.324, callId: "pending-call", turn: 2, turnAttempt: 2,
      outcome: "started" as const, costStatus: "reserved" as const,
    };
    const pendingId = await store.beginAgentCall(pending);
    assert.equal((await store.memoryReads("reader")).some((ids) => ids.includes("in_flight_fact")), false);
    await store.finishAgentCall(pendingId, {
      ...pending, output: { question: "Which group?" }, ms: 12, usd: 0.014, outcome: "success", costStatus: "measured",
    });
    const finalizedRows = await db.query(
      "SELECT callId, attempt, turn, turnAttempt, outcome, costStatus, usd FROM agent_log WHERE id = $id",
      { id: new RecordId("agent_log", pendingId) },
    ).collect<[{ callId: string; attempt: number; turn: number; turnAttempt: number; outcome: string; costStatus: string; usd: number }[]]>();
    assert.deepEqual(finalizedRows[0], [{ callId: "pending-call", attempt: 1, turn: 2, turnAttempt: 2, outcome: "success", costStatus: "measured", usd: 0.014 }]);
    await store.logAgentCall({ ...entry(api1.id, "hint_giver", facts("attr_1", "attr_2"), { cites: ["attr_1"] }), dropped: ["attr_x"] });
    await store.logAgentCall(entry(api2.id, "coach", facts("attr_1")));
    await store.logAgentCall(entry(api2.id, "coach", { concept: "API" }));
    await store.logAgentCall(entry(api1.id, "questioner", facts("attr_9")));
    await store.logAgentCall(entry(theirs.id, "coach", facts("attr_8")));
    for (const [attempt, costStatus, usd] of [[1, "reserved", 0.324], [2, "measured", 0.014]] as const) {
      await store.logAgentCall({
        session: api1.id, user: "reader", agent: "questioner", input: {}, output: { error: "agent_failed" }, ms: 1, usd,
        callId: "retry-call", attempt, turn: 3, turnAttempt: 2, outcome: attempt === 1 ? "failed" : "success", costStatus,
      });
    }
    const attemptRows = await db.query(
      "SELECT callId, attempt, turn, turnAttempt, outcome, costStatus, usd FROM agent_log WHERE callId = 'retry-call' ORDER BY attempt",
    ).collect<[{ callId: string; attempt: number; turn: number; turnAttempt: number; outcome: string; costStatus: string; usd: number }[]]>();
    assert.deepEqual(attemptRows[0], [
      { callId: "retry-call", attempt: 1, turn: 3, turnAttempt: 2, outcome: "failed", costStatus: "reserved", usd: 0.324 },
      { callId: "retry-call", attempt: 2, turn: 3, turnAttempt: 2, outcome: "success", costStatus: "measured", usd: 0.014 },
    ]);
    const reads = (await store.memoryReads("reader")).sort((a, b) => b.length - a.length || a.join().localeCompare(b.join()));
    assert.deepEqual(reads, [["attr_1", "attr_2"], ["attr_1"], ["in_flight_fact"], []]);
    const [dropped] = await db.query("SELECT VALUE dropped FROM agent_log WHERE agent = 'hint_giver'").collect<[string[][]]>();
    assert.deepEqual(dropped, [["attr_x"]]);
    // the delete test below counts the whole agent_log table
    await store.deleteUserData("reader");
    await store.deleteUserData("other");
  });

  await t.test("the sessions memory rows name: the concept of each that is the learner's own, and nothing for the rest (code review, Oct 28)", async () => {
    const mine = await store.createSession("namer", { concept: "C++", material: null, mode: "learn" });
    const also = await store.createSession("namer", { concept: "C", material: null, mode: "test" });
    const theirs = await store.createSession("someone", { concept: "C", material: null, mode: "learn" });
    const concepts = await store.sessionConcepts("namer", [mine.id, theirs.id, "doesnotexist000", "Not an id!", mine.id, also.id]);
    assert.deepEqual([...concepts].sort(), [[mine.id, "C++"], [also.id, "C"]].sort());
    assert.equal((await store.sessionConcepts("namer", [])).size, 0);
    await store.deleteUserData("namer");
    await store.deleteUserData("someone");
  });

  await t.test("Delete my data removes the agent_log rows that name the learner, their session gone or not (code review, Oct 28)", async () => {
    const mine = await store.createSession("orphan", { concept: "API", material: null, mode: "learn" });
    const entry = (session: string, user: string) => ({
      session, user, agent: "coach", input: {}, output: {}, ms: 1, usd: 0, callId: "test-call", attempt: 1,
      outcome: "success" as const, costStatus: "measured" as const,
    });
    await store.logAgentCall(entry(mine.id, "orphan"));
    // rows that landed after their session went: a write the API stopped waiting for, applied late
    await store.logAgentCall({ ...entry("gone0000000000000000", "orphan"), agent: "evaluator" });
    await store.logAgentCall({ ...entry("gone0000000000000001", "stays"), agent: "evaluator" });
    await store.deleteUserData("orphan");
    const [left] = await db.query("SELECT VALUE user FROM agent_log WHERE user IN ['orphan', 'stays']").collect<[string[]]>();
    assert.deepEqual(left, ["stays"]);
    await db.query("DELETE agent_log WHERE user = 'stays'").collect();
  });

  await t.test("deleting a user's data removes their sessions, logs and mastery, and nobody else's", async () => {
    const mine = await store.createSession("delete-me", { concept: "inflation", material: "notes", mode: "test" });
    await store.logAgentCall({
      session: mine.id, agent: "fact_desk", input: { q: 1 }, output: { a: 2 }, ms: 120.4, usd: 0.0123,
      callId: "test-call", attempt: 1, outcome: "success", costStatus: "measured",
    });
    await store.saveMastery("delete-me", await store.getMastery("delete-me"));
    const theirs = await store.createSession("keep-me", { concept: "inflation", material: null, mode: "learn" });

    await store.deleteUserData("delete-me");
    const [counts] = await db
      .query(
        `RETURN {
           sessions: count(SELECT id FROM session WHERE user = "delete-me"),
           mastery: count(SELECT id FROM mastery WHERE user = "delete-me"),
           logs: count(SELECT id FROM agent_log)
         }`,
      )
      .collect<[{ sessions: number; mastery: number; logs: number }]>();
    assert.deepEqual(counts, { sessions: 0, mastery: 0, logs: 0 });
    assert.notEqual(await store.getSession("keep-me", theirs.id), null);
  });

  await t.test("the demo seed puts its user at level 5 on every move, with a CORS session the API carries on", async (st) => {
    const seed = DemoSeed.parse(demoSeed);
    const session = await loadDemoSeed(store, "demo");
    assert.deepEqual(await store.getMastery("demo"), seed.mastery);
    assert.deepEqual(await store.getSession("demo", session.id), session);

    // what the app gets when the demo user signs in, then the presenter's first question
    const fact = { kind: "fact", answer: "No. Browsers enforce CORS, and curl doesn't check it.", questionType: "breaking_case" };
    const server = createApp({ corsOrigins: [], checkDb: null, store, advance, callAgentFor: () => async () => fact, userFromToken: null, devKey: "k", memory: null }).listen(0);
    st.after(() => server.close());
    await once(server, "listening");
    const api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const headers = { "content-type": "application/json", "x-dev-user": "demo", "x-dev-key": "k" };
    const mastery = await (await fetch(`${api}/me/mastery`, { headers })).json();
    assert.deepEqual(mastery.moves.map((m: { level: number }) => m.level), [5, 5, 5, 5]);
    const waiting = await (await fetch(`${api}/sessions/${session.id}`, { headers })).json();
    assert.deepEqual(waiting, { ...seed.session.lastTurn, sessionId: session.id });
    const body = JSON.stringify({ turn: waiting.turn, question: seed.script.questions[0] });
    const next = await (await fetch(`${api}/sessions/${session.id}/turns`, { method: "POST", headers, body })).json();
    assert.deepEqual([next.turn, next.expects, next.messages], [3, "map", [{ agent: "fact_desk", kind: "fact", text: fact.answer }]]);
  });
});

test("a save whose transaction answers anything but true or false fails loudly instead of reading as a lost race (code review, Oct 28)", async () => {
  // what saveSession's chain gets back from the RETURN, as a server that places it elsewhere would answer
  const answering = (value: unknown) => {
    const chain = { json: () => chain, retry: () => chain, signal: () => chain, collect: async () => [value] };
    return { query: () => chain } as unknown as Surreal;
  };
  const session = { ...initialSession("leo", { concept: "API", material: null, mode: "learn" }), id: "s1", createdAt: "2026-10-28T10:00:00Z" };
  assert.equal(await createStore(answering(true)).saveSession(session, 0), true);
  assert.equal(await createStore(answering(false)).saveSession(session, 0), false);
  for (const value of [undefined, null, "true", [true], 1]) {
    await assert.rejects(createStore(answering(value)).saveSession(session, 0), /didn't answer whether it saved/);
  }
});
