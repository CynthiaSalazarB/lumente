import {
  AgentName,
  MEMORY_FACTS_MAX,
  MOVE_LABEL,
  MOVE_ORDER,
  MemoryFact as MemoryFactSchema,
  MemoryGap as MemoryGapSchema,
  MemoryHistoryRow as MemoryHistoryRowSchema,
  MemorySourceKind,
  MemoryView as MemoryViewSchema,
  type CallAgent,
  type LearnerMemory,
  type MemoryFact,
  type MemoryGap,
  type MemoryHistoryRow,
  type MemoryView,
  type MoveId,
  type Session,
  type Turn,
} from "@build-north/agents";
import { createHash } from "node:crypto";
import { pseudonymOf } from "./export-testers.ts";

// SurrealDB Agent Memory on Leo's side (#112, CONTRACTS.md section 2, Memory): what the API writes after a
// session, what it reads before the hint giver and the coach, the Memory sheet's view, and the purge behind
// Delete my data. Every fact is a sentence code writes from a template, sent as a triple (`infer: "triples"`,
// no model on memory's side), so the learner's words never go in. One scope per learner, named by the same
// salted pseudonym the testers' export uses; a later session's write of the same key supersedes the earlier
// one, and memory keeps the chain. Memory never changes a number: the levels still come from the orchestrator.

export type MemoryConfig = { endpoint: string; context: string; apiKey: string; salt: string };

/** The read before an agent call gives up after this: the agent then runs without memory (CONTRACTS.md). */
export const MEMORY_READ_MS = 1_500;
/** Writes and the purge run off the request path, so they can take longer. */
const WRITE_MS = 10_000;
const WRITE_RETRY_BASE_MS = 100;
const WRITE_RETRY_MAX_MS = 30_000;
/** A history page, and how many a read walks before it stops: nine rows a session, so plenty. */
const PAGE = 200;
const MAX_PAGES = 5;

const ON = /^(1|true|on|yes)$/i;

// Null unless AGENT_MEMORY_ENABLED is on: the flag is off by default (DECISIONS.md, Oct 22), and the API runs
// every session without memory.
export function memoryConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MemoryConfig | null {
  if (!ON.test(env.AGENT_MEMORY_ENABLED?.trim() ?? "")) return null;
  const endpoint = env.AGENT_MEMORY_ENDPOINT?.trim();
  const context = env.AGENT_MEMORY_CONTEXT?.trim();
  const apiKey = env.AGENT_MEMORY_API_KEY?.trim();
  if (!endpoint || !context || !apiKey) {
    throw new Error("AGENT_MEMORY_ENABLED is on, so AGENT_MEMORY_ENDPOINT, AGENT_MEMORY_CONTEXT and AGENT_MEMORY_API_KEY are required");
  }
  if (!URL.canParse(endpoint)) throw new Error("AGENT_MEMORY_ENDPOINT is not a URL (expected https://<the context's host>)");
  return { endpoint: endpoint.replace(/\/+$/, ""), context, apiKey, salt: env.LEARNER_ID_SALT ?? "" };
}

// With the flag off, Delete my data still needs memory when it is set up: what a learner left there while the flag was
// on is still theirs to delete (code review, Oct 28). Null when memory was never set up, or its endpoint isn't a URL.
export function memoryPurgeConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MemoryConfig | null {
  const endpoint = env.AGENT_MEMORY_ENDPOINT?.trim();
  const context = env.AGENT_MEMORY_CONTEXT?.trim();
  const apiKey = env.AGENT_MEMORY_API_KEY?.trim();
  if (!endpoint || !context || !apiKey || !URL.canParse(endpoint)) return null;
  return { endpoint: endpoint.replace(/\/+$/, ""), context, apiKey, salt: env.LEARNER_ID_SALT ?? "" };
}

// ---------- Names: the scope, the entity and the keys ----------

/** What memory knows a learner as: the testers' pseudonym (export-testers.ts), never the Clerk id. */
export const scopeOf = (pseudonym: string): string => `learner/${pseudonym}`;

/** Lowercase letters, digits and underscores only, so memory's own name normalisation can't change it. */
const slug = (concept: string) => concept.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "concept";

/** Letters and digits in groups, with spaces, dots, dashes, slashes or underscores between them: the slug keeps every
 * group, so two such concepts share a slug only when they differ in how they're spaced ("Node.js", "node js"). */
