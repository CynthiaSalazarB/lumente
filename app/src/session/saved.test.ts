// What the device keeps per session so a pick-up loses nothing: the record, its text form, what is read back from
// it, and the cache that keeps one entry per session.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Turn } from "@build-north/agents";
import sessionOne from "@build-north/agents/fixtures/session-1.json" with { type: "json" };
import { createSavedSessions, parseSaved, savedOf, type SavedSession, type SavedSessionStorage } from "./saved.ts";
import { blankMap, drafted, failed, initialState, received, sent, startedWith, typed, type SessionState } from "./transcript.ts";

const turns = sessionOne.map((step) => Turn.parse(step.turn));
const first = turns[0]!;

test("explicitly clearing a definitely rejected answer removes its recovery copy", () => {
  const asking = turns.find((turn) => turn.expects === "text")!;
  const body = { turn: asking.turn, text: "Remove this" };
  const lost = failed(sent(startedWith(asking), body), body, "Rejected", false);
  const cleared = typed(lost, asking.sessionId, asking.move, "", true);
  assert.equal(savedOf(cleared), null);
});

test("a truncated session list cannot delete an older draft", async () => {
  const { storage } = memoryStorage();
  const cache = createSavedSessions(storage);
  const old = record("older", null, { answer: { move: null, text: "still unfinished" } });
  await cache.keep("older", old);
  await cache.prune(await cache.ids(), new Set());
  assert.deepEqual(await cache.get("older"), old);
});

test("pending text survives a reload until the server acknowledges its Turn", () => {
  const asking = turns.find((turn) => turn.expects === "text")!;
  const body = { turn: asking.turn, text: "Keep my answer until acknowledged" };
  const kept = savedOf(sent(startedWith(asking), body));
  assert.equal(kept?.answer?.text, body.text);
  assert.equal((kept?.answer as { turn?: number })?.turn, asking.turn);
  assert.deepEqual(parseSaved(JSON.stringify(kept))[0]?.answer, kept?.answer);
});
const record = (sessionId: string, material: string | null = null, extra: Partial<SavedSession> = {}): SavedSession => ({ sessionId, material, draft: null, answer: null, ...extra });

test("a session on screen is kept with its notes; one that is over, none at all, or one with nothing to keep, is not", () => {
  assert.equal(savedOf(initialState), null);
  const learning = startedWith(first, "learn", "my notes");
  assert.deepEqual(savedOf(learning), record(first.sessionId, "my notes"));
  // no notes and no map: the server holds everything a pick-up needs
  assert.equal(savedOf(startedWith(first, "learn", null)), null);
  // the result with the coach's words is the end: nothing is left to pick up
  let over = initialState;
  for (const turn of turns) over = received(over, { ...turn });
  assert.equal(over.turn!.expects, "none");
  assert.equal(savedOf({ ...over, material: "my notes" }), null);
  // the result before the coach's words still waits for them, so it is kept
  let waiting: SessionState = { ...initialState, material: "my notes" };
  for (const turn of turns.slice(0, -1)) waiting = received(waiting, turn);
  assert.equal(savedOf(waiting)?.sessionId, first.sessionId);
});

test("at level 5 the learner's map goes with the record, and comes back from the text", () => {
  const level5 = Turn.parse({ ...first, turn: 2, phase: "move", level: 5, expects: "map", messages: [], mentefacto: blankMap("CORS") });
  const map = { ...blankMap("CORS"), supraordinate: { value: "a browser rule", note: null } };
  const state = drafted(startedWith(level5, "test"), map);
  const kept = savedOf(state)!;
  assert.deepEqual(kept, record(level5.sessionId, null, { draft: map }));
  assert.deepEqual(parseSaved(JSON.stringify(kept)), [kept]);
});

test("a guided answer typed and not sent goes with the record, even with no notes, and comes back from the text", () => {
  const asking = turns.find((turn) => turn.expects === "text" && turn.phase === "move")!;
  const state = typed(startedWith(asking), asking.sessionId, asking.move, "a kind of government");
  const kept = savedOf(state)!;
  assert.deepEqual(kept, record(asking.sessionId, null, { answer: { move: asking.move, text: "a kind of government" } }));
  assert.deepEqual(parseSaved(JSON.stringify(kept)), [kept]);
  // what isn't an unsent answer reads back as none
  for (const answer of [{ move: "bigger", text: "x" }, { move: null, text: "  " }, "text", 7]) {
    assert.equal(parseSaved(JSON.stringify({ ...kept, answer }))[0]?.answer, null);
  }
});

