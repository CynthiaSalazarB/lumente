// The session logic without a phone: the fixture replay (#6), the API client's requests and answers
// (#7), and what the transcript shows.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Turn, type TurnBody } from "@build-north/agents";
import sessionApi from "@build-north/agents/fixtures/session-api.json" with { type: "json" };
import sessionOne from "@build-north/agents/fixtures/session-1.json" with { type: "json" };
import { createApiClient } from "./api-client.ts";
import { ClientError } from "./client.ts";
import { createFixtureClient } from "./fixture-client.ts";
import { lastPartNoteOf, partClosingsOf, resultMessagesOf } from "./present.ts";
import { arrived, blankMap, drafted, echoFor, failed, initialState, partOf, received, replayed, resendOf, sent, startedWith, typed, unsentOf, withRevealed } from "./transcript.ts";

const fixtureTurns = sessionOne.map((step) => Turn.parse(step.turn));
const first = fixtureTurns[0]!;

test("a recovered submitted answer is shown only while its Turn still awaits it", () => {
  const asking = fixtureTurns.find((turn) => turn.expects === "text")!;
  const state = { ...startedWith(asking), answer: { move: partOf(asking), text: "Recovered", turn: asking.turn } };
  assert.equal(unsentOf(state), "Recovered");
  assert.equal(unsentOf({ ...state, turn: { ...asking, turn: asking.turn + 1 } }), "");
});

test("the fixture client clicks through the whole recorded API session, then stops", async () => {
  const client = createFixtureClient(0);
  let state = received(initialState, await client.start({ concept: "API" }));
  assert.equal(state.turn!.mentefacto.concept, "API");
  for (const step of sessionApi.slice(1)) {
    const body = { turn: state.turn!.turn, ...(step.input as object) } as TurnBody;
    state = sent(state, body);
    state = received(state, await client.send(state.turn!.sessionId, body));
  }
  assert.equal(state.turn!.expects, "none");
  assert.equal(state.turn!.result!.score, 5);
  await assert.rejects(client.send("x", { turn: 99, action: "continue" }), ClientError);
  // a second run is its own session to the screens, so the coach is asked again (demo mode's Try again)
  assert.notEqual((await client.start({ concept: "API" })).sessionId, state.turn!.sessionId);
});

test("the transcript adds a Turn's messages once, and echoes what the learner sent", () => {
  let state = received(initialState, first);
  assert.equal(state.entries.length, first.messages.length);
  state = sent(state, { turn: 1, text: "A form of government" });
  assert.deepEqual(state.entries.at(-1), { id: "learner-1", from: "learner", text: "A form of government" });
  // a resend or a 409 answers with the same Turn: nothing is added twice
  state = received(state, first);
  assert.equal(state.entries.length, first.messages.length + 1);
  assert.equal(echoFor({ turn: 3, action: "continue" }), null);
  // the guess has its own screen, so it isn't echoed
  assert.equal(echoFor({ turn: 1, prediction: 7 }), null);
});

test("the worked example's map joins the conversation once, ahead of its messages", () => {
  let state = initialState;
  for (const turn of fixtureTurns) state = received(state, turn);
  const at = state.entries.findIndex((e) => e.from === "map");
  const exampleTurn = fixtureTurns.find((t) => t.example)!;
  assert.equal(state.entries.filter((e) => e.from === "map").length, 1);
  assert.equal(state.entries[at + 1]!.id, `turn-${exampleTurn.turn}-0`);
});

test("the result comes first without the coach's words; the next Turn brings them, and the result's lines stay", () => {
  let state = initialState;
  for (const turn of fixtureTurns.slice(0, -1)) state = received(state, turn);
  assert.deepEqual([state.turn!.phase, state.turn!.expects, state.turn!.result!.coach], ["result", "continue", null]);
  const shown = resultMessagesOf(state.entries);
  state = received(state, fixtureTurns.at(-1)!);
  assert.equal(state.turn!.expects, "none");
  assert.deepEqual(resultMessagesOf(state.entries), [...shown, { agent: "coach", kind: "summary", text: state.turn!.result!.coach!.message }]);
});

