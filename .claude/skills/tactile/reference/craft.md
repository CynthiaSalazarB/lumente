# Craft Flow

Build a mobile feature with impeccable UX and UI quality through a structured process: shape the design, load the right references and deep skills, then build and iterate on a real device frame until the result is delightful.

## Step 1: Shape the Design

Run /shape, passing along whatever feature description the user provided.

Wait for the design brief to be fully confirmed before proceeding. The brief is your blueprint, and every implementation decision should trace back to it. For mobile, the brief should additionally pin down:

- **Target platforms** and the iOS-first / Android-first / parity strategy (from `.tactile.md` if already set)
- **Native vs RN** — pure Expo/React Native, or native SwiftUI / Jetpack Compose screens
- **Screen list** and the **navigation shape** (tabs / stack / modal / sheet / full-screen)
- **One archetype per screen**, named in the brief — dashboard / feed / detail / settings / composer / paywall, from [screen-archetypes.md](screen-archetypes.md). Naming it here is what stops a route being assembled component-by-component; it also fixes what occupies the first frame, which is the whole first impression on a phone.

If the user has already run /shape and has a confirmed design brief, skip this step and use the existing brief.

**If the direction is still open** — or Leo says "show me some options" — build a device-frame option board before committing: [mobile-option-boards.md](mobile-option-boards.md). Boards are for exploration only; once he names an option, stop boarding and go to Step 3.

## Step 2: Load References

**First — consult the project brain (if available).** Before choosing references, check for an app-dev brain (`~/Documents/Wiki/wiki/app-dev/`) and a project `.tactile.md`; they bias what to load and surface the wider toolbox (`recall` finds them: `node ~/.claude/scripts/recall.js "<topic>"`):
- `app-dev/stack.md` — current Expo SDK / RN / native version pins + the two store-submission mandates (iOS 26 SDK build · Play API-35 target) + the New-Architecture-mandatory and NativeWind-v4-vs-v5 traps
- `app-dev/principles.md` — the verified 2026 platform layers (Liquid Glass, Material 3 Expressive, 44pt/48dp targets, edge-to-edge enforcement, the RN translation traps) on top of the axioms here
- `app-dev/capability-map.md` — which skill / plugin / MCP to reach for, so you don't stop at tactile
- `.tactile.md` (project root) — design context already captured; reuse it, don't re-ask

Always consult the **non-negotiable trio** first — every mobile screen needs them:

- [mobile-typography.md](mobile-typography.md) — type system, 3-sizes rule, Dynamic Type
- [mobile-spacing.md](mobile-spacing.md) — 4/8pt grid, gutters, RN flex/gap layout
- [safe-area-and-devices.md](safe-area-and-devices.md) — insets, notch/Dynamic Island/edge-to-edge

Then add **internal references** based on the brief's needs:

- Glass / iOS-modern / depth aesthetic? Consult [glass-and-depth.md](glass-and-depth.md) + [rn-translation-traps.md](rn-translation-traps.md)
- Tabs / stacks / sheets / information architecture? Consult [navigation-and-ia.md](navigation-and-ia.md)
- iOS-vs-Android divergence, or native screens? Consult [platform-conventions.md](platform-conventions.md) + [cross-platform-parity.md](cross-platform-parity.md)
- Color-heavy or themed? Consult [mobile-color.md](mobile-color.md)
- Motion, gesture, or "make it feel alive"? Consult [motion-and-gesture.md](motion-and-gesture.md)
- Forms or rich interaction? Consult [touch-and-interaction.md](touch-and-interaction.md)
- Onboarding / empty / loading / error / offline states? Consult [state-patterns.md](state-patterns.md)
- Icons, app icon, splash, or imagery? Consult [imagery-and-icons.md](imagery-and-icons.md)
- Palette / font-pairing / style candidates wanted? Query the ui-ux-catalog skill (SK-133) — rows are starting points; tactile's font procedure and absolute bans always win

Then route to the **external deep skills** for the heavy implementation work — tactile orchestrates these, it does not duplicate them:

- Expo Router structure, native UI, native tabs, sheets, SF Symbols, liquid glass → **building-native-ui**
- React Native performance, lists (FlashList), Reanimated, TTI, memory, bundle size → **react-native**
- Native iOS screens → **swiftui-pro** (+ **swift-concurrency-pro** for async, **swift-testing-pro** for tests)
- Native Android screens → **android-development** (Compose + MVVM + Hilt + Room)
- `@expo/ui` native styling bridges → **expo-ui-swiftui** / **expo-ui-jetpack-compose**; Tailwind-in-RN → **expo-tailwind-setup**
- Deployment, native modules, CI, dev clients, SDK upgrades → the **expo-\*** family (expo-deployment, expo-module, expo-cicd-workflows, expo-dev-client, upgrading-expo)
- Mobile design review of an existing screen → the loaded **mobile-app-design** (SK-126) `CHECKLIST.md` (22 items) and `RN_PITFALLS.md`