const PLAIN = /^[a-z0-9]+(?:[\s._/-]+[a-z0-9]+)*$/;

/** The concept's part of its entity name. The slug drops everything else, so "C++" and "C#" would both be "c" and every
 * Japanese or Korean concept "concept": those get the start of a hash of the concept itself (trimmed, lowercase) too,
 * and two concepts never share their history. A plain concept keeps the name it always had, and its memory with it. */
function conceptKey(concept: string): string {
  const name = concept.trim().toLowerCase();
  return PLAIN.test(name) ? slug(name) : `${slug(name)}_${createHash("sha256").update(name.replace(/\s+/g, " ")).digest("hex").slice(0, 12)}`;
}

export type MemoryEntity = { type: "topic"; name: string };

/** One entity per learner and concept; its attributes are the facts, one key per fact (below; underscores, since memory folds a dot in a key to one). */
export const entityOf = (pseudonym: string, concept: string): MemoryEntity => ({ type: "topic", name: `${pseudonym}_${conceptKey(concept)}` });

/** The name every concept had before Oct 27, the slug alone: what memory holds from then on a concept the slug couldn't
 * keep ("C++", "Dijkstra's algorithm") is under it, beside what other concepts with the same slug wrote ("C"). */
const legacyEntityOf = (pseudonym: string, concept: string): MemoryEntity => ({ type: "topic", name: `${pseudonym}_${slug(concept)}` });

type FactKind = "level" | "gap" | "help";

/** The agent each kind of fact is written for (`MemoryFact.writtenBy`): the evaluator's verdicts moved the level,
 * the whole-map result is the coach's, the Helps are the hint giver's. */
const WRITER: Record<FactKind, AgentName> = { level: "evaluator", gap: "coach", help: "hint_giver" };

function kindOf(key: string): FactKind | null {
  if (key === "gap") return "gap";
  if (key.startsWith("level_")) return "level";
  if (key.startsWith("help_")) return "help";
  return null;
}

const isMove = (value: string): value is MoveId => (MOVE_ORDER as readonly string[]).includes(value);

// ---------- Templates: the only words memory ever holds ----------

/** The zone a fact's date is written in: `TZ` when set, else the team's. The Memory sheet dates the same rows in the
 * device's zone, so a session finished at 9 PM in Toronto reads "Oct 23" in both places instead of "Oct 24" here. */
const TIME_ZONE = process.env.TZ?.trim() || "America/Toronto";

/** "Oct 22": the date of `at` in `timeZone`. */
export function dateOf(at: string | Date, timeZone: string = TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(new Date(at));
}

/** Plain sentences with the parts' plain labels (Cynthia, #112): what the agents read and the learner sees. */
export const factText = {
  level: (concept: string, move: MoveId, from: number, to: number, at: string | Date): string =>
    `You moved ${to >= from ? "up" : "down"} to level ${to} on '${MOVE_LABEL[move]}' for ${concept} on ${dateOf(at)}.`,
  /** The first time memory hears of a part: where the learner stood when the session ended. */
  baseline: (concept: string, move: MoveId, level: number, at: string | Date): string =>
    `You were at level ${level} on '${MOVE_LABEL[move]}' for ${concept} on ${dateOf(at)}.`,
  gap: (concept: string, predicted: number, score: number): string => `Last time on ${concept} you guessed ${predicted} and proved ${score}.`,
  help: (concept: string, move: MoveId, helps: number): string =>
    `'${MOVE_LABEL[move]}' took ${helps === 0 ? "no Help" : helps === 1 ? "1 Help" : `${helps} Helps`} on ${concept} last time.`,
};

export type FactWrite = { key: string; value: string; labels: Record<string, string | number> };

/** The facts a session leaves once it has its result: a level fact per part whose level changed, the gap, and the
 * Helps each part took. The numbers go in labels, so a read never parses a sentence. Nothing without a result.
 *
 * `levelsOnRecord` is the set of parts memory already holds a level for. Given, every finished part missing from it
 * gets a baseline level fact too (`factText.baseline`, the level the session ended at), so a learner whose levels
 * never move, the demo account at level 5 on every part included, still has a level row to show and to read.
 * Left out (memory couldn't be read first), only the changes are written, as before. */
