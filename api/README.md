# api

Node 24 + Express 5 in TypeScript. Checks the Clerk token, reads and writes SurrealDB, runs the
orchestrator from `agents`, and is the only place the Claude key exists.

Endpoints and the `Turn` shape are in [`../agents/CONTRACTS.md`](../agents/CONTRACTS.md).

Host: Render, decided in [`../DECISIONS.md`](../DECISIONS.md) (2026-10-19). Live at
https://build-north-api.onrender.com, in Render's Virginia region next to the SurrealDB Cloud
instance (AWS US East, N. Virginia).

## Run it

From the repo root, with `.env` filled in (see [`../.env.example`](../.env.example)):

```bash
npm run dev -w api
```

That serves on `http://localhost:3000` and restarts on save. `npm test -w api` runs the tests and
`npm run typecheck -w api` type checks. The store's tests need a real SurrealDB and are skipped
without one; the top of [`src/store.test.ts`](src/store.test.ts) shows how to run them against a
local container.

There is no build step: Node runs the `.ts` files as they are, by stripping the types. So only write
TypeScript that can be erased (no `enum`, `namespace` or constructor parameter properties), import
local files with their `.ts` extension, and use `import type` for types. The type check catches the rest.

## Routes so far

| Route | What it does |
|---|---|
| `GET /health` | `{ ok: true, commit, memory }`: Render's health check (never touches the database), plus the running commit (Render's `RENDER_GIT_COMMIT`, 7 characters; `null` locally) and `"on"` or `"off"` for Agent Memory, so a deploy and the flag can be checked with one request |
| `GET /health/db` | Asks SurrealDB for its clock and returns it with how many milliseconds that took. Read-only. `503` when the database is not configured, refuses the login or takes over 5 s; the cause goes to the server log, not the response |
| `POST /sessions` | `{ concept, material?, mode? }`: saves a new session and returns its first `Turn`, the prediction question. `mode: "test"` (the testers' pre-test and post-test) puts every move at level 5: after the prediction the learner asks the fact desk with `{ question }` and builds the whole map, and the session never writes mastery. `400` for a bad body, `413` for notes over 8,000 characters |
| `GET /sessions` | `{ sessions: SessionSummary[] }`: the caller's sessions that have a `Turn`, newest first, each with its concept, mode, date, whether it is finished and, once it is, its score and prediction. Start lists the unfinished ones to pick up and the finished ones under "Your maps" |
| `GET /sessions/:id` | The session's latest `Turn`: Resume on Start reads it after a reload or a killed app (#137), and "Your maps" opens a finished session with it (its result Turn, read-only). `404` if it doesn't exist or belongs to someone else |
| `GET /sessions/:id/transcript` | `{ steps }`: every saved step of the session, oldest first, each the body the learner sent (`null` for the start) and the `Turn` it got, so the app shows a picked-up session or a reopened map with its whole conversation. `[]` for a session saved before Oct 25. `404` like `GET /sessions/:id` |
| `POST /sessions/:id/turns` | One of the bodies in CONTRACTS.md section 1, plus `turn`, the number of the `Turn` it answers. Returns the next `Turn`. An answer to an older `Turn` gets the latest one back and runs nothing; two copies of the same answer arriving at once both run, and the one that saves first is the one that counts. A `Turn` with `error` saves nothing, and neither does a `Turn` that doesn't fit the contract (checked with the `Turn` schema before the save): the answer is then the latest `Turn` with `error` set (`agent_failed`, retryable), the reason goes to the server log, and the retry runs the agents again. Mastery is written only for the moves the `Turn` changed, never for a test session. `400` for a bad body, `404` if the session doesn't exist or belongs to someone else (both with `{ error }`). `409` with the latest `Turn` for a `turn` from the future or a body the latest `Turn` doesn't ask for; the reason goes to the server log |
| `GET /me/mastery` | The caller's `Mastery`: the four moves in session order, at level 1 until the orchestrator raises them |
| `GET /me/memory` | The caller's `MemoryView` (CONTRACTS.md section 2b), what the app's Memory sheet shows: per concept and part the level now and how it changed, and the latest guess against the score beside the one before. `{ "concepts": [] }` with memory off, or before a first finished session |
| `DELETE /me/data` | `204`. Purges the caller's memory scope, then deletes their sessions, their agent logs and mastery (the delete button). If the purge fails, nothing is deleted and the answer is a `500`, so the learner can try again |

The session and `/me` routes need the Clerk session token as `Authorization: Bearer <token>` (#23).
The API checks it without a network call, using the instance's PEM public key in `CLERK_JWT_KEY` (in
the Clerk dashboard: API keys, Show JWT public key), and keys sessions and mastery by the Clerk user
id. A web build's token names the origin it came from, which must be one of the `CORS_ORIGIN`
origins; the native app's token names none. A token that doesn't hold up gets `401`, even with the dev
headers below.

Outside production, `x-dev-user` also works, but only together with an `x-dev-key` header equal to
the server's `DEV_KEY` (CONTRACTS.md section 1). Without a `DEV_KEY`, or with `NODE_ENV=production`,
the dev headers get `401`. Leo shares the key; it never goes in the repo or in the deployed web build.

Every route except `/health` allows 60 requests a minute from one IP (`REQUESTS_PER_MINUTE` changes it; Render
runs with 240 since Oct 23, for a room of testers on one Wi-Fi), then answers `429`.

The API's types and request schemas come from `@build-north/agents` (`agents/src/contracts.ts`), so
a change to the contract shows up here as a type error. With Claude on (below), `/turns` runs
Cynthia's orchestrator, `advance` from `@build-north/agents` (#28). With Claude off, the `Turn`s come
from [`src/advance-stub.ts`](src/advance-stub.ts) instead, with the same `Advance` type. It replays
Cynthia's democracy walk-through, [`agents/fixtures/session-1.json`](../agents/fixtures/session-1.json):
one `Turn` per answer, the same 9 whatever the concept, the mode or the answers (a Help gets the next
one too), and mastery stays at level 1. That way the app runs against an API with no key. The stub is for
development only: a process that looks like production (`NODE_ENV=production`, which Render sets by default,
or Render's `RENDER_GIT_COMMIT`) and lacks the Claude key or the database refuses to start instead
(`orchestratorFor` in `src/advance-stub.ts`), so a Render deploy that lost a variable fails its health check
and the last healthy deploy stays up.

## Claude calls

[`src/call-agent.ts`](src/call-agent.ts) is the only code that talks to Claude (#10). Each agent is
one structured-output call, set up from Cynthia's registry in `@build-north/agents` (`AGENTS`, #2):
the agent's system prompt, the user message its `render` writes from the input, its effort, and its
Zod schemas. The reply is checked against the output schema. Every call writes an `agent_log` row
with its milliseconds and its cost in dollars. An agent that isn't in the registry fails before any
call. When the coach's call fails (#44), the session still ends: `advance` writes fixed text from the
result's numbers instead.

| Variable | What it does |
|---|---|
| `ANTHROPIC_API_KEY` | Turns Claude calls on. Render and your local `.env` only, never the app |
| `AGENT_MODEL` | `claude-opus-5-5` (default) or `claude-sonnet-5-5`, the two models with a price in the code |
| `AGENT_BUDGET_USD` | Required with the key: the Claude budget in dollars |
| `REQUESTS_PER_MINUTE` | Per IP, every route except `/health`; 60 when unset. Raise it for a room of testers on one Wi-Fi, who share an IP (240 on Render since Oct 23) |

Following DECISIONS.md (Oct 20), calls stop at 95% of the budget, and while any of Anthropic's
rate-limit windows is 95% used, until it refills. Both come back as a `rate_limited` error in the
`Turn`: retryable for a rate limit, not for the budget. The spend is counted in memory, so it starts
again at $0 after a restart; the account's own balance, with auto-reload off (#20), is the hard stop.

## SurrealDB

- SurrealDB 3 does not create a namespace or database on first use. `SURREAL_NAMESPACE` and
  `SURREAL_DATABASE` must already exist on the instance (create them in Surrealist); otherwise
  `/health/db` answers `503` and the log says `The namespace '…' does not exist`.
- `SURREAL_AUTH_LEVEL` is the level the user was created at: `root` (default), `namespace` or `database`.
- Two databases on the instance: `dev` for local work, and `prod`, which only Render uses, so the
  testers' sessions never mix with test data.
- One connection per process, opened at startup. After a drop it reconnects on its own; requests in
  the meantime fail after 5 s instead of hanging.
- All the database code is in [`src/store.ts`](src/store.ts), and the orchestrator never touches the
  database. At startup the store defines the `session`, `mastery` and `agent_log` tables from
  CONTRACTS.md section 4. They stay schemaless so the orchestrator's state can grow, but the fields
  the API relies on are typed, so a bad level or mode is refused instead of saved.

## Agent Memory (#112)

[`src/memory.ts`](src/memory.ts) is the API's side of SurrealDB Agent Memory (CONTRACTS.md section 2,
Memory): what earlier sessions left about a learner, read before the hint giver and the coach, written
when a session reaches its result, shown by `GET /me/memory` and purged by `DELETE /me/data`. Scope registration and
fact writes get at most three attempts. Fact retries reuse an idempotency key; deletion stops later attempts, and a
write that timed out waits one more write's time before the purge. Waiting for learner writes has a 30-second HTTP
deadline (`503`). Late provider commits and cross-process ordering remain
outside this process-local guarantee. Off by
default in the code; on in production since Oct 23 at 9:11 PM ET (`DECISIONS.md`, "Agent Memory goes on for
the testers"): `/health` answers `"memory": "on"`, and the kill switch is `AGENT_MEMORY_ENABLED` set to anything
else (about a minute, no deploy).

| Variable | What it does |
|---|---|
| `AGENT_MEMORY_ENABLED` | `true` turns memory on. Unset or anything else: off, and every route runs as before memory existed |
| `AGENT_MEMORY_ENDPOINT` | The context's host, `https://<host>` (SurrealDB Studio, the context's API keys view). Required when on |
| `AGENT_MEMORY_CONTEXT` | The context id. Required when on |
| `AGENT_MEMORY_API_KEY` | A key for that context with read, write, scope-create and forget grants. Render and your local `.env` only, never the app |
| `LEARNER_ID_SALT` | Salts the learner's pseudonym, the same one the testers' export uses (above). Set it to the same value on Render and for the export |
| `TZ` | The zone a fact's date is written in ("on Oct 23"); `America/Toronto` when unset, the zone the Memory sheet's dates show on the team's and the testers' devices |

What goes in: after a session has its result, one fact per part whose level changed ("You moved up to
level 3 on 'What it isn't' for API on Oct 22."), a baseline for a finished part memory holds no level for
yet ("You were at level 5 on 'Its types' for API on Oct 23.", so a learner at level 5 everywhere still has a
row per part), the gap ("Last time on API you guessed 7 and proved
3.") and the Helps each part took ("'Its types' took 2 Helps on API last time."). Each is a sentence code
writes from a template, sent as a triple (`infer: "triples"`: memory runs no model on it), so the
learner's words never go in. The scope is `learner/<pseudonym>`, the entity `topic/<pseudonym>_<concept>`,
and each row carries its provenance in labels (`session`, `turn`, `writer`, and the numbers). A later
session's write of the same key supersedes the earlier value; memory keeps the chain, and the Memory
sheet shows it. Two things the live context taught us (Oct 23): a dot in a key is folded into an
underscore, so the keys are `level_<move>`, `gap` and `help_<move>` from the start; and parallel writes
on one entity fail with "unknown error", so the writes go one after another (about 5 s for a session's
seven facts, off the request path).

What comes out: before the hint giver and the coach, up to 8 facts from the learner's earlier sessions
on the concept (the current level per part, the latest gap, the Helps that cost most), read once per
Turn and only when one of those two runs. A read over 1.5 s, an empty one or the flag off: the agent
runs without memory and the user message is the one it always had. The orchestrator copies the facts a
message cites onto it (`Message.cites`); the API keeps only ids it passed in (`verifyCites`), logs the
rest on the `agent_log` row as `dropped`, and fills `Message.sources` with the cited facts' words, so
the app can show "From what Lumente remembers: …". The write runs off the request path: a memory that
is down costs the learner nothing but the facts, and the cause goes to the server log. The tables above
stay the record; memory never changes a number.

**How it went on in production (Oct 23):** the app parses every `Turn` with the strict schema, so a build without
the `cites` and `sources` fields rejects a Turn that carries them. The order was Ship, then Render
(docs/deploy.md): the app update with #130 (issue #112) reached the `preview` channel and both web addresses at
about 12:50 PM (`docs/expo-log.md`, the rollout of `main` at 99880ae), and `AGENT_MEMORY_ENABLED=true` went on
Render at 9:11 PM. The same order holds if the flag is ever turned off and on again after an app change to those
fields. #147 (Oct 23 night) added the baseline level fact and the `TZ` rule above; both are API-side and need no
app update.

```bash
npm run memory:smoke -w api
```

The memory smoke test, against the live context with a throwaway learner that it erases at the end:
a session's facts are written, its own coach reads nothing, a second session reads them within 1.5 s,
a second write supersedes the first and the chain is kept, a third session reads the current facts
with what they superseded, the Memory sheet's view shows the level change and both gaps, the rows hold
sentences only, and the purge leaves nothing. Exit 0 with a note when the three memory variables are
unset (so it runs anywhere the API's smoke test runs), exit 1 on any failure. Prints no secret.

## The demo profile

```bash
npm run seed:demo -w api -- <user id>
```

Loads Cynthia's demo profile ([`agents/fixtures/demo-seed.json`](../agents/fixtures/demo-seed.json),
#32) for one user, through the same store the API reads: level 5 on all four moves, and the CORS
session waiting at the whole map, with the prediction (7) already made. It prints the session's id.
Running it again resets the mastery to the seed and adds a fresh waiting session; earlier sessions
stay.

- **The user id** is what the API keys rows by: the demo account's Clerk user id (its `sub`, now that
  Clerk is in, #23), or an `x-dev-user` name for local work.
- **The database** is the one the `SURREAL_*` variables name. With the root `.env` that's `dev`. For
  demo day, set `SURREAL_DATABASE=prod` in the shell for that one run (a variable set in the shell wins
  over `.env`), with a user that can write to `prod`.

## The testers' numbers (#50)

```bash
npm run export:testers -w api -- testers.csv
```

Reads every finished test session (the pre-test and the post-test of each tester,
[`docs/tester-protocol.md`](../docs/tester-protocol.md)) from the database the `SURREAL_*` variables
name, and writes two files: `testers.csv`, the rows of [`docs/grading-sheet.csv`](../docs/grading-sheet.csv)
with the evaluator's four scores, the prediction, the questions and the hints filled in (the human
columns stay empty for #49), and `testers.maps.json`, each map to grade by hand. Testers appear as
`L1`, `L2`... in the order their first test session started, plus a pseudonym in the notes (8 hex
characters of a salted hash of their user id; set `LEARNER_ID_SALT` to salt it). No name or Clerk id
is written. The first finished test session of a tester is the pre-test, the last the post-test.

## The smoke test (#45, #37)

```bash
npm run smoke -w api                                          # the live API and web build
npm run smoke -w api -- http://localhost:3000 http://localhost:8081   # or any pair
```

Seven checks with no credentials, exit code 1 on any failure: `/health`, `/health/db` (read-only: it asks the
database for its clock), a call with no token and one with the dev headers both answer 401, the web build's origin
passes the CORS preflight, the web build answers with Lumente's title, and its bundle names this API's
host (a demo-mode export would not). A full session on the public URL is still a person's walk through
the web build; this is the part before and after it, and the warm-up before the testers.

## Deploy on Render

Render dashboard → **New → Web Service**:

| Field | Value |
|---|---|
| Source | **Git Provider** once the Render GitHub app has access to this repo (auto-deploys on merge). Until then, **Public Git Repository** with `https://github.com/CynthiaSalazarB/lumente` (manual deploys only) |
| Branch | `main` |
| Region | Closest to the SurrealDB instance, whose AWS region code is in `SURREAL_URL` (`aws-euw1` would be eu-west-1). It can't be changed later |
| Root directory | Empty (the repo root): the API needs the workspace lockfile and `agents/` (`@build-north/agents`) |
| Build command | `npm ci --workspace api` |
| Start command | `node api/src/server.ts` |
| Health check path | `/health` (under Advanced) |
| Instance type | Free while building (it sleeps after 15 min idle and takes about a minute to wake). Starter from Oct 22, per `DECISIONS.md` |
| Environment | `CORS_ORIGIN` (comma-separated: the Expo dev server and every web build's address, since a web build's Clerk token must come from one of them), the `SURREAL_*` values with `SURREAL_DATABASE=prod`, `CLERK_JWT_KEY` (#23), `ANTHROPIC_API_KEY` with `AGENT_BUDGET_USD` for Claude calls (#10), `REQUESTS_PER_MINUTE` for a room on one IP, and with memory on the `AGENT_MEMORY_*` variables and `LEARNER_ID_SALT` (above) |

The Node version comes from [`../.node-version`](../.node-version). Render sets `PORT` itself, and
also sets `NODE_ENV=production` unless the service sets its own, which turns `x-dev-user` off on the
public URL. Since Oct 22 the service sets no `NODE_ENV`, so every caller signs in with Clerk (#22, #23);
a `DEV_KEY` left on Render does nothing there.