test("every finished part keeps what closed it, so its area can open and be read again", () => {
  let state = initialState;
  for (const step of sessionApi) state = received(state, Turn.parse(step.turn));
  const closings = partClosingsOf(state.entries);
  const named = state.entries.filter((e) => e.from === "app" && e.message.kind === "named_move").length;
  // one closing per part that got its name, each the feedback on it or the answer shown
  assert.equal(Object.keys(closings).length, named);
  assert.ok(named >= 3);
  // the last part closes with the words the result Turn carried, the same ones lastPartNoteOf keeps
  assert.deepEqual(closings.infraordinate, { text: lastPartNoteOf(state.entries).infraordinate, revealed: false });
  // a session picked up with only its latest Turn has nothing from earlier parts
  assert.deepEqual(partClosingsOf(received(initialState, Turn.parse(sessionApi[0]!.turn)).entries), {});
});

test("the last answer's feedback, which comes with the result, is kept for the part the session asked last", () => {
  let state = initialState;
  for (const step of sessionApi) state = received(state, Turn.parse(step.turn));
  const words = state.entries.find((e) => e.from === "app" && e.phase === "result" && e.message.kind === "feedback");
  assert.ok(words && words.from === "app");
  assert.deepEqual(lastPartNoteOf(state.entries), { infraordinate: words.message.text });
  // a self-test's labeled notes are partNotesOf's, and a session with no result has nothing to keep
  const labeled = state.entries.map((e) => (e === words ? { ...words, message: { ...words.message, text: `Its types: ${words.message.text}` } } : e));
  assert.deepEqual(lastPartNoteOf(labeled), {});
  assert.deepEqual(lastPartNoteOf(received(initialState, first).entries), {});
});

test("an error Turn keeps the screen and offers to send the same body again, without echoing it twice", () => {
  const body = { turn: 1, prediction: 7 } as const;
  let state = sent(received(initialState, first), body);
  state = received(state, { ...first, error: { code: "agent_failed", retryable: true } });
  assert.deepEqual(state.failure, { message: "Something went wrong on our side.", retryable: true, body });
  assert.equal(state.pending, null);
  const before = state.entries.length;
  state = sent(state, body, true);
  assert.equal(state.entries.length, before);
  assert.equal(state.failure, null);
  assert.deepEqual(failed(state, body, "offline", true).failure, { message: "offline", retryable: true, body });
});

