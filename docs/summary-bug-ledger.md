# Consolidated bug-fix loop

Updated October 29, 2026. Working branch: `summary`. Base: `8218c33d510245306b7e8a039d5d98dd837bf74a`.
Workspace: `C:/Users/leooa/.codex/worktrees/sequential-bug-fixes/build-north`.
This ledger describes local work, not a merge or deployment. Other branches are preserved.

## Loop

1. Verify the current branch, diff, and other active work before editing.
2. Choose one unresolved finding; trace callers and contracts. Historical audits of `82bdd212` are not current findings.
3. Write and run a reproduction that fails for the actual defect.
4. Fix the root cause; verify the reproduction, adjacent failure paths, and workspace types. Run each fix's tests
   at least twice against its final implementation. A later code edit invalidates earlier final-state verification.
5. Run relevant integration checks on the combined result. Record actual failures, passes, and skips here.
6. Review the diff and reconcile docs; continue to the next finding. Do not mark untested external behavior fixed.
7. User clarification, Oct 29: retain bug fixes and their necessary tests/docs only. No unrelated features,
   preventive-only changes or refactors. A failing compatibility check proves a configuration mismatch,
   not a runtime failure. Never claim that passing checks prove absence of all bugs.

## Consolidation

- Latest `origin/main` already includes atomic mastery saves, semantic agent validation, input caps with old-history
  compatibility, concept identity fixes, stale reply guards, cross-tab drafts, navigation guards, stable dictation rows,
  manual edit protection, and result fidelity fixes. Do not recreate those from the old audit.
- Imported the uncommitted diff from `C:/Users/leooa/.codex/worktrees/verified-bug-fixes/build-north`, without changing
  that checkout: recovery, full request deadlines, CSV escaping, compressed body rejection, dependency updates,
  transcript material opt-in, and memory retry/deletion fences. Source patch: `C:/tmp/lumente-existing-fixes.patch`.
- Original project checkout remains separate at `leo/claude-skills-oct25`; no resets, merges, or force pushes performed.

## New fixes verified locally

- Dependency alignment continuation: `npm ls zod --json` reproduced ELSPROBLEMS: Expo CLI 58.1.17
  declares `^3.25.76`, while the inherited root override forced 4.6.7. Removed that override and reconciled
  with `npm update zod --no-audit --no-fund`; the CLI now resolves 3.25.76, agents retain 4.6.7.
  A plain npm install initially left the invalid locked resolution unchanged; verification caught it.
  `expo install --check` then proved installed RN 0.88.0 differed from SDK 58's bundled 0.88.1.
  `npm exec --workspace=app -- expo install react-native --npm` aligned that patch. Clean-install and
  repeated checks follow; do not treat prior native binary/OTA compatibility as current after this change.
  Current audit is **not clean**: 6 low and 3 high dependency entries, rooted in two advisories:
  GHSA-gcqx-w48m-w2h4 (deepmerge, no patched release) and GHSA-mrhx-c7xc-m3w5 (Zod <4.6.6).
  Latest published Expo CLI still declares Zod 3. Installed CLI uses it for dev-tool plugin configuration,
  command input and plugin output schemas. deepmerge is used by Expo config/plugin configuration updates.
  These inspected callers are tooling paths; this is not proof every possible path is unreachable in deployment.
  Do not reinstate an unsupported major-version override merely to make npm audit green.