test("an answer with an uncertain server outcome stays with the record until retry or resume (code review, Oct 28)", () => {
  const asking = turns.find((turn) => turn.expects === "text" && turn.phase === "move")!;
  const body = { turn: asking.turn, text: "a kind of government" };
  const kept = { move: asking.move, text: "a kind of government", turn: asking.turn };
  const sending = sent(startedWith(asking), body);
  // Keep it until acknowledgement; its Turn number prevents restoring an answer already saved by the server.
  assert.deepEqual(savedOf(sending)?.answer, kept);
  // failed before a Turn came back: the server never got it, so it is kept as the part's unsent answer
  const lost = failed(sending, body, "No connection.", true);
  assert.deepEqual(savedOf(lost), record(asking.sessionId, null, { answer: kept }));
  // an agent's failure (an error Turn) keeps it the same way
  assert.deepEqual(savedOf(received(sending, { ...asking, error: { code: "agent_failed", retryable: true } }))?.answer, kept);
  // The answer field is locked during retry; an accidental edit can't replace a body the server may have accepted.
  assert.deepEqual(savedOf(typed(lost, asking.sessionId, asking.move, ""))?.answer, kept);
  assert.deepEqual(savedOf(typed(lost, asking.sessionId, asking.move, "a newer answer", true))?.answer, kept);
  // sent again, it is on its way once more
  assert.deepEqual(savedOf(sent(lost, body, true))?.answer, kept);
});

test("a definitely rejected answer becomes editable and clears when the learner changes it", () => {
  const asking = turns.find((turn) => turn.expects === "text")!;
  const body = { turn: asking.turn, text: "Rejected body" };
  const rejected = failed(sent(startedWith(asking), body), body, "The server rejected this answer.", false);
  const edited = typed(rejected, asking.sessionId, asking.move, "Replacement", true);
  assert.equal(edited.failure, null);
  assert.deepEqual(savedOf(edited)?.answer, { move: asking.move, text: "Replacement" });
});

test("anything that isn't a record reads back as nothing; the list kept before Oct 27 and the one record before Oct 24 read as records", () => {
  assert.deepEqual(parseSaved(null), []);
  assert.deepEqual(parseSaved(""), []);
  assert.deepEqual(parseSaved("{"), []);
  assert.deepEqual(parseSaved("42"), []);
  assert.deepEqual(parseSaved(JSON.stringify({ sessionId: "" })), []);
  assert.deepEqual(parseSaved(JSON.stringify([{ sessionId: "ses_1", draft: { concept: "API" } }, 7, null])), []);
  // the older shape kept the concept, the mode and the date too; what a record didn't say takes its empty value
  assert.deepEqual(parseSaved(JSON.stringify({ sessionId: "ses_1", concept: "API", mode: "learn", material: "notes", savedAt: "2026-10-23T18:30:00Z" })), [record("ses_1", "notes")]);
  assert.deepEqual(parseSaved(JSON.stringify([{ sessionId: "ses_1" }, { sessionId: "ses_2", material: 3 }])), [record("ses_1"), record("ses_2")]);
});

