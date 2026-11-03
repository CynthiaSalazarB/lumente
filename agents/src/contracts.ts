// The Zod version of agents/CONTRACTS.md. The markdown is the reference; this file follows it.
// Objects are strict so a typo in a fixture or a response fails loudly instead of being dropped.
import { z } from "zod";

// ---------- 0. Shared vocabulary ----------

export const MoveId = z.enum(["supraordinate", "exclusion", "isoordinate", "infraordinate"]);
export type MoveId = z.infer<typeof MoveId>;

/** The order moves run in during a session. */
export const MOVE_ORDER: readonly MoveId[] = ["supraordinate", "exclusion", "isoordinate", "infraordinate"];

/** What the screen shows. The method's name appears only after the learner finds the move. */
export const MOVE_LABEL: Record<MoveId, string> = {
  supraordinate: "Bigger group",
  exclusion: "What it isn't",
  isoordinate: "What it needs",
  infraordinate: "Its types",
};

/** 1 watch, 2 guided, 3 complete, 4 named only, 5 alone (the learner asks the fact desk). */
export const Level = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);
export type Level = z.infer<typeof Level>;

export const HintStep = z.enum(["nudge", "hint", "partial", "reveal"]);
export type HintStep = z.infer<typeof HintStep>;

export const Verdict = z.enum(["correct", "partial", "incorrect"]);
export type Verdict = z.infer<typeof Verdict>;

/** 0 to 2 points for one move. */
export const Quality = z.union([z.literal(0), z.literal(1), z.literal(2)]);
export type Quality = z.infer<typeof Quality>;

/** `note` is the difference, for exclusions. */
export const Item = z.strictObject({ value: z.string(), note: z.string().nullable() });
export type Item = z.infer<typeof Item>;

export const Mentefacto = z.strictObject({
  concept: z.string(),
  supraordinate: Item.nullable(),
  exclusion: z.array(Item),
  isoordinate: z.array(Item),
  infraordinate: z.array(Item),
});
export type Mentefacto = z.infer<typeof Mentefacto>;

// ---------- 1. API and the Turn ----------

export const SessionMode = z.enum(["learn", "test"]);
export type SessionMode = z.infer<typeof SessionMode>;

/**
 * POST /sessions. `material` is pasted text, up to 8,000 characters. When this schema rejects a
 * too-long `material`, the API answers 413 with a message, not a generic 400 (CONTRACTS.md section 1).
 */
export const CreateSessionBody = z.strictObject({
  concept: z.string().min(1),
  material: z.string().max(8000).optional(),
  mode: SessionMode.optional(),
});
export type CreateSessionBody = z.infer<typeof CreateSessionBody>;

/**
 * GET /sessions: one line per session of the caller, newest first, so Start can list what the learner went
 * through (the unfinished ones to pick up, the finished ones under "Your maps"). A session the orchestrator never
 * started (no Turn yet) is left out. `score` and `predictedScore` are set once the session has its result.
 */
export const SessionSummary = z.strictObject({
  id: z.string(),
  concept: z.string(),
  mode: SessionMode,
  /** ISO 8601. */
  createdAt: z.string(),
  finished: z.boolean(),
  score: z.number().int().min(0).max(8).nullable(),
  predictedScore: z.number().int().min(0).max(8).nullable(),
});
export type SessionSummary = z.infer<typeof SessionSummary>;
/** What GET /sessions answers. */
export const SessionList = z.strictObject({ sessions: z.array(SessionSummary) });

/** POST /sessions/:id/turns. `turn` is the number of the Turn being answered (decision 18). */
const answering = { turn: z.number().int() };
export const TurnBody = z.union([
  z.strictObject({ ...answering, prediction: z.number().int().min(0).max(8) }),
  z.strictObject({ ...answering, text: z.string().min(1).max(2000) }),
  z.strictObject({ ...answering, question: z.string().min(1).max(500) }),
  z.strictObject({ ...answering, mentefacto: Mentefacto }),
  z.strictObject({ ...answering, action: z.enum(["help", "continue"]) }),
]);
export type TurnBody = z.infer<typeof TurnBody>;

export const Phase = z.enum(["predict", "attempt", "example", "move", "result"]);
export type Phase = z.infer<typeof Phase>;

export const Expects = z.enum(["prediction", "text", "continue", "map", "none"]);
export type Expects = z.infer<typeof Expects>;

