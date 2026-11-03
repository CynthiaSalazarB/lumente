import { MOVE_ORDER, Mastery, Session, SessionSummary, type Level, type MoveId } from "@build-north/agents";
import { RecordId, type Surreal } from "surrealdb";
import { queryTimeout } from "./db.ts";

export type NewSession = Pick<Session, "concept" | "material" | "mode">;

/** The ids SurrealDB generates for a session (app.ts checks the ones in a URL the same way). */
const SESSION_ID = /^[a-z0-9]{1,40}$/;

// All of the API's database code (CONTRACTS.md section 4). The orchestrator never comes here: the
// API loads a session and mastery, calls `advance`, and saves what it returns.

// Applied at every startup. Tables stay schemaless so the orchestrator's state can grow without a
// migration; the fields the API relies on get a type, so a bad write fails instead of saving.
const SCHEMA = `
DEFINE TABLE IF NOT EXISTS session SCHEMALESS;
DEFINE FIELD OVERWRITE user ON session TYPE string;
DEFINE FIELD OVERWRITE mode ON session TYPE "learn" | "test";
DEFINE FIELD OVERWRITE turn ON session TYPE int;
DEFINE FIELD OVERWRITE activeTurnClaim ON session TYPE option<string>;
DEFINE FIELD OVERWRITE activeTurnClaimUntil ON session TYPE option<datetime>;
DEFINE FIELD OVERWRITE turnClaimFor ON session TYPE option<int>;
DEFINE FIELD OVERWRITE turnClaimAttempts ON session TYPE option<int>;
DEFINE FIELD OVERWRITE createdAt ON session TYPE datetime DEFAULT time::now() READONLY;
DEFINE INDEX OVERWRITE session_user ON session FIELDS user;

DEFINE TABLE IF NOT EXISTS mastery SCHEMALESS;
DEFINE FIELD OVERWRITE user ON mastery TYPE string;
DEFINE FIELD OVERWRITE move ON mastery TYPE "supraordinate" | "exclusion" | "isoordinate" | "infraordinate";
DEFINE FIELD OVERWRITE level ON mastery TYPE int ASSERT $value >= 1 AND $value <= 5;
DEFINE FIELD OVERWRITE unassistedSuccesses ON mastery TYPE int ASSERT $value >= 0;
DEFINE FIELD OVERWRITE updatedAt ON mastery TYPE datetime VALUE time::now();
DEFINE INDEX OVERWRITE mastery_user ON mastery FIELDS user;

DEFINE TABLE IF NOT EXISTS agent_log SCHEMALESS;
DEFINE FIELD OVERWRITE session ON agent_log TYPE record<session>;
DEFINE FIELD OVERWRITE agent ON agent_log TYPE string;
DEFINE FIELD OVERWRITE ms ON agent_log TYPE int;
DEFINE FIELD OVERWRITE usd ON agent_log TYPE number;
DEFINE FIELD OVERWRITE callId ON agent_log TYPE string;
DEFINE FIELD OVERWRITE attempt ON agent_log TYPE int ASSERT $value >= 1;
DEFINE FIELD OVERWRITE outcome ON agent_log TYPE "started" | "success" | "failed";
DEFINE FIELD OVERWRITE costStatus ON agent_log TYPE "measured" | "reserved" | "not_charged";
DEFINE FIELD OVERWRITE at ON agent_log TYPE datetime DEFAULT time::now() READONLY;
DEFINE FIELD OVERWRITE user ON agent_log TYPE option<string>;
DEFINE FIELD OVERWRITE turn ON agent_log TYPE option<int>;
DEFINE FIELD OVERWRITE turnAttempt ON agent_log TYPE option<int>;
DEFINE INDEX OVERWRITE agent_log_session ON agent_log FIELDS session;
DEFINE INDEX OVERWRITE agent_log_user ON agent_log FIELDS user;
`;

/** `dropped`: on a coach or hint giver row, the fact ids its output cited that the API hadn't passed in (CONTRACTS.md, Memory).
 * `user`: the learner the call was for, so Delete my data finds the row even after its session is gone (rows from
 * before Oct 28 have none, and go by their session). */