- Server concurrency and retry accounting: the red probes above reproduced two `/turns` model calls across API
  instances and a hidden SDK retry that lacked its own `agent_log` row. `POST /sessions/:id/turns` now uses a
  database-backed expiring claim, renewal and save fencing. The duplicate-turn harness passes twice with two
  API instances and two independent SurrealDB connections: one model call, two HTTP 200 responses, Turn 3
  returned to both callers, and one persisted Turn 3. Lease expiry/reclaim, renewal and stale-save fencing also
  pass against SurrealDB. After a transport failure or 5xx, the client now resends the exact Turn once. A duplicate
  waits up to 125 seconds and can reclaim one expired 2-minute lease. The 225-second recovery deadline covers that
  wait, the 90-second normal request window, and 10 seconds for the reply. User selected automatic retry once rather
  than manual recovery, explicitly requiring:
  "Retry once. Count the retry against the budget cap and log it in agent_log."
  The SDK now has hidden retries disabled; transient transport/provider failures can receive one explicit retry.
  A new red unit test showed that a successful Claude call was still sent and returned when `agent_log` failed
  (`sends = 1`, no row). Each outbound Messages attempt now first creates a durable `started` row with its
  conservative reservation; Claude is not called if that insert fails. The same row is finalized after usage or
  failure is known. A failed final update leaves the existing row in `started`/`reserved` state. Memory read counts
  exclude those unsettled rows. A real SurrealDB test verifies one row is updated in place and memory counts change
  only after finalization. The unit tests verify that a failed prelog prevents send and failed finalization leaves
  a conservative row while the reply remains usable. The real-SDK dropped-response harness passes twice: two
  attempts, two correlated rows (`failed/reserved`, then `success/measured`), attempt numbers 1 and 2.
  The first attempt's actual charge remains unknown; the logged reservation is a conservative maximum, not a
  measured bill. Current spend and reservations remain process-local and reset on restart; user explicitly chose to
  keep that documented cap. The Anthropic account limit remains the global hard stop. `agent_log` is deleted with
  learner data, so it cannot hold a durable global budget. No live Claude calls were used in verification.

- Oct 29 continuation: app start requests now persist an API/auth-kind/learner/body-scoped key before sending.
  Browser reservations use Web Locks; native adapter uses synchronous temp-file write and rename. Adapter tests
  use mocked native modules, not a physical device. Keys survive successful replies until the session finishes:
  a new regression proved that deleting one tab's key on success broke another tab's lost-response recovery.
  Replay reads the current Turn; advanced sessions restore their transcript through the existing resume path.
  Finished sessions rotate the key before a new start. Failed persistence prevents the POST; failed rotation
  is surfaced. Deletion clears only the caller's API/learner key scope. Clerk tokens are bound to the same
  Session resource as that scope; installed SDK source showed useAuth.getToken follows the active session.
  CONTRACTS.md and DECISIONS.md document this behavior. No new package added.

- Memory view uses one overall deadline, even when the provider ignores cancellation; expired reads cannot start
  another concept. Memory tests passed twice (30 each): `C:/tmp/lumente-view-green-1.log` and `-2.log`.
- Budget configuration rejects Infinity/overflow rather than disabling the spending cutoff. This is a boundary
  validation fix, not a resolution of concurrent spending or restart accounting.
- Memory history follows all provider pages within the caller deadline instead of truncating after five. Malformed
  pages, disappearing subsequent pages, and repeated/invalid cursors fail explicitly. Tests reproduce the old
  truncation and silent failure; `C:/tmp/lumente-history-green-1.log` and `-2.log` record repeated verification.
- Session start now initializes and validates in memory before `Store.insertSession` writes the complete first Turn
  and transcript atomically. Initialization failure creates no row; duplicate IDs cannot overwrite existing sessions.
  API/store integration checks passed twice (70 each, no skips): `C:/tmp/lumente-start-verified-1.log` and `-2.log`.
  Keyed API calls recover lost responses; the app wiring and local verification are recorded above.
- Clerk configuration rejects missing keys in production and Render; Render also disables development headers.
- Database startup awaits authentication and schema initialization, closes on failure, and bounds connection wait.
  All three `connectSurreal` callers await it. Child-process tests prove schema failure prevents listening.
- Credential-bearing endpoints require TLS remotely, with explicit development loopback exceptions. Partial Memory
  purge configuration fails startup instead of silently skipping deletion.
- Export checks accept Base64 padding and reject non-HTTPS URLs, URL credentials, fragments, and localhost variants.
- Transcript failure is surfaced; only legacy 404 falls back to latest Turn.
- Device enumeration/removal failures propagate; deletion awaits cache cleanup and offers a retry after local failure.
- Smoke probes bound headers/body to ten seconds and correctly label the database probe as read-only.
- Removed the proposed `.gitattributes` shell LF rule during bug-only review: current Git Bash tolerated CRLF,
  so this was preventive rather than a reproduced fix. No shell-content change is retained.

## Change-to-proof review, October 29