## Step 3: Build

Implement the feature following the design brief. Work in this order:

0. **Real copy first**: Write the actual copy from the brief before any structure — labels, headings, CTAs, empty-state text, error messages. Real copy shapes structure; placeholder copy produces placeholder design. On mobile the container decides the length before the sentence exists, so budget characters here, not after the layout breaks — [mobile-copy.md](mobile-copy.md).
1. **Component structure**: The screen's component tree for the primary state. No styling yet.
2. **Layout and spacing**: Establish the spatial rhythm — gutter, section breath, card padding — on the 4/8pt grid with tokens.
3. **Typography and color**: Apply the type system (display/body/label) and the semantic color tokens. No raw hex. **Seed the token system from `skills/tactile/starter-tokens.ts`** — a typed, WCAG-AA-verified MD3 light+dark baseline (palette + spacing + type + radius + elevation + motion + touch targets) that's NativeWind-version-agnostic; retint it from one brand hue via `scripts/generate-tokens.mjs` (it re-proves AA), then wire the real fonts. `/new-mobile-app` Step 1a copies it in for greenfield apps; on an existing app, adapt it into the project's `theme/`.
4. **Interactive states**: Default, pressed, disabled, selected, loading — every interactive gets press feedback and the right `accessibilityRole`/`Label`.
5. **Edge-case states**: Empty, loading (skeleton), error, offline, first-run/onboarding. Each should feel intentional.
6. **Motion**: Purposeful transitions and gestures (if appropriate) — native timing, transform/opacity only, on the UI thread.
7. **Device & responsive adaptation**: Safe-area insets on every edge; adapt for small phone → large phone → tablet → foldable and orientation. Don't just stretch.
8. **App-level assets** (if building a full app): app icon, splash, status-bar style.

### During Build
- Build against real (or realistic) data at every step, not placeholder text
- Check each state as you build it, not all at the end
- Honor the brief's platform-parity policy — set both `shadow*` and `elevation`, branch with `Platform.select` where iOS/Android diverge
- If you discover a design question, stop and ask rather than guessing
- Every visual choice should trace back to something in the design brief

## Step 4: Verify — the 3-stage pipeline

**This step is critical.** Do not stop after the first implementation pass.

### Step 4a: Deterministic audit (run FIRST, before eyeballing)

**Completeness gate — `node skills/tactile/scripts/app-preflight.mjs --dir <project>`.** Run this before the grep sheet; it is the cheapest pass and it checks a different axis. The grep sheet judges the *quality* of what exists; the preflight checks what a shippable app **must have** and mostly cannot be seen by looking at a screen: store-size icon, adaptive icon, splash, `ios.bundleIdentifier` / `android.package`, iOS permission purpose strings, the Play target-API floor, New Architecture, dark mode, Dynamic Type, `+not-found`, an error boundary, and a version/build-number strategy. **Exit 1 = not ship-ready**; add `--store` when preparing a submission (submission blockers escalate to failures) and `--strict` to fail on every warning. Its findings are existence facts, not taste — fix them, don't argue with them.

**Contrast gate — `node ~/.claude/skills/tactile/scripts/check-contrast.mjs --dir <project>`.** `generate-tokens.mjs` proves AA for the palette it *generates*; this measures the palette the project actually ships, whatever its origin (Stitch export, Figma hand-off, hand-tuned theme). It needs no manifest — Material 3 token names encode their own pairing, so `onSurface` vs `surface` and every other `onX`/`X` pair derives from the names, in **both** light and dark, and both must pass. Exit 1 = a pair below its floor (4.5:1 text, 3:1 non-text). `*Variant` hairlines report as advisories, not failures.

Then run the [audit-rules.md](audit-rules.md) grep sheet against the build output — and run its **mandatory canary** first: a clean result is only valid if the toolchain demonstrably detects a planted violation (a dead `rg` reports a false zero). **Zero BLOCK hits are required before presenting** — a single hit means rewrite, not excuse. ADVISORY hits must be fixed or explicitly justified in the delivery notes.

