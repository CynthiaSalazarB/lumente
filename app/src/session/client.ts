// How the app moves a session forward (CONTRACTS.md section 1). Two clients share this shape: the
// real API (#7) and a replay of the recorded API session that needs no API at all (#6).
import type { CreateSessionBody, MemoryView, SessionSummary, Transcript, Turn, TurnBody } from "@build-north/agents";

export type SessionClient = {
  /** POST /sessions: the session's first Turn. */
  start(body: CreateSessionBody): Promise<Turn>;
  /** POST /sessions/:id/turns: the next Turn. */
  send(sessionId: string, body: TurnBody): Promise<Turn>;
  /** GET /sessions: the learner's sessions, newest first: the unfinished ones Start offers to pick up, the finished
   * ones under "Your maps". */
  list(): Promise<SessionSummary[]>;
  /** GET /sessions/:id: the session's latest Turn, to pick it up where it stopped or, once finished, to show its
   * result again. Rejects with a 404 ClientError once the server no longer has it. */
  resume(sessionId: string): Promise<Turn>;
  /** GET /sessions/:id/transcript?material=1: every saved step, oldest first, plus the original notes for recovery.
   * Empty for a session saved before Oct 25; an API from before then doesn't have the route. */
  transcript(sessionId: string): Promise<Transcript>;
  /** DELETE /me/data: the learner's sessions, their logs, their levels and their memory are gone (the delete button, #43). */
  deleteData(): Promise<void>;
  /** GET /me/memory: what Lumente remembers of the learner, the Memory sheet (#112). Empty with memory off. */
  memory(): Promise<MemoryView>;
  /** True when the client replays the fixture instead of calling the API. */
  readonly offline: boolean;
};

/** A call that didn't produce a Turn. `message` is safe to show the learner. */
export class ClientError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(message: string, status: number | null, retryable: boolean) {
    super(message);
    this.name = "ClientError";
    this.status = status;
    this.retryable = retryable;
  }
}