export const MessageAgent = z.enum([
  "questioner",
  "evaluator",
  "hint_giver",
  "example_builder",
  "coach",
  "fact_desk",
  "app",
]);
export const MessageKind = z.enum([
  "question",
  "feedback",
  "hint",
  "example",
  "named_move",
  "summary",
  "fact",
  "redirect",
]);

export const Message = z.strictObject({
  agent: MessageAgent,
  kind: MessageKind,
  text: z.string(),
  hintStep: HintStep.optional(),
  /** A hint or the coach's summary with memory on: the ids of the memory facts the text relies on, once the API
   *  kept only the ones it passed in (`verifyCites`). Absent when nothing was cited. */
  cites: z.array(z.string().min(1)).optional(),
  /** The cited facts' own words, filled by the API's memory reader before the Turn goes out, so the app can show
   *  "From what Lumente remembers: …" under the message. Absent when nothing was cited. */
  sources: z.array(z.strictObject({ id: z.string().min(1), text: z.string().min(1) })).optional(),
});
export type Message = z.infer<typeof Message>;

export const Result = z.strictObject({
  predictedScore: z.number().int().min(0).max(8),
  score: z.number().int().min(0).max(8),
  maxScore: z.literal(8),
  /** predictedScore − score, in points. Positive means overconfident. */
  calibrationGap: z.number().int(),
  hintsUsed: z.number().int().min(0),
  rubric: z.array(z.strictObject({ move: MoveId, points: Quality })),
  masteryChanges: z.array(z.strictObject({ move: MoveId, from: Level, to: Level })),
  /** What the learner asked the fact desk; `testing` = questions that test the concept. */
  questions: z.strictObject({ asked: z.number().int().min(0), testing: z.number().int().min(0) }),
  /** Null on the Turn that shows the result: the coach's words come in the next Turn, which the app asks for
   * at once with `continue`. */
  coach: z.strictObject({ message: z.string(), nextFocus: MoveId.nullable() }).nullable(),
});
export type Result = z.infer<typeof Result>;

export const Turn = z.strictObject({
  sessionId: z.string(),
  turn: z.number().int().min(1),
  phase: Phase,
  move: MoveId.nullable(),
  level: Level.nullable(),
  messages: z.array(Message),
  expects: Expects,
  /** Level 3 only: the half-built part. */
  scaffold: z.strictObject({ given: z.array(z.string()), blanks: z.number().int().min(1) }).nullable(),
  /** What the learner has built so far. */
  mentefacto: Mentefacto,
  /** Phase "example" only: the worked example's map (planet). */
  example: Mentefacto.nullable(),
  progress: z.strictObject({
    movesDone: z.number().int().min(0),
    movesTotal: z.number().int().min(1),
    hintsUsed: z.number().int().min(0),
    /** Each finished move's points, in the order the moves finished, so the app can light them as they're
     * proved. Optional: Turns saved before Oct 22, and the fixtures, don't have it. */
    points: z.array(z.strictObject({ move: MoveId, points: Quality })).optional(),
  }),
  result: Result.nullable(),
  error: z.strictObject({ code: z.enum(["agent_failed", "rate_limited"]), retryable: z.boolean() }).nullable(),
});
export type Turn = z.infer<typeof Turn>;

/** A Turn body of any length: saved answers and questions may predate the request limits, and the API checks a new
 * body's shape with it first, so a resend of a Turn already judged gets the latest Turn back however long it is. */
export const SavedTurnBody = z.union([
  ...TurnBody.options,
  z.strictObject({ ...answering, text: z.string().min(1) }),
  z.strictObject({ ...answering, question: z.string().min(1) }),
]);
/**
 * One saved step of a session: the body the learner sent (null for the start) and the Turn that came back. The API
 * keeps every step on the session row (`Session.transcript`), so a session picked up again, or a finished map opened
 * from "Your maps", shows its whole conversation instead of the latest Turn alone.
 */
export const TranscriptStep = z.strictObject({ body: SavedTurnBody.nullable(), turn: Turn });
export type TranscriptStep = z.infer<typeof TranscriptStep>;
/** What GET /sessions/:id/transcript answers: every saved step, oldest first; `?material=1` also opts in to the original
 * notes. Empty for a session saved before Oct 25. */
export const Transcript = z.strictObject({ steps: z.array(TranscriptStep), material: z.string().nullable().optional() });
export type Transcript = z.infer<typeof Transcript>;