export function factsToWrite(session: Session, at: string, levelsOnRecord?: ReadonlySet<MoveId>): FactWrite[] {
  const { result, concept } = session;
  if (!result) return [];
  const writes: FactWrite[] = result.masteryChanges.map((change) => ({
    key: `level_${change.move}`,
    value: factText.level(concept, change.move, change.from, change.to, at),
    labels: { writer: WRITER.level, move: change.move, level: change.to },
  }));
  if (levelsOnRecord) {
    const changed = new Set(result.masteryChanges.map((change) => change.move));
    for (const move of MOVE_ORDER) {
      if (changed.has(move) || levelsOnRecord.has(move)) continue;
      const finished = session.moveLog.findLast((entry) => entry.move === move);
      if (!finished) continue;
      writes.push({ key: `level_${move}`, value: factText.baseline(concept, move, finished.to, at), labels: { writer: WRITER.level, move, level: finished.to } });
    }
  }
  writes.push({
    key: "gap",
    value: factText.gap(concept, result.predictedScore, result.score),
    labels: { writer: WRITER.gap, predicted: result.predictedScore, score: result.score },
  });
  for (const move of MOVE_ORDER) {
    const helps = session.hintsPerMove[move];
    writes.push({ key: `help_${move}`, value: factText.help(concept, move, helps), labels: { writer: WRITER.help, move, helps } });
  }
  return writes;
}

// ---------- The REST calls (reference/rest-api): facts, history, scopes ----------

/** One attribute row as memory lists it (GET /entities/{type}/{name}/history), the fields the API reads. */
export type MemoryRow = {
  id: string;
  key: string;
  value: string;
  createdAt: string;
  validFrom?: string | null;
  validUntil?: string | null;
  supersedes?: string | null;
  /** `key=value`, stamped on the row by the write that made it. */
  labels?: string[];
  source?: { kind: string } | null;
};

type Triple = { entity: MemoryEntity; key: string; value: string; occurred_at: string };

export class MemoryError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "MemoryError";
    this.status = status;
  }
}

export type MemoryApi = {
  /** Registers the scope path; one that exists already is fine. */
  registerScope(path: string, signal: AbortSignal): Promise<void>;
  /** Writes the triples into the scope, every row stamped with the labels. */
  write(scope: string, labels: readonly string[], triples: readonly Triple[], signal: AbortSignal, idempotencyKey: string): Promise<void>;
  /** Every attribute row of the entity, every key, superseded ones included; [] for an entity memory doesn't have. */
  history(entity: MemoryEntity, signal: AbortSignal): Promise<MemoryRow[]>;
  /** Hard-deletes everything under the scope path; how many rows went (0 for a scope that was never registered). */
  forgetScope(path: string, signal: AbortSignal): Promise<number>;
};

export const labelsOf = (labels: Record<string, string | number>): string[] => Object.entries(labels).map(([key, value]) => `${key}=${value}`);

const labelOf = (row: MemoryRow, key: string): string | undefined => row.labels?.find((label) => label.startsWith(`${key}=`))?.slice(key.length + 1);

const numberLabelOf = (row: MemoryRow, key: string): number => Number(labelOf(row, key) ?? Number.NaN);

