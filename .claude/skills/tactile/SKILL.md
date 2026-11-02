---
name: tactile
description: "Leo's entry point for building or beautifying any mobile UI — Expo/React Native, SwiftUI, Jetpack Compose, or full apps. Distinctive, production-grade mobile code grounded in project context, avoiding generic AI app aesthetics. Prefer over raw mobile-app-design (SK-126) for any actual build. Call with 'craft' for the shape-then-build flow, 'teach' to set up design context."
user-invocable: true
argument-hint: "[craft|teach]"
license: Apache 2.0. Based on Anthropic's frontend-design / impeccable structure and Leo's mobile-app-design skill. See NOTICE.md for attribution.
---

This skill guides creation of distinctive, production-grade mobile interfaces that avoid generic "AI app slop" aesthetics. Implement real working screens — Expo/React Native, native SwiftUI, or Jetpack Compose — with exceptional attention to touch, motion, platform fidelity, and the details that separate a shipped app from a template.

## Context Gathering Protocol

Design skills produce generic output without project context. You MUST have confirmed design context before doing any design work.

**Required context** (every design skill needs at minimum):
- **Target audience**: Who uses this app and in what physical context? (one-handed on the go, focused at a desk, late at night, in bright sun?)
- **Use cases**: What jobs are they trying to get done?
- **Brand personality/tone**: How should the app feel?
- **Target platforms & strategy** (mobile-only): iOS, Android, or both — and if both, **iOS-first, Android-first, or strict parity**? This decides every platform-fidelity call downstream and cannot be inferred from code.

**CRITICAL**: You cannot infer this context by reading the codebase. Code tells you what was built, not who it's for, what it should feel like, or which platform leads. Only the creator can provide this context.

**Gathering order:**
1. **Check current instructions (instant)**: If your loaded instructions already contain a **Design Context** section, proceed immediately.
2. **Check .tactile.md (fast)**: If not in instructions, read `.tactile.md` from the project root. If it exists and contains the required context, proceed.
3. **Run tactile teach (REQUIRED)**: If neither source has context, you MUST run /tactile teach NOW before doing anything else. Do NOT skip this step. Do NOT attempt to infer context from the codebase instead.

---

## Design Direction

Commit to a BOLD aesthetic direction. Mobile is not a smaller website — it is a touched object held in one hand, and the direction should be true to that.

- **Purpose**: What problem does this app solve? Who holds it, where, and when?
- **Tone**: Pick an extreme and commit. Mobile flavors worth choosing between: iOS-modern glass (translucent layers, squircles, depth), Material-expressive (bold color, tonal surfaces, motion), system-honest native (lean on platform components, near-zero custom chrome), editorial-app (type-led, magazine cadence), playful/toy-like (chunky, springy, characterful), fitness-zen (calm, spacious, one-number focus), fintech-precise (dense, gridded, trustworthy). There are many more — design one true to the brief.
- **Constraints**: Framework (Expo/RN vs native), minimum OS, device classes, accessibility floor, performance targets (60fps lists, fast TTI).
- **Differentiation**: What makes this app UNFORGETTABLE in the first five seconds of use? What is the one moment — a transition, a gesture, a hero number — someone will remember?

**CRITICAL**: Choose a clear conceptual direction and execute it with precision. A restrained system-honest app and a maximalist glass app both work. The key is intentionality, not intensity. Honor the platform unless the brand has a specific reason to diverge — and when you diverge, do it everywhere, deliberately, not by accident.

Then implement working screens that are:
- Production-grade and functional (every state, not just the happy path)
- Tactile and responsive (every touch has feedback; nothing feels dead)
- Cohesive with a clear aesthetic point-of-view
- Meticulously refined in every detail — spacing, type, safe areas, motion timing

## Mobile Aesthetics Guidelines

### Typography
→ *Consult [mobile typography reference](reference/mobile-typography.md) for the type system, Dynamic Type, platform display faces, and the deeper material on scales.*

Choose fonts that are beautiful, unique, and fit the app as a physical object. Pair a distinctive display face with a refined body face.

<typography_principles>
Always apply these — do not consult a reference, just do them:

- **Three text sizes per screen, max.** Pick a display (hero/headline), a body (paragraph/list), and a label (eyebrow/caption). Resist a fourth. Hierarchy comes from **weight and color**, not from a four-rung ladder.
- Display/headline uses a display-grade face; body never uses display fonts. Light (300) for long prose, Regular (400) for UI body and lists — never Light for small labels (reads washed out).
- Labels are uppercase, 11–12pt, with generous letter-spacing (`letterSpacing: 1.4` in RN, `0.08em` in CSS). Section-label register, not shouting.
- Body text is ≥14pt (16 ideal). Never lock body text out of Dynamic Type — `allowFontScaling={false}` is only ever justified on a hero numeric display where layout would visibly break.
- Every `Text` rendering user content of unknown length gets `numberOfLines` + `ellipsizeMode`. Numeric displays use `adjustsFontSizeToFit` + `minimumFontScale` instead.
</typography_principles>

<font_selection_procedure>
DO THIS BEFORE TYPING ANY FONT NAME.

The model's natural failure mode is "I was told not to use Inter, so I will pick my next favorite font, which becomes the new monoculture." On mobile the reflex is even narrower — defaulting to the system face (SF Pro / Roboto) for *everything*, or reaching for Poppins/Nunito to feel "friendly." Avoid this by performing the following procedure on every project, in order:

Step 1. Read the brief once. Write down 3 concrete words for the brand voice (e.g., "warm and mechanical and opinionated", "calm and clinical and careful", "fast and dense and unimpressed", "handmade and a little weird"). NOT "modern" or "elegant" — those are dead categories.

Step 2. List the 3 fonts you would normally reach for given those words. Write them down. They are most likely from this list:

<reflex_fonts_to_reject>
Inter
Roboto
SF Pro (as the app's ONLY face)
System (as the app's ONLY face)
Poppins
Nunito
Montserrat
Lato
Open Sans
DM Sans
Plus Jakarta Sans
Outfit
Space Grotesk
Sora
Manrope
Fraunces
Playfair Display
Syne
</reflex_fonts_to_reject>

Reject every font that appears in the reflex_fonts_to_reject list. They are your training-data defaults and they create monoculture across apps. **Syne in particular is the most overused "distinctive" display font and is an instant AI design tell. Never use it.** Leaning entirely on the platform system face is a valid *system-honest* choice — but only when that is the deliberate direction, paired with strong weight/color hierarchy, not a default you fell into.

Step 3. Browse a font catalog with the 3 brand words in mind. Sources: Google Fonts, Pangram Pangram, Future Fonts, Adobe Fonts, ABC Dinamo, Klim Type Foundry, Velvetyne. The ui-ux-catalog skill (SK-133) holds searchable font pairings — a valid candidate source, but every returned row is subject to this procedure: any pairing containing a reflex_fonts_to_reject font is rejected outright, and the final pick must still pass Step 4. Look for something that fits the brand as a *physical object* — a transit-card display, a hand-painted shop sign, a 1970s mainframe terminal manual, a fabric label inside a coat. Reject the first thing that "looks designy" — that's the trained reflex too. Confirm it ships a variable or multi-weight family (mobile leans hard on weight contrast) and bundles cleanly via `@expo-google-fonts/*` or a local `.ttf`.

Step 4. Cross-check the result. The right font for an "elegant" brief is NOT necessarily a serif. The right font for a "technical" brief is NOT necessarily a sans-serif. If your final pick lines up with your reflex pattern, go back to Step 3.
</font_selection_procedure>

<typography_rules>
DO use a small, high-contrast type scale (display / body / label) with clear weight separation.
DO vary your font choices across projects. If you used a humanist sans last time, look elsewhere now.
DO gate the root render on `useFonts(...)` so the design never flashes the fallback face.

DO NOT use Syne. Ever. It is an instant AI design tell.
DO NOT default every app to the bare system face out of habit — choose system-honest deliberately or pick a real pairing.
DO NOT use a flat hierarchy where sizes sit within 1.25× of each other.
DO NOT set long body passages in uppercase. Reserve all-caps for short labels.
DO NOT use four+ text sizes on one screen.
</typography_rules>

### Color & Theme
→ *Consult [mobile color reference](reference/mobile-color.md) for semantic token roles, OKLCH tinting, status containers, and the deeper material on contrast.*

Commit to a cohesive palette expressed as **semantic tokens** — never raw hex in screen code. For industry-specific palette candidates, query the ui-ux-catalog skill (SK-133); catalog rows are starting points only — adapt them into your token system, never paste raw.

<color_principles>
Always apply these — do not consult a reference, just do them:

- **Semantic tokens, never raw hex.** `palette.primary`, never `#34c759`. The moment a screen has an inline color, dark mode is dead. If you need a color you don't have, add a token.
- **Status colors use the container variant.** Errors: `errorContainer` (soft) background + `onErrorContainer` text. Never the raw `error` red as a chip/badge background.
- Use the MD3 role system as your mental model even on iOS-leaning apps: `primary` / `primaryContainer` / `onPrimary` / `onPrimaryContainer`. It is the cleanest way to keep light + dark coherent.
- Never pure black on pure white. `#1a1c1f` on `#f9f9fe` reads calmer than `#000` on `#fff`. Tint neutrals subtly toward the brand hue for subconscious cohesion.
- No gray text on colored backgrounds — change the opacity of the text color against the surface instead (Refactoring UI).
</color_principles>

<theme_selection>
Theme (light vs dark) should be DERIVED from audience and context of use, not picked from a default. Read the brief and ask: when is this app opened, by whom, in what light?

- A meditation/sleep app used in bed → dark
- A fasting tracker glanced at on a sunny walk → light
- A trading app used in fast sessions → dark
- A kids' chore app → light
- A photography portfolio app → dark (let the images carry the color)

Do not default everything to dark "to look cool" or light "to be safe." Both are the lazy reflex. Choose, and support both themes if the audience spans contexts.
</theme_selection>

<color_rules>
DO derive a full light + dark token set; verify every text/background pair meets contrast (≥4.5:1 body, ≥3:1 for ≥18pt).
DO tint neutrals toward the brand hue.

DO NOT use raw hex in screen code.
DO NOT use the AI app palette: purple→blue gradient hero, cyan-on-near-black, neon accents on a dark background.
DO NOT use raw `error`/`warning`/`success` as a fill — use the `*Container` + `on*Container` pair.
DO NOT use pure `#000` / `#fff` as your primary ink and surface.
</color_rules>

### Layout & Space
→ *Consult [mobile spacing reference](reference/mobile-spacing.md) for the grid, tokens, RN flex/gap layout, and bento patterns.*
→ *Consult [navigation & IA reference](reference/navigation-and-ia.md) when choosing screen structure — tabs vs stacks vs modals vs sheets, and Expo Router conventions.*
→ *Consult [screen archetypes reference](reference/screen-archetypes.md) BEFORE laying out any route — the six content shapes (dashboard, feed, detail, settings, composer, paywall), what occupies the first frame of each, and the failure mode each one has.*
→ *Consult [mobile option boards](reference/mobile-option-boards.md) when the direction is open and Leo should pick from several built screens — device frames at true logical size, light+dark paired, rendered headlessly with `shot.mjs`.*

<spatial_principles>
Always apply these — do not consult a reference, just do them:

- **Everything snaps to a 4/8pt grid.** Every padding, gap, margin, height, and radius is a multiple of 4 (preferably 8). A random `13px` gap is a tell that someone eyeballed instead of designing. Use spacing tokens (`s.gutter`, `s.stackLg`) — never raw pixel values in screen code.
- **Generous breath.** 24pt page gutter (20 acceptable, below 16 is cramped). ~40pt between distinct vertical sections. ~20pt internal card padding (never below 12 — text against a card edge always reads broken). Compressing these "to fit more" is the single most common quality killer.
- Use `gap` on flex parents for sibling spacing, not margins. For row layouts, `flex: 1` children + `gap` on the parent — never percentage widths on row siblings (they don't account for the gap).
- Vary spacing for hierarchy: tight groupings for related items, generous separation between topics. Don't apply the same padding everywhere.
</spatial_principles>

<spatial_rules>
DO give the screen one clear hero. Two competing heroes = no hero.
DO let the most saturated element be the primary action.
DO respect safe areas on every edge (see below) — they are part of the layout, not an afterthought.

DO NOT wrap everything in cards, and never nest cards inside cards. Flatten with spacing, type, and dividers.
DO NOT use identical card grids repeated endlessly (icon + heading + text, over and over).
DO NOT compress the gutter/section/card spacing to cram in more content.
</spatial_rules>

### Visual Details
→ *Consult [glass & depth reference](reference/glass-and-depth.md) for the glass-card recipe, blur, squircles, and gradient-orb mesh — and the restraint rules for when NOT to use them.*

<absolute_bans>
These patterns are NEVER acceptable. They are the most recognizable AI app tells. Match-and-refuse: if you find yourself about to write any of these, stop and rewrite with a different structure entirely.

BAN 1: Raw hex color literals in screen code
  - PATTERN: a `#rrggbb` / `#rgb` literal, or a native `0xFF......` / `Color(red:...)` literal, in a screen/component file (anything outside `theme`/`palette`/`tokens`/`colors`)
  - WHY: it kills dark mode and guarantees design drift. It is the clearest sign a screen was eyeballed, not designed against a system.
  - REWRITE: add a semantic token and reference it. If the token doesn't exist yet, that's the bug — create it.

BAN 2: Web-only visual effects ported literally into React Native
  - PATTERN: `backdropFilter` / CSS `filter: blur()`, `position: 'fixed'`, `radial-gradient`, or `conic-gradient` written in RN style
  - WHY: none of these exist in React Native. They silently render as flat panels or throw — the design looks broken on a real device.
  - REWRITE: `expo-blur` `BlurView` for glass; `position: 'absolute'` for pinned chrome; faked mesh (LinearGradient + circle Views) for radial; `react-native-svg` for conic/progress rings. See [rn-translation-traps.md](reference/rn-translation-traps.md).

BAN 3: The incomplete glass card
  - PATTERN: a `BlurView` with no tinted fill, no inner-glow border, and no ambient shadow — i.e. glass with only one of its three layers
  - WHY: it renders as a flat translucent gray panel, the single most common "this is fake glass" tell.
  - REWRITE: all three layers (blur → tinted fill → 0.5px inner-glow border + soft ambient shadow), per [glass-and-depth.md](reference/glass-and-depth.md) — or don't use glass here at all. Glass earns its place; the default is opaque.
</absolute_bans>

DO: Use intentional, purposeful depth that reinforces the brand.
DO NOT: Use untinted drop shadows everywhere — flat and forgettable. Tint hero-CTA shadows toward the accent (iOS only; Android elevation can't be tinted).
DO NOT: Use glassmorphism on every surface. Blur is expensive and decorative blur reads as slop. Reserve it for app bars, tab bars, and genuine overlays.
DO NOT: Mix icon optical weights in one row (one filled, one outline). Pick a fill state and hold it.

The deterministic version of every visual check lives in [audit rules](reference/audit-rules.md) — ~31 detector rules with a copy-pasteable grep sheet. Run it before presenting any build.

### Motion & Gesture
→ *Consult [motion & gesture reference](reference/motion-and-gesture.md) for timing, easing, Reanimated GPU-only props, the gesture vocabulary, and reduced motion.*

Mobile motion is native motion. Derive the motion personality from the same 3 brand words as the font procedure — mixed personalities on one app read as slop.

**DO**: Use native timing — sheet/modal entry ~240ms, press feedback 100–150ms (scale to 0.96 is the sweet spot), tab switches instant (no fade — disorienting on mobile). Anything over ~300ms reads laggy.
**DO**: Ease-out for entrances, ease-in for exits. Animate only `transform` and `opacity` (GPU); drive them with Reanimated on the UI thread.
**DO**: Give every interactive a pressed state. A button with no press feedback feels broken even when it works.
**DON'T**: Animate layout properties (width, height, padding, margin) — janky on the JS thread.
**DON'T**: Use bounce/elastic easing. Real objects decelerate smoothly.

### Touch & Interaction
→ *Consult [touch & interaction reference](reference/touch-and-interaction.md) for targets, the full interaction-state matrix, and progressive disclosure.*

**DO**: Make every touch target ≥44×44pt (iOS) / 48×48dp (Android). If the visible icon is smaller, expand the zone with `hitSlop`. Prefer `Pressable` over the legacy `TouchableOpacity` for new code.
**DO**: Design every state — default, pressed, disabled, selected, loading. Use optimistic UI: update immediately, sync later.
**DO**: Use progressive disclosure — basic options first, advanced behind an expandable section or sheet.
**DON'T**: Make every button primary. Hierarchy needs ghost/secondary/text styles too.

### Device Adaptation
→ *Consult [safe area & devices reference](reference/safe-area-and-devices.md) for insets, notch/Dynamic Island/edge-to-edge, keyboard avoidance, and device-class adaptation.*

**DO**: Use `useSafeAreaInsets()` (from `react-native-safe-area-context`) and pass `edges` explicitly. Status bar, home indicator, gesture nav, Dynamic Island, notched corners — handle each.
**DO**: Adapt for device class (small phone → large phone → tablet → foldable) and orientation — don't just stretch.
**DON'T**: Use the bare `SafeAreaView` from `react-native` (deprecated) or rely on its defaults.

### Platform Fidelity
→ *Consult [platform conventions reference](reference/platform-conventions.md) for iOS HIG vs Material 3, and [cross-platform parity](reference/cross-platform-parity.md) for where identical RN code renders differently.*

**DO**: Honor each platform's conventions (navigation, modality, system controls, SF Symbols vs Material Symbols) unless the brand has a deliberate reason to unify — then unify everywhere.
**DO**: Always set both `shadow*` (iOS) and `elevation` (Android); verify the result on both platforms, not just the one you're developing on.
**DON'T**: Ship an iOS-tuned screen to Android without checking it — blur, shadows, fonts, and ripple all diverge.

### State & Content
→ *Consult [state patterns reference](reference/state-patterns.md) for onboarding, empty, loading, error, offline, and permission states.*
→ *Consult [store listing reference](reference/store-listing.md) before shipping — screenshots 1–3 are what a searcher sees, the preview video autoplays muted, and Apple forbids alpha in screenshots while Play requires it in the icon.*
→ *Consult [mobile copy reference](reference/mobile-copy.md) for the words — the container decides the length before the sentence exists, plus permission strings (the one copy Apple reads before approving), the mobile error taxonomy, destructive-confirm verbs, and why a shorter synonym is an accessibility fix under Dynamic Type.*

**DO**: Design empty states that teach the interface, not just say "nothing here." Use skeletons over spinners for content that has a known shape.
**DO**: Write the real copy from the brief BEFORE building layout. Real copy shapes structure; placeholder copy produces placeholder design.
**DON'T**: Ship lorem ipsum, `[placeholder]`, or TODO copy — placeholder text found at audit is a build failure, not a TODO.

### Imagery & Icons
→ *Consult [imagery & icons reference](reference/imagery-and-icons.md) for icon systems, app icon/splash specs, `expo-image`, and avoiding generic stock.*

**DO**: Pick one icon system (SF Symbols, Material Symbols, or a single custom set) and hold a consistent weight/fill state. Ship a real app icon and splash.
**DON'T**: Use generic stock clichés or uncanny AI-generated imagery — instant slop tells.

---

## The AI Slop Test

**Critical quality check**: If you showed this app to someone and said "an AI generated this," would they believe you immediately? If yes, that's the problem.

A distinctive app should make someone ask "how did they build this?" not "which AI made this?"

Review the DON'T guidelines above. They are the fingerprints of AI-generated mobile work from 2024–2025: untinted shadows everywhere, glass on every surface, the system font for everything, raw hex, cramped spacing, no press feedback, the purple-to-blue hero gradient.

Then run the deterministic pass: the [audit rules](reference/audit-rules.md) grep sheet. Zero BLOCK hits are required before presenting any build.

---

## Implementation Principles

Match implementation complexity to the aesthetic vision. A maximalist glass app needs careful layering, blur calibration, and tinted shadows. A system-honest app needs restraint, precision, and platform components used well.

Interpret creatively and make unexpected choices that feel genuinely designed for the context. No two apps should look the same. Vary between light and dark, different fonts, different aesthetics. NEVER converge on common choices across generations.

Build with real content from the very first pass: never lorem ipsum, never `[placeholder]`. If the brief lacks copy, write it before writing the screen — placeholder text found at audit time is a build failure, not a TODO.

Verify on a real rendered frame, not just the dev server. Blur intensity, shadow/elevation, font fallbacks, and remote-image rules all diverge between dev and release — what looks right in `expo start` can be wrong in the build.

Remember: Claude is capable of extraordinary creative work. Don't hold back. Show what a mobile app can be when you commit fully to a distinctive, tactile vision.

---

## Craft Mode

If this skill is invoked with the argument "craft" (e.g., `/tactile craft [feature description]`), follow the [craft flow](reference/craft.md). Pass any additional arguments as the feature description.

---

## Teach Mode

If this skill is invoked with the argument "teach" (e.g., `/tactile teach`), skip all design work above and instead run the teach flow below. This is a one-time setup that gathers design context for the project.

### Step 1: Explore the Codebase

Before asking questions, thoroughly scan the project to discover what you can:

- **app.json / app.config.\***: Expo SDK, platforms, orientation, splash, icon, scheme
- **package.json**: stack signals — `expo-router`, `react-native-reanimated`, `expo-blur`, `nativewind`, `react-native-safe-area-context`, `expo-image`, native module deps
- **Existing screens**: current patterns under `app/`, `screens/`, or `src/screens/`
- **Theme / tokens**: existing `palette`/`tokens`/`theme` files, color and spacing scales, font setup
- **Native targets**: any `ios/*.xcodeproj`, `android/build.gradle`, or `modules/` (native code in play)
- **Brand assets**: app icon, splash, logo, defined color values

Note what you've learned and what remains unclear.

### Step 2: Ask Mobile-Focused Questions

STOP and call the AskUserQuestion tool to clarify. Focus only on what you couldn't infer from the codebase:

#### Platforms & Strategy
- iOS, Android, or both? If both: iOS-first, Android-first, or strict parity?
- Pure Expo/React Native, or are native SwiftUI / Jetpack Compose modules in play?

#### Users & Purpose
- Who uses this, and in what physical context? (one-handed/on the go vs focused; bright vs dark setting)
- What job are they getting done? What should the app feel like in the first five seconds?

#### Brand & Aesthetic
- Brand personality in 3 words?
- Aesthetic direction (iOS-modern glass / Material-expressive / system-honest / editorial / playful / fitness-zen / fintech-precise)? Reference apps, and anti-references? — each of the seven is **defined** in `~/Documents/Wiki/wiki/app-dev/design-language-library.md` (what it is, the moves that make it cohere, where it breaks); read it before offering the list, so the answer means something specific.
- Light, dark, or both — and is there a reason tied to context of use?

#### Platform Conventions & Accessibility
- Honor each platform's native look, or unify to one brand intent? Where (if anywhere) to deliberately diverge?
- Accessibility floor: Dynamic Type, VoiceOver/TalkBack targets, contrast, reduced motion?

Skip questions where the answer is already clear from the codebase exploration.

### Step 3: Write Design Context

Synthesize your findings and the user's answers into a `## Design Context (tactile)` section:

```markdown
## Design Context (tactile)

### Platforms & Strategy
[iOS / Android / both; iOS-first vs Android-first vs parity; native modules in play]

### App Category & Users
[Category; who uses it, in what physical context, one-handed vs focused]

### Brand Personality
[3-word personality; voice; emotional goal; motion personality]

### Aesthetic Direction
[Visual tone (iOS-modern glass / Material-expressive / system-honest / ...); theme (light/dark and
why, derived from use context); reference apps; anti-references]

### Platform Conventions Policy
[Honor each platform's native look, or unify to one brand intent? Where to diverge deliberately.]

### Tokens & Stack
[Type system (display/body faces, scale); color token system (MD3 roles); spacing scale; known
stack: Expo SDK / nativewind / reanimated / expo-blur / safe-area-context]

### Design Principles
[3-5 principles guiding every screen — e.g. "weight-and-color hierarchy, never a 4th size",
"glass earns its place; the default is opaque", "Android parity verified in release, not dev"]
```

Write this section to `.tactile.md` in the project root. If the file already exists, update the Design Context section in place.

Then STOP and call the AskUserQuestion tool to clarify whether they'd also like the Design Context appended to CLAUDE.md. If yes, append or update the section there as well.

Confirm completion and summarize the key design principles that will now guide all future work.