| Changed area | Defect and verification boundary |
| --- | --- |
| `api/src/app.ts`, `store.ts`, their tests | Compressed body rejection; orphan start initialization; keyed creation replay across instances/lost DB acknowledgements; opt-in notes; bounded deletion waits; database-backed `/turns` claim, renewal and stale-save fence. Real disposable DB tests, route tests and a two-API/two-connection duplicate-turn harness. |
| `api/src/db.ts`, `server.ts`, `demo-seed.ts`, database/server tests | Startup previously listened before authentication/schema readiness; connection failures/timeout cleanup. All connect callers await; child process tests check listen ordering and failures. |
| `api/src/clerk.ts`, `service-url.ts`, Clerk/DB/Memory tests | Missing production authentication configuration, plaintext remote credential endpoints, partial purge config. Boundary tests; no live Clerk verification. |
| `api/src/memory.ts`, `memory.test.ts` | Truncated history, unbounded sheet reads, uncertain write/purge race. Fake-provider timing/retry cases verify process-local behavior only; provider ordering and cross-process/restart deletion remain unresolved. |
| `api/src/call-agent.ts`, `store.ts`, their tests | Reject nonfinite budget config; disable hidden SDK retries; create a durable reserved log row before each Messages request; finalize that same row; retry one transient failure only when the process budget permits. Unit tests, SurrealDB row-finalization coverage, and a real SDK/local dropped-response harness. Unknown first-attempt charges remain reserved, not represented as measured. |
| `api/src/export-testers.ts`, its tests | Formula/control-prefix and CR CSV cells; awaited DB connection. Fixture CSV assertions. |
| `api/src/smoke.ts`, `smoke.test.ts` | Unbounded fetch/body wait, wrong database-write label, relative script resolution. Local HTTP tests; not live-production smoke. |
| `agents/src/contracts.ts`, `app/src/session/client.ts`, API client, session context | Notes recovery via opt-in transcript shape; legacy response compatibility; propagate transcript errors; full token/header/body deadline. Route, schema/client and browser fixtures. |
| `saved.ts`, `storage.ts`, `transcript.ts` and tests | Pending answer loss, old draft pruning on capped list, swallowed deletion failures, stale answer restoration. Mock storage and reducer tests; browser persistence/deletion; native adapter mock only. |
| Composer, whole-map, session screen | Lost draft while editor open; uncertain answer recovery/editing; inaccurate saved-copy wording. Browser recovery/deletion matrix, phone/desktop widths. Physical speech/accessibility unverified. |
| Pending-start modules/tests, config, root layout | Missing persisted retry key, overlapping-tab key removal, identity scoping. Unit/adapters plus browser lost-response/reload/concurrent-tab cases. Live Clerk switching/native crash durability unverified. |
| Package manifests and lock | Unsupported Zod major override and Expo/RN mismatch reproduced by dependency checks; clean install and real CLI schema smoke. Audit still has tooling advisories; native build needs recreation. Earlier inherited package updates still require package-by-package scope review before commit. |
| `app/scripts/check-export.mjs`, tests | Rejects valid padded Clerk keys; accepts invalid deployment URL schemes/credentials/local targets. Export fixture tests. |
| Browser harness, root test command, Playwright dependency, ignore rule | Regression infrastructure for confirmed recovery/deletion/start bugs; ignored artifacts avoid accidental commits. |
| Contracts, API README, decisions, this ledger | Necessary behavior/limitations and handoff documentation; no changed learning order, levels or prompts. |

This matrix is a review record, not a claim that all cases are covered. The two new red probes now pass locally.
External boundaries, the dependency audit findings, and remaining inherited dependency-scope review prevent
declaring the complete patch ready or the goal complete.

## Verification and artifacts

