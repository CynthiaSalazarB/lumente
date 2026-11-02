import { CreateSessionBody, SavedTurnBody, Turn, TurnBody, UnexpectedInput, type Advance, type CallAgent, type Expects, type Mastery } from "@build-north/agents";
import cors from "cors";
import express, { type ErrorRequestHandler, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { createHash, timingSafeEqual } from "node:crypto";
import type { DbCheck } from "./db.ts";
import { MemoryError, fillSources, withMemory, type LearnerMemoryStore } from "./memory.ts";
import type { MasteryProgress, NewSession, Store } from "./store.ts";

export type AppOptions = {
  corsOrigins: string[];
  checkDb: (() => Promise<DbCheck>) | null;
  store: Store | null;
  // CONTRACTS.md section 3: the orchestrator and the only way it reaches Claude, one callAgent per
  // session so every agent_log row names its session, and its learner (Delete my data finds the row by them)
  advance: Advance;
  callAgentFor: (sessionId: string, user?: string) => CallAgent;
  // CONTRACTS.md section 1: the Clerk user id in a session token, or null for a token that doesn't
  // hold up (#23). null when Clerk isn't set up (no CLERK_JWT_KEY), so no token signs anyone in.
  userFromToken: ((token: string) => Promise<string | null>) | null;
  // Outside production, x-dev-user also names the caller, but only with x-dev-key matching this key.
  // null turns dev users off (production, or no DEV_KEY set).
  devKey: string | null;
  // per IP, for every route except /health
  requestsPerMinute?: number;
  // CONTRACTS.md section 2, Memory (#112): what earlier sessions left, read before the hint giver and the coach,
  // written when a session has its result, shown by GET /me/memory and purged by DELETE /me/data. null with the
  // flag off: every route then runs as before memory existed.
  memory: LearnerMemoryStore | null;
  // With memory null (the flag off) but memory set up, Delete my data's purge of what the learner left there while the
  // flag was on: it is still theirs to delete. null when memory was never set up (code review, Oct 28).
  purgeMemory?: ((user: string) => Promise<void>) | null;
  // The commit this process runs (Render's RENDER_GIT_COMMIT, shortened), so /health says what is live
  // without a dashboard visit. null when unknown (local runs, tests).
  commit?: string | null;
};

const MAX_CONCEPT = 100;
const DEV_USER = /^[A-Za-z0-9._@-]{1,64}$/;
const SESSION_ID = /^[a-z0-9]{1,40}$/; // the ids SurrealDB generates

// CONTRACTS.md section 1: what a /turns body may send for each `expects`. Help goes by the phase
// instead: it works during the moves, the whole map included, where `advance` has a hint to give.
const ANSWERS: Record<Expects, readonly string[]> = {
  prediction: ["prediction"],
  text: ["text"],
  continue: ["continue"],
  map: ["question", "mentefacto"],
  none: [],
};
const TURN_BODY = 'Send turn with one of: prediction (0 to 8), text, question, mentefacto, or action ("help" or "continue")';

// Hashing first gives timingSafeEqual two buffers of the same length, whatever was sent.
const digest = (text: string) => createHash("sha256").update(text).digest();
const sameKey = (sent: string, expected: string) => timingSafeEqual(digest(sent), digest(expected));

// A schema's issues as one line for the response
const describe = (issues: readonly { path: readonly PropertyKey[]; message: string }[]) =>
  issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ");

type Parsed<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

/** The moves whose level or count of unassisted successes `after` changed from `before`, with the level reached and
 * the successes added: what a Turn writes back, onto mastery as it is stored by then (`Store.saveSession`), so the
 * moves it left alone, and what a parallel session saved meanwhile, stay. */
export function changedMoves(before: Mastery, after: Mastery): MasteryProgress[] {
  return after.moves.flatMap((m) => {
    const was = before.moves.find((b) => b.move === m.move);
    const gained = m.unassistedSuccesses - (was?.unassistedSuccesses ?? 0);
    return !was || was.level !== m.level || gained !== 0 ? [{ move: m.move, level: m.level, gained }] : [];
  });
}

/** What this process has in flight for each learner (Render runs the API as one), so Delete my data finishes it first:
 * the Turns being answered, their agent_log rows included, and the memory write a result starts, which stops before
 * its next fact once a delete begins (`stop`). The learner's writes that come during the delete wait until it's done. */
function waitFor<T>(work: Promise<T>, waitMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(message), { status: 503, expose: true })), waitMs);
  });
  return Promise.race([work, deadline]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export function learnerWrites(waitMs = 30_000) {
  const inFlight = new Map<string, Set<Promise<unknown>>>();
  const stops = new Map<string, AbortController>();
  const erasing = new Map<string, Promise<void>>();

  /** Counts `work` as one of the learner's writes until it settles. */
  function track<T>(user: string, work: Promise<T>): Promise<T> {
    const writes = inFlight.get(user) ?? new Set<Promise<unknown>>();
    inFlight.set(user, writes);
    writes.add(work);
    const done = () => {
      writes.delete(work);
      if (writes.size === 0 && inFlight.get(user) === writes) {
        inFlight.delete(user);
        stops.delete(user);
      }
    };
    work.then(done, done);
    return work;
  }

  return {
    track,
    /** Runs one of the learner's writes once no delete of theirs is under way. From the check to `work` starting
     * nothing is awaited, so a delete can't begin in between unseen. */
    async run<T>(user: string, work: (stop: AbortSignal) => Promise<T>): Promise<T> {
      while (erasing.has(user)) {
        await waitFor(erasing.get(user)!, waitMs, "A data deletion is still pending; retry this request shortly");
      }
      let stop = stops.get(user);
      if (!stop) stops.set(user, (stop = new AbortController()));
      return track(user, work(stop.signal));
    },
    /** Runs `work` (the delete) once the learner's writes in flight have settled, the ones they start meanwhile
     * included: a Turn that began before the delete can still start agent calls, and one of them can outlive it. */
    async erase(user: string, work: () => Promise<void>): Promise<void> {
      while (erasing.has(user)) {
        await waitFor(erasing.get(user)!, waitMs, "A data deletion is still pending; retry Delete my data shortly");
      }
      stops.get(user)?.abort();
      stops.delete(user);
      const deleting = (async () => {
        while (inFlight.get(user)?.size) await Promise.allSettled([...inFlight.get(user)!]);
        await work();
      })();
      const settled = deleting.then(
        () => {},
        () => {},
      ).finally(() => {
        if (erasing.get(user) === settled) erasing.delete(user);
      });
      erasing.set(user, settled);
      await waitFor(deleting, waitMs, "Deletion is still waiting for an in-flight write; retry shortly");
    },
  };
}

// The body schema is Cynthia's (@build-north/agents). The API adds what the schema leaves to it: 413
// for notes over 8,000 characters, a cap on the concept's length, and trimming.
function parseNewSession(body: unknown): Parsed<NewSession> {
  const parsed = CreateSessionBody.safeParse(body);
  if (!parsed.success) {
    const tooLong = parsed.error.issues.some((issue) => issue.path[0] === "material" && issue.code === "too_big");
    if (tooLong) return { ok: false, status: 413, error: "Your notes are over 8,000 characters. Paste a shorter excerpt." };
    return { ok: false, status: 400, error: describe(parsed.error.issues) };
  }
  const { concept, material, mode = "learn" } = parsed.data;
  if (!concept.trim() || concept.trim().length > MAX_CONCEPT) {
    return { ok: false, status: 400, error: `concept must be text, 1 to ${MAX_CONCEPT} characters` };
  }
  return { ok: true, value: { concept: concept.trim(), material: material?.trim() ? material : null, mode } };
}

export function createApp({ corsOrigins, checkDb, store, advance, callAgentFor, userFromToken, devKey, requestsPerMinute = 60, memory, purgeMemory = null, commit = null }: AppOptions) {
  const app = express();
  const writes = learnerWrites();
  // Every agent call is one of the learner's writes too (its agent_log row): the orchestrator asks the next question
  // beside the evaluator, and when the evaluator fails fast that call outlives the Turn (code review, Oct 27).
  const callsFor = (user: string, sessionId: string): CallAgent => {
    const call = callAgentFor(sessionId, user);
    return (agent, input) => writes.track(user, call(agent, input));
  };
  app.disable("x-powered-by");
  // Render puts one proxy in front of the app; trusting it makes req.ip the caller's address.
  app.set("trust proxy", 1);
  app.use(cors({ origin: corsOrigins }));
  // Clients send plain JSON. Reject compressed bodies before creating a decoder (GHSA-27r3-jxmh-p828).
  app.use(express.json({ limit: "64kb", inflate: false }));

  // The Clerk user id from the session token. Without a token, x-dev-user with the right x-dev-key,
  // which devKey turns off in production. A token that doesn't hold up never falls back to the dev headers.
  async function signedIn(req: Request): Promise<string | null> {
    const token = /^Bearer (\S+)$/i.exec(req.get("authorization") ?? "")?.[1];
    if (token) return userFromToken ? userFromToken(token) : null;
    const name = req.get("x-dev-user");
    const key = req.get("x-dev-key");
    return devKey && name && DEV_USER.test(name) && key && sameKey(key, devKey) ? name : null;
  }

  // Who is calling, and whether there is a database to serve them. Answers the request itself when not.
  async function caller(req: Request, res: Response): Promise<{ user: string; store: Store } | null> {
    const user = await signedIn(req);
    if (!user) {
      const devHeaders = devKey ? ", or x-dev-user with x-dev-key" : "";
      res.status(401).json({ error: `Sign in first: send the Clerk session token as Authorization: Bearer <token>${devHeaders}` });
      return null;
    }
    if (!store) {
      res.status(503).json({ error: "SurrealDB is not configured (SURREAL_URL is unset)" });
      return null;
    }
    return { user, store };
  }

  // `ok` is what Render's health check reads; `commit` and `memory` let anyone confirm which commit is live
  // and whether the memory flag is on, with one request and no dashboard. Neither is a secret.
  app.get("/health", (_req, res) => {
    res.json({ ok: true, commit, memory: memory ? "on" : "off" });
  });

  // After /health, so Render's health checks never count against it.
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: requestsPerMinute,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler: (_req, res) => {
        res.status(429).json({ error: "Too many requests. Wait a minute and try again" });
      },
    }),
  );

  // Ops check, not part of the app contract: proves the API can reach SurrealDB.
  app.get("/health/db", async (_req, res) => {
    if (!checkDb) {
      res.status(503).json({ ok: false, error: "SurrealDB is not configured (SURREAL_URL is unset)" });
      return;
    }
    try {
      res.json({ ok: true, ...(await checkDb()) });
    } catch (error) {
      console.error("GET /health/db failed:", error);
      res.status(503).json({ ok: false, error: "SurrealDB check failed; the cause is in the server logs" });
    }
  });

  app.post("/sessions", async (req, res) => {
    const who = await caller(req, res);
    if (!who) return;
    const parsed = parseNewSession(req.body);
    if (!parsed.ok) {
      res.status(parsed.status).json({ error: parsed.error });
      return;
    }
    // CONTRACTS.md section 3: load, advance, save what comes back, return the Turn
    await writes.run(who.user, async () => {
      const session = await who.store.createSession(who.user, parsed.value);
      const mastery = await who.store.getMastery(who.user);
      const next = await advance({ session, mastery }, { action: "start" }, callsFor(who.user, session.id));
      // the first step of the conversation the app replays when the session is picked up again
      if (!next.turn.error) next.session.transcript.push({ body: null, turn: next.turn });
      // Nothing else knows this session's id yet, so this save can't lose to another request. A test session never
      // writes mastery and a start changes none, so the progress is empty in practice; the rule is the same as /turns.
      await who.store.saveSession(next.session, session.turn, session.mode === "test" ? [] : changedMoves(mastery, next.mastery));
      res.status(201).json(next.turn);
    });
  });

  // Start's lists (CONTRACTS.md section 1): the sessions to pick up and "Your maps"
  app.get("/sessions", async (req, res) => {
    const who = await caller(req, res);
    if (!who) return;
    res.json({ sessions: await who.store.listSessions(who.user) });
  });

  app.get("/sessions/:id", async (req, res) => {
    const who = await caller(req, res);
    if (!who) return;
    const session = SESSION_ID.test(req.params.id) ? await who.store.getSession(who.user, req.params.id) : null;
    if (!session?.lastTurn) {
      res.status(404).json({ error: "No such session" });
      return;
    }
    res.json(session.lastTurn);
  });

  // The session's whole conversation, oldest first, so a session picked up again (or a finished map opened again)
  // shows every step it had, not only the latest Turn. A session saved before Oct 25 has no steps; the app then shows
  // its latest Turn alone.
  app.get("/sessions/:id/transcript", async (req, res) => {
    const who = await caller(req, res);
    if (!who) return;
    const session = SESSION_ID.test(req.params.id) ? await who.store.getSession(who.user, req.params.id) : null;
    if (!session?.lastTurn) {
      res.status(404).json({ error: "No such session" });
      return;
    }
    // Opt in so older clients with strict transcript schemas keep reading their history.
    res.json({ steps: session.transcript, ...(req.query.material === "1" ? { material: session.material } : {}) });
  });

  app.post("/sessions/:id/turns", async (req, res) => {
    const who = await caller(req, res);
    if (!who) return;
    // The shape first, at any length: the limits only stop a body that would be judged, so a resend of a Turn already
    // judged still gets the latest Turn, and a missing session its 404 (code review, Oct 28)
    const parsed = SavedTurnBody.safeParse(req.body);
    if (!parsed.success) {
      // a body that matches none of the shapes gets the list instead of Zod's "Invalid input"
      const noShape = parsed.error.issues[0]?.code === "invalid_union";
      res.status(400).json({ error: noShape ? TURN_BODY : describe(parsed.error.issues) });
      return;
    }
    // one of the learner's writes: Delete my data waits for it, and it waits for a delete under way (learnerWrites)
    await writes.run(who.user, async (stop) => {
      const session = SESSION_ID.test(req.params.id) ? await who.store.getSession(who.user, req.params.id) : null;
      if (!session?.lastTurn) {
        res.status(404).json({ error: "No such session" });
        return;
      }
      const { turn, ...input } = parsed.data;
      const latest = session.lastTurn;
      // Decision 18: an answer to an older Turn was judged already, so it gets the latest Turn back
      if (turn < session.turn) {
        res.json(latest);
        return;
      }
      // CONTRACTS.md section 5: a 409 answers with the latest Turn too, so the app draws whatever /turns
      // sends back. The reason goes to the server log.
      const conflict = (reason: string) => {
        console.warn(`409 for session ${session.id}: ${reason}`);
        res.status(409).json(latest);
      };
      if (turn > session.turn) {
        conflict(`Turn ${turn} doesn't exist yet; the latest is ${session.turn}`);
        return;
      }
      const sent = "action" in input ? input.action : (Object.keys(input)[0] ?? "");
      const { expects } = latest;
      const allowed = sent === "help" ? session.phase === "move" : ANSWERS[expects].includes(sent);
      if (!allowed) {
        conflict(expects === "none" ? "This session is over" : sent === "help" ? "Help works during the moves" : `Turn ${turn} expects ${expects}, not ${sent}`);
        return;
      }
      if (!TurnBody.safeParse(parsed.data).success) {
        res.status(400).json({ error: "text" in input ? "Your answer is over 2,000 characters. Shorten it and send it again." : "Your question is over 500 characters. Shorten it and send it again." });
        return;
      }
      const mastery = await who.store.getMastery(who.user);
      // The hint giver and the coach get what this learner's earlier sessions left, read once per Turn and only
      // when one of them runs; over 1.5 s, empty or off, they run without it (CONTRACTS.md section 2, Memory).
      const remembered = memory ? withMemory(callsFor(who.user, session.id), () => memory.recall(who.user, session.concept, session.id)) : null;
      const next = await advance({ session, mastery }, input, remembered?.callAgent ?? callsFor(who.user, session.id)).catch((error: unknown) => {
        // input that doesn't fit the phase changes nothing
        if (error instanceof UnexpectedInput) return error;
        throw error;
      });
      if (next instanceof UnexpectedInput) {
        conflict(next.message);
        return;
      }
      // CONTRACTS.md section 5: an agent failed, so nothing moved on and there is nothing to save. Writing the
      // unchanged session and mastery back here could overwrite what a parallel request saved meanwhile.
      if (next.turn.error) {
        res.json(next.turn);
        return;
      }
      // the words of the facts a hint or the coach cited, so the app can show where they came from
      if (remembered) fillSources(next.turn, remembered.given());
      // The Turn is what the app draws and what the session keeps as its lastTurn, so one off the contract (an agent's
      // output reaching a stricter Turn field, as #139 found) would be refused by the app and fail every later read of
      // the session. It is never saved: the learner gets the latest Turn again with error set, and the retry runs
      // the agents again (CONTRACTS.md section 5).
      const checked = Turn.safeParse(next.turn);
      if (!checked.success) {
        console.error(`Turn ${next.turn.turn} of session ${session.id} is off the contract and wasn't saved: ${describe(checked.error.issues)}`);
        res.json({ ...latest, error: { code: "agent_failed", retryable: true } });
        return;
      }
      // CONTRACTS.md section 3: a test session never writes mastery. Only the moves this Turn moved on are written, in
      // the session's own transaction and against the stored levels: the copy read before the Claude call is seconds
      // old, and another session may have saved a level since.
      const progress = session.mode === "test" ? [] : changedMoves(mastery, next.mastery);
      // saved with the session, in the same conditional write, so a step lands exactly when its Turn does
      next.session.transcript.push({ body: parsed.data, turn: next.turn });
      if (!(await who.store.saveSession(next.session, session.turn, progress))) {
        // another request answering the same Turn saved first, and its Turn is the one that counts
        const saved = await who.store.getSession(who.user, session.id);
        if (saved?.lastTurn) res.json(saved.lastTurn);
        else res.status(404).json({ error: "No such session" });
        return;
      }
      // The session has its result: what it leaves for the next one is written off the request path. The tables
      // above stay the record, so a memory that is down costs the learner nothing but the facts; the cause is logged.
      // A delete that began meanwhile (`stop`) leaves it unwritten, and one that begins later waits for it.
      if (memory && next.session.result && !session.result && !stop.aborted) {
        writes.track(
          who.user,
          memory.remember(who.user, next.session, stop).catch((error: unknown) => console.error(`memory write failed for session ${session.id}:`, error)),
        );
      }
      res.json(next.turn);
    });
  });

  // The Memory sheet (CONTRACTS.md section 2b). Empty with memory off, so the app says there is nothing yet.
  app.get("/me/memory", async (req, res) => {
    const who = await caller(req, res);
    if (!who) return;
    if (!memory) {
      res.json({ concepts: [] });
      return;
    }
    const [concepts, reads] = await Promise.all([who.store.finishedConcepts(who.user), who.store.memoryReads(who.user)]);
    res.json(await memory.view(who.user, concepts, reads));
  });

  app.get("/me/mastery", async (req, res) => {
    const who = await caller(req, res);
    if (!who) return;
    res.json(await who.store.getMastery(who.user));
  });

  // The delete button: the caller's memory scope, then their sessions, their agent logs, and mastery. Ambiguous fact
  // writes have bounded retries before purge. The HTTP wait is 30 s; other processes/restarts are not fenced.
  app.delete("/me/data", async (req, res) => {
    const who = await caller(req, res);
    if (!who) return;
    await writes.erase(who.user, async () => {
      if (memory) await memory.purge(who.user);
      else if (purgeMemory) await purgeMemory(who.user);
      await who.store.deleteUserData(who.user);
    });
    res.status(204).end();
  });

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // Every error answers in JSON, never with a stack trace. body-parser marks its own errors with a status and `expose`:
  // 400 for broken JSON, 413 for a body over the limit, with words meant for the caller. Memory failing (MemoryError,
  // whose status and words are memory's) is a service behind the API: a 502 the app offers to retry, and memory's words
  // go to the log only (code review, Oct 28: a key memory refused read as the learner's sign-in failing).
  const onError: ErrorRequestHandler = (error, _req, res, _next) => {
    const status = error?.expose === true && typeof error.status === "number" && error.status <= 503 ? error.status : error instanceof MemoryError ? 502 : 500;
    if (status >= 500) console.error(error);
    res.status(status).json({ error: status === 502 ? "Memory didn't answer; the cause is in the server logs" : status === 500 ? "Something went wrong; the cause is in the server logs" : String(error.message) });
  };
  app.use(onError);

  return app;
}