export const Mastery = z.strictObject({
  moves: z.array(
    z.strictObject({ move: MoveId, level: Level, unassistedSuccesses: z.number().int().min(0) }),
  ),
});
export type Mastery = z.infer<typeof Mastery>;

// ---------- 2. Agents: inputs and outputs ----------
// Output schemas go to Claude through `zodOutputFormat`, so they stay plain: strings, enums,
// literals, arrays and nullables.

export const AgentName = z.enum(["questioner", "evaluator", "evaluator_full", "hint_giver", "fact_desk", "coach"]);
export type AgentName = z.infer<typeof AgentName>;

// ---------- 2a. What the agents remember about a learner (SurrealDB Agent Memory) ----------
// The API keeps one memory scope per learner. Every fact is built in code from a template ("Level 3 on
// infraordinate for CORS, since Oct 22"); learner text never goes in. The levels still come from code and
// our own tables: memory never changes a score, it only tells the coach and the hint giver what this
// learner has already proved, and lets the app show how that memory changed and why.

/** One fact the API read back from memory, as the coach and the hint giver see it. */
export const MemoryFact = z.strictObject({
  /** Memory's id for the row, what `cites` points at. */
  id: z.string().min(1),
  /** One line from a template, never the learner's words. */
  text: z.string().min(1),
  concept: z.string().min(1),
  /** Facts about one move (`level_<move>`, `help_<move>`); absent on the session's `gap` fact. */
  move: MoveId.optional(),
  level: Level.optional(),
  /** When the fact became current (ISO 8601). */
  since: z.string().min(1),
  /** The id of the fact this one replaced, when memory kept an older value for the same key. */
  supersedes: z.string().min(1).optional(),
  writtenBy: AgentName,
  /** The session whose turn wrote it. */
  sessionId: z.string().min(1),
  turn: z.number().int().min(1).optional(),
});
export type MemoryFact = z.infer<typeof MemoryFact>;

/** At most 8 facts: the current level per move, the latest gap, and the Helps that cost the most. */
export const MEMORY_FACTS_MAX = 8;
export const LearnerMemory = z.strictObject({ facts: z.array(MemoryFact).max(MEMORY_FACTS_MAX) });
export type LearnerMemory = z.infer<typeof LearnerMemory>;

export const AgentContext = z.strictObject({
  concept: z.string(),
  material: z.string().nullable(),
  move: MoveId,
  level: Level,
  mentefacto: Mentefacto,
  /** This move's exchanges only. */
  recent: z.array(z.strictObject({ from: z.enum(["app", "learner"]), text: z.string() })),
  /** What memory holds on this learner and concept; absent when memory is off, empty or late. */
  memory: LearnerMemory.optional(),
});
export type AgentContext = z.infer<typeof AgentContext>;

export const QuestionerInput = AgentContext;
export const QuestionerOutput = z.strictObject({
  question: z.string(),
  scaffold: z.strictObject({ given: z.array(z.string()), blanks: z.number().int() }).nullable(),
});
export type QuestionerOutput = z.infer<typeof QuestionerOutput>;

export const EvaluatorIssue = z.enum([
  "too_broad",
  "not_a_class",
  "same_level",
  "is_a_subtype",
  "is_a_characteristic",
  "off_topic",
  "none",
]);
export type EvaluatorIssue = z.infer<typeof EvaluatorIssue>;

export const EvaluatorInput = AgentContext.extend({ answer: z.string() });
export type EvaluatorInput = z.infer<typeof EvaluatorInput>;
export const EvaluatorOutput = z.strictObject({
  verdict: Verdict,
  /** Any defensible answer passes: 2 closest class, 1 too broad or incomplete, 0 not defensible. */
  quality: Quality,
  accepted: z.array(Item),
  issue: EvaluatorIssue,
  /** For logs and the team. */
  reason: z.string(),
  /** Shown to the learner; never contains the answer before the move is correct, and after it, may add what the
   * learner left out of the same criterion. */
  feedback: z.string(),
});
export type EvaluatorOutput = z.infer<typeof EvaluatorOutput>;

export const WholeMapEvaluatorInput = z.strictObject({
  concept: z.string(),
  material: z.string().nullable(),
  mentefacto: Mentefacto,
});
export type WholeMapEvaluatorInput = z.infer<typeof WholeMapEvaluatorInput>;
export const WholeMapEvaluatorOutput = z.strictObject({
  rubric: z.array(z.strictObject({ move: MoveId, quality: Quality, feedback: z.string() })),
});
export type WholeMapEvaluatorOutput = z.infer<typeof WholeMapEvaluatorOutput>;