export type AgentLogEntry = {
  session: string;
  user?: string;
  agent: string;
  input: unknown;
  output: unknown;
  ms: number;
  usd: number;
  callId: string;
  attempt: number;
  turn?: number;
  turnAttempt?: number;
  outcome: "started" | "success" | "failed";
  costStatus: "measured" | "reserved" | "not_charged";
  status?: number;
  dropped?: string[];
};

/** A move a Turn moved on: the level it reached and the unassisted successes it added (`changedMoves` in app.ts). */
export type MasteryProgress = { move: MoveId; level: Level; gained: number };
export type TurnClaimState = { active: boolean };

export type Store = {
  // Persist an already initialized session in one write; no invisible intermediate row.
  insertSession(session: Session): Promise<void>;
  createSession(user: string, input: NewSession): Promise<Session>;
  // null when the session doesn't exist or belongs to someone else
  getSession(user: string, id: string): Promise<Session | null>;
  // GET /sessions: the user's sessions that have a Turn, newest first
  listSessions(user: string): Promise<SessionSummary[]>;
  // false when the stored session is no longer at `previousTurn` or the supplied lease was replaced. In the same
  // transaction, and only when the session is saved, `progress` goes onto the session user's mastery as it is stored
  // then: a level never drops below the stored one and successes add to the stored count, so a Turn that read mastery
  // before another session saved can't undo that session's progress, and no session moves on without what it earned.
  saveSession(session: Session, previousTurn: number, progress?: readonly MasteryProgress[], claimId?: string): Promise<boolean>;
  // A database-backed lease admits one handler, as attempt 1 of the Turn. A `recovery` claim, from a request that waited
  // behind that handler, takes over a lease it left unsaved once (attempt 2): duplicates of one send can't keep re-running
  // a failing Turn, and the learner's next send starts again at attempt 1 (audit, Nov 2).
  claimTurn(user: string, sessionId: string, turn: number, claimId: string, recovery?: boolean): Promise<number | null>;
  turnClaimState(user: string, sessionId: string, turn: number): Promise<TurnClaimState | null>;
  releaseTurn(user: string, sessionId: string, claimId: string): Promise<void>;
  renewTurnClaim(user: string, sessionId: string, turn: number, claimId: string): Promise<boolean>;
  // every move, in session order; a move the learner hasn't touched yet is at level 1
  getMastery(user: string): Promise<Mastery>;
  // the moves given, one row each, as they are (the demo seed); moves left out keep their rows
  saveMastery(user: string, mastery: Mastery): Promise<void>;
  // Create the reserved row before the provider call; an unsettled row remains a conservative record after a crash.
  beginAgentCall(entry: AgentLogEntry): Promise<string>;
  // Finalize the same row after usage or failure is known. On failure, the original reservation remains.
  finishAgentCall(id: string, entry: AgentLogEntry): Promise<void>;
  logAgentCall(entry: AgentLogEntry): Promise<void>;
  // GET /me/memory: the concepts of the user's finished sessions, newest first, each once
  finishedConcepts(user: string): Promise<string[]>;
  // GET /me/memory: the memory fact ids each hint giver or coach call received, one list per agent_log row
  memoryReads(user: string): Promise<string[][]>;
  // Memory: the concept of each of the user's sessions among `ids` (the sessions memory rows name), so a row counts for
  // the concept its session was on; another user's session, or an id that isn't one, is left out
  sessionConcepts(user: string, ids: readonly string[]): Promise<Map<string, string>>;
  // DELETE /me/data: sessions, their agent logs, and mastery
  deleteUserData(user: string): Promise<void>;
};

export async function defineSchema(db: Surreal): Promise<void> {
  await db.query(SCHEMA).signal(queryTimeout()).collect();
}