- Bug-only rereview: removed preventive `.gitattributes`; no runtime source edit in that pass.
  After the additional attempt-log fix, full workspace tests passed twice: app 136/API 142/agents 125 = 403 each,
  zero skips/failures. Both runs used the disposable SurrealDB endpoint; exact summaries are
  `C:/tmp/lumente-loop-workspace-tests-resume-1.log` and `-2.log` (both exit 0).
  Workspace typechecks passed twice after the final runtime edits.
  Retry-accounting and duplicate-turn harnesses each passed twice after the attempt-log change;
  browser recovery at Chromium 390 px passed twice. Changed app source files pass scoped ESLint.
  `expo install --check` reports dependencies up to date; `npm ls zod react-native` reports the supported
  Expo CLI Zod 3.25.76 and app/agents Zod 4.6.7 with React Native 0.88.1.
  Fresh `npm audit --json` still exits 1 with 9 advisories (6 low, 3 high, 0 critical): Expo/CLI chains,
  `deepmerge` GHSA-gcqx-w48m-w2h4, and `zod` GHSA-mrhx-c7xc-m3w5. No dependency change was made for these
  advisories in this pass; current Expo constraints and existing package scope need a verified fix path.
  Final `git diff --check` passed after the documentation update; all untracked files had zero trailing-whitespace
  matches, and the added diff had zero high-risk secret-pattern matches. Expo SDK compatibility check passes.
  A broad `eslint .` attempt exited 1 after including generated `app/dist` bundles (10,678 reported problems);
  it is not a valid authored-source result. The explicit changed app-source file list passed ESLint.
  Prior full browser evidence remains the 12 passing Chromium/Firefox/WebKit × 390/1440 runs on unchanged UI
  sources. No live Clerk, Claude, Agent Memory, native device or deployed behavior was exercised.
  This evidence does not prove absence of all bugs.

  Historical pre-fix run (not final evidence):
  Fresh full tests passed twice: app 136/API 137/agents 125 = 398 each, zero skips/failures;
  `C:/tmp/lumente-review-all-1.log` and `-2.log`. All workspace types passed
  (`C:/tmp/lumente-review-types.log`); dependency tree valid (`C:/tmp/lumente-review-deps.json`);
  `git diff --check` passed. Latest browser evidence remains the 12 passing dependency-pass runs on
  unchanged runtime source.

- Dependency pass after `npm ci --no-audit --no-fund` (950 packages, exit 0): 398 workspace tests passed
  twice with zero skips, `C:/tmp/lumente-loop-dependency-tests-1.log` and `-2.log`; all workspace types passed,
  `C:/tmp/lumente-loop-dependency-types.log`. Actual CLI plugin schemas accept valid and reject invalid data
  twice (`node output/playwright/dependency-smoke.cjs`); `npm ls zod react-native --json` and Expo compatibility
  checks passed twice (`C:/tmp/lumente-loop-deps-valid-<pass>.json`, `lumente-loop-expo-check-<pass>.log`).
  Full app lint: exit 0, zero errors, seven existing warnings (`C:/tmp/lumente-loop-full-lint.log`).
  Local fixture web export passed (`C:/tmp/lumente-loop-dependency-export.log`); never deploy this export.
  Current advisories remain 6 low/3 high as described above; no claim of a clean vulnerability audit.
  Browser matrix after dependency changes: Chromium/Firefox/WebKit at 390/1440, twice each, all 12 passed
  with no page errors. Logs: `C:/tmp/lumente-loop-dependency-<engine>-<width>-<pass>.log`.

- Latest continuation source: full workspaces passed twice, app 136 + API 137 + agents 125 = 398 per run,
  zero failures/skips. Logs: `C:/tmp/lumente-loop-integrated-1.log` and `-2.log`.
  Workspace typechecks: `C:/tmp/lumente-loop-types.log`, exit 0. Touched app files ESLint:
  `C:/tmp/lumente-loop-start-lint.log`, exit 0, no output. Focused start/session tests: 40 passed.
  Red proofs: missing Idempotency-Key header; `C:/tmp/lumente-loop-overlap-red.log` demonstrates the
  first implementation incorrectly rotating an overlapping tab's key. Both corrected before final checks.
  Latest web export: `C:/tmp/lumente-loop-web-export.log`, local fixture API only, never deploy this export.
- Latest browser matrix passed twice per combination: Chromium, Firefox and WebKit, widths 390 and 1440
  (12 successful runs, no page errors). Logs: `C:/tmp/lumente-loop-browser-<engine>-<width>-<pass>.log`.
  Added lost-start reload, overlapping tabs with one successful and one lost response, current-Turn recovery,
  and refusal to POST when persistence fails. Existing transcript/draft/deletion cases also passed.
  Screenshots remain under ignored `output/playwright/deletion-<engine>-<width>.png`.

- Prior session's combined code passed twice: app 129, API 137, agents 125 (391 each run), zero failures/skips.
  Logs: `C:/tmp/lumente-summary-integrated-1.log` and `C:/tmp/lumente-summary-integrated-2.log`.
  All workspace typechecks passed: `C:/tmp/lumente-summary-integrated-types.log`.
  `git diff --check` passed; current branch remains `summary`. These results supersede earlier suite counts below.
- Full workspace run: app 129, API 127, agents 125 passed; zero failures/skips. Log:
  `C:/tmp/lumente-summary-final-tests1.log`. Earlier integrated run passed app 125/API 120/agents 125.