export function createMemoryApi({ endpoint, context, apiKey }: Omit<MemoryConfig, "salt">, send: typeof fetch = fetch): MemoryApi {
  const base = `${endpoint}/api/v1/${encodeURIComponent(context)}`;

  // The error body is { message }; a status in `accepted` comes back instead of throwing.
  async function call<T>(method: "GET" | "POST", path: string, body: unknown, signal: AbortSignal, accepted: readonly number[] = [], idempotencyKey?: string): Promise<{ status: number; json: T | null }> {
    const headers: Record<string, string> = { authorization: `Bearer ${apiKey}` };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    const res = await send(`${base}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal });
    const json = (await res.json().catch(() => null)) as T | null;
    if (!res.ok && !accepted.includes(res.status)) {
      const message = (json as { message?: unknown } | null)?.message;
      throw new MemoryError(res.status, `memory answered ${res.status}${typeof message === "string" ? `: ${message}` : ""}`);
    }
    return { status: res.status, json };
  }

  return {
    async registerScope(path, signal) {
      try {
        await call("POST", "/scopes", { path }, signal, [409]);
      } catch (error) {
        // a path registered earlier may answer 4xx with a message instead of 409
        if (!(error instanceof MemoryError && error.status < 500 && /exist|registered|duplicate/i.test(error.message))) throw error;
      }
    },

    async write(scope, labels, triples, signal, idempotencyKey) {
      await call("POST", "/facts", { infer: "triples", scopes: [[scope]], memory_category: "knowledge", labels, triples }, signal, [], idempotencyKey);
    },

    async history(entity, signal) {
      const rows: MemoryRow[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const query: string = `?limit=${PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
        const { status, json }: { status: number; json: { history?: MemoryRow[]; page?: { nextCursor?: string | null } } | null } = await call(
          "GET",
          `/entities/${entity.type}/${encodeURIComponent(entity.name)}/history${query}`,
          undefined,
          signal,
          [404],
        );
        if (status === 404 || !json?.history) return rows;
        rows.push(...json.history);
        cursor = json.page?.nextCursor ?? null;
        if (!cursor) break;
      }
      return rows;
    },

    async forgetScope(path, signal) {
      const { status, json } = await call<{ forgotten?: number }>("POST", "/scopes/forget", { path }, signal, [404]);
      return status === 404 ? 0 : (json?.forgotten ?? 0);
    },
  };
}

// ---------- Rows to the contract's shapes (pure) ----------

const sinceOf = (row: MemoryRow): string => row.validFrom ?? row.createdAt;

/** The rows this API wrote (a key it knows, a session label), grouped by key, each group newest first: the first
 * row of a group is the key's current value. Anything else in the entity is left out, never read as a fact. */
function chainsOf(rows: readonly MemoryRow[]): Map<string, MemoryRow[]> {
  const chains = new Map<string, MemoryRow[]>();
  for (const row of rows) {
    if (!kindOf(row.key) || !labelOf(row, "session")) continue;
    chains.set(row.key, [...(chains.get(row.key) ?? []), row]);
  }
  for (const chain of chains.values()) chain.sort((a, b) => sinceOf(b).localeCompare(sinceOf(a)) || b.createdAt.localeCompare(a.createdAt));
  return chains;
}

/** The parts memory already holds a level row for (open or superseded), from the entity's history. */
export function levelsOnRecord(rows: readonly MemoryRow[]): Set<MoveId> {
  const moves = new Set<MoveId>();
  for (const key of chainsOf(rows).keys()) {
    const move = key.startsWith("level_") ? key.slice("level_".length) : "";
    if (isMove(move)) moves.add(move);
  }
  return moves;
}

const writtenByOf = (row: MemoryRow, kind: FactKind): AgentName => {
  const writer = labelOf(row, "writer");
  return writer && AgentName.safeParse(writer).success ? (writer as AgentName) : WRITER[kind];
};

/** One row as the agents see it; null for a row this API didn't write (no kind, no session label). */
export function factOf(row: MemoryRow, concept: string): MemoryFact | null {
  const kind = kindOf(row.key);
  const sessionId = labelOf(row, "session");
  if (!kind || !sessionId) return null;
  const move = kind === "gap" ? undefined : row.key.slice(kind.length + 1);
  if (move !== undefined && !isMove(move)) return null;
  const level = kind === "level" ? numberLabelOf(row, "level") : undefined;
  const turn = numberLabelOf(row, "turn");
  const parsed = MemoryFactSchema.safeParse({
    id: row.id,
    text: row.value,
    concept,
    ...(move ? { move } : {}),
    ...(level !== undefined ? { level } : {}),
    since: sinceOf(row),
    ...(row.supersedes ? { supersedes: row.supersedes } : {}),
    writtenBy: writtenByOf(row, kind),
    sessionId,
    ...(Number.isInteger(turn) && turn >= 1 ? { turn } : {}),
  });
  return parsed.success ? parsed.data : null;
}

/** What earlier sessions left on this concept, at most 8 facts (CONTRACTS.md): the current level per part, the
 * latest gap, then the Helps that cost the most. Rows from `exceptSession` are skipped, so the coach of a session
 * whose result was just written still reads only what came before it. */