// A new session before the orchestrator's first step, already valid against the Session schema in
// @build-north/agents: it starts in the predict phase with no hints on any move.
export function initialSession(user: string, { concept, material, mode }: NewSession): Omit<Session, "id" | "createdAt"> {
  return {
    user,
    concept,
    material,
    mode,
    turn: 0,
    lastTurn: null,
    predictedScore: null,
    firstAttempt: null,
    phase: "predict",
    move: null,
    hintStep: null,
    hintsPerMove: Object.fromEntries(MOVE_ORDER.map((move) => [move, 0])) as Record<MoveId, number>,
    mentefacto: { concept, supraordinate: null, exclusion: [], isoordinate: [], infraordinate: [] },
    recent: [],
    retries: 0,
    lastIssue: "none",
    nextQuestion: null,
    questions: { asked: 0, testing: 0 },
    moveLog: [],
    result: null,
    transcript: [],
  };
}

// saveSession writes every Session field but the ones fixed when the session starts, so a field the
// orchestrator adds to the contract is saved without a change here. The keys come from the schema,
// never from a request.
const FIXED_FIELDS = ["id", "user", "concept", "material", "mode", "createdAt"];
const SET_SESSION = Object.keys(Session.shape)
  .filter((key) => !FIXED_FIELDS.includes(key))
  .map((key) => `${key} = $s.${key}`)
  .join(", ");

// export-testers.ts reads its rows through this too.
export function sessionRecord(row: Record<string, unknown>) {
  const session = { ...row };
  // Durable lease metadata belongs to the API store, not the strict learner-session contract.
  for (const field of ["activeTurnClaim", "activeTurnClaimUntil", "turnClaimFor", "turnClaimAttempts"]) delete session[field];
  return Session.parse(session);
}