- Workspace typechecks passed: `C:/tmp/lumente-summary-types.log`.
- ESLint: zero errors, seven existing warnings: `C:/tmp/lumente-summary-lint.log`.
- Expo compatibility passed; Expo Doctor 20/20: `C:/tmp/lumente-summary-expo.log`, `C:/tmp/lumente-summary-doctor.log`.
- Browser matrix passed Chromium/Firefox/WebKit at 390 and 1440: transcript 500/404, map/guided draft recovery,
  uncertain retry, clearing, failed deletion and successful retry; no page errors. Logs:
  `C:/tmp/lumente-summary-<engine>-<width>.log`. Screenshots: `output/playwright/deletion-<engine>-<width>.png`.
- Dependency audit: eight low, zero moderate/high/critical: `C:/tmp/lumente-summary-audit.json`.
- Disposable DB currently running: Docker `lumente-aligned-tests`, SurrealDB v3.3.2, loopback port 18159,
  memory storage, test credentials root/root. Remove this container when validation is complete.
- Browser export `app/dist` targets local fixture API, not production. Never deploy it.

## Remaining queue and limits

0. POST /sessions accepts optional Idempotency-Key, derives an owner-scoped stable database ID,
   replays its stored first Turn even after advancement, and rejects changed input. API recreation test failed before
   and passes now. Real SurrealDB tests force two separate API instances past their initial read before inserting;
   both return the same Turn and exactly one row survives. A committed insert with a lost acknowledgement recovers,
   including through a fresh API/store instance. Invalid keys fail before insertion; failed writes never report success.
   CONTRACTS.md and api/README.md now agree on this behavior and its lifetime (while the session exists).
   Targeted suite: 73 passed, zero skips, `C:/tmp/lumente-start-durable-final-1.log`; final repeated verification is
   also covered by prior integrated runs. Client wiring now exists in `pending-start.ts`, `pending-start-storage.ts`,
   `config.ts`, `api-client.ts`, `session-context.tsx`, and `_layout.tsx`. Regressions cover lost responses,
   client recreation, isolated API/learner/body scopes, deletion, storage faults, overlapping tabs and advanced
   session recovery. Live Clerk account switching and native crash durability still require direct verification.
1. Connection-timeout/cleanup regression added and passed. Final full workspace suites and typechecks now pass twice
   after the automatic Turn recovery and its 225-second deadline changes.
2. Orphan creation from initialization failure is fixed and tested twice. Source review confirms the initial `start`
   route produces a static prediction prompt without calling Claude; the durable key prevents duplicate session rows.
   Replaying a lost start response therefore does not duplicate a paid model call.
3. Concurrent budget admission and same-learner Memory writes pass their process-local regressions. `AGENT_BUDGET_USD`
   remains process-local by the user's explicit choice. Memory entity serialization is also process-local; `app.ts`
   documents one Render process, but live scaling is unverified.
4. Memory deletion fencing remains process-local; a second API process or restart can miss an in-flight write. A
   process-level mock can order a still-pending write after the local deletion fence, but live provider ordering remains
   unverified. The official
   provider docs describe same-key in-flight writes returning `409` and a 24-hour idempotency window, but do not state
   a write-versus-forget ordering guarantee. Do not claim cross-process/restart erasure is durable.
5. Prompt delimiters: historical handoff explicitly reverted HTML escaping because evaluator copies learner words.
   Need a representation preserving exact learner text plus adversarial regression; no live-model proof yet.
6. Session list cap of 200 is an explicit decision, not a newly confirmed bug. Memory page truncation and total
   Memory-view deadline are fixed and regression-tested twice.
7. Unsupported Expo CLI Zod 4 override removed; compatible Zod 3 installed and CLI schemas tested twice.
   Current audit has 6 low/3 high entries from deepmerge and Zod advisories. Inspected callers are Expo tooling;
   no proof of exhaustive deployment reachability. Seven existing lint warnings remain, not proven product bugs.
8. Physical-device accessibility/speech, live Clerk, live model, Agent Memory, and deployed behavior unverified.
9. Final diff check, scoped app ESLint, three-browser 390 px recovery checks and repeated full checks pass. No commit, push, PR, merge, or deployment was
   requested or performed. Do not claim all bugs fixed while item 4 and live-provider/device boundaries remain open.