export function factsOf(rows: readonly MemoryRow[], concept: string, exceptSession: string): MemoryFact[] {
  const chains = chainsOf(rows.filter((row) => labelOf(row, "session") !== exceptSession));
  const current = (key: string): MemoryFact[] => {
    const row = chains.get(key)?.[0];
    const fact = row ? factOf(row, concept) : null;
    return fact ? [fact] : [];
  };
  const levels = MOVE_ORDER.flatMap((move) => current(`level_${move}`));
  const helps = MOVE_ORDER.flatMap((move) => current(`help_${move}`)).sort((a, b) => helpsOf(chains, b) - helpsOf(chains, a));
  return [...levels, ...current("gap"), ...helps].slice(0, MEMORY_FACTS_MAX);
}

const helpsOf = (chains: Map<string, MemoryRow[]>, fact: MemoryFact): number => {
  const row = chains.get(`help_${fact.move}`)?.[0];
  return row ? numberLabelOf(row, "helps") : 0;
};

function historyRowOf(row: MemoryRow, readBy: ReadonlyMap<string, number>): MemoryHistoryRow | null {
  const kind = row.source?.kind;
  const parsed = MemoryHistoryRowSchema.safeParse({
    level: numberLabelOf(row, "level"),
    since: sinceOf(row),
    until: row.validUntil ?? null,
    // triples are `upsert` in memory's words; anything else it may report is folded into the contract's three
    source: kind && MemorySourceKind.safeParse(kind).success ? kind : "upsert",
    writtenBy: writtenByOf(row, "level"),
    readBy: readBy.get(row.id) ?? 0,
  });
  return parsed.success ? parsed.data : null;
}

function gapOf(row: MemoryRow): MemoryGap | null {
  const predictedScore = numberLabelOf(row, "predicted");
  const score = numberLabelOf(row, "score");
  const parsed = MemoryGapSchema.safeParse({ sessionId: labelOf(row, "session"), at: sinceOf(row), predictedScore, score, gap: predictedScore - score });
  return parsed.success ? parsed.data : null;
}

/** One concept of the Memory sheet: per part the level now and its chain, and the latest gap beside the one before.
 * `readBy` counts, per fact id, the agent calls that received it (from agent_log). */
export function viewOf(concept: string, rows: readonly MemoryRow[], readBy: ReadonlyMap<string, number>): MemoryView["concepts"][number] {
  const chains = chainsOf(rows);
  const moves = MOVE_ORDER.map((move) => {
    const history = (chains.get(`level_${move}`) ?? []).flatMap((row) => historyRowOf(row, readBy) ?? []);
    return { move, level: history[0]?.level ?? null, history };
  });
  const gaps = (chains.get("gap") ?? []).flatMap((row) => gapOf(row) ?? []);
  return { concept, moves, gap: { latest: gaps[0] ?? null, previous: gaps[1] ?? null } };
}

/** How many agent calls received each fact id, from the ids the agent_log rows carried. */
export function readCountsOf(reads: readonly (readonly string[])[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const ids of reads) for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

// ---------- The learner's memory, as the routes use it ----------

export type LearnerMemoryStore = {
  /** Up to 8 facts from this learner's earlier sessions on the concept, or undefined when memory has none or
   * doesn't answer within MEMORY_READ_MS: the agent then runs without memory. Never throws. */
  recall(user: string, concept: string, sessionId: string): Promise<LearnerMemory | undefined>;
  /** Writes the facts a session with a result leaves (factsToWrite), after one read of what memory already holds
   * so parts with no level row yet get their baseline. Fact retries reuse the same key, at most three attempts. */
  remember(user: string, session: Session, stop?: AbortSignal): Promise<void>;
  /** The Memory sheet: the concepts given, in that order, leaving out the ones memory holds nothing on. */
  view(user: string, concepts: readonly string[], reads: readonly (readonly string[])[]): Promise<MemoryView>;
  /** Delete my data: everything under the learner's scope, for good. */
  purge(user: string): Promise<void>;
};

export type LearnerMemoryOptions = Pick<MemoryConfig, "salt"> & {
  /** The concept of each of the learner's sessions among `sessionIds` (`Store.sessionConcepts`): a row counts for a
   * concept only when the session that wrote it is the learner's, on a concept with the same entity name. */
  conceptsOf: (user: string, sessionIds: readonly string[]) => Promise<ReadonlyMap<string, string>>;
  readMs?: number;
  /** How long a write, the sheet's reads and the purge wait for memory (WRITE_MS). */
  writeMs?: number;
  warn?: (message: string) => void;
};

/** The reason AbortSignal.timeout gives: memory stopped answering in time, and may still apply what it was sent. */
const timedOut = (error: unknown) => (error as { name?: unknown } | null)?.name === "TimeoutError";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function retryableMemoryError(error: unknown): boolean {
  if (error instanceof MemoryError) return error.status === 408 || error.status === 409 || error.status === 425 || error.status === 429 || error.status >= 500;
  return error instanceof TypeError || (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"));
}

async function retryUntilConfirmed<T>(work: () => Promise<T>, stop?: AbortSignal): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    stop?.throwIfAborted();
    try { return await work(); }
    catch (error) {
      if (attempt >= 3 || !retryableMemoryError(error)) throw error;
      stop?.throwIfAborted();
      await sleep(Math.min(WRITE_RETRY_BASE_MS * 2 ** (attempt - 1), WRITE_RETRY_MAX_MS));
    }
  }
}