export function createStore(db: Surreal): Store {
  // Runs one statement and returns its result as plain JSON (dates as ISO strings).
  async function one<T>(sql: string, bindings: Record<string, unknown>): Promise<T> {
    const [result] = await db.query(sql, bindings).json().signal(queryTimeout()).collect();
    return result as T;
  }
  const sessionId = (id: string) => new RecordId("session", id);
  const agentLogId = (id: string) => new RecordId("agent_log", id);

  // Rows go through the agents schemas on the way out, so a database that drifted from the contract
  // fails here instead of somewhere downstream.
  return {
    async insertSession(session) {
      const { id, createdAt: _createdAt, ...content } = Session.parse(session);
      if (!session.lastTurn || session.turn !== session.lastTurn.turn || session.id !== session.lastTurn.sessionId) {
        throw new Error("A new session must contain its matching first Turn");
      }
      await one("CREATE ONLY $id CONTENT $content", { id: sessionId(id), content });
    },
    async createSession(user, input) {
      const session = await one("CREATE ONLY session CONTENT $content RETURN *, record::id(id) AS id", {
        content: initialSession(user, input),
      });
      return Session.parse(session);
    },

    async getSession(user, id) {
      const session = await one<Record<string, unknown> | null>("SELECT *, record::id(id) AS id FROM ONLY $id WHERE user = $user", {
        id: sessionId(id),
        user,
      });
      return session ? sessionRecord(session) : null;
    },

    async claimTurn(user, id, turn, claimId, recovery = false) {
      const [claimed] = await db
        .query(
          `UPDATE $id SET activeTurnClaim = $claimId, activeTurnClaimUntil = time::now() + 2m,
             turnClaimFor = $turn,
             turnClaimAttempts = IF $recovery AND turnClaimFor = $turn THEN (turnClaimAttempts ?? 0) + 1 ELSE 1 END
           WHERE user = $user AND turn = $turn
             AND (activeTurnClaim = NONE OR activeTurnClaim = NULL OR activeTurnClaimUntil <= time::now())
             AND ($recovery = false OR turnClaimFor != $turn OR (turnClaimAttempts ?? 0) < 2)
           RETURN VALUE turnClaimAttempts`,
          { id: sessionId(id), user, turn, claimId, recovery },
        )
        .json()
        .retry()
        .signal(queryTimeout())
        .collect<[number[]]>();
      return claimed?.[0] ?? null;
    },

    async turnClaimState(user, id, turn) {
      const row = await one<{ active?: boolean } | null>(
        `SELECT (activeTurnClaim != NONE AND activeTurnClaim != NULL AND activeTurnClaimUntil > time::now()) AS active
         FROM ONLY $id WHERE user = $user AND turn = $turn`,
        { id: sessionId(id), user, turn },
      );
      return row ? { active: row.active === true } : null;
    },

    async releaseTurn(user, id, claimId) {
      await db
        .query(
          `UPDATE $id SET activeTurnClaim = NONE, activeTurnClaimUntil = NONE
           WHERE user = $user AND activeTurnClaim = $claimId RETURN NONE`,
          { id: sessionId(id), user, claimId },
        )
        .retry()
        .signal(queryTimeout())
        .collect();
    },

    async renewTurnClaim(user, id, turn, claimId) {
      const [renewed] = await db
        .query(
          `UPDATE $id SET activeTurnClaimUntil = time::now() + 2m
           WHERE user = $user AND turn = $turn AND activeTurnClaim = $claimId
           RETURN VALUE activeTurnClaim`,
          { id: sessionId(id), user, turn, claimId },
        )
        .json()
        .retry()
        .signal(queryTimeout())
        .collect<[string[]]>();
      return renewed?.[0] === claimId;
    },

    async listSessions(user) {
      // a session whose first Turn never came back (the agent failed on the start) has nothing to show
      const rows = await one<unknown[]>(
        `SELECT record::id(id) AS id, concept, mode, createdAt, (result != NONE AND result != NULL) AS finished,
           result.score ?? NULL AS score, result.predictedScore ?? NULL AS predictedScore
         FROM session WHERE user = $user AND lastTurn != NONE AND lastTurn != NULL ORDER BY createdAt DESC LIMIT 200`,
        { user },
      );
      return rows.map((row) => SessionSummary.parse(row));
    },

    async saveSession(session, previousTurn, progress = [], claimId) {
      // The WHERE checks and writes in one statement, so two answers to the same Turn can't both move it on, and the
      // mastery the Turn earned is written in the same transaction, so both land or neither does. A conflict with a
      // parallel write (another session's mastery, Delete my data) runs the whole transaction again, which then sees it.
      const claimWhere = claimId === undefined
        ? " AND (activeTurnClaim = NONE OR activeTurnClaim = NULL)"
        : " AND activeTurnClaim = $claimId";
      const [saved] = await db
        .query(
          `BEGIN;
           LET $saved = (UPDATE $id SET ${SET_SESSION}, activeTurnClaim = NONE, activeTurnClaimUntil = NONE
             WHERE turn = $previousTurn${claimWhere} RETURN VALUE turn);
           IF array::len($saved) > 0 {
             FOR $m IN $progress {
               UPSERT type::record("mastery", [$user, $m.move]) SET user = $user, move = $m.move,
                 level = math::max([level ?? 1, $m.level]), unassistedSuccesses = (unassistedSuccesses ?? 0) + $m.gained;
             };
           };
           RETURN array::len($saved) > 0;
           COMMIT;`,
          { id: sessionId(session.id), previousTurn, s: session, user: session.user, progress, ...(claimId === undefined ? {} : { claimId }) },
        )
        .json()
        .retry()
        .signal(queryTimeout())
        // the RETURN, after BEGIN, LET and IF
        .collect<[unknown]>(3);
      // A server that answers the RETURN somewhere else (before 3.0, BEGIN isn't listed) would read as a lost race on
      // every Turn while the learner gets 200s: anything but a boolean fails loudly instead (code review, Oct 28).
      if (typeof saved !== "boolean") throw new Error(`The session save didn't answer whether it saved (got ${JSON.stringify(saved) ?? "nothing"})`);
      return saved;
    },

    async getMastery(user) {
      const rows = await one<{ move: string; level: number; unassistedSuccesses: number }[]>(
        "SELECT move, level, unassistedSuccesses FROM mastery WHERE user = $user",
        { user },
      );
      return Mastery.parse({
        moves: MOVE_ORDER.map((move) => {
          const row = rows.find((r) => r.move === move);
          return { move, level: row?.level ?? 1, unassistedSuccesses: row?.unassistedSuccesses ?? 0 };
        }),
      });
    },

    async saveMastery(user, { moves }) {
      // one statement, so the four moves are saved together or not at all
      await one(
        `FOR $m IN $moves {
           UPSERT type::record("mastery", [$user, $m.move]) SET user = $user, move = $m.move,
             level = $m.level, unassistedSuccesses = $m.unassistedSuccesses;
         }`,
        { user, moves },
      );
    },

    async beginAgentCall({ session, user, agent, input, output, ms, usd, callId, attempt, turn, turnAttempt, outcome, costStatus, status, dropped }) {
      const ids = await one<string[]>("CREATE agent_log CONTENT $entry RETURN VALUE record::id(id)", {
        entry: {
          session: sessionId(session), ...(user ? { user } : {}), agent, input, output, ms: Math.round(ms), usd,
          callId, attempt, ...(turn === undefined ? {} : { turn }), ...(turnAttempt === undefined ? {} : { turnAttempt }),
          outcome, costStatus, ...(status ? { status } : {}), ...(dropped ? { dropped } : {}),
        },
      });
      const id = ids[0];
      if (typeof id !== "string" || !id) throw new Error("The agent_log reservation didn't return its record id");
      return id;
    },

    async finishAgentCall(id, { output, ms, usd, outcome, costStatus, status, dropped }) {
      const fields = ["output = $output", "ms = $ms", "usd = $usd", "outcome = $outcome", "costStatus = $costStatus"];
      const bindings: Record<string, unknown> = {
        id: agentLogId(id), output, ms: Math.round(ms), usd, outcome, costStatus,
      };
      if (status !== undefined) {
        fields.push("status = $status");
        bindings.status = status;
      }
      if (dropped !== undefined) {
        fields.push("dropped = $dropped");
        bindings.dropped = dropped;
      }
      const updated = await one<string[]>(`UPDATE ONLY $id SET ${fields.join(", ")} RETURN VALUE record::id(id)`, bindings);
      if (!updated.includes(id)) throw new Error(`The agent_log reservation ${id} was not finalized`);
    },

    async logAgentCall({ session, user, agent, input, output, ms, usd, callId, attempt, turn, turnAttempt, outcome, costStatus, status, dropped }) {
      await one("CREATE agent_log CONTENT $entry RETURN NONE", {
        entry: {
          session: sessionId(session), ...(user ? { user } : {}), agent, input, output, ms: Math.round(ms), usd,
          callId, attempt, ...(turn === undefined ? {} : { turn }), ...(turnAttempt === undefined ? {} : { turnAttempt }),
          outcome, costStatus, ...(status ? { status } : {}), ...(dropped ? { dropped } : {}),
        },
      });
    },

    async finishedConcepts(user) {
      const rows = await one<{ concept: string }[]>("SELECT concept FROM session WHERE user = $user AND result != NONE AND result != NULL ORDER BY createdAt DESC", { user });
      return [...new Set(rows.map((row) => row.concept))];
    },

    async memoryReads(user) {
      // a path through the facts array gives the ids as one array; NONE on a call that got no memory
      const rows = await one<{ ids: unknown }[]>('SELECT input.memory.facts.id AS ids FROM agent_log WHERE session.user = $user AND agent IN ["hint_giver", "coach"] AND outcome != "started"', { user });
      return rows.map((row) => (Array.isArray(row.ids) ? row.ids.filter((id): id is string => typeof id === "string") : []));
    },

    async sessionConcepts(user, ids) {
      // the labels on memory rows are text: only an id SurrealDB makes becomes a record to look up
      const wanted = [...new Set(ids)].filter((id) => SESSION_ID.test(id));
      if (wanted.length === 0) return new Map();
      const rows = await one<{ id: string; concept: string }[]>("SELECT record::id(id) AS id, concept FROM $ids WHERE user = $user", { ids: wanted.map(sessionId), user });
      return new Map(rows.map((row) => [row.id, row.concept]));
    },

    async deleteUserData(user) {
      await db
        .query(
          `BEGIN;
           DELETE agent_log WHERE session.user = $user OR user = $user;
           DELETE session WHERE user = $user;
           DELETE mastery WHERE user = $user;
           COMMIT;`,
          { user },
        )
        // a Turn saved meanwhile conflicts on its session row: the delete runs again and takes it too
        .retry()
        .signal(queryTimeout())
        .collect();
    },
  };
}
