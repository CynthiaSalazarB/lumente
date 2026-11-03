// What the device keeps per session so picking it up loses nothing the server doesn't hold: the notes it started
// with (the Turn doesn't carry them back), at level 5 the map the learner is building, and a guided answer typed but
// not sent. Which sessions exist, and which are unfinished, comes from the server (GET /sessions), so one record per
// session is kept here, each in an entry of its own keyed by the session's id: two tabs on two sessions write two
// entries, never one over the other (code review, Oct 26). Pure, so it's tested under Node; storage.ts reads and writes
// the text.
import { Mentefacto, MoveId } from "@build-north/agents";
import { partOf, type SessionState, type Unsent } from "./transcript.ts";

export type SavedSession = {
  sessionId: string;
  material: string | null;
  draft: Mentefacto | null;
  answer: Unsent | null;
};

/** What to keep for the session on screen: null before one starts, once it is over (the result and the coach's
 * words are both in), and when it has nothing the server doesn't hold. */
export function savedOf(state: SessionState): SavedSession | null {
  const { turn } = state;
  const answer = unsentAnswerOf(state);
  if (!turn || turn.expects === "none" || (state.material === null && state.draft === null && answer === null)) return null;
  return { sessionId: turn.sessionId, material: state.material, draft: state.draft, answer };
}

/** The guided answer to keep: the words typed and not sent, or else an answer that was sent and failed. The server never
 * got that one and the failure note says it's saved, so a pick-up puts it back in the field (code review, Oct 28). */
function unsentAnswerOf({ answer, failure, pending, turn }: SessionState): Unsent | null {
  if (answer) return answer;
  const body = pending ?? failure?.body;
  return body && turn && "text" in body ? { move: partOf(turn), text: body.text, turn: body.turn } : null;
}

function unsentOf(value: unknown): Unsent | null {
  if (!value || typeof value !== "object") return null;
  const { move, text, turn } = value as Record<string, unknown>;
  if (typeof text !== "string" || !text.trim() || (move !== null && !MoveId.safeParse(move).success)) return null;
  if (turn !== undefined && (typeof turn !== "number" || !Number.isSafeInteger(turn) || turn < 1)) return null;
  return { move: move as MoveId | null, text, ...(turn === undefined ? {} : { turn: turn as number }) };
}

/** The records an entry holds: one (an entry per session, since Oct 27), the list every session shared before (since
 * Oct 24), or the one record kept before that; anything that isn't a record is dropped (a stray file, a map that
 * isn't one, no file). */
export function parseSaved(text: string | null): SavedSession[] {
  if (!text) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  const items = Array.isArray(raw) ? raw : [raw];
  return items.flatMap((item): SavedSession[] => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const draft = record.draft === null || record.draft === undefined ? { success: true as const, data: null } : Mentefacto.safeParse(record.draft);
    if (typeof record.sessionId !== "string" || !record.sessionId || !draft.success) return [];
    return [{ sessionId: record.sessionId, material: typeof record.material === "string" ? record.material : null, draft: draft.data, answer: unsentOf(record.answer) }];
  });
}

/** One entry per session. */
export type SavedSessionStorage = {
  /** The ids of the sessions that have an entry. */
  ids: () => Promise<string[]>;
  read: (sessionId: string) => Promise<string | null>;
  write: (sessionId: string, text: string) => Promise<void>;
  remove: (sessionId: string) => Promise<void>;
  /** The one entry every session shared before Oct 27: read once, its records moved to entries of their own, removed. */
  legacy: { read: () => Promise<string | null>; remove: () => Promise<void> };
};

export type SavedSessions = {
  ids: () => Promise<Set<string>>;
  get: (sessionId: string) => Promise<SavedSession | null>;
  keep: (sessionId: string, record: SavedSession | null) => Promise<void>;
  prune: (knownIds: ReadonlySet<string>, finishedIds: ReadonlySet<string>) => Promise<void>;
  clear: () => Promise<void>;
};

/** Orders this tab's use of the device cache: the move out of the old shared entry first, then every update in turn,
 * so a slow older write of a session can't land over a newer one. */
export function createSavedSessions(storage: SavedSessionStorage): SavedSessions {
  let ready: Promise<void> | null = null;
  let writes: Promise<void> = Promise.resolve();

  // what the shared entry held moves to entries of its own, except where a session has one already (written since)
  const migrate = async () => {
    const legacy = await storage.legacy.read();
    if (legacy === null) return;
    const have = new Set(await storage.ids());
    for (const record of parseSaved(legacy)) if (!have.has(record.sessionId)) await storage.write(record.sessionId, JSON.stringify(record));
    await storage.legacy.remove();
  };
  const load = () => (ready ??= migrate().catch(() => {}));
  const settled = async () => {
    await load();
    await writes;
  };

  function update(change: () => Promise<void>) {
    const write = writes.then(async () => {
      await load();
      await change();
    });
    writes = write.catch(() => {});
    return write;
  }

  return {
    async ids() {
      await settled();
      return new Set(await storage.ids());
    },
    async get(sessionId) {
      await settled();
      return parseSaved(await storage.read(sessionId)).find((record) => record.sessionId === sessionId) ?? null;
    },
    keep: (sessionId, record) => update(() => (record ? storage.write(sessionId, JSON.stringify(record)) : storage.remove(sessionId))),
    prune: (knownIds, finishedIds) =>
      update(async () => {
        for (const id of await storage.ids()) if (knownIds.has(id) && finishedIds.has(id)) await storage.remove(id);
      }),
    clear: () =>
      update(async () => {
        for (const id of await storage.ids()) await storage.remove(id);
        await storage.legacy.remove();
      }),
  };
}