function writeKey(scope: string, labels: readonly string[], triple: Triple): string {
  return createHash("sha256")
    .update(JSON.stringify({ infer: "triples", scopes: [[scope]], memory_category: "knowledge", labels, triples: [triple] }))
    .digest("hex");
}

/** `work`, unless `signal` aborts first: then its reason. The read before an agent gives up at its budget, whatever it
 * is waiting on (memory, or the database's answer about the sessions). */
function within<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const stop = () => reject(signal.reason);
    if (signal.aborted) return stop();
    signal.addEventListener("abort", stop, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
  });
}

/** Delete my data's purge: everything under the learner's scope, for good. Alone, it is what the API keeps of memory
 * with the flag off (`memoryPurgeConfigFromEnv`). */
export const memoryPurgeOf =
  (api: MemoryApi, { salt, writeMs = WRITE_MS }: Pick<MemoryConfig, "salt"> & { writeMs?: number }) =>
  async (user: string): Promise<void> => {
    await api.forgetScope(scopeOf(pseudonymOf(user, salt)), AbortSignal.timeout(writeMs));
  };

export function createLearnerMemory(
  api: MemoryApi,
  { salt, conceptsOf, readMs = MEMORY_READ_MS, writeMs = WRITE_MS, warn = (message) => console.warn(message) }: LearnerMemoryOptions,
): LearnerMemoryStore {
  // scopes registered by this process, so a learner's second session doesn't ask again
  const registered = new Set<string>();
  const who = (user: string) => pseudonymOf(user, salt);
  const forget = memoryPurgeOf(api, { salt, writeMs });
  const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

  // A concept's rows: from the entity its name maps to and, for a name the slug alone couldn't keep, from the one it had
  // before Oct 27. Each counts only when the session that wrote it is one of this learner's, on a concept with the same
  // entity name: C++'s rows from before then sit under the name C still reads, and they stay out of C and still reach
  // C++ (code review, Oct 28). A row from a session the learner doesn't have counts for nothing.
  async function rowsOf(user: string, concept: string, signal: AbortSignal): Promise<MemoryRow[]> {
    const pseudonym = who(user);
    const names = [...new Set([entityOf(pseudonym, concept).name, legacyEntityOf(pseudonym, concept).name])];
    const rows = (await Promise.all(names.map((name) => api.history({ type: "topic", name }, signal)))).flat();
    const ids = [...new Set(rows.flatMap((row) => labelOf(row, "session") ?? []))];
    if (ids.length === 0) return [];
    const concepts = await conceptsOf(user, ids);
    const key = conceptKey(concept);
    return rows.filter((row) => {
      const written = concepts.get(labelOf(row, "session") ?? "");
      return written !== undefined && conceptKey(written) === key;
    });
  }

  return {
    async recall(user, concept, sessionId) {
      const started = performance.now();
      try {
        const budget = AbortSignal.timeout(readMs);
        const rows = await within(rowsOf(user, concept, budget), budget);
        const facts = factsOf(rows, concept, sessionId);
        return facts.length ? { facts } : undefined;
      } catch (error) {
        warn(`memory read skipped after ${Math.round(performance.now() - started)} ms: ${reason(error)}`);
        return undefined;
      }
    },

    async remember(user, session, stop) {
      if (!session.result || stop?.aborted) return;
      const at = new Date().toISOString();
      const pseudonym = who(user);
      const scope = scopeOf(pseudonym);
      const entity = entityOf(pseudonym, session.concept);
      // What memory holds already decides which parts need a baseline level row. Off the request path, so the
      // read gets the write budget; when it fails, the session's level changes are still written.
      let onRecord: ReadonlySet<MoveId> | undefined;
      try {
        onRecord = levelsOnRecord(await rowsOf(user, session.concept, AbortSignal.timeout(writeMs)));
      } catch (error) {
        warn(`memory history skipped before the write, so only level changes are written: ${reason(error)}`);
      }
      const writes = factsToWrite(session, at, onRecord);
      if (stop?.aborted) return;
      if (!registered.has(scope)) {
        await retryUntilConfirmed(() => api.registerScope(scope, AbortSignal.timeout(writeMs)), stop);
        registered.add(scope);
      }
      // One write per fact, so each row carries its own numbers in its labels, and one after another: the live
      // context answered "unknown error" to parallel writes on the same entity (Oct 23), one transaction each.
      const failures: string[] = [];
      let late = false;
      for (const write of writes) {
        // A delete stops subsequent attempts and facts.
        if (stop?.aborted) break;
        const labels = labelsOf({ session: session.id, turn: session.turn, ...write.labels });
        const triple = { entity, key: write.key, value: write.value, occurred_at: at };
        const key = writeKey(scope, labels, triple);
        const attempt = () =>
          api.write(scope, labels, [triple], AbortSignal.timeout(writeMs), key).catch((error: unknown) => {
            if (timedOut(error)) late = true;
            throw error;
          });
        try {
          await retryUntilConfirmed(attempt, stop);
        } catch (error) {
          failures.push(reason(error));
        }
      }
      // A write memory stopped answering in time may still be applied. Waiting one more write's time before returning
      // keeps a delete that waits for this (learnerWrites) from purging before memory applies it (code review, Oct 28).
      if (late) await sleep(writeMs);
      if (failures.length) throw new Error(`Memory fact writes failed: ${failures.join("; ")}`);
    },

    async view(user, concepts, reads) {
      const readBy = readCountsOf(reads);
      const out: MemoryView["concepts"] = [];
      // one card per history: "CORS" and "cors" are the same entity, so the first spelling (the newest) shows it once
      const shown = new Set<string>();
      for (const concept of concepts) {
        const key = conceptKey(concept);
        if (shown.has(key)) continue;
        shown.add(key);
        const rows = await rowsOf(user, concept, AbortSignal.timeout(writeMs));
        if (rows.length > 0) out.push(viewOf(concept, rows, readBy));
      }
      return MemoryViewSchema.parse({ concepts: out });
    },

    async purge(user) {
      await forget(user);
      registered.delete(scopeOf(who(user)));
    },
  };
}