/** The device's storage as saved.ts sees it, in memory: one entry per session, plus the shared one from before. */
function memoryStorage(legacy: string | null = null) {
  const entries = new Map<string, string>();
  const shared = { text: legacy };
  const storage: SavedSessionStorage = {
    ids: async () => [...entries.keys()],
    read: async (id) => entries.get(id) ?? null,
    write: async (id, text) => {
      entries.set(id, text);
    },
    remove: async (id) => {
      entries.delete(id);
    },
    legacy: {
      read: async () => shared.text,
      remove: async () => {
        shared.text = null;
      },
    },
  };
  return { storage, entries, shared };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

test("two tabs keeping two sessions keep both: neither writes over the other's (code review, Oct 26)", async () => {
  const { storage } = memoryStorage();
  // each tab has its own cache, as each provider instance does, over the one storage the browser has
  const tabA = createSavedSessions(storage);
  const tabB = createSavedSessions(storage);
  const a = record("ses_a", null, { draft: { ...blankMap("API"), supraordinate: { value: "interface", note: null } } });
  const b = record("ses_b", null, { draft: { ...blankMap("CORS"), supraordinate: { value: "browser rule", note: null } } });
  await tabA.keep(a.sessionId, a);
  await tabB.keep(b.sessionId, b);
  for (const tab of [tabA, tabB]) {
    assert.deepEqual(await tab.get("ses_a"), a);
    assert.deepEqual(await tab.get("ses_b"), b);
    assert.deepEqual(await tab.ids(), new Set(["ses_a", "ses_b"]));
  }
  // a tab dropping its session leaves the other tab's alone
  await tabB.keep("ses_b", null);
  assert.deepEqual(await tabA.get("ses_a"), a);
  assert.equal(await tabA.get("ses_b"), null);
});

test("the records the shared entry kept before Oct 27 move to entries of their own, once, and a newer entry of the same session stays", async () => {
  const older = record("ses_old", "old notes");
  const stale = record("ses_both", "stale notes");
  const { storage, entries, shared } = memoryStorage(JSON.stringify([older, stale]));
  const newer = record("ses_both", "newer notes");
  entries.set(newer.sessionId, JSON.stringify(newer));
  const cache = createSavedSessions(storage);
  assert.deepEqual(await cache.get("ses_old"), older);
  assert.deepEqual(await cache.get("ses_both"), newer);
  assert.equal(shared.text, null);
  // a record under another session's entry is no record of this one
  entries.set("ses_x", JSON.stringify(record("ses_y")));
  assert.equal(await cache.get("ses_x"), null);
});

test("an update waits for the move out of the shared entry instead of racing it", async () => {
  const loading = deferred<string | null>();
  const older = record("ses_old", "old notes");
  const newer = record("ses_new", "new notes");
  const { storage, entries } = memoryStorage();
  const cache = createSavedSessions({ ...storage, legacy: { read: () => loading.promise, remove: storage.legacy.remove } });
  const ids = cache.ids();
  const update = cache.keep(newer.sessionId, newer);
  loading.resolve(JSON.stringify([older]));
  assert.deepEqual(await ids, new Set(["ses_old", "ses_new"]));
  await update;
  assert.deepEqual([...entries.keys()].sort(), ["ses_new", "ses_old"]);
});

test("a slow older write cannot overwrite a newer draft", async () => {
  const writes: { text: string; done: ReturnType<typeof deferred<void>> }[] = [];
  const firstStarted = deferred<void>();
  const secondStarted = deferred<void>();
  const { storage, entries } = memoryStorage();
  const cache = createSavedSessions({
    ...storage,
    write: (id, text) => {
      const done = deferred<void>();
      writes.push({ text, done });
      if (writes.length === 1) firstStarted.resolve();
      if (writes.length === 2) secondStarted.resolve();
      return done.promise.then(() => storage.write(id, text));
    },
  });
  const oldest = record("ses_map", null, { draft: { ...blankMap("CORS"), supraordinate: { value: "older", note: null } } });
  const last = { ...oldest, draft: { ...oldest.draft!, supraordinate: { value: "newer", note: null } } };
  const oldWrite = cache.keep(oldest.sessionId, oldest);
  const newWrite = cache.keep(last.sessionId, last);

  await firstStarted.promise;
  assert.equal(writes.length, 1);
  writes[0]!.done.resolve();
  await secondStarted.promise;
  assert.equal(writes.length, 2);
  writes[1]!.done.resolve();
  await Promise.all([oldWrite, newWrite]);
  assert.deepEqual(JSON.parse(entries.get("ses_map")!), last);
});

test("pruning on a session list keeps the unfinished sessions and the ones created after the list was asked for", async () => {
  const { storage } = memoryStorage();
  const cache = createSavedSessions(storage);
  await cache.keep("ses_done", record("ses_done", "notes"));
  await cache.keep("ses_going", record("ses_going", "notes"));
  const atRequest = await cache.ids();
  const startedWhileLoading = record("ses_new", "notes");
  await cache.keep(startedWhileLoading.sessionId, startedWhileLoading);
  await cache.prune(atRequest, new Set(["ses_done"]));
  assert.deepEqual(await cache.ids(), new Set(["ses_going", "ses_new"]));
});

test("clearing (sign-out, Delete my data) removes every session's entry and the shared one", async () => {
  const { storage, entries, shared } = memoryStorage(JSON.stringify([record("ses_old")]));
  const cache = createSavedSessions(storage);
  await cache.keep("ses_a", record("ses_a", "notes"));
  await cache.clear();
  assert.equal(entries.size, 0);
  assert.equal(shared.text, null);
  assert.deepEqual(await cache.ids(), new Set());
});
