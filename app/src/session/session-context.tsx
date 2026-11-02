// The session the screens share: the transcript state plus what a learner can do (start, send, retry,
// and at level 5 edit their map). The rules live in transcript.ts; this file only wires them to the
// client. Starting a session replaces the one on screen; the server keeps every session, and GET /sessions lists
// them (`history`), so Your concepts offers unfinished sessions to resume and finished maps to review. The device
// keeps, per session, only what the server doesn't hold (saved.ts, storage.ts): the notes, the level-5 map and a
// guided answer not sent yet.
import type { CreateSessionBody, MemoryView, Mentefacto, MoveId, SessionSummary, TurnInput } from "@build-north/agents";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ClientError, type SessionClient } from "./client.ts";
import { createSavedSessions, savedOf } from "./saved.ts";
import { deviceStorage } from "./storage.ts";
import { arrived, drafted, failed, initialState, replayed, resendOf, sent, startedWith, typed, unsentOf, withRevealed, type SessionState } from "./transcript.ts";

/** What the learner can send: a /turns body without its `turn` number, which the provider adds. */
export type LearnerInput = Exclude<TurnInput, { action: "start" }>;

type SessionApi = {
  state: SessionState;
  offline: boolean;
  /** Starts a new session; resolves with an error message to show, or null when it started. */
  start(body: CreateSessionBody): Promise<string | null>;
  send(input: LearnerInput): void;
  retry(): void;
  /** Level 5: keeps the learner's map; `send({ mentefacto })` submits it. */
  edit(draft: Mentefacto): void;
  /** The guided answer field's words, not sent yet, on `move` of session `sessionId` (`typed` in transcript.ts). */
  type(sessionId: string, move: MoveId | null, text: string, edited?: boolean): void;
  /** The learner's sessions on the server, newest first (GET /sessions); null until the first read. Demo mode has none. */
  history: SessionSummary[] | null;
  /** Reads the list again (Start does when it is shown). Resolves with an error message, or null; undefined when a newer
   * read replaced this one, whose own answer is the one to show (code review, Oct 28). */
  refresh(): Promise<string | null | undefined>;
  /** The list as it is now, for a choice that depends on it (Start: go on with an unfinished session of the concept,
   * or start one): `history`, or a read of its own while there is none yet. Demo mode has none. */
  sessionsNow(): Promise<{ sessions: SessionSummary[] } | { error: string }>;
  /** Picks a session up from the server: unfinished, it goes on from its latest Turn, with the notes and the level-5
   * map this device kept; finished, its result shows again, read-only. Resolves with an error message to show, or
   * null when it is on screen. A session the server no longer has is forgotten. */
  resume(session: Pick<SessionSummary, "id" | "mode">): Promise<string | null>;
  /** Sign-out: the session on screen, the list and what the device kept all go, since the next learner on this
   * device isn't this one. */
  forget(): void;
  /** The delete button (#43): everything the server kept goes, and so does everything on this device.
   * Resolves with an error message to show, or null when it's done. */
  deleteData(): Promise<string | null>;
  /** The Memory sheet (#112): what Lumente remembers of this learner. Rejects with a ClientError. */
  memory(): Promise<MemoryView>;
};

const SessionContext = createContext<SessionApi | null>(null);

const messageOf = (error: unknown) => (error instanceof ClientError ? error.message : "Something went wrong. Try again.");
const retryableOf = (error: unknown) => (error instanceof ClientError ? error.retryable : true);
const CLEARED = "Your session changed while this was loading. Try again.";

