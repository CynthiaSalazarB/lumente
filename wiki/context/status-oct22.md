---
title: "Status, Oct 22 night: what is live, what is open, and who holds it"
type: context
related: ["[[plan-to-win]]", "[[expo-prize-plan]]", "[[hosting-setup]]"]
created: 2026-10-22
updated: 2026-11-02
---

Where Leo's side stands, started late on Oct 22 and kept current since (the latest rows are Nov 2: start with
the next section), written for the next session that opens this repo (Cynthia's Claude included). Numbers and
links only; no secrets, no tester names. Every item names who holds it.

## Nov 2: the `summary` branch, audited, fixed, waiting for Cynthia (#207)

Leo's side; Cynthia reviews and merges. [#207](https://github.com/CynthiaSalazarB/lumente/pull/207) is Codex's
consolidated bug-fix loop (Oct 29) plus every finding of Codex's Nov 2 audit and of the checks after it, fixed and
tested. Nothing is merged or deployed. The PR description has the detail, and `docs/summary-bug-ledger.md` has each
fix's reproduction and proof.

- **The audit:** two regressions in the branch, both fixed (a Turn refused for good after two failed attempts; the
  tester export exiting 1 on the lease fields a Turn leaves), and seven defects on `main` that the branch fixes
  (compressed bodies before sign-in, a pending answer lost on reload, whole-map typing unsaved, the token lookup
  outside the deadline, drafts pruned beyond the 200-row list, CSV formulas, paid bad replies missing from
  `agent_log`).
- **Found after it, also fixed:** three timing-sensitive tests, the lockfile's `libc` fields (dropped by Windows
  npm), and new required `agent_log` fields that made the live release lose its rows during a deploy.
- **Checked:** app 140, api 154 (SurrealDB 3.3.2), agents 125, twice; tsc clean; mutation runs; the audit's
  probes; the browser recovery harness at 390 px; Linux `npm ci`.