export const QuestionType = z.enum([
  "fact",
  "compare",
  "contrast",
  "breaking_case",
  "what_it_needs",
  "asks_for_structure",
  /** Not a question: an answer for a part of the map, typed in the chat instead of on the map. Not counted. */
  "states_an_answer",
  "other",
]);
export type QuestionType = z.infer<typeof QuestionType>;

/** The question types that count as `testing` in the result. */
export const TESTING_QUESTION_TYPES: readonly QuestionType[] = [
  "compare",
  "contrast",
  "breaking_case",
  "what_it_needs",
];

export const FactDeskInput = z.strictObject({
  concept: z.string(),
  material: z.string().nullable(),
  mentefacto: Mentefacto,
  question: z.string(),
});
export type FactDeskInput = z.infer<typeof FactDeskInput>;
export const FactDeskOutput = z.strictObject({
  kind: z.enum(["fact", "redirect"]),
  answer: z.string(),
  questionType: QuestionType,
});
export type FactDeskOutput = z.infer<typeof FactDeskOutput>;

/** Decision 17: the only text a redirect may say. */
export const FACT_DESK_REDIRECT = "That part is yours to decide. If you're stuck, tap Help (it costs a point).";
/** The only text for an answer typed in the chat (`states_an_answer`, Oct 22): where answers go, never whether
 *  this one is right. */
export const FACT_DESK_ANSWER_REDIRECT = "That looks like an answer. Answers go on the map, and the whole map is scored when you submit. If you need a fact, ask me.";

export const HintGiverInput = AgentContext.extend({
  step: HintStep,
  lastAnswer: z.string(),
  issue: EvaluatorIssue,
});
export type HintGiverInput = z.infer<typeof HintGiverInput>;
export const HintGiverOutput = z.strictObject({
  step: HintStep,
  text: z.string(),
  /** Only at `reveal`: the Item that goes into the mentefacto, with 0 points. */
  revealed: Item.nullable(),
  /** Ids of the `AgentContext.memory` facts the hint relies on; the API drops any id it didn't pass in. */
  cites: z.array(z.string()).optional(),
});
export type HintGiverOutput = z.infer<typeof HintGiverOutput>;

/** Not a Claude call in this version: the shape of fixtures/worked-example.json (decision 4). */
export const WorkedExample = z.strictObject({
  exampleConcept: z.string(),
  steps: z.array(z.strictObject({ move: MoveId, thinkAloud: z.string(), item: Item })),
});
export type WorkedExample = z.infer<typeof WorkedExample>;

/** The coach writes `result.coach`, so it receives the result without it. `memory` is what earlier sessions
 *  left, so the message can compare with last time; absent when memory is off, empty or late. */
export const CoachInput = z.strictObject({
  concept: z.string(),
  mentefacto: Mentefacto,
  result: Result.omit({ coach: true }),
  memory: LearnerMemory.optional(),
});
export type CoachInput = z.infer<typeof CoachInput>;
export const CoachOutput = z.strictObject({
  message: z.string(),
  nextFocus: MoveId.nullable(),
  /** Ids of the `AgentContext.memory` facts the message relies on; the API drops any id it didn't pass in. */
  cites: z.array(z.string()).optional(),
});
export type CoachOutput = z.infer<typeof CoachOutput>;

// ---------- 2b. What the app shows of memory: GET /me/memory ----------

/** Where a memory row came from, in memory's own words (`upsert` is a fact the API wrote as a triple). */
export const MemorySourceKind = z.enum(["upsert", "turn", "document"]);
export type MemorySourceKind = z.infer<typeof MemorySourceKind>;

/** One row of a move's history: a level that was current from `since` until `until` (null = still current). */
export const MemoryHistoryRow = z.strictObject({
  level: Level,
  since: z.string().min(1),
  until: z.string().min(1).nullable(),
  source: MemorySourceKind,
  writtenBy: AgentName,
  /** How many times an agent other than the writer received this row (counted from agent_log). */
  readBy: z.number().int().min(0),
});
export type MemoryHistoryRow = z.infer<typeof MemoryHistoryRow>;