// ---------- One Turn's memory: the read before the agent, the sources after ----------

export type MemoryTurn = {
  /** The callAgent to hand `advance`: the hint giver and the coach get `memory` in their input, no one else. */
  callAgent: CallAgent;
  /** The facts this Turn's agents were given (none until one of them ran). */
  given(): readonly MemoryFact[];
};

/** Wraps a session's callAgent so the hint giver and the coach receive what memory holds. The read happens once,
 * at the first of those calls, so a Turn that calls neither never waits on memory. */
export function withMemory(callAgent: CallAgent, recall: () => Promise<LearnerMemory | undefined>): MemoryTurn {
  let read: Promise<LearnerMemory | undefined> | null = null;
  let facts: readonly MemoryFact[] = [];
  return {
    async callAgent(agent, input) {
      if (agent !== "hint_giver" && agent !== "coach") return callAgent(agent, input);
      read ??= recall();
      const memory = await read;
      facts = memory?.facts ?? [];
      return callAgent(agent, memory ? { ...(input as object), memory } : input);
    },
    given: () => facts,
  };
}

/** Fills `sources` on every message that cites a fact this Turn was given, in place: the same object is the
 * session's `lastTurn`, so the save and the response carry the words. A message citing nothing stays as it is. */
export function fillSources(turn: Turn, facts: readonly MemoryFact[]): void {
  for (const message of turn.messages) {
    if (!message.cites?.length) continue;
    const sources = message.cites.flatMap((id) => {
      const fact = facts.find((given) => given.id === id);
      return fact ? [{ id, text: fact.text }] : [];
    });
    if (sources.length > 0) message.sources = sources;
  }
}