export function SessionProvider({ client, children }: { client: SessionClient; children: ReactNode }) {
  const [state, setState] = useState<SessionState>(initialState);
  const [history, setHistory] = useState<SessionSummary[] | null>(null);
  const epoch = useRef(0);
  const listRequest = useRef(0);
  const saved = useRef<ReturnType<typeof createSavedSessions> | null>(null);
  if (saved.current === null) saved.current = createSavedSessions(deviceStorage);

  // the session on screen is kept as it moves (the level-5 map with it), and dropped once it is over
  useEffect(() => {
    if (client.offline || !state.turn) return;
    void saved.current!.keep(state.turn.sessionId, savedOf(state));
  }, [client, state]);

  const refresh = useCallback(async () => {
    if (client.offline) return null;
    const request = ++listRequest.current;
    try {
      const knownIds = await saved.current!.ids();
      const list = await client.list();
      if (request !== listRequest.current) return undefined;
      setHistory(list);
      // Don't prune a record created while this list request was in flight; the response can predate that session.
      const finishedIds = new Set(list.filter((session) => session.finished).map((session) => session.id));
      await saved.current!.prune(knownIds, finishedIds);
      return null;
    } catch (error) {
      if (request !== listRequest.current) return undefined;
      return messageOf(error);
    }
  }, [client]);

  const forget = () => {
    // Late reads must not put deleted data or a previous learner's session back on screen.
    epoch.current++;
    listRequest.current++;
    setState(initialState);
    setHistory(null);
    void saved.current!.clear();
  };

  const deliver = (body: Parameters<typeof sent>[1], retry: boolean) => {
    const sessionId = state.turn?.sessionId;
    if (!sessionId || state.pending) return;
    setState((s) => sent(s, body, retry));
    // a reply for a session no longer on screen (the learner started another, say before the coach's words
    // came) changes nothing, and neither does one for a body no longer waiting (`arrived`, `failed`)
    const same = (s: SessionState) => s.turn?.sessionId === sessionId;
    client.send(sessionId, body).then(
      (turn) => setState((s) => (same(s) ? arrived(s, body, turn) : s)),
      (error: unknown) => setState((s) => (same(s) ? failed(s, body, messageOf(error), retryableOf(error)) : s)),
    );
  };

  const api: SessionApi = {
    state,
    offline: client.offline,
    async start(body) {
      const version = ++epoch.current;
      try {
        const turn = await client.start(body);
        if (version !== epoch.current) return CLEARED;
        setState(startedWith(turn, body.mode, body.material ?? null));
        return null;
      } catch (error) {
        if (version !== epoch.current) return CLEARED;
        return messageOf(error);
      }
    },
    send(input) {
      if (state.turn) deliver({ turn: state.turn.turn, ...input }, false);
    },
    retry() {
      const body = resendOf(state);
      if (body) deliver(body, true);
    },
    edit(draft) {
      setState((s) => drafted(s, draft));
    },
    type(sessionId, move, text, edited) {
      setState((s) => typed(s, sessionId, move, text, edited));
    },
    history,
    refresh,
    async sessionsNow() {
      if (client.offline) return { sessions: [] };
      if (history) return { sessions: history };
      try {
        return { sessions: await client.list() };
      } catch (error) {
        return { error: messageOf(error) };
      }
    },
    async resume({ id, mode }) {
      const version = ++epoch.current;
      try {
        // the latest Turn says whether the session is still there (a 404 when it isn't); the steps bring its whole
        // conversation back, and without them (an older session, or an API from before they were kept) the latest
        // Turn shows alone
        const [turn, transcript] = await Promise.all([client.resume(id), client.transcript(id).catch(() => null)]);
        const kept = await saved.current!.get(id);
        if (version !== epoch.current) return CLEARED;
        // the server's map holds what Help revealed; the learner's own words come back from the device, the level-5 map
        // and an answer they hadn't sent yet with them
        const back = replayed(transcript?.steps ?? null, turn, mode, transcript?.material === undefined ? kept?.material ?? null : transcript.material);
        const answer = kept?.answer ?? null;
        setState({ ...(kept?.draft ? drafted(back, withRevealed(kept.draft, turn.mentefacto)) : back), answer: unsentOf({ ...back, answer }) ? answer : null });
        return null;
      } catch (error) {
        if (version !== epoch.current) return CLEARED;
        // deleted, over for longer than the server keeps it, or another learner's: it isn't coming back
        if (error instanceof ClientError && error.status === 404) {
          void saved.current!.keep(id, null);
          setHistory((list) => list?.filter((s) => s.id !== id) ?? null);
          return "That session is gone. Start a new one.";
        }
        return messageOf(error);
      }
    },
    forget,
    async deleteData() {
      try {
        await client.deleteData();
        forget();
        setHistory([]);
        return null;
      } catch (error) {
        return messageOf(error);
      }
    },
    memory: () => client.memory(),
  };

  return <SessionContext.Provider value={api}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionApi {
  const api = useContext(SessionContext);
  if (!api) throw new Error("useSession needs a SessionProvider above it");
  return api;
}