## Commands

Continuation checkpoint: the duplicate-turn, hidden SDK retry logging, and lost-reply recovery defects have
reproductions, fixes and repeated passing checks. The client retries the same Turn once after transport/5xx failure,
and the durable lease admits one recovery; process-local spend limits remain by user choice. Full suites (app 140,
API 149, agents 125) and workspace typechecks passed twice; Chromium, Firefox and WebKit recovery flows passed at
390 px, and scoped app ESLint passed.
Agent Memory cross-process/restart ordering and live provider/device behavior remain unverified. All changes are
local/uncommitted on `summary`; no push, PR, merge or deployment. Original checkout remains separate.

```powershell
$env:SURREAL_TEST_URL='ws://127.0.0.1:18159'
$env:SURREAL_TEST_USER='root'
$env:SURREAL_TEST_PASS='root'
npm test --workspaces --if-present
npm run typecheck --workspaces --if-present
$env:EXPO_PUBLIC_API_URL='http://127.0.0.1:18130'
npm run export:web --workspace=app
node scripts/session-recovery-browser.mjs chromium 390
git diff --check
```

## Agent execution corrections

- This continuation again guessed `api/src/learner-writes.ts`; read failed because learnerWrites lives in app.ts.
  Corrected with symbol search. Also initially guessed a hoisted Expo CLI path; npm tree showed the nested path.
  Prevention: discover exact file/module resolution before reads, especially nested npm dependencies.
- First local overlap harness let an assertion escape while HTTP handles were closing, producing a Windows
  libuv assertion in cleanup. It now awaits server close and reports the expected red assertion via exitCode=1;
  rerun produced only the intended duplicate-call failure. No project source was changed by this harness issue.

- Continuation initially called list_threads with limit 100; tool rejected it, then limit 50 succeeded.
- Continuation attempted a repo-local skill path in the isolated checkout where that untracked folder is absent;
  loaded the original checkout's exact skill path instead. A guessed test filename and a PowerShell glob path
  also failed read-only; future searches must discover paths before reading and use rg -g instead of path globs.
- Browser concurrency harness initially reused browser.newPage's single-page context; Playwright explicitly
  rejected a second page. Switched to browser.newContext plus context.newPage and reran all engines.
- First start-key implementation deleted keys on success. Adversarial overlapping-tab regression exposed an
  agent-introduced retry gap. Retaining keys until session completion fixed it; test now covers one successful
  tab, one lost response, recreation and reuse of the same key. This is separate from the original missing-header bug.

- A broad `npm exec --workspace=app -- eslint .` included generated `app/dist` bundles and returned 10,678
  findings, so it did not isolate authored source. Corrected by linting only changed `app/src` files; that scoped
  command passed. Prevention: exclude generated exports explicitly from repository lint checks.

- Initial documentation patches used mismatched context and applied no changes. Re-read exact lines and applied
  narrower anchors; then reviewed the resulting `DECISIONS.md` and `agents/CONTRACTS.md` text.

- The first store regression run had no SurrealDB listening on port 18159; reconnect exhausted after 62 s. Started
  a separately named disposable SurrealDB container on that test port, then reran the store suite successfully.
- A new store test initially assumed stable ordering for equal-length Memory read lists. The DB result order was
  unspecified; added a deterministic secondary sort. Its first failure skipped cleanup and cascaded into a later
  row-count failure; the complete store suite passed after the assertion correction.

- One thread read exceeded the tool's 20,000-character limit; retried with allowed limit and filtered output.
- A typecheck ran during `npm ci`, when compiler binaries were temporarily absent; rerun after install passed.
- A test path was guessed incorrectly; used discovered `app/src/check-export.test.ts` afterwards.
- Broad command output was sometimes truncated; narrowed follow-up reads. Avoid relying on truncated evidence.
- The first browser export omitted `EXPO_PUBLIC_API_URL`, so Expo built demo mode and the harness could not find its
  live-client text field. Set the loopback fixture URL before export; Chromium then passed.
- After automatic client-side 5xx retries, the browser harness had stale POST-count assertions. A rerun caught `6 !== 3`;
  updated all counts to two posts per send, then Chromium, Firefox and WebKit passed at 390 px.
- One patch used a relative path and targeted the primary checkout; its context check failed without editing. Retried
  against the isolated worktree's absolute path and verified the primary checkout stayed unchanged.
