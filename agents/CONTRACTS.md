# Agent contracts · v0.1

Locked at the Oct 19 kickoff ([section 6](#6-kickoff-decisions-oct-19) lists what was decided). This
file is the reference; the Zod schemas in `agents/` follow it. A change goes through a pull request
and, if it has a real trade-off, a line in `DECISIONS.md`.

Three layers, three pairs of people:

| Layer | Between | Section |
|---|---|---|
| App ↔ API | Jonathan + Leo | [1. API and the `Turn`](#1-api-and-the-turn) |
| API ↔ agents | Leo + Cynthia | [2. Agents](#2-agents) |
| What's stored | Leo | [4. State in SurrealDB](#4-state-in-surrealdb) |

**The rule behind the split: numbers in code, words in the model.** Code picks the level, the hint
step, the points, the calibration gap and the mastery update, so the numbers on the slide are
deterministic and explainable. Claude writes the questions, judges the answers and words the hints.

---

## 0. Shared vocabulary

```ts
type MoveId = "supraordinate" | "exclusion" | "isoordinate" | "infraordinate";
//             bigger group      what it isn't  what it needs   its types

type Level = 1 | 2 | 3 | 4 | 5;   // watch, guided, complete, named only, alone (the learner asks the fact desk)
type HintStep = "nudge" | "hint" | "partial" | "reveal";
type Verdict = "correct" | "partial" | "incorrect";

type Item = { value: string; note: string | null };   // note = the difference, for exclusions

type Mentefacto = {
  concept: string;
  supraordinate: Item | null;
  exclusion: Item[];       // { value: "dictatorship", note: "who holds the power" }
  isoordinate: Item[];
  infraordinate: Item[];
};
```

Moves run in this order in a session: supraordinate, exclusion, isoordinate, infraordinate (the
order of the democracy example in the brief).

Code and JSON use the ids above. The screen shows plain labels, and the method's name appears only
after the learner finds the move ("That's called the supraordinate class"):

```ts
const MOVE_LABEL: Record<MoveId, string> = {
  supraordinate: "Bigger group",
  exclusion: "What it isn't",
  isoordinate: "What it needs",
  infraordinate: "Its types",
};
```

---

## 1. API and the `Turn`

Every call needs the Clerk token as `Authorization: Bearer <token>` (Clerk is in since #23). Outside
production the API also accepts an `x-dev-user: <name>` header, but only together with `x-dev-key: <the
shared dev key>` (Leo shares it privately; it never goes in the repo or the deployed web build). The API
rejects both when `NODE_ENV=production` or when no `DEV_KEY` is set. Every route except `/health` allows
60 requests a minute from one IP (`REQUESTS_PER_MINUTE` changes the number); past that the API answers `429`.

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/sessions` | `{ concept, material?, mode? }` | `Turn` (asks for the prediction) |
| `POST` | `/sessions/:id/turns` | one of `{ prediction }`, `{ text }`, `{ question }`, `{ mentefacto }`, `{ action: "help" }`, `{ action: "continue" }` | `Turn` |
| `GET` | `/sessions` | | `{ sessions: SessionSummary[] }`: the caller's sessions that have a Turn, newest first (`id`, `concept`, `mode`, `createdAt`, `finished`, and `score` and `predictedScore` once the result is in; the schema is in `agents/src/contracts.ts`). Start lists the unfinished ones to pick up and the finished ones under "Your maps", each opened through `GET /sessions/:id` |
| `GET` | `/sessions/:id` | | latest `Turn`: Resume on Start reads it after a reload or a killed app (#137). `404` for a session that isn't the caller's |
| `GET` | `/sessions/:id/transcript` | | `{ steps: TranscriptStep[], material?: string \| null }`: every saved step, oldest first, each the body the learner sent (`null` for the start) and the `Turn` it got. The app replays them so a session picked up again, or a map opened again, shows its whole conversation. `?material=1` also includes the session's original notes for recovery. Empty for a session saved before Oct 25 (the app then shows the latest `Turn` alone). `404` for a session that isn't the caller's |
| `GET` | `/me/mastery` | | `Mastery` |
| `GET` | `/me/memory` | | `MemoryView` (the Memory sheet; see [Memory](#memory-what-earlier-sessions-left)) |
| `DELETE` | `/me/data` | | `204`, deletes sessions, logs (by their session or their learner) and mastery, and purges the learner's memory, with the memory flag off too when memory is set up (the delete button); `502` if memory refuses; `503` if a tracked write does not settle within 30 s |
| `GET` | `/health` | | `{ ok: true, commit, memory }`: the running commit (7 characters, `null` locally) and `"on"` or `"off"` for Agent Memory (#143). Never touches the database, and the rate limit skips it |
| `GET` | `/health/db` | | `{ ok: true, ... }` with SurrealDB's clock and the milliseconds it took (read-only); `503` when the database is not configured or does not answer. An ops check, not part of the app contract |

One endpoint moves a session forward: `/turns`. The app sends the body the last `Turn`'s `expects`
asks for: `prediction` → `{ prediction }`, `text` → `{ text }`, `continue` → `{ action: "continue" }`,
`map` → `{ question }` while the learner asks and `{ mentefacto }` to submit. `{ action: "help" }`
works during the moves, the whole map included.

`text` allows up to 2,000 characters; `question` allows up to 500. Saved transcripts keep older, longer answers and questions readable. The limits stop only a body the Turn would judge: a resend of a Turn already judged still gets the latest Turn, and a missing session its 404. An answer refused for its length goes back to the app's answer field, out of the conversation, to shorten and send again.

The session ends in two Turns, so the result never waits for the coach. The last answer's Turn shows the
result with `result.coach: null` and `expects: "continue"`; the app shows the result and sends
`{ action: "continue" }` at once, with no button. The next Turn brings the coach's words (`result.coach`
and a `summary` message) and `expects: "none"`.

Every `/turns` body also carries `turn`: the number of the `Turn` it answers. If that number is
older than the session's latest, the API returns the latest `Turn` as it is and doesn't call
`advance` again, so an answer resent after a timeout is judged once. The app disables Send while a
call is pending.

The app uses one 90-second deadline over token lookup, headers and body. An uncertain request is retried manually
with "Try again". Pending text is saved with its Turn number and restored only while the server still expects that Turn.
Each Claude API call gets at most one automatic transport retry, with SDK retries disabled. Each completed attempt
writes an `agent_log` row; measured cost counts against the process-local budget. Unknown cost is marked without a reservation.

A body the latest `Turn` doesn't ask for gets `409` with the latest `Turn`, and `advance` isn't
called: a `turn` newer than the latest, a body other than the one `expects` names, Help before the
moves, or any body once `expects` is `none` (the session is over). Like a resent answer, the app
draws whatever `Turn` comes back; the reason goes to the server log. Errors with no `Turn` to send
back (a malformed body, a session that doesn't exist) answer `{ error }`.

Before a `Turn` is saved, the API checks it against the `Turn` schema (#141). One that fails is never saved:
the answer is the latest `Turn` again with `error: { code: "agent_failed", retryable: true }`, nothing is
written to the session, mastery or memory, the reason goes to the server log, and the retry runs the agents
again. A `Turn` with `error` set saves nothing either, and mastery is written only for the moves a `Turn`
changed (#124).

`prediction` is a whole number from 0 to 8. The first `Turn` asks on the same scale as the score, in one
line from code: "You'll build the map of democracy in 4 parts, 2 points each. How many of the 8 points do
you think you'll get?" (`agents/src/orchestrator/texts.ts`). The app's prediction screen shows its own
words in place of that line (#136): the task, the points rule and the 2/1/0 rubric over a picker of 0 to 8
with nothing selected, and it sends `{ prediction, turn }` once the learner has picked a number.

`material` is text the learner pastes (notes, a passage); no files, photos or links in this version. Over 8,000 characters the API answers `413` with a message
asking for a shorter excerpt; it never trims silently.

`mode` is `"learn"` (default) or `"test"`. A test session runs every move at level 5 and never
changes mastery. The testers' pre-test and post-test use it, so a new learner can be measured
before the ladder starts.

### `Turn`: the one object the app renders

```ts
type Turn = {
  sessionId: string;
  turn: number;   // goes up by 1 with each Turn; the app sends it back with its next action
  phase: "predict" | "attempt" | "example" | "move" | "result";
  move: MoveId | null;
  level: Level | null;
  messages: {
    agent: "questioner" | "evaluator" | "hint_giver" | "example_builder" | "coach" | "fact_desk" | "app";
    kind: "question" | "feedback" | "hint" | "example" | "named_move" | "summary" | "fact" | "redirect";
    text: string;
    hintStep?: HintStep;
    cites?: string[];                        // a hint or the summary with memory on: the memory facts it relies on (see Memory)
    sources?: { id: string; text: string }[];   // those facts' own words, filled by the API before the Turn goes out
  }[];
  expects: "prediction" | "text" | "continue" | "map" | "none";   // decides which input the screen shows
  // "map" = level 5: the editable map (the app marks the next empty part, #136), an optional chat box for the
  // learner's questions, Help behind a confirmation, and Review & submit
  scaffold: { given: string[]; blanks: number } | null;     // level 3 only: the half-built part
  mentefacto: Mentefacto;                                   // what the learner has built so far
  example: Mentefacto | null;   // phase "example" only: the worked example's map (planet) as it fills in
  progress: {
    movesDone: number;
    movesTotal: number;
    hintsUsed: number;
    points?: { move: MoveId; points: 0 | 1 | 2 }[];   // each finished move's points, in the order they finished
  };
  result: Result | null;   // only when phase = "result"; result.coach is null on the first of its two Turns
  error: { code: "agent_failed" | "rate_limited"; retryable: boolean } | null;
};
```

Example, session 1, the learner just answered "A law?" for the bigger group:

```json
{
  "sessionId": "ses_8f2k",
  "turn": 5,
  "phase": "move",
  "move": "supraordinate",
  "level": 2,
  "messages": [
    { "agent": "evaluator", "kind": "feedback",
      "text": "Not quite: a law is one rule, and democracy isn't a rule. So what kind of thing is it?" }
  ],
  "expects": "text",
  "scaffold": null,
  "mentefacto": { "concept": "democracy", "supraordinate": null, "exclusion": [], "isoordinate": [], "infraordinate": [] },
  "example": null,
  "progress": { "movesDone": 0, "movesTotal": 4, "hintsUsed": 0, "points": [] },
  "result": null,
  "error": null
}
```

### `Result`: the end of a session

```json
{
  "predictedScore": 7,
  "score": 5,
  "maxScore": 8,
  "calibrationGap": 2,
  "hintsUsed": 2,
  "rubric": [
    { "move": "supraordinate", "points": 1 },
    { "move": "exclusion", "points": 2 },
    { "move": "isoordinate", "points": 1 },
    { "move": "infraordinate", "points": 1 }
  ],
  "masteryChanges": [
    { "move": "exclusion", "from": 2, "to": 3 },
    { "move": "infraordinate", "from": 2, "to": 3 }
  ],
  "questions": { "asked": 0, "testing": 0 },
  "coach": { "message": "You found the bigger group and a real exclusion. 'What it needs' is next.", "nextFocus": "isoordinate" }
}
```

`calibrationGap = predictedScore − score`, in points. Positive means overconfident (predicted 7, got 5: +2).

`coach` is null on the Turn that shows the result, and filled on the next one (section 1).

`questions` counts what the learner asked the fact desk (level 5 and the testers' pre-test and
post-test). `testing` is how many of those test the concept (compare, contrast, breaking case, what
it needs) instead of asking a plain fact. In session 1 both are 0: the app does the asking.

### `Mastery`

```json
{ "moves": [
  { "move": "supraordinate", "level": 3, "unassistedSuccesses": 0 },
  { "move": "exclusion", "level": 3, "unassistedSuccesses": 1 },
  { "move": "isoordinate", "level": 2, "unassistedSuccesses": 0 },
  { "move": "infraordinate", "level": 3, "unassistedSuccesses": 0 }
] }
```

---

## 2. Agents

Every prompt, and every line the app shows, is in English in this version.

Each agent is one `client.messages.create()` call with `output_config.format: zodOutputFormat(schema)`,
and the API checks the reply against the same schema, so the output is valid JSON or the call fails.
The system prompt and the user message come from the agent's entry in `AGENTS` (`agents/src/agents.ts`):
`system`, and `render` writing the user message from the input (below). The API never shows the
learner anything an agent didn't return.

Every agent receives the same context, plus its own fields:

```ts
type AgentContext = {
  concept: string;
  material: string | null;
  move: MoveId;
  level: Level;
  mentefacto: Mentefacto;                          // built so far
  recent: { from: "app" | "learner"; text: string }[];   // this move's exchanges only
  memory?: { facts: MemoryFact[] };                // hint giver only: see Memory, below
};
```

### Memory: what earlier sessions left

With SurrealDB Agent Memory on, the API reads what earlier sessions left about this learner and concept
and passes it to two agents: the hint giver (in `AgentContext.memory`) and the coach (`CoachInput.memory`).
No other agent gets it.

```ts
type MemoryFact = {
  id: string;            // what `cites` points at
  text: string;          // one line from a template: "You moved up to level 3 on 'Its types' for planet on Oct 22."
  concept: string;
  move?: MoveId;         // facts about one move; absent on whole-map facts (the gap)
  level?: Level;
  since: string;         // ISO 8601: when the fact became current
  supersedes?: string;   // the fact this one replaced; memory keeps the history
  writtenBy: AgentName;
  sessionId: string;
  turn?: number;
};
```

- **Code writes every fact from a template.** The learner's words never go in, so a fact is never an
  answer and never instructions. The learner's scope is a salted hash of their Clerk id.
- **Earlier sessions only, at most 8 facts:** the current level per move, the latest gap, and the Helps
  that cost the most. This session's numbers are already in the agent's own input.
- **Memory never changes a number.** Levels, hint steps and points still come from code (section 3);
  memory only remembers them, so if it's wrong, stale or deleted, no score changes.
- **Optional end to end.** Off by default behind a flag. When it's off, empty, or slower than 1.5 s, the
  API calls the agent without it, and the user message is the same as before memory existed. With the flag off but
  memory set up (endpoint, context, key), only Delete my data still talks to memory: it purges the learner's scope.
- **`cites`:** the hint giver's and the coach's outputs carry the ids of the facts their text relies on.
  The API keeps only ids it passed in and logs the rest, with `verifyCites(output, memory)` from
  `@build-north/agents` (it returns the cleaned output and the dropped ids; they go to the `agent_log` row
  as `dropped`).
- **On screen:** the orchestrator copies the verified `cites` onto the hint's and the summary's `Message`, and
  the API fills `Message.sources` with those facts' words before the Turn goes out. The app shows them as one
  dim line under the hint card or the coach's words, "From what Lumente remembers: …", and tapping it opens the
  Memory sheet. Questions, nudges and fact desk answers never carry either: those agents never see memory.
  With memory off, or nothing cited, neither field is there, so the Turn is the one the app already knew.
- **What the API writes, after a session reaches its result** (one scope per learner, `learner/<pseudonym>`,
  each fact an attribute of the entity `topic/<pseudonym>_<concept>` (the concept as lowercase letters, digits and
  underscores; one with anything but letters, digits and spaces, dots, dashes or slashes between them, like C++, C# or
  a Japanese name, adds the start of a hash of itself, so two concepts never share a history) sent as a triple with its provenance in
  labels: `session`, `turn`, `writer`, and the numbers). Memory written before Oct 27 on a concept the slug alone
  couldn't keep sits under the slug alone, so the API reads that name too, and a row counts for a concept only when
  its `session` label is one of the learner's sessions on a concept with the same entity name: C++'s old rows under
  `…_c` stay out of C, and a row from a session the learner doesn't have counts for nothing:
  - `level_<move>`, for each part whose level changed: "You moved up to level 3 on 'What it isn't' for API on
    Oct 22." (`writtenBy: evaluator`). A finished part memory holds no level for yet gets its baseline instead,
    the level the session ended at: "You were at level 5 on 'Its types' for API on Oct 23." (same key and
    writer), so every part a learner has played has a level row, whether or not it ever moved.
  - `gap`: "Last time on API you guessed 7 and proved 3." (`writtenBy: coach`)
  - `help_<move>`, for each part: "'Its types' took 2 Helps on API last time." (`writtenBy: hint_giver`)
  A later session's write supersedes the earlier value of the same key, and memory keeps the chain. The
  facts are written when the result Turn is saved, so the coach of the same session reads only facts from
  earlier sessions (its own session's rows are skipped by their `session` label).

`GET /me/memory` returns `MemoryView`, what the app's Memory sheet shows: per concept and move, the
level now and its history (level, since, until, source, which agent wrote it, how many times other
agents read it), and the latest whole-map gap beside the one before; one card per concept however it was typed
("CORS" and "cors" are one history). The shapes are in
`agents/src/contracts.ts` (section 2b) and `agents/fixtures/memory-view.json`.

### Questioner: asks the plain question for the learner's level

In: `AgentContext`

```json
{ "question": "Democracy is one example of a bigger group. What group?",
  "scaffold": null }
```

At level 3, `scaffold` is filled (`{ "given": ["free elections", "rights"], "blanks": 1 }`). A scaffold with
no blanks is dropped by the orchestrator and the question stands alone (#139), so `Turn.scaffold` always has
at least one blank. Levels
4 and 5 use fixed text from code ("Now find the exclusion.", "Build the mentefacto for inflation.
Ask me any facts you need."), no model call.

### Evaluator: judges one answer against the mentefacto rules

In: `AgentContext & { answer: string }`

```json
{
  "verdict": "incorrect",
  "quality": 0,
  "accepted": [],
  "issue": "not_a_class",
  "reason": "A law is a rule, not a class that contains monarchy and dictatorship.",
  "feedback": "Not quite: a law is one rule, and democracy isn't a rule. So what kind of thing is it?"
}
```

- `quality`: 0 to 2 for this move, before any hint penalty. Any defensible answer passes, not one
  right answer: for democracy, "form of government" and "political system" both do. 2 = defensible
  and the closest class; 1 = defensible but too broad or incomplete; 0 = not defensible.
- `accepted`: the `Item`s to write into the mentefacto (empty when not accepted).
- `issue`: `too_broad | not_a_class | same_level | is_a_subtype | is_a_characteristic | off_topic | none`.
  Code keeps it (`session.lastIssue`) for the learner's next Help; the hint giver uses it to aim the hint.
- `reason` is for logs and for us. `feedback` is shown, and must never contain the answer before the move is
  correct. Once it is, the feedback names what makes it right and may add what the learner left out of the same
  criterion (a missing type, a missing characteristic); the points don't change (DECISIONS.md, Oct 23).
- When the answer isn't right, `feedback` says what is off. At levels 2 and 3 it ends with a nudge: a
  question that sends the learner back to their own answer, with no new information (free, the
  ladder's first step). At levels 4 and 5 it stops there. Pointing where to look is a hint, and hints
  only come from Help.

### Evaluator, whole map: scores a mentefacto built alone

Used at level 5 and for the testers' pre-test and post-test. Same grading rule as the evaluator: any
defensible answer passes. In: `{ concept, material, mentefacto }`

```json
{ "rubric": [
    { "move": "supraordinate", "quality": 0, "feedback": "Inflation is related to money, but it isn't a kind of money." },
    { "move": "exclusion", "quality": 2, "feedback": "'One product getting more expensive' is an excellent exclusion." },
    { "move": "isoordinate", "quality": 2, "feedback": "..." },
    { "move": "infraordinate", "quality": 2, "feedback": "..." }
  ] }
```

### Fact desk: level 5 only, answers the learner's questions with facts, never the structure

In: `{ concept, material, mentefacto, question }`

```json
{ "kind": "fact",
  "answer": "Not by itself: that's one product. It counts as inflation when the overall price level goes up.",
  "questionType": "breaking_case" }
```

When the question asks for the structure ("what's the bigger group of inflation?"), it doesn't answer.
It hands the decision back without pointing at any part of the map, and reminds the learner that
Help exists and costs a point (a question that points somewhere would be a free hint):

```json
{ "kind": "redirect",
  "answer": "That part is yours to decide. If you're stuck, tap Help (it costs a point).",
  "questionType": "asks_for_structure" }
```

Code puts the fixed redirect text on either signal, `kind: "redirect"` or `questionType: "asks_for_structure"`,
whatever the model wrote in `answer` (#139).

When the learner types an answer in the chat instead of a question ("software interface"), the fact desk
hands it back with `questionType: "states_an_answer"`. Code then shows its own fixed line, whatever the
model wrote, so it can never confirm or correct the answer: "That looks like an answer. Answers go on the
map, and the whole map is scored when you submit. If you need a fact, ask me." It isn't counted in
`questions`. A claim the learner wants checked ("an API always uses HTTP") is a question and gets facts.

- `questionType`: `fact | compare | contrast | breaking_case | what_it_needs | asks_for_structure | states_an_answer | other`.
  Everything except `fact`, `asks_for_structure`, `states_an_answer` and `other` counts as `testing` in the
  result, and `states_an_answer` doesn't count as a question at all.
- Facts in one or two sentences, from the learner's material when it has the answer.
- Never names a part of the map or says which box something belongs in. A leak here gives the answer
  away, so this prompt gets the most test cases.

### Hint giver: words the hint step code chose

In: `AgentContext & { step: HintStep; lastAnswer: string; issue: string }`

```json
{ "step": "hint",
  "text": "Think of monarchy and dictatorship. What are all three examples of?",
  "revealed": null }
```

Called only when the learner taps Help. `revealed` is filled only at `reveal`: the `Item` that goes into
the mentefacto, with 0 points. With memory on, `cites` lists the facts the help leans on ("You found this
part alone last time. How did you look for it then?"); memory never changes the step.

A hint can be a counterexample when the answer is incomplete: "North Korea holds elections. Is it a
democracy? What's missing?" That is the hint giver's job; Check yourself has no Challenger agent.

### Example builder: the level 1 worked example, thinking out loud (a fixture, no live call)

Not a Claude call in this version. The planet example is written once and ships as
`agents/fixtures/worked-example.json` (#15), the same for every learner: instant, free, and it can't
fail on demo day. The shape below is the fixture's shape.

```json
{ "exampleConcept": "planet",
  "steps": [
    { "move": "supraordinate", "thinkAloud": "A planet is a kind of celestial body. 'A thing' is too broad; the closest group is opaque celestial bodies.",
      "item": { "value": "opaque celestial body", "note": null } },
    { "move": "exclusion", "thinkAloud": "It looks like a star, but it isn't one: it has no light of its own.",
      "item": { "value": "star", "note": "has no light of its own" } }
  ] }
```

### Coach: the end-of-session message

In: `{ concept, mentefacto, result, memory? }` with every number already computed by code; `result` comes
without its `coach` field, since that's what the coach writes. Called on the Turn after the result, which
the app asks for as soon as the result is on screen (section 1).

```json
{ "message": "You found the bigger group and a real exclusion, and your guess was closer than last time. 'What it needs' is next.",
  "nextFocus": "isoordinate",
  "cites": ["attr_gap"] }
```

The coach never computes or states a number it wasn't given. It doesn't repeat the prediction, which the
screen already shows. With memory on, it can compare this session with the last in words, only from a fact
in `memory`, and cites that fact. Naming a move after it's found
("That's called the supraordinate class. You found it.") is fixed text from code.

### Not in this version

Challenger and Steelman belong to Check the AI. In Check yourself, a counterexample is a hint (see
Hint giver).

---

## 3. Orchestrator rules (code, in `agents/`)

| When | Rule |
|---|---|
| Session start | predict (0 to 8 points, after one line explaining the task) → short attempt ("in your own words") → worked example if any move is at level 1 → the four moves → result → the coach's words. On the whole map (below) the prediction goes straight to the map: no attempt, no example |
| Session end | the last answer's Turn shows the result, every number from code, with `coach: null` and `expects: "continue"`; the app's `continue` gets the coach's Turn, which ends the session. If the coach fails, its Turn carries fixed text built from the numbers |
| Level for a move | read from mastery; new learners start at 1. Watching the worked example moves every move to level 2 |
| After an answer | evaluator. `correct` → accept, name the move, next move. `partial` / `incorrect` → the feedback only, and the learner tries again (a retry). No automatic hint. A `correct` that leaves the move's part empty on the map, one with `quality` 0, or a `correct` bigger group that accepts none (the map would keep the earlier one) is the evaluator failing (an agent call that fails, below) |
| Hint ladder | nudge → hint → partial → reveal, one step per Help, and every Help counts. At levels 2 and 3 the feedback after a retry already nudged (free), so the first Help gives `hint`. At levels 4 and 5 there is no free nudge |
| The next move's question | asked at the same time as the move's first evaluation (or Help), from the map as it was before that answer, and kept in `session.nextQuestion`. The turn that ends a move waits for one call, not two. If it fails, the next move asks when it starts |
| Level 5 | **the learner asks.** They send any number of `{ question }` to the fact desk while filling the map, then submit `{ mentefacto }`. No per-move checks; whole-map evaluator at the end. Help gives a hint and caps that move at 1 point |
| Mixed levels | whole-map mode (the learner asks, one submit) runs only when all four moves are at level 5, or in test mode. Otherwise a move at level 5 runs like level 4: a check per move, hints only on Help |
| Testers' pre-test and post-test | run in level 5 mode, so both measure the same thing: questions asked, how many test the concept, and the score |
| Test sessions (`mode: "test"`) | every move at level 5 whatever the mastery says; the result is computed as usual; mastery is never updated |
| Points per move | evaluator `quality` on the first try with no Help; capped at 1 after a retry or a Help; 0 if revealed. Max 8 |
| Mastery | done with at most one retry or Help → level up one (max 5). Neither → `unassistedSuccesses + 1`. Never down in this version. The API saves what a Turn changed in the session's own transaction, onto the stored row: the level never drops below it and the successes add up, so a Turn that read mastery before another session saved can't undo that session's progress |
| Calibration | `calibrationGap = predictedScore − score` (points) |
| Exclusion without a difference | one follow-up question from code ("What's the key difference between democracy and dictatorship?"), at most once a move; not a hint, not a retry. An answer to it that still has no difference is a retry. When the answer to it is `correct` and the item still has no difference, the learner's own words become it |
| Reveal | the ladder's last step reveals: the item goes on the map, the move scores 0, it's named, and the next move starts. A reveal with no item to show is the hint giver failing: the step isn't spent |
| Help on the whole map | works on the first move, in order, whose hints haven't run out; a revealed item goes on the map. The hints already given on that move go to the hint giver with the next Help, so none comes twice |
| Done, on the whole map | a move counts as done (level up, unassisted success) when its quality is 2 |
| The whole-map rubric | exactly one row per move, or the whole-map evaluator failed (an agent call that fails, below). A part left empty scores 0 whatever its row says |
| Writing the map | a sharper item replaces the vaguer one it contains ("free elections" replaces "elections"); `note` only survives on exclusions; "a; b" becomes two items |
| Input that doesn't fit the phase | `advance` throws `UnexpectedInput`, nothing changes; the API answers 409 with the latest Turn |
| An agent call fails | `advance` returns the session unchanged and the last Turn with `error` set: `code` and `retryable` from callAgent's error (#10), otherwise `agent_failed`, retryable |
| The coach fails | the result still comes back, with fixed text built from the numbers (#44) |

### The seam between the orchestrator and the API

The orchestrator is one async function in `agents/`. It never touches the database or the network;
the only way it reaches Claude is the `callAgent` the API passes in.

```ts
type AgentName = "questioner" | "evaluator" | "evaluator_full" | "hint_giver" | "fact_desk" | "coach";

// Written by Leo (#10): sends the agent's prompt + Zod schema to Claude, validates, logs to agent_log.
type CallAgent = (agent: AgentName, input: unknown) => Promise<unknown>;

type TurnInput =
  | { action: "start" }                                   // sent by the API on POST /sessions
  | { prediction: number } | { text: string } | { question: string } | { mentefacto: Mentefacto }
  | { action: "help" } | { action: "continue" };

// Written by Cynthia (#3).
function advance(
  state: { session: Session; mastery: Mastery },
  input: TurnInput,
  callAgent: CallAgent,
): Promise<{ session: Session; mastery: Mastery; turn: Turn }>;
```

The API loads the session and mastery, calls `advance`, checks the `Turn` against its schema (#141), saves
what comes back, and returns the `Turn`. A `Turn` with `error`, or one off the contract, is not saved (#124,
#141), and mastery is written only for the moves the `Turn` changed (#124). The repeat check on the `turn`
number happens in the API before `advance`, so `advance` never sees a resend.
The API never decides the flow; the orchestrator never stores anything. In test mode `advance` returns
the mastery unchanged. If `callAgent` throws, `advance` returns the session unchanged and a `Turn`
with `error` set. What `callAgent` throws carries `code` and `retryable`, the two fields of
`Turn.error`, so `advance` can copy them.

---

## 4. State in SurrealDB

| Table | Fields | Notes |
|---|---|---|
| `mastery` | user, move, level, unassistedSuccesses, updatedAt | one row per user per move; read every turn |
| `session` | id, user, concept, material, mode, turn, lastTurn, predictedScore, firstAttempt, phase, move, hintStep, hintsPerMove, mentefacto, recent, retries, lastIssue, nextQuestion, questions, moveLog, result, transcript, createdAt | the orchestrator's state; `lastTurn` is returned again on a repeat; `hintsPerMove` starts with all four moves at 0, `retries` at 0, `lastIssue` at `"none"`, `nextQuestion` at null. `transcript` is the API's, not the orchestrator's: one `{ body, turn }` per saved Turn, appended in the same conditional write as the Turn, never for an error Turn, a resend or a 409; `[]` on sessions saved before Oct 25 |
| `agent_log` | session, user?, agent, input, output, ms, usd, at, dropped?, callId?, attempt?, outcome?, costStatus?, status? | append-only; debugging, the testers' numbers (fact desk rows are the questions metric) and what a session costs. `user` (since Oct 28) names the learner the call was for, so Delete my data finds a row whose session is gone; older rows go by their session. `dropped` is on a coach or hint giver row whose output cited a fact id the API hadn't passed in (CONTRACTS.md, Memory) |

With the memory flag on, SurrealDB Agent Memory keeps one scope per learner (a salted hash of the Clerk
id) holding the facts in [Memory](#memory-what-earlier-sessions-left): each with its source, the agent that
wrote it, the fact it superseded and who read it. It's a copy for the agents and the Memory sheet; the
tables above stay the record.

`DELETE /me/data` waits for tracked learner writes, purges the scope, then removes sessions, logs and mastery.
Scope registration and each fact get at most three attempts; deletion stops later attempts and facts. Fact retries reuse
an idempotency key derived from the exact body. Failed facts are reported together after remaining facts are tried.
The HTTP wait for tracked writes is 30 seconds; expiry is a plain `503`, while provider Memory errors are `502`.
The process-local fence remains until tracked work settles. It does not survive restart or coordinate multiple processes.
A fact write memory stopped answering in time may still be applied, so the write waits one more write's time before the
purge; provider write/forget ordering is still not guaranteed.


## 5. Notes for the API

- Model from `AGENT_MODEL` (default `claude-opus-5-5`). Effort `low` for questioner, hint giver and
  coach, `medium` for the evaluators.
- Latency budget: **median under 4 s per turn, never over 8 s**, measured at the walking skeleton
  (Oct 21, #7 and #10). The app shows a thinking indicator whenever a call is pending. If it's slower:
  lower the effort first, then move the Questioner and Hint giver to `claude-sonnet-5-5`.
- Budget: the $100 credits expire Oct 21. Unless the organizers extend them (#19), the account gets
  $30 with auto-reload off (#20). Measure the cost of one full session (#10); if 20 tester sessions
  plus the demo don't fit in $30, `AGENT_MODEL` drops to `claude-sonnet-5-5`.
- A turn waits for one call at a time: a wrong answer is the evaluator alone, a Help is the hint giver
  alone, and the next move's question is asked alongside the move's first evaluation (section 3). No
  turn waits for two calls in a row: the last answer is the evaluator alone and shows the result, and the
  coach is its own Turn, asked for while the result is on screen (decided Oct 22: the two calls in a row
  took 9.2 s). With memory on, the coach's memory read goes on that Turn. At level 5 each question is one
  fact desk call (effort `low`).
- Schemas: every object `additionalProperties: false` (Zod does this). No `min`/`max`/`minLength`:
  the SDK strips them and checks them locally. The first call with a new schema is slower (it gets
  compiled, then cached 24 h), so warm up every agent before the demo.
- If a call fails or Claude refuses, return the same `Turn` with `error` set. Never fill the gap
  with a made-up answer.
- Errors answer in JSON. body-parser's 400 and 413 carry their words; memory failing (`GET /me/memory`,
  `DELETE /me/data`) is `502` with the API's words, never memory's status or text, which go to the log.

---

## 6. Kickoff decisions (Oct 19)

| # | Question | Decision | Why |
|---|---|---|---|
| 1 | Move names | The method's ids in code; plain labels on screen (`MOVE_LABEL`, section 0) | Plain question first, the move's name after |
| 2 | One endpoint or one per action | One: `/turns`, driven by `expects` (section 1) | The orchestrator decides the next step anyway: one handler in the API, one call in the app |
| 3 | Challenger in Check yourself | No sixth agent: a counterexample is a hint from the hint giver | One less prompt; the Challenger stays in Check the AI |
| 4 | Worked example | A fixture (`agents/fixtures/worked-example.json`), no live call | Same for everyone; instant, free, can't fail on demo day |
| 5 | `x-dev-user` before Clerk | Yes, until Oct 21; rejected when `NODE_ENV=production` | Front end and back end can test without waiting for Clerk |
| 6 | Latency | Median under 4 s per turn, never over 8 s; a thinking indicator always shows (section 5) | The number is set before measuring, so the Oct 21 measurement has a pass line |
| 7 | Fact desk structure answer | `kind: "redirect"` in both the agent output and the `Turn` | One name end to end, nothing to translate |
| 8 | Prediction scale | 0 to 8 points (`{ prediction }`), after one line explaining the task | Same scale as the score, so the calibration gap compares like with like |
| 9 | Showing the worked example | `Turn.example` holds the planet map while it fills in | `mentefacto` stays the learner's own concept |
| 10 | Orchestrator and API | `advance(state, input, callAgent)` (section 3) | Rules stay in `agents/`, storage and Claude calls stay in the API |
| 11 | Sign-in | Clerk email code only, no Google or Apple | No OAuth setup, same on phone and web, testers and judges get in fast |
| 12 | Learner material | Pasted text only, up to 8,000 characters | No upload or parsing code |
| 13 | Language | English only this week | One set of prompts to test; Spanish goes on the roadmap |
| 14 | Layout | Phone first; the web build shows the same layout, centered | One layout to build and polish |
| 15 | Grading | Any defensible answer passes (2 = closest class, 1 = defensible but too broad or incomplete). The bigger group is tested with "<concept> is a kind of <answer>": related is not belonging | Concepts have fuzzy edges; one right answer would mark good thinking wrong |
| 16 | Mixed levels (Leo) | Whole-map mode only when all four moves are at 5 (or test mode); otherwise a level-5 move runs like level 4 | One clear rule; the demo profile is seeded with all four at 5 |
| 17 | Fact desk redirect (Leo) | "That part is yours to decide. If you're stuck, tap Help (it costs a point)." Never points at a move | A pointing question was a free hint, and learners could ask for the structure on purpose |
| 18 | Resent answers (Leo) | Each `Turn` has a `turn` number; a repeat gets the stored `Turn` back | A slow phone resends, and the hint step would move twice |
| 19 | Package name (Leo) | `@build-north/agents` | The plain name `agents` collides with another package on npm and trips `npm audit` |
| 20 | Public API before Clerk (Leo, Oct 20) | `x-dev-user` needs `x-dev-key`; 60 requests a minute per IP; Claude calls stop at 95% of Anthropic's limits and the budget | The repo is public, so anyone can read the API's address and header names |