### Step 4b: Device / platform screenshot proof

A grep sheet and a dev-server glance are blind to how the screen *actually renders* on a device — and blur, shadow/elevation, fonts, and remote images all diverge between dev and release (see [platform-verification.md](platform-verification.md)). Get rendered proof on a real frame:

- **`device-shot.mjs`** — one command, and it is a *gate*, not a camera: `node ~/.claude/skills/tactile/scripts/device-shot.mjs <out.png> --package <app.id>`. It captures, then asks the device what a picture cannot answer — is the app actually in the foreground, is the crash buffer clean, do the captured dimensions match the real screen. **Exit 1 = `BROKEN PROOF — do not present this screenshot`**, which is the case where the app crashed to the launcher and the capture looks fine. Use this for scripted/repeatable proof; iOS needs macOS (`--ios` prints the simctl command).
- **mobile MCP** (`mcp__mobile__*`) — drive a simulator/emulator interactively: launch, tap, navigate, then verify
- **Expo preview / Claude Browser** — for web-target or quick layout checks
- **e2e-testing (SK-027) / Maestro** — for multi-step flows and natural-language assertions

Capture **both iOS and Android** when the parity policy is "parity." Enforce the dev-vs-release rule: if you changed a blur intensity, a shadow/elevation, a font weight, or an image source, verify on a release-style build, not just `expo start`. Use **design-check (SK-127)** to pre-flight a visual diff against any Figma/Stitch reference; use **ship-verify (SK-128)** to confirm the actual build artifact when shipping. Confirm the audit's visual-judgment subset here (touch-target geometry, glass three-layer, per-element a11y, etc.).

### Step 4c: Manual visual iteration

Walk these checks against the live device frames:

1. **Does it match the brief?** Compare against every section. Fix discrepancies.
2. **Does it pass the AI slop test?** If someone saw this and said "an AI made this app," would they believe it immediately? If yes, it needs more design intention.
3. **Walk the mobile-app-design (SK-126) `CHECKLIST.md`** — all 22 items — plus tactile's DON'T guidelines. Anything that fails is a fix candidate.
4. **Check every state.** Navigate empty, error, loading, offline, first-run. Each should feel intentional, not an afterthought.
5. **Check both platforms** (per parity policy) and at least one small phone — does it adapt or just shrink? Does it clear the notch/home indicator?
6. **Check the details.** Spacing rhythm, type hierarchy, contrast, press feedback within 150ms, motion timing, safe areas.
7. **Walk the primary flow with a screen reader, without looking at the screen.** The full procedure — the mechanical `mobile_list_elements_on_screen` pass first, then the gestures and what a pass looks like — is in [platform-verification.md](platform-verification.md) § The screen-reader walk. This is what confirms **AR-T04**; the grep sheet only harvests candidates.

After each round of fixes, re-run 4a → 4c. **Repeat until you would be proud to ship this.** The bar is not "it works"; the bar is "this delights in the hand."

## Step 5: Present

Present the result to the user:
- Show the feature in its primary state on a real device frame
- Walk through the key states (empty, error, loading) and the iOS-vs-Android parity
- Explain design decisions that connect back to the design brief
- Ask: "What's working? What isn't?"

Iterate based on feedback. Good design is rarely right on the first pass.

### Step 5b: Append the cook-log entry (the step that makes the system learn)

**After Leo has responded — not before — append one row to `~/Documents/Wiki/wiki/app-dev/cook-log.md`.** The column that matters most is **post-delivery edits: what Leo changed after you handed it over.** That is the only honest measure of "renders right and feels native by default, without editing after", and it is worthless if written from your own opinion of the build.

One row: date · archetype ([screen-archetypes.md](screen-archetypes.md)) · costume (the design language) · menu kept? · gates that actually ran (AR-T / `app-preflight` / `device-shot` / `check-contrast` / store-review) · **post-delivery edits** · crash-OTA line · the one lesson.

Rules that keep it worth reading:

- **Never fabricate a row.** No build, no entry. An empty log is honest; an invented one poisons every future read, because the next session cannot tell which rows were observed.
- **Write what happened, not what was intended.** A gate you skipped is recorded as skipped.
- **One lesson, stated as a rule you would apply again.** "Glass over a flat ground read as a grey box — the backdrop is the language" beats "looked good".

This is the write half of a loop whose read half already fires: `hooks/app-intent-router.js` and CLAUDE.md's app-doors paragraph both send an *existing-app* ask to read this log first. Skipping the write is what leaves that read pointed at an empty table.
