// What the session screen shows, as pure functions of the Turns that came back: the conversation so
// far, the latest Turn, the call in flight, a failed call to retry and, at level 5, the map the learner
// is building. No React here, so it's tested under Node.
import { MOVE_ORDER, type Item, type Level, type Mentefacto, type Message, type MoveId, type Phase, type SessionMode, type TranscriptStep, type Turn, type TurnBody } from "@build-north/agents";

/** An app entry keeps the phase, part and level of the Turn it came with, so the screen can draw a
 * question with its stage, and leave the guess's own messages to the guess screen. A map entry is the
 * worked example's map (planet), which stays in the conversation after the example. */
export type Entry =
  | { id: string; from: "app"; message: Message; phase: Phase; move: MoveId | null; level: Level | null }
  | { id: string; from: "learner"; text: string }
  | { id: string; from: "map"; map: Mentefacto };

export type Failure = { message: string; retryable: boolean; body: TurnBody };

/** A guided answer typed and not sent yet, with the part it was typed on (null before the moves: the first explanation). */
export type Unsent = { move: MoveId | null; text: string; turn?: number };

export type SessionState = {
  /** The latest Turn: what the screen asks for next, the map, the progress. */
  turn: Turn | null;
  entries: Entry[];
  /** The body in flight. Send stays disabled while it's set (decision 18). */
  pending: TurnBody | null;
  failure: Failure | null;
  /** "test" for a self-test (the testers' pre-test and post-test): every part at level 5. */
  mode: SessionMode;
  /** The notes the session started with (pasted text), so Try again on the result keeps them. The Turn doesn't
   * carry them back. */
  material: string | null;
  /** Level 5: the learner's map, kept on the phone until they submit it (`expects: "map"`). */
  draft: Mentefacto | null;
  /** The guided answer field's words while they're unsent, so Save and close keeps them (`typed`). */
  answer: Unsent | null;
};

export const initialState: SessionState = { turn: null, entries: [], pending: null, failure: null, mode: "learn", material: null, draft: null, answer: null };

/** A session that just started, in learn or test mode, with the notes it was given. */
export const startedWith = (turn: Turn, mode: SessionMode = "learn", material: string | null = null): SessionState => received({ ...initialState, mode, material }, turn);

/** A session picked up again, with the whole conversation it had: the steps the server saved are sent and received
 * again, as they were on the screen that ran them. Only when they run from the first Turn to `latest` with none
 * missing; otherwise (a session saved before Oct 25, an API without the steps) the latest Turn alone, as before. */
export function replayed(steps: readonly TranscriptStep[] | null, latest: Turn, mode: SessionMode = "learn", material: string | null = null): SessionState {
  const whole = !!steps?.length && steps.every((step, i) => step.turn.turn === i + 1) && steps.at(-1)!.turn.turn === latest.turn;
  if (!whole) return startedWith(latest, mode, material);
  return steps.reduce((state, { body, turn }) => received(body ? sent(state, body) : state, turn), { ...initialState, mode, material });
}

/** The learner's side of the conversation, as it shows in the transcript. The guess has its own
 * screen and comes back on the result, and Help shows as the hint card it brings, so neither is echoed. */
export function echoFor(body: TurnBody): string | null {
  if ("text" in body) return body.text;
  if ("question" in body) return body.question;
  if ("mentefacto" in body) return "Here's my map.";
  return null;
}

/** The learner sent `body`. A retry sends the same body again without echoing it twice. An answer sent is no longer
 * an unsent one. */
export function sent(state: SessionState, body: TurnBody, retry = false): SessionState {
  const echo = retry ? null : echoFor(body);
  const entries = echo === null ? state.entries : [...state.entries, { id: `learner-${state.entries.length}`, from: "learner" as const, text: echo }];
  return { ...state, entries, pending: body, failure: null, answer: "text" in body ? null : state.answer };
}

/** The part a Turn asks about, as an unsent answer records it: its move, or null before the moves. */
export const partOf = (turn: Turn): MoveId | null => (turn.phase === "move" ? turn.move : null);

/** The learner's words in the guided answer field, not sent yet, on `move` of session `sessionId`: kept so Save and close
 * keeps them, and they come back on that part only (a reveal moves the session to the next part before the field
 * goes). Blank words keep nothing. The same state comes back when nothing changed (code review, Oct 26). */
export function typed(state: SessionState, sessionId: string, move: MoveId | null, text: string, edited = false): SessionState {
  if (state.turn?.sessionId !== sessionId || state.turn.expects !== "text") return state;
  // A retryable failure may already have reached the server; only retry its exact body until the latest Turn is known.
  if ((state.failure?.retryable && "text" in state.failure.body)) return state;
  const answer = text.trim() ? { move, text } : null;
  // An explicit edit replaces the failed submission; passive field cleanup after Send does not.
  if (edited) return { ...state, answer, failure: null };
  return answer?.text === state.answer?.text && answer?.move === state.answer?.move ? state : { ...state, answer };
}

/** The unsent words for the part the latest Turn asks about, or "" when there are none for it. */
export const unsentOf = (state: SessionState): string =>
  state.turn?.expects === "text" && state.answer && state.answer.move === partOf(state.turn) && (state.answer.turn === undefined || state.answer.turn === state.turn.turn) ? state.answer.text : "";