/** The whole-map result memory kept: predicted minus real points, as in `Result.calibrationGap`. */
export const MemoryGap = z.strictObject({
  sessionId: z.string().min(1),
  at: z.string().min(1),
  predictedScore: z.number().int().min(0).max(8),
  score: z.number().int().min(0).max(8),
  gap: z.number().int(),
});
export type MemoryGap = z.infer<typeof MemoryGap>;

/** "What Lumente remembers": per concept, each move's level now and how it got there. Empty arrays on a first session. */
export const MemoryView = z.strictObject({
  concepts: z.array(
    z.strictObject({
      concept: z.string().min(1),
      moves: z.array(
        z.strictObject({
          move: MoveId,
          /** Null until the evaluator has written a level for this move. */
          level: Level.nullable(),
          /** Newest first; the first row is the current one. */
          history: z.array(MemoryHistoryRow),
        }),
      ),
      /** The latest whole-map gap and the one before it, for "last time you predicted 3 too many, this time 1". */
      gap: z.strictObject({ latest: MemoryGap.nullable(), previous: MemoryGap.nullable() }),
    }),
  ),
});
export type MemoryView = z.infer<typeof MemoryView>;

// ---------- 3. The seam between the orchestrator and the API ----------
// `AgentName` moved up to section 2, since `MemoryFact.writtenBy` uses it.

/** Written by the API (#10): prompt + schema to Claude, validated, logged to agent_log. */
export type CallAgent = (agent: AgentName, input: unknown) => Promise<unknown>;

/** What `advance` receives: a /turns body without `turn` (the API checks repeats first), or the start. */
export type TurnInput =
  | { action: "start" }
  | { prediction: number }
  | { text: string }
  | { question: string }
  | { mentefacto: Mentefacto }
  | { action: "help" | "continue" };

// ---------- 4. State in SurrealDB ----------
// The fields in section 4. The orchestrator (#3) may add fields through a PR to CONTRACTS.md.

export const Session = z.strictObject({
  id: z.string(),
  user: z.string(),
  concept: z.string(),
  material: z.string().nullable(),
  mode: SessionMode,
  turn: z.number().int().min(0),
  lastTurn: Turn.nullable(),
  predictedScore: z.number().int().min(0).max(8).nullable(),
  firstAttempt: z.string().nullable(),
  phase: Phase,
  move: MoveId.nullable(),
  /** The furthest step of the ladder this move has shown; the evaluator's nudge counts as the first. */
  hintStep: HintStep.nullable(),
  /** Helps per move. All four moves, starting at 0: a Zod record keyed by an enum requires every key. */
  hintsPerMove: z.record(MoveId, z.number().int().min(0)),
  mentefacto: Mentefacto,
  /** This move's exchanges, passed to the agents as AgentContext.recent; empty when a move starts. */
  recent: z.array(z.strictObject({ from: z.enum(["app", "learner"]), text: z.string() })),
  /** This move's answers that weren't right yet (the exclusion's follow-up doesn't count); 0 when a move starts. */
  retries: z.number().int().min(0),
  /** The evaluator's issue with this move's last answer, so a Help aims at it; "none" when a move starts. */
  lastIssue: EvaluatorIssue,
  /** The next move's question, asked while the evaluator judged an answer (both calls at once). */
  nextQuestion: z
    .strictObject({ move: MoveId, level: Level, question: z.string(), scaffold: QuestionerOutput.shape.scaffold })
    .nullable(),
  /** Fact desk questions so far (level 5 and test sessions). */
  questions: z.strictObject({ asked: z.number().int().min(0), testing: z.number().int().min(0) }),
  /** One entry per finished move: its points, Helps, retries, and the level before and after. */
  moveLog: z.array(
    z.strictObject({
      move: MoveId,
      points: Quality,
      hints: z.number().int().min(0),
      retries: z.number().int().min(0),
      from: Level,
      to: Level,
    }),
  ),
  result: Result.nullable(),
  /** Every saved step, oldest first, written by the API (never read by the orchestrator). Sessions saved before
   * Oct 25 have none. */
  transcript: z.array(TranscriptStep).default([]),
  createdAt: z.string(),
});
export type Session = z.infer<typeof Session>;

/** Written by Cynthia (#3). Never touches the database or the network except through callAgent. */
export type Advance = (
  state: { session: Session; mastery: Mastery },
  input: TurnInput,
  callAgent: CallAgent,
) => Promise<{ session: Session; mastery: Mastery; turn: Turn }>;