type Call = { url: string; init: RequestInit };
function fakeFetch(status: number, json: unknown) {
  const calls: Call[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

test("the API client posts the contract's bodies with the dev headers, and checks the Turn", async () => {
  const { fetch, calls } = fakeFetch(201, first);
  const client = createApiClient({ baseUrl: "http://api.test/", devUser: "tester", devKey: "k", fetch });
  assert.deepEqual(await client.start({ concept: "democracy" }), first);
  await client.send("ses_1", { turn: 1, prediction: 7 });
  assert.equal(calls[0]!.url, "http://api.test/sessions");
  assert.equal(calls[1]!.url, "http://api.test/sessions/ses_1/turns");
  assert.equal(calls[1]!.init.body, JSON.stringify({ turn: 1, prediction: 7 }));
  assert.deepEqual(calls[0]!.init.headers, { "content-type": "application/json", "x-dev-user": "tester", "x-dev-key": "k" });
});

test("a Clerk token goes instead of the dev headers", async () => {
  const { fetch, calls } = fakeFetch(201, first);
  await createApiClient({ baseUrl: "http://api.test", devUser: "tester", devKey: "k", getToken: async () => "tok", fetch }).start({ concept: "x" });
  assert.deepEqual(calls[0]!.init.headers, { "content-type": "application/json", authorization: "Bearer tok" });
});

test("an uncertain turn ends after one request and leaves retry to the learner", async () => {
  for (const status of [null, 503]) {
    let calls = 0;
    const fetch = (async () => {
      calls++;
      if (status === null) throw new TypeError("network");
      return Response.json({ error: "unavailable" }, { status });
    }) as typeof globalThis.fetch;
    await assert.rejects(createApiClient({ baseUrl: "http://api.test", fetch }).send("s1", { turn: 1, text: "answer" }), { retryable: true });
    assert.equal(calls, 1);
  }
});

test("a 409 with the latest Turn is drawn; other errors carry the server's message", async () => {
  assert.deepEqual(await createApiClient({ baseUrl: "http://api.test", fetch: fakeFetch(409, first).fetch }).send("s", { turn: 9, text: "x" }), first);

  const conflict = createApiClient({ baseUrl: "http://api.test", fetch: fakeFetch(409, { error: "This session is over" }).fetch });
  await assert.rejects(conflict.send("s", { turn: 9, text: "x" }), { message: "This session is over", retryable: false });

  const busy = createApiClient({ baseUrl: "http://api.test", fetch: fakeFetch(429, { error: "Too many requests" }).fetch });
  await assert.rejects(busy.send("s", { turn: 1, text: "x" }), { status: 429, retryable: true });

  const down = createApiClient({ baseUrl: "http://api.test", fetch: (async () => { throw new TypeError("network"); }) as unknown as typeof fetch });
  await assert.rejects(down.start({ concept: "x" }), { status: null, retryable: true });
});

test("a server that is broken or restarting, and a sign-in it refuses, get the learner's words, not the server's", async () => {
  // the API's own 500 line ends in "the cause is in the server logs", and a host's 502 page isn't JSON at all
  const broken = createApiClient({ baseUrl: "http://api.test", fetch: fakeFetch(500, { error: "Something went wrong; the cause is in the server logs" }).fetch });
  await assert.rejects(broken.send("s", { turn: 1, text: "x" }), { message: "The server hit a problem. Try again in a moment.", status: 500, retryable: true });
  const restarting = ((async () => new Response("<html>Bad Gateway</html>", { status: 502 })) as unknown) as typeof fetch;
  await assert.rejects(createApiClient({ baseUrl: "http://api.test", fetch: restarting }).start({ concept: "x" }), { message: "The server hit a problem. Try again in a moment.", status: 502, retryable: true });
  const refused = createApiClient({ baseUrl: "http://api.test", fetch: fakeFetch(401, { error: "Sign in first: send the Clerk session token as Authorization: Bearer <token>" }).fetch });
  await assert.rejects(refused.start({ concept: "x" }), { message: "The server didn't accept your sign-in. Sign out, then sign in again.", status: 401, retryable: false });
  // a 4xx with a message written for the learner keeps it
  const long = createApiClient({ baseUrl: "http://api.test", fetch: fakeFetch(413, { error: "Your notes are over 8,000 characters. Paste a shorter excerpt." }).fetch });
  await assert.rejects(long.start({ concept: "x", material: "…" }), { message: "Your notes are over 8,000 characters. Paste a shorter excerpt.", status: 413, retryable: false });
});

test("a session is picked up with GET /sessions/:id, and a 404 says it is gone for good", async () => {
  const { fetch, calls } = fakeFetch(200, first);
  const client = createApiClient({ baseUrl: "http://api.test", getToken: async () => "tok", fetch });
  assert.deepEqual(await client.resume("ses 1"), first);
  assert.equal(calls[0]!.url, "http://api.test/sessions/ses%201");
  assert.equal(calls[0]!.init.method, "GET");
  assert.equal(calls[0]!.init.body, undefined);
  assert.deepEqual(calls[0]!.init.headers, { authorization: "Bearer tok" });

  const gone = createApiClient({ baseUrl: "http://api.test", fetch: fakeFetch(404, { error: "No such session" }).fetch });
  await assert.rejects(gone.resume("ses_1"), { message: "No such session", status: 404, retryable: false });
  const odd = createApiClient({ baseUrl: "http://api.test", fetch: fakeFetch(200, { hello: "world" }).fetch });
  await assert.rejects(odd.resume("ses_1"), { message: /unexpected/, retryable: true });
  // demo mode keeps nothing to pick up
  await assert.rejects(createFixtureClient(0).resume("ses_1"), { retryable: false });
});

/** session-1 as the server saves it: the start with no body, then each answer and the Turn it got, numbered one after
 * another as saved Turns are (the fixture's own numbers skip some). */
const savedSteps = sessionOne.map((step, i) => ({ body: i === 0 ? null : ({ ...step.input, turn: i } as TurnBody), turn: { ...fixtureTurns[i]!, turn: i + 1 } }));

test("a session's steps are read with GET /sessions/:id/transcript and checked against the contract", async () => {
  const { fetch, calls } = fakeFetch(200, { steps: savedSteps });
  const client = createApiClient({ baseUrl: "http://api.test", getToken: async () => "tok", fetch });
  assert.deepEqual(await client.transcript("ses 1"), { steps: savedSteps });
  assert.equal(calls[0]!.url, "http://api.test/sessions/ses%201/transcript?material=1");
  assert.equal(calls[0]!.init.method, "GET");
  const gone = createApiClient({ baseUrl: "http://api.test", fetch: fakeFetch(404, { error: "Not found" }).fetch });
  await assert.rejects(gone.transcript("ses_1"), { status: 404 });
  const odd = createApiClient({ baseUrl: "http://api.test", fetch: fakeFetch(200, { steps: [{ body: null }] }).fetch });
  await assert.rejects(odd.transcript("ses_1"), { message: /unexpected/ });
  await assert.rejects(createFixtureClient(0).transcript("ses_1"), { retryable: false });
});

test("a session picked up again replays every saved step: the same conversation as on the screen that ran it", () => {
  // the screen that ran it: the start, then each body sent and its Turn received
  const ran = (upTo: number) => {
    let state = startedWith(savedSteps[0]!.turn, "learn", "my notes");
    for (const { body, turn } of savedSteps.slice(1, upTo)) state = received(sent(state, body!), turn);
    return state;
  };
  for (const upTo of [1, 4, savedSteps.length - 1]) {
    assert.deepEqual(replayed(savedSteps.slice(0, upTo), savedSteps[upTo - 1]!.turn, "learn", "my notes"), ran(upTo));
  }
  const live = ran(savedSteps.length);
  const back = replayed(savedSteps, savedSteps.at(-1)!.turn, "learn", "my notes");
  assert.deepEqual(back, live);
  // the learner's four typed answers are back with the questions around them (the guess and the taps aren't echoed)
  assert.equal(back.entries.filter((e) => e.from === "learner").length, 4);
  // every part's closing and the last part's note, which the result screen reads from the conversation, are back
  assert.deepEqual(partClosingsOf(back.entries), partClosingsOf(live.entries));
  assert.deepEqual(lastPartNoteOf(back.entries), lastPartNoteOf(live.entries));
});

test("resuming can recover original material without a device cache", async () => {
  const { fetch } = fakeFetch(200, { steps: savedSteps, material: "Original notes" });
  const client = createApiClient({ baseUrl: "http://api.test", fetch });
  assert.deepEqual(await client.transcript("s1"), { steps: savedSteps, material: "Original notes" });
});

test("an answer whose reply lands after the session was picked up again keeps the learner's words", () => {
  // the screen that sent it: the answer is echoed, then its reply arrives
  const before = replayed(savedSteps.slice(0, 4), savedSteps[3]!.turn);
  const { body, turn } = savedSteps[4]!;
  const live = arrived(sent(before, body!), body!, turn);
  assert.deepEqual(live, received(sent(before, body!), turn));
  // closed mid-answer, another concept opened, then Continue: the server didn't have the answer yet, so the
  // picked-up state stops at the question; the reply still in flight lands on it with the learner's words
  assert.deepEqual(arrived(before, body!, turn).entries, live.entries);
  assert.equal(arrived(before, body!, turn).pending, null);
  // picked up after the server saved it: the reply is already there, and nothing is added twice
  const after = replayed(savedSteps.slice(0, 5), turn);
  assert.deepEqual(arrived(after, body!, turn), after);
});

test("steps that miss a Turn, stop short of the latest one, or aren't there fall back to the latest Turn alone", () => {
  const latest = savedSteps[5]!.turn;
  const alone = startedWith(latest, "test", null);
  assert.deepEqual(replayed(null, latest, "test", null), alone);
  assert.deepEqual(replayed([], latest, "test", null), alone);
  assert.deepEqual(replayed([...savedSteps.slice(0, 2), ...savedSteps.slice(3, 6)], latest, "test", null), alone);
  assert.deepEqual(replayed(savedSteps.slice(0, 4), latest, "test", null), alone);
  // a session saved before Oct 25 kept steps from the deploy on only: not from its first Turn, so not replayed
  assert.deepEqual(replayed(savedSteps.slice(2, 6), latest, "test", null), alone);
});

test("a call that outlasts the timeout says so, and is worth trying again", async () => {
  const hangs = ((_: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as unknown as typeof fetch;
  await assert.rejects(createApiClient({ baseUrl: "http://api.test", fetch: hangs, timeoutMs: 5 }).start({ concept: "x" }), { message: /taking too long/, status: null, retryable: true });
});

test("the notes a session started with stay in its state, so Try again can send them", () => {
  const state = startedWith(first, "learn", "my notes");
  assert.equal(state.material, "my notes");
  assert.equal(received(sent(state, { turn: 1, prediction: 7 }), first).material, "my notes");
  assert.equal(startedWith(first).material, null);
  assert.equal(initialState.material, null);
});

test("the delete button sends DELETE /me/data with the credentials, no body, and takes the 204", async () => {
  const calls: Call[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(null, { status: 204 });
  }) as unknown as typeof globalThis.fetch;
  await createApiClient({ baseUrl: "http://api.test", getToken: async () => "tok", fetch }).deleteData();
  assert.equal(calls[0]!.url, "http://api.test/me/data");
  assert.equal(calls[0]!.init.method, "DELETE");
  assert.equal(calls[0]!.init.body, undefined);
  assert.deepEqual(calls[0]!.init.headers, { authorization: "Bearer tok" });

  const refused = createApiClient({ baseUrl: "http://api.test", fetch: fakeFetch(401, { error: "Sign in first" }).fetch });
  await assert.rejects(refused.deleteData(), { message: /sign in again/, status: 401, retryable: false });
  // demo mode has nothing to delete, and says nothing
  await createFixtureClient(0).deleteData();
});

/** A level-5 Turn: the whole map, as the orchestrator sends it after the guess. */
function wholeMap(over: Partial<Turn> = {}): Turn {
  return Turn.parse({
    sessionId: "ses_5",
    turn: 2,
    phase: "move",
    move: null,
    level: 5,
    messages: [{ agent: "app", kind: "question", text: "Build the mentefacto for CORS. Ask me any facts you need." }],
    expects: "map",
    scaffold: null,
    mentefacto: blankMap("CORS"),
    example: null,
    progress: { movesDone: 0, movesTotal: 4, hintsUsed: 0 },
    result: null,
    error: null,
    ...over,
  });
}

test("a self-test starts in test mode, and the learner's map stays on the phone until they submit", () => {
  let state = startedWith(wholeMap(), "test");
  assert.equal(state.mode, "test");
  assert.deepEqual(state.draft, blankMap("CORS"));
  const mine = { ...blankMap("CORS"), supraordinate: { value: "web security", note: null }, infraordinate: [{ value: "simple requests", note: null }] };
  state = drafted(state, mine);
  // a fact desk answer keeps the map as the learner left it
  state = received(sent(state, { turn: 2, question: "Does curl get blocked?" }), wholeMap({ turn: 3, messages: [{ agent: "fact_desk", kind: "fact", text: "No: browsers enforce it." }] }));
  assert.deepEqual(state.draft, mine);
  assert.equal(state.entries.at(-2)?.from, "learner");
});

test("an answer Help revealed joins the learner's map once: a bigger group replaces theirs, list items are added", () => {
  const mine = { ...blankMap("CORS"), supraordinate: { value: "web security", note: null }, infraordinate: [{ value: "simple requests", note: null }] };
  const server = {
    ...blankMap("CORS"),
    supraordinate: { value: "browser security mechanism", note: null },
    infraordinate: [{ value: "Simple Requests", note: null }, { value: "preflighted requests", note: null }],
  };
  const joined = withRevealed(mine, server);
  assert.deepEqual(joined.supraordinate, server.supraordinate);
  assert.deepEqual(joined.infraordinate.map((i) => i.value), ["simple requests", "preflighted requests"]);
  assert.deepEqual(withRevealed(joined, server), joined);
  // the learner's own map isn't changed in place
  assert.equal(mine.supraordinate.value, "web security");
});

test("the map goes once the result comes back, and only a level-5 Turn takes edits", () => {
  let state = startedWith(wholeMap());
  state = received(state, { ...wholeMap({ turn: 3, phase: "result", expects: "none" }), result: null });
  assert.equal(state.draft, null);
  assert.equal(drafted(state, blankMap("x")).draft, null);
  assert.equal(drafted(received(initialState, first), blankMap("x")).draft, null);
});

test("a retry sends the same body, except that a map goes as the learner has it now", () => {
  let state = startedWith(wholeMap());
  const before = { ...blankMap("CORS"), supraordinate: { value: "a browser rule", note: null } };
  state = drafted(state, before);
  const map = { turn: 2, mentefacto: before };
  state = failed(sent(state, map), map, "offline", true);
  assert.deepEqual(resendOf(state), { turn: 2, mentefacto: before });
  // the failure note says the map is saved, so a part fixed before Try again is what goes
  const fixed = { ...before, supraordinate: { value: "a browser security rule", note: null } };
  assert.deepEqual(resendOf(drafted(state, fixed)), { turn: 2, mentefacto: fixed });
  // a text answer goes as it was, and nothing goes without a retryable failure
  const answer = { turn: 1, text: "a rule" };
  const text = failed(sent(startedWith(first), answer), answer, "down", true);
  assert.deepEqual(resendOf(text), { turn: 1, text: "a rule" });
  assert.equal(resendOf(failed(sent(startedWith(first), answer), answer, "spent", false)), null);
  assert.equal(resendOf(state.failure ? { ...state, failure: null } : state), null);
});

test("a late, older Turn changes nothing: not the screen, the draft, the request waiting or the failure note", () => {
  const later = fixtureTurns[3]!;
  let state = received(initialState, later);
  state = sent(state, { turn: later.turn, text: "my answer" });
  const before = state;
  assert.equal(received(state, fixtureTurns[1]!), before);
});

test("an older answer's reply landing while a newer answer waits changes nothing, and the newer one shows once with its own reply (code review, Oct 26)", () => {
  const { body: older, turn: olderReply } = savedSteps[4]!;
  // picked up after the server saved the older answer; the learner has sent the next one
  const newer: TurnBody = { turn: olderReply.turn, text: "A kind of government." };
  const waiting = sent(replayed(savedSteps.slice(0, 5), olderReply), newer);
  // the older answer's reply, and its failure, late: the newer answer is still the one waiting
  assert.equal(arrived(waiting, older!, olderReply), waiting);
  assert.equal(failed(waiting, older!, "offline", true), waiting);
  const done = arrived(waiting, newer, { ...savedSteps[6]!.turn, turn: olderReply.turn + 1 });
  assert.equal(done.pending, null);
  assert.equal(done.entries.filter((e) => e.from === "learner" && e.text === "A kind of government.").length, 1);
});

test("a guided answer typed and not sent stays with its part, comes back on that part only, and goes once it is sent (code review, Oct 26)", () => {
  const asking = replayed(savedSteps.slice(0, 4), savedSteps[3]!.turn);
  const id = asking.turn!.sessionId;
  assert.deepEqual([asking.turn!.expects, partOf(asking.turn!)], ["text", "supraordinate"]);
  const typing = typed(asking, id, "supraordinate", "a kind of rule");
  assert.deepEqual(typing.answer, { move: "supraordinate", text: "a kind of rule" });
  assert.equal(unsentOf(typing), "a kind of rule");
  // the same words again change nothing; blank words keep nothing; another session's words don't land here
  assert.equal(typed(typing, id, "supraordinate", "a kind of rule"), typing);
  assert.equal(typed(typing, id, "supraordinate", "   ").answer, null);
  assert.equal(typed(asking, "another session", "supraordinate", "x"), asking);
  // a Turn on another part (a reveal moved on) doesn't show them
  assert.equal(unsentOf(received(typing, { ...savedSteps[6]!.turn, turn: 9 })), "");
  // an answer sent drops them, Help keeps them, and a reply put back after a pick-up leaves them alone
  assert.equal(sent(typing, { turn: 4, text: "a kind of rule" }).answer, null);
  assert.deepEqual(sent(typing, { turn: 4, action: "help" }).answer, typing.answer);
  const { body, turn } = savedSteps[4]!;
  assert.deepEqual(arrived(typing, body!, turn).answer, typing.answer);
});

test("a stalled token lookup times out without sending a request after the token eventually arrives", async () => {
  let token!: (value: string) => void;
  let calls = 0;
  const client = createApiClient({
    baseUrl: "http://api.test", timeoutMs: 10,
    getToken: () => new Promise<string>((resolve) => { token = resolve; }),
    fetch: (async () => { calls++; return Response.json(first); }) as typeof fetch,
  });
  const request = client.start({ concept: "x" });
  const release = setTimeout(() => token("late-token"), 60);
  try {
    await assert.rejects(request, { message: /taking too long/, status: null, retryable: true });
    token("late-token");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(calls, 0);
  } finally { clearTimeout(release); }
});

test("a fetch ignoring cancellation still times out before returning its headers", async () => {
  const client = createApiClient({
    baseUrl: "http://api.test", timeoutMs: 10,
    fetch: (() => new Promise(() => {})) as typeof fetch,
  });
  let guard!: ReturnType<typeof setTimeout>;
  const stalled = new Promise<never>((_, reject) => {
    guard = setTimeout(() => reject(new Error("request remained pending past its deadline")), 100);
  });
  try {
    await assert.rejects(Promise.race([client.start({ concept: "x" }), stalled]), { message: /taking too long/, status: null, retryable: true });
  } finally { clearTimeout(guard); }
});

test("a body that stalls after the headers ends as a slow answer when the timer fires", async () => {
  const stalled = (async () => ({ status: 200, ok: true, json: () => new Promise(() => {}) })) as unknown as typeof fetch;
  const client = createApiClient({ baseUrl: "http://api.test", fetch: stalled, timeoutMs: 30 });
  await assert.rejects(client.start({ concept: "x" }), (error: unknown) => error instanceof ClientError && error.retryable);
});

test("a fetch that answers after the timer fired, with a body that fails, ends as a slow answer instead of waiting forever", async () => {
  // a fetch that ignores the abort signal and answers late
  const late = (async () => {
    await new Promise((r) => setTimeout(r, 60));
    return { status: 200, ok: true, json: async () => { throw new Error("aborted"); } };
  }) as unknown as typeof fetch;
  const client = createApiClient({ baseUrl: "http://api.test", fetch: late, timeoutMs: 20 });
  await assert.rejects(client.start({ concept: "x" }), (error: unknown) => error instanceof ClientError && error.retryable);
});

test("an answer the server refused for good goes back to the field and leaves the conversation; one to try again stays sent (code review, Oct 28)", () => {
  const asking = fixtureTurns.find((t) => t.expects === "text" && t.phase === "move")!;
  const body = { turn: asking.turn, text: "x".repeat(2001) };
  const sending = sent(startedWith(asking), body);
  const refused = failed(sending, body, "Your answer is over 2,000 characters. Shorten it and send it again.", false);
  assert.deepEqual(refused.answer, { move: partOf(asking), text: body.text });
  assert.equal(unsentOf(refused), body.text);
  assert.equal(refused.entries.some((e) => e.from === "learner" && e.text === body.text), false);
  assert.equal(refused.failure?.retryable, false);
  // a failure Try again can fix keeps the answer as it went: the retry sends that body again
  const dropped = failed(sending, body, "No connection.", true);
  assert.equal(dropped.answer, null);
  assert.equal(typed(dropped, asking.sessionId, partOf(asking), "replacement"), dropped, "don't replace a body whose server outcome is uncertain");
  assert.equal(typed(dropped, asking.sessionId, partOf(asking), "replacement", true), dropped, "the explicit edit path is guarded too");
  const echo = dropped.entries.at(-1);
  assert.equal(echo?.from === "learner" ? echo.text : null, body.text);
});


test("typing after failed Help keeps the new answer", () => {
  const turn = { ...first, expects: "text" as const, phase: "move" as const, move: "supraordinate" as const };
  const body = { turn: turn.turn, action: "help" as const };
  const state = failed(sent(startedWith(turn), body), body, "offline", true);
  assert.equal(typed(state, turn.sessionId, turn.move, "new answer", true).answer?.text, "new answer");
});

test("session listing remains available", async () => {
  const { fetch, calls } = fakeFetch(200, { sessions: [] });
  assert.deepEqual(await createApiClient({ baseUrl: "http://api.test", fetch }).list(), []);
  assert.equal(calls[0]?.url, "http://api.test/sessions");
});