/** A Turn came back. Only a newer Turn adds messages: a resend, a 409 or an error Turn repeats the
 * latest one, which is already on screen. */
export function received(state: SessionState, turn: Turn): SessionState {
  // An older Turn is a late answer (the session was picked up again, or moved on meanwhile): it changes nothing,
  // not the screen, the draft, the request waiting or the failure note.
  if (state.turn && turn.turn < state.turn.turn) return state;
  const isNew = turn.turn > (state.turn?.turn ?? 0);
  // one worked example per session: its map goes in once, ahead of its messages
  const example =
    isNew && turn.example && !state.entries.some((e) => e.from === "map") ? [{ id: `turn-${turn.turn}-map`, from: "map" as const, map: turn.example }] : [];
  const entries = isNew
    ? [
        ...state.entries,
        ...example,
        ...turn.messages.map((message, i) => ({
          id: `turn-${turn.turn}-${i}`,
          from: "app" as const,
          message,
          phase: turn.phase,
          move: turn.move,
          level: turn.level,
        })),
      ]
    : state.entries;
  // An agent failed (CONTRACTS.md section 5): nothing moved on, and the same body can be sent again.
  const failure =
    turn.error && state.pending
      ? { message: turn.error.code === "rate_limited" ? "Too many requests right now. Wait a moment and try again." : "Something went wrong on our side.", retryable: turn.error.retryable, body: state.pending }
      : null;
  // The map stays the learner's while they build it; an answer Help revealed joins it.
  const draft = turn.expects === "map" ? withRevealed(state.draft ?? blankMap(turn.mentefacto.concept), turn.mentefacto) : null;
  return { ...state, turn, entries, pending: null, failure, draft };
}

/** The Turn that answers `body` came back. If the session was picked up again while it was on its way (closed
 * mid-answer, another concept opened, then Continue), the state came from the server before this answer was saved,
 * so the learner's words go back in ahead of the reply. A reply the picked-up state already holds adds nothing, and
 * a reply to a body that isn't the one waiting (an answer sent before the pick-up, while a newer one is on its way)
 * changes nothing: the newer answer's own reply brings the latest Turn (code review, Oct 26). */
export function arrived(state: SessionState, body: TurnBody, turn: Turn): SessionState {
  if (state.pending !== null && state.pending !== body) return state;
  const echoLost = state.pending === null && turn.turn > (state.turn?.turn ?? 0);
  // the echo put back is an answer sent long ago: it leaves the words the learner is typing now alone
  return received(echoLost ? { ...sent(state, body), answer: state.answer } : state, turn);
}

/** The call that sent `body` failed before any Turn came back. A newer body on its way stays on its way. An answer the
 * server refused for good (over the length limit, say) was never judged: it leaves the conversation and goes back to the
 * field as the part's unsent answer, so the learner can change it and send it again (code review, Oct 28). */
export function failed(state: SessionState, body: TurnBody, message: string, retryable: boolean): SessionState {
  if (state.pending !== body) return state;
  const next = { ...state, pending: null, failure: { message, retryable, body } };
  if (retryable || !("text" in body) || !state.turn) return next;
  // its echo is the last entry: nothing else joins the conversation while an answer is on its way
  const last = state.entries.at(-1);
  const entries = last?.from === "learner" && last.text === body.text ? state.entries.slice(0, -1) : state.entries;
  return { ...next, entries, answer: { move: partOf(state.turn), text: body.text } };
}

/** The body to send again after a failure: the same one, except that a map goes as the learner has it now, since
 * the failure note says their map is saved and they may have fixed a part before trying again. */
export function resendOf(state: SessionState): TurnBody | null {
  const { failure, draft } = state;
  if (!failure?.retryable) return null;
  return "mentefacto" in failure.body && draft ? { ...failure.body, mentefacto: draft } : failure.body;
}

/** The learner changed their map (level 5). Nothing is sent until they submit it. */
export function drafted(state: SessionState, draft: Mentefacto): SessionState {
  return state.turn?.expects === "map" ? { ...state, draft } : state;
}

export const blankMap = (concept: string): Mentefacto => ({ concept, supraordinate: null, exclusion: [], isoordinate: [], infraordinate: [] });

const sameValue = (a: Item, b: Item) => a.value.trim().toLowerCase() === b.value.trim().toLowerCase();

/** At level 5 the server's map only holds what Help revealed (CONTRACTS.md section 3), so those items
 * join the learner's map: a revealed bigger group replaces theirs, revealed list items are added. */
export function withRevealed(draft: Mentefacto, server: Mentefacto): Mentefacto {
  const next: Mentefacto = { ...draft, exclusion: [...draft.exclusion], isoordinate: [...draft.isoordinate], infraordinate: [...draft.infraordinate] };
  if (server.supraordinate && !(draft.supraordinate && sameValue(draft.supraordinate, server.supraordinate))) next.supraordinate = server.supraordinate;
  for (const move of MOVE_ORDER) {
    if (move === "supraordinate") continue;
    for (const item of server[move]) if (!next[move].some((mine) => sameValue(mine, item))) next[move].push(item);
  }
  return next;
}