- **Before merging** (a merge deploys the API): startup now requires `CLERK_JWT_KEY`, a `wss://` `SURREAL_URL`,
  an `https://` memory endpoint and a finite `AGENT_BUDGET_USD`. Leo's notes say Render has them; the variables
  weren't checked live. A rollback to `main` first needs `UPDATE session UNSET activeTurnClaim,
  activeTurnClaimUntil, turnClaimFor, turnClaimAttempts;`.
- **Cynthia's calls:** the Android fingerprint changes (`56eeb40f…` to `fdc7c608…`, from the Expo SDK 58 patch
  updates), so the app fixes need a new Android build, or the dependency updates move to their own PR and the fixes
  ship to build 3 as a JavaScript update; the three new DECISIONS.md entries and the CONTRACTS.md changes are hers to
  accept with the merge.

## Oct 27 to 28: two code reviews, fixed, tested and shipped

Leo's side. Five PRs fixed every finding of Codex's Oct 26 review and of a second review by three independent
reviewers. Each was merged on Leo's word after a "shipping" notice on #37, so Cynthia hasn't reviewed them; each PR
body has the full detail. The app changes are JavaScript only, so build 3 (runtime `56eeb40f…`) takes them as
`preview` updates: `eas fingerprint:compare --build-id 93910cdd…` matched before every Ship. The API changes are
backward compatible, since Render deploys every merge. Times are Toronto time.

| PR | What changed | `main` | Shipped |
|---|---|---|---|
| [#197](https://github.com/CynthiaSalazarB/lumente/pull/197) | Codex's 17 findings at `6113b37`. API: Delete my data waits for writes in flight; a session and its mastery save in one transaction, a level never drops and successes add up; the agent log write is awaited. Agents: output that passes the schema but leaves a part out is a failed call; an empty whole-map part scores 0. Memory: a concept name with symbols gets an entity of its own (a hash suffix); plain names keep theirs. App: one device entry per session (`lumente.session.<id>`, migrated from the old single entry); a reply counts only for the body waiting for it; Save and close keeps an unsent answer per part; Start ignores a start that finishes after the learner left, and waits for the list; the result has "Read the whole conversation", "Read feedback" on an empty area, reveals only where Help revealed, and the exclusion's differences; typing stops dictation. `agents/CONTRACTS.md` updated | `25ea7df`, Oct 27 | Run `01a17f75…`, 6:22 to 6:30 PM: web `socg2mlag0`, Android group `a3556646…`, `testers` re-pointed |
| [#199](https://github.com/CynthiaSalazarB/lumente/pull/199) | API only: Delete my data also waits for an agent call that outlives its Turn (the question asked ahead, beside an evaluator that failed fast) | `15758b1`, Oct 27 | Render only |
| [#201](https://github.com/CynthiaSalazarB/lumente/pull/201) | The second review: api, app and agents, each by its own reviewer; 22 findings, all reproduced, 18 fixed. App: the typecheck passes again; the 404 page has a title; an answer that failed comes back after a reload; Start waits for an answer still saving, and starts even when the list can't be read; a reveal reads "Shown to you" without the conversation; a stale list read no longer wins. Agents: the exclusion's follow-up is asked once a move (it could repeat without limit, which inflated points and levels); a `correct` worth 0 points, or a bigger group that names none, is a failed call; the follow-up keeps the learner's own difference; whole-map Help keeps its hints. API: memory failing answers 502; memory rows count only for their session's concept, read under the new and the pre-Oct 27 names; `agent_log` rows carry their learner (indexed) and Delete my data removes them by it; a memory write that timed out is waited for; the memory purge runs even with the flag off; Memory shows one card per concept; a save whose transaction answers neither true nor false fails loudly | `b0bc8c3`, Oct 28 | Run `01a182be…`, 9:41 to 9:52 AM: web `ipm5qka9vq`, Android group `d43de987…`, `testers` re-pointed |
| [#200](https://github.com/CynthiaSalazarB/lumente/pull/200) | Written by Leo's Codex from Leo's prompt, then reviewed and tested by Leo's Claude. On the whole map, dictation stays on its row after Remove item (rows keep stable ids). Map areas read their question, the chosen category, the points, "shown to you" and "left empty" to a screen reader | `590f21e`, Oct 28 | By hand at 1 PM (below) |
| [#202](https://github.com/CynthiaSalazarB/lumente/pull/202) | Codex from Leo's prompt, with Leo's follow-ups. An answer is capped at 2,000 characters and a fact question at 500 (`TurnBody`); a saved transcript with a longer one still loads (`SavedTurnBody`); the API checks the cap only on a body a Turn would judge (after its 404, old-Turn and 409 checks) and answers 400 with a plain message; the app puts a refused answer back in its field instead of the conversation, and the field stops at 2,000. DECISIONS.md, Oct 28: "Answer limits apply to new requests, while saved history stays readable", accepted by the merge on Leo's word; CONTRACTS.md has the line | `c1b5d94`, Oct 28 | By hand at 1 PM (below) |

**Today's Ship of `c1b5d94`:** the Ship workflow (run `01a18356…`, 12:26 PM) sat in Expo's queue for 30 minutes
without starting a job, so Leo's side cancelled it and ran the same steps from a clean detached checkout of
`c1b5d94`: the web export with the `production` environment and `--clear`, `eas deploy --prod` (deployment
`9kpf0t5blu`, between 12:58 and 1:01 PM), then `eas update --channel preview --platform android --environment
preview` (group `6a4e6b64…`, update `01a18375…`, created 1:01 PM, runtime `56eeb40f…`). `testers` was re-pointed to
`9kpf0t5blu` with `deploy:alias`, run twice; it served the new build within a minute of the second run.

**How each was checked.** On `c1b5d94`: agents 125, api 110 and app 117 tests pass, and tsc is clean in all
three; the API's store tests run against SurrealDB 3.3.2 in Docker, production's version. Mutation checks before
merging: 10 of 10 caught for #197, 23 for #201. A browser harness on Leo's machine (the web export against the
repo's API with the real orchestrator and a scripted Claude, on a throwaway SurrealDB, driven by Playwright) runs
13 + 12 checks, one per finding: all pass on `c1b5d94`; before #197, `main` failed every one of its bug checks,
and before #201 it passed 1 of the 6 new ones. Every route,
signed out, at 390 and 1440 px: no page or console errors. Live after the #201 Ship: a signed-in run on production
(Memory showed one card per concept; a new session's hint cited a remembered fact), and build 3 on an API 36
Android emulator took update `01a182c8…`, where an unsent answer, an answer that failed offline and a whole-map
draft each came back after the app was killed. After today's Ship: smoke 7 of 7 against production and `testers`;
both serve `__common-c7a783fb…` and `session-815d8925…`, the files a clean export of `c1b5d94` gives (with the new
map labels and the 2,000-character field); the 404 page keeps its title; build 3 on the emulator runs update
`01a18375…` (Your data's version line), and on the whole map, removing the first of two rows left the second with
its text.

**Left open on purpose** (no code changed):

- Cynthia's calls, from the second review: (1) the questioner's level 3 scaffold items aren't on the map and the
  evaluator doesn't see them; should they count? (2) A learner's answer can close the prompt's tags; the prompts are
  hers, and Codex's escaping was reverted on Oct 25.
- No user impact: the device's session list isn't pruned beyond the API's `LIMIT 200`.
- Not checked: a screen reader (VoiceOver or TalkBack) on #200's labels.

**For whoever ships next:**

- `ship.yml` still runs by hand (no Expo GitHub app yet). If its jobs sit in Expo's queue with no logs, the same
  steps run from a clean checkout of the merged commit: `eas env:exec production "npx expo export --platform web
  --clear"` in `app/`, `eas deploy --prod`, then `eas update --channel preview --platform android --environment
  preview`. The update re-exports into `dist`, so it goes after the deploy.
- After the run, check what production serves (the `__common-…` and `session-…` chunks). On Oct 28 morning it kept
  serving the previous page until `eas deploy:alias --prod --id <deployment>`.
- `testers` moves only with `eas deploy:alias --alias testers --id <deployment>`. On Oct 27 and on Oct 28 morning,
  the first run reported success without taking effect; check with a fetch that skips the cache.
- A burst of requests at lumente.expo.app, such as a route checker, gets 429 from EAS Hosting for a few minutes.
- Export with `--clear` when two worktrees are around: Metro's cache can build the other one's app.
- Leo's test account is at level 5 on all four parts, so its guided sessions open as the whole map; use a new
  `+clerk_test` account to see guided questions. It holds test sessions (unfinished "rate limiting" and "hashing",
  CORS with a prediction).

## Live

| Piece | State | Evidence |
|---|---|---|
| API | **Now, Oct 28:** the API code at `c1b5d94` (#202), memory on, live about 90 s after the 12:24 PM merge (`/health` → `{"ok":true,"commit":"c1b5d94","memory":"on"}`); later docs-only merges redeploy the same code, so `/health` names the newest merge. Smoke: 7 of 7 for production and `testers` at about 1:03 PM. `main`, auto-deployed on merge, Render Starter (no cold start). **Oct 23, 9:11 PM:** `main` at `7a372bc` with Agent Memory on (`AGENT_MEMORY_ENABLED=true`, the startup line says "Agent Memory: on"; the kill switch is that variable set to anything else, about a minute, no deploy). Since #143, `/health` names the running commit and the memory state, `{"ok":true,"commit":"7a372bc","memory":"on"}`, in about 0.2 s; `/health/db` asks `prod` for its clock as the database-level user (`SURREAL_USER=api`, auth level `database`), read-only; no token and dev headers both answer 401; CORS allows `https://lumente.expo.app`, its `testers` and `review` aliases and, until a day after the rename, the old `reality-check` addresses. **Oct 23, about 11:10 PM:** `main` at `6adbc84` (tonight's merges, #144 to #155), memory on, `/health` → `{"ok":true,"commit":"6adbc84","memory":"on"}`; `REQUESTS_PER_MINUTE=240` (the limit is per IP and a room shares one). Render auto-deploys every merge, so #158 and #159 (app only, `main` at `58f5c52`) went on it after that check. **Oct 24, about 12:45 AM:** `main` at `866c4d0`; Render runs `4264e2c` (#166: a production-looking process without the Claude key or the database refuses to start; #167 is app only), `/health` → commit `4264e2c`, memory on; the API code is unchanged since `6adbc84` | `npm run smoke -w api` (PR #104): 7 of 7 for production and 7 of 7 for `testers` with memory on, Oct 23 at 9:15 PM; `npm run memory:smoke -w api` 8 of 8 on the live context (#37) **Oct 24, about 12:50 AM:** `/health` → commit `a64cc3e` (docs-only merges after `4264e2c`), memory on; `ratelimit-policy` 240 a minute; CORS answers `https://lumente.expo.app`. **Oct 24, about 11:15 AM:** `/health` → `{"ok":true,"commit":"e41669d","memory":"on"}` (#170 and #171 touch docs and `.env.example` only); smoke 7 of 7. **Oct 24, about 11:30 AM:** `AGENT_BUDGET_USD=70` (Leo's call, #20; it was 95), the startup line says "$70 budget", memory on; smoke 7 of 7. **Oct 24, 12:16 PM:** `CORS_ORIGIN` is `localhost:8081` and the three lumente addresses only (Leo and Cynthia's call): `reality-check.expo.app` still loads its old build but can't reach the API; smoke 7 of 7. **Oct 24, about 4:10 PM:** `/health` → commit `f641cf0` (#106, docs only; Render restarted at 2:51 PM), memory on; smoke 7 of 7; Render's logs have no error or warning line since Oct 23, 9:11 PM. Claude Console: $93.76 of the $100 promotional credit left (expires Nov 13), $6.23 spent of the $95 monthly limit, the latest calls OK. **Oct 25, 8:53 AM:** `/health` → `{"ok":true,"commit":"939b65d","memory":"on"}` 45 s after #179 merged (`GET /sessions`, `GET /sessions/:id/transcript`, `Session.transcript`, the coach guard and its prompt line); smoke 7 of 7; `npm run memory:smoke -w api` 8 of 8 on the live context; Render Auto-Deploy stays on (Leo, Oct 25). Hand-over: #37. |
| Web, production and `testers` | **Now, Oct 28:** both addresses serve deployment `9kpf0t5blu` from `c1b5d94` (`__common-c7a783fb…`), published by hand after Expo's queue held the Ship (the top section). https://lumente.expo.app and https://lumente--testers.expo.app (renamed from `reality-check` on Oct 23 at about 10:05 PM, Cynthia's ask; DECISIONS.md), EAS Hosting, both from `main`. **Oct 23, about 11:10 PM:** production redeployed by Ship from `main` at `6adbc84` (`entry-2f254156….js`: the Share link, #153's fixes, #154's light preview, #155's feedback lines); the `testers` alias stays at `179807e`. #158 and #159 (the firefly hovers in place; it rests on the result) merged after that Ship, so the website shows them only after the next one. **Oct 23, about 7:15 PM:** both redeployed from `main` at `179807e` (#136, #139) by Cynthia's side, after `34a285f` (#137) at about 4:25 PM and `99880ae` (#129, #130, #132, #133, #135) at about 12:50 PM. The 12:50 PM one had a five-minute demo-mode window first (12:47 to 12:52 PM, a cached export without `EXPO_PUBLIC_*`), so every export now runs with `--clear` and the bundle is checked before deploying (`docs/deploy.md`).. **Oct 24, about 12:45 AM:** two Ships by hand, from `4264e2c` (`entry-0709beb7….js`) and then `866c4d0` (`entry-50fc3599….js`, serving now): the firefly hover (#158, #159), the copy cuts (#160) with Cynthia's two lines back (#167), thin scrollbars (#164 over #162), demo mode on API only (#163), hover, press, focus and enter motion (#165). The `__common-22c9ff04….js` chunk carries the API host, the Clerk key, `brand.site` and the `fades` rule, the session chunk the new lines, `index.html` the scrollbar rule; smoke 7 of 7. The `testers` alias stays at `179807e` Render runs `main`, so they move together | `docs/expo-log.md`; at 8:55 PM both addresses serve `entry-92d2ccb4….js`, the file a clean export of `179807e` with `production` produces, and `/health` answers 200 **Oct 24, about 12:50 AM:** a third Ship from `a64cc3e` (`entry-8e2c69f5….js`, serving now) carries Cynthia's #168 (tap a lit area to read it again); the session chunk checked for its sheet and #167's lines, the common chunk for the API host, the Clerk key and `brand.site`; smoke 7 of 7. **Oct 24, about 12:52 AM:** Cynthia's side shipped `a64cc3e` too: production `lumente--82mn4udwxe`, and `testers` re-pointed to `lumente--uoy2ddh6ys`, so `testers` no longer sits at `179807e`; at about 11:15 AM both addresses serve `entry-8e2c69f5….js`. **Oct 25, about 9:33 AM:** Ship from `main` at `939b65d` (run `01a17342…`): production serves `entry-a1281f63….js` with #179's app side (the sign-up page on the site, `/sign-up` 200, "Continue with guidance", a picked-up session with its whole conversation, no "Development mode"); `testers` untouched, still Cynthia's `sqhnx6luly` (#181's draft stack, `6ec3c0df`). Smoke 7 of 7; both live forms checked headless at 1280 and 320 px. Two small fixes found before it wait in #183. |
| Web, test alias | The `polish` alias: the #103 build at `7306df1` in demo mode (no API, no Clerk), deployed Oct 22 for the website layout, "Your data", the mic and the review fixes, all merged since. It was `reality-check--polish.expo.app` until the Oct 23 rename; the old addresses are no longer ours (DECISIONS.md, Oct 23), so if it still answers it is at `lumente--polish.expo.app`. Nothing deployed to it since Oct 22, not checked since the rename | A new address with the API would need its own `CORS_ORIGIN` row on Render |
| Android | **Now, Oct 28:** the newest `preview` group is `6a4e6b64…` (update `01a18375…`, `c1b5d94`, runtime `56eeb40f…`); build 3 runs it from its second launch (checked on an emulator). `preview` APK, build 3 on the `lumente` project, runtime `56eeb40f…`: [download](https://expo.dev/artifacts/eas/LVkBl_worJBs2ro5p6z9vFa1XtYyA992vF3QrkSzG_A.apk). **Oct 23, about 7:15 PM:** the newest EAS Update on the `preview` channel, group `39faf44b…` (a clean-cache export, the `.hbc` checked for the API host, the Clerk key and #136's scoring text), is `main` at `179807e`; the APK takes it on its second launch. **Oct 23, about 11:10 PM:** group `0aefba2e…` from Ship, `main` at `6adbc84`, runtime `56eeb40f…`, so build 3 takes it. #158 and #159 (the firefly's hover, JavaScript only) merged after that Ship. **Oct 24, about 12:45 AM:** groups `232f9173…` (`4264e2c`) and `069add98…` (`866c4d0`, the newest), runtime `56eeb40f…` unchanged, so build 3 takes them and reach the phones with the next one | `docs/expo-log.md`; at 8:55 PM `eas update:list --branch preview` shows `39faf44b…` on top (commit `179807e`), and `eas fingerprint:compare --build-id 93910cdd…` says `main` at `179807e` still matches the build **Oct 24, about 12:50 AM:** group `f25d59ea…` (`a64cc3e`, #168), runtime `56eeb40f…`, so build 3 takes it. **Oct 24, about 12:52 AM:** Cynthia's side published group `cdf3bcfc…` from the same `a64cc3e`, the newest on `preview` at about 11:15 AM; same runtime, so build 3 takes it. **Oct 25, about 9:33 AM:** group `103d9256…` from the same Ship (`eas update:view`: commit `939b65d`, runtime `56eeb40f…`); `eas fingerprint:compare --build-id 93910cdd…` matched before the run, so build 3 takes it on its second launch. |
| Demo account | Leo's Google account, seeded in `prod`: level 5 on all four parts and a CORS session waiting at the whole map | `npm run seed:demo -w api` from a checkout with the prod variables |
| First real session on prod | `/turns` median 2.4 s, slowest 10.6 s (the final `evaluator_full`, over the plan's 8 s line), $0.040 for the session | `agent_log` rows, Oct 22 |

## Open pull requests

**Update, Oct 23 early:** #104, #124 and #103 are merged (see "Open on Cynthia", item 1); #106 stays a draft
until the freeze.

**Update, Oct 23 night:** #144 to #159 are merged (`git log main`): the SurrealDB evidence page and memory unit
tests (#144), the baseline level fact and fact dates in the team's zone (#147), the old-name sweep (#150), the site
at `lumente.expo.app` (#151), the Devpost and demo-script drafts (#152), the judge-facing polish (#153), the guess
light (#154), the feedback line above the next question (#155), the status page and log rows (#146, #148, #157)
and the firefly's hover (#158, #159). #106 is the one open PR, still a draft.

**Update, Oct 25, 9 AM:** #179 is merged (`939b65d`, on Render at 8:53 AM): the sign-up page on the site, `GET /sessions`
with Resume per session and "Your maps", every session's whole conversation (`GET /sessions/:id/transcript`), and
"Continue with guidance" for a concept left unfinished; most of Codex's Oct 24 commit reverted, with the reasons in
the PR. The full hand-over is on #37. Open: Leo's #175 and #176 (docs), Cynthia's draft stack #177 → #181, whose one
conflict with `main` is `app/src/app/sign-in.web.tsx` (#178's new `HOW` line now belongs in
`app/src/components/landing.tsx`).

**Update, Oct 28:** merged since Oct 25 (`git log main`): Cynthia's #177, #178, #180, #181, #184, #186, #192, #193
and #194 and her Ship logs #185 and #188; Leo's #182, #183, #187, #189 and #195, merged by Cynthia; then #197,
#199, #201, #200 and #202 (the section at the top) and the release logs #196 and #198, all merged on Leo's word.
Open: #176 (Leo's UX research docs, parked by Cynthia), #190 (Claude Code skills for the app, Leo's, never
reviewed) and #191 (the demo video's notes, Leo's); Leo keeps #190 and #191 open for now. The table below is the
Oct 23 list, kept for its history.

One teammate reviews, the merge is the acceptance.

| PR | What | Waits on |
|---|---|---|
| #103 | The app's final polish, with `main` merged in through #123 and Cynthia's three asks done (the points rule under the guess squares, "write your answers on the map", an audio line that promises only what we control; the facts are in the PR body). Plus the review fixes of Oct 22 night: the mic hands over between fields cleanly and ignores a second tap during the start, the coach is asked on a second session, Try again sends the map or the guess as it is on screen, Delete my data never sticks. Tests: app 49/49, api 42 + 1 skipped, agents 102/102; tsc clean. Native module inside, and `eas fingerprint:compare` says this tree matches build 3, so merging keeps `main` on build 3's runtime | Cynthia's review and merge. Leo's real-microphone test on the phone has not happened yet; the phones already run this code through the preview updates, so the merge changes nothing on them. Cynthia's timing rule stands: tonight, or after Oct 23, never on tester day |
| #104 | `npm run export:testers -w api` (the grading sheet's rows and the maps to grade, pseudonyms only, #50) and `npm run smoke -w api` (#45, #37). Reviewed by Cynthia on Oct 22 | Cynthia's merge |
| #124 | API: a Turn with `error` saves nothing (it wrote the stale session and mastery back), mastery is written only for the moves the Turn changed (every turn wrote all four from a seconds-old copy, so another session's level-up could go back down), and `REQUESTS_PER_MINUTE` (the limit is per IP; a room shares one; 60 when unset). api 43 pass + 1 skipped, tsc clean. Three smaller things seen and left for after Oct 23 are in the PR body | Cynthia's review and merge. Render deploys `main` on merge |
| #106 | The final README (#55), rewritten Oct 23 in plain words for judges and organizers: what Lumente is and who it's for, why, how a session works, the idea behind it, mission and vision, how to try it, the judging criteria, the prize tracks. A hero image and four screenshots from demo mode. Setup, tests and team rules moved to `docs/developers.md`; `main` merged in. Draft until the freeze; the PR body lists 8 `TODO(Cynthia)` items (links, pilot numbers, names, disclosures, wording) | Cynthia fills the TODOs and merges after the freeze |

Merged on Oct 22: #79, #81, #82, #88 to #100, #102, #105, #107 to #111, #113 to #123.

## Open on Cynthia

1. **Merge order: done.** #104, #124 and #103 merged early on Oct 23, in that order, with every check green on
   the merged result first (agents 102/102, api 47 pass + 1 skipped, app 49/49, tsc clean). Then, from `main` at
   `d0d4a25`: `ship.yml` run by hand (the `preview` update for build 3 and the production web), and the
   `testers` alias redeployed with the `production` environment. Both addresses checked for the new screens
   (Your data, "Ask me a fact", the result's level-up marks, the new headline); `/health` 200.
2. **Password at sign-up: done Oct 24, about 11:25 AM,** email code and Google only (Cynthia, Oct 22). Clerk's
   "Sign-up with password" is off; its public settings say the password is not required.
3. **The Expo GitHub app:** after the testers (Cynthia). Until then `ship.yml` runs by hand.
4. **#59: closed** on Oct 22: one Claude key for production and development (Cynthia).
5. The slow `evaluator_full` turn: lower the effort first, then Sonnet for the questioner and the hint giver
   (plan, section 10). Prompts and effort are hers. Related, from the #124 review: the Anthropic client runs
   with a 30 s timeout and one retry, so a hung call holds a learner for about a minute before the error Turn.
6. #112 (Agent Memory, Leo's build): **done.** #130 merged on Oct 23 and shipped with the 12:50 PM rollout; the
   flag went on in production at 9:11 PM (the kill rule, Oct 24 noon, was met). The live smoke
   (`npm run memory:smoke -w api`) passes all 8 checks against the `lumente` context. Since then: the evidence
   page with the three criteria, code pointers and unit tests (`wiki/context/surrealdb-sponsor-prize.md`, #144),
   and #147, so a part's first finished session leaves its level row even when no level moved (the demo account
   at level 5 everywhere included) and fact dates read in the team's zone.
7. **Oct 28:** the two calls the second review left (the top section, "Left open on purpose"), and, if she wants,
   a read of #197, #199, #201, #200 and #202, merged on Leo's word. The Expo GitHub app (item 3) is still not
   installed, so `ship.yml` still runs by hand.

## Open on Leo

- **Oct 28:** a screen reader (VoiceOver or TalkBack) on #200's labels, and his own run of the Chrome test prompt
  with a new `+clerk_test` account: its first checks need guided questions, which his level 5 account can't show.

- A full session on his phone with voice, and on the web with a real microphone.
- Clerk's Android tab: the package `ca.buildnorth.realitycheck` and build 3's SHA-256, so Google sign-in works
  on the phone. Email code works without it. **Done Oct 24, about 11:55 AM:** namespace `android_app`, the package
  and build 3's upload-keystore SHA-256 (`79:D0…9B:E3`, from Expo → Credentials); Clerk's public
  `/.well-known/assetlinks.json` lists them. Not yet tried on a phone.
- Clerk Protect's "Challenge suspicious sign-ups": **off since Oct 24, about 3:30 PM.** At 3:20 PM Leo's Google
  sign-up on the web got `protect.sign_up.challenged` in Clerk's Application Logs, the hosted
  `/sign-up/protect-check` page stayed blank, and the OAuth callback failed three times. The protection challenges
  sign-ups that look automated or come through a VPN, Tor or a proxy, which a campus or venue network can trigger.
  Device Trust, the lockout after failed sign-ins and user enumeration protection stay on; native apps were never
  challenged. Not yet re-tried with a fresh sign-up.
- Clerk's development instance limits, checked Oct 24 at about 4 PM: 100 users (5 used) and 100 real emails a
  calendar month, so October's allowance has to last through Demo Day. Codes count, and so do the "new device signed
  in" notices, Google sign-ins included; `+clerk_test` addresses send nothing. Clerk keeps one day of email logs, so the month's count is
  unknown. The README and the testing notes point judges to `+clerk_test`.
- After #103 merges: the production web deploy (above), and one `ship.yml` run by hand. Done early on Oct 23 (above).
- **Oct 23, #129** (`leo/alive-polish`, review requested from Cynthia): the firefly's light answers hover and touch, and five fixes from a review of `main` (a mic that could stay stuck, Send mid-phrase, the timeout's words at 90 s, Try again keeping the notes, sign-out). App only, fingerprint unchanged. Leo's standing OK: as soon as it merges, a `preview` update from `main` and the production and `testers` web redeploys, logged in `docs/expo-log.md`. Merged at 11:45 AM; as of 1:30 PM not live anywhere (the `preview` channel's newest update is #127, the production web bundle has no #129 code), so one rollout after #133 carries #129, #130, #132 and #133 together.
- **Oct 23, #133** (`leo/expo-polish`, review requested from Cynthia, `main` merged in through #132): the web build installs as a web app on iPhones and laptops (manifest, icons, Apple metas), every page has a link card (`og.png`), the update notice checks again on the foreground and when Start is shown (once a minute), Your data ends with the running version and update, Observe gets a marker on the session route and the crashes a learner recovers from. JavaScript and web only, fingerprint unchanged. Tests on the merged tree: app 57/57, api 60 + 1 skipped, agents 103/103; tsc clean. Not checked on a device: a real iPhone's Add to Home Screen, an Android release build.
- **Oct 23, #137** (`leo/resume-session`, review requested from Cynthia, from `main` at `99880ae`): a session survives a reload or a killed app (the device keeps the session's id, mode, notes and the level-5 map; Start offers to resume it from `GET /sessions/:id`; the record goes when the session ends, on Delete my data and on sign-out; demo mode keeps nothing), Share on the result, and the prompt's Copy button says when a browser refused the clipboard. JavaScript only; `eas fingerprint:compare` against build 3: match. Tests: app 62/62, api 60 + 1 skipped, agents 103/103; tsc clean; the export builds. Walked in a browser against a scripted API. Not checked: the file on an Android build (every storage call swallows its errors). Ships as a `preview` update plus the two web redeploys once it merges, at a time that doesn't split a tester's pre-test from their post-test. **Shipped** at about 4:25 PM from `main` at `34a285f` (update group `9742677e…`; `docs/expo-log.md`).
- **Oct 23, 3:30 PM, Cynthia's #136** (`cynthia/ux-guidance`: the prediction picker, the map-first self-test, the collapsed fact chat, the hint confirmation, Expo's ESLint): merges cleanly with #137 (the two together: app 64/64, tsc clean, the export builds). **But it changes the fingerprint**: `eas fingerprint:compare` on the merged tree answers `7e43f635…`, not build 3's `56eeb40f…`, because the fingerprint includes `package.json` `scripts` and #136 adds `"lint": "eslint src"`. Once it merges as is, no update from `main` reaches the testers' phones (build 3 ignores a runtime it doesn't know), and the web keeps moving. The fix is one line: drop the `lint` script and document `npx eslint src` instead, or hold #136 for the Oct 24 production build. Also: the root `package-lock.json` gains ESLint; Render runs `npm ci` from it. **Update, 6:55 PM:** #136 merged without the `lint` script (ESLint stays as two devDependencies), so `main` at `179807e` still matches build 3, and it shipped at about 7:15 PM (update group `39faf44b…`).
- Oct 23: `npm run smoke -w api` in the morning (#37), on call for the API, fixes as `eas update` from a branch
  whose fingerprint matches build 3 (`main` after #103, or `leo/final-polish` before); after the post-tests,
  `npm run export:testers -w api` against `prod` (#50).
- Oct 24, before 6 PM: an Android build only if the fingerprint changed, and then with the `preview` profile, since
  every phone is on the one `preview` channel (DECISIONS.md, Oct 23, "One update channel for every phone"; `main`
  still matches build 3, so as of Oct 23 night no build is needed); the last update and web deploy (one Ship, which
  also carries #158 and #159); Render Auto-Deploy off (superseded on Oct 25: Leo keeps it on while changes go on);
  the freeze summary on #45. #112 is done early: #130 shipped
  with the 12:50 PM rollout on Oct 23, and `AGENT_MEMORY_ENABLED=true` has been on in production since Oct 23 at
  9:11 PM.

## Closed on Oct 22

#28 and #23 with evidence; #101 (superseded by #103). #10 and #27 have the evidence in a comment and wait for
their owners to close. #43 closes with #103.
