# Audit Rules — Deterministic Mobile Anti-Slop Detector Pass

Purpose: a deterministic, mechanical detector sweep run on mobile UI code before it is ever shown.
Run it at **craft Step 4a** (immediately after the Step 4 build, before presenting anything). Also
the mechanical pre-pass that pairs with **mobile-app-design (SK-126)** review, **design-check
(SK-127)**, and **ship-verify (SK-128)**. **Zero hits on BLOCK rules are required before
presenting.** ADVISORY hits must be fixed or explicitly justified in the delivery notes.

Rules synthesized from Leo's `mobile-app-design` (SK-126) — `RN_PITFALLS.md`, `CHECKLIST.md`, the
8-rule model — and the `impeccable` audit-rules format (Apache 2.0). Full ledger: ../NOTICE.md

**True rule count: 31** (`AR-T01`..`AR-T31`, no gaps). Most carry a deterministic grep pattern
(Grep sheet below); **11 need visual/runtime confirmation** on a rendered device frame (Visual-judgment
subset below) — several appear in both, because a grep harvests candidates that the eye confirms.
IDs use the **`AR-T##`** prefix (T = tactile) to avoid collision
with impeccable's web `AR-##`. Severity: **BLOCK** = must be zero before presenting; **ADVISORY** =
fix or justify. Targets are React Native source (`M`) and native iOS/Android source (`X`); many
rules harvest candidates that a final visual pass confirms on a rendered device frame.

---

## A — Touch & interaction

- **AR-T01** `sub-min-touch-target` BLOCK — an interactive (`Pressable`/`TouchableOpacity`/`Button`) whose visible box is below 44pt (iOS) / 48dp (Android) with no compensating `hitSlop`. Grep harvests small explicit dimensions and interactives lacking `hitSlop`; **geometry confirmed visually** on the frame.
  Fix: ≥44×44pt, or expand the zone with `hitSlop`.
- **AR-T02** `no-press-feedback` BLOCK — an interactive with no pressed-state visual (`pressed` style callback, `activeOpacity`, scale-to-0.96, or ripple). A button that doesn't react feels broken.
  Fix: add a pressed style (`opacity 0.88` or `transform: [{ scale: 0.96 }]`).
- **AR-T03** `touchableopacity-over-pressable` ADVISORY — legacy `TouchableOpacity`/`TouchableHighlight` in new code.
  Fix: prefer `Pressable` (richer state, better a11y).
- **AR-T04** `missing-a11y-on-interactive` BLOCK — an interactive without `accessibilityRole` and `accessibilityLabel` (icon-only buttons especially). **Per-element manual confirm.**
  Fix: add both; report selected/checked/expanded via `accessibilityState`.

## B — Color & tokens

- **AR-T05** `raw-hex-in-screen` BLOCK — an inline hex (`#rgb`/`#rrggbb`/`#rrggbbaa`) or native color literal in screen code instead of a token. Excludes `theme`/`palette`/`tokens`/`colors` definition files.
  Fix: add a semantic token and reference it.
- **AR-T06** `pure-black-or-white` BLOCK — `#000`/`#fff`/`'black'`/`'white'` as a surface or ink color.
  Fix: tinted near-black/near-white (e.g. `#1a1c1f` on `#f9f9fe`).
- **AR-T07** `raw-status-color-fill` BLOCK — raw `error`/`danger`/`warning`/`success` token used as a chip/badge **background** (should use the `*Container` variant).
  Fix: `errorContainer` bg + `onErrorContainer` text.
- **AR-T08** `ai-app-palette` ADVISORY — purple→blue hero gradient, cyan-on-near-black, or neon-on-dark.
  Fix: a deliberate brand palette, not the AI default.
- **AR-T09** `gray-on-color` BLOCK — achromatic (gray) text on a chromatic background. **Visual confirm** of background hue.
  Fix: a darker shade of the background's own hue, or a transparency of the text color.

## C — Spacing & layout

- **AR-T10** `off-grid-spacing` BLOCK — a padding/margin/gap literal that is not a multiple of 4 (the `13px` eyeballed tell). Harvest numeric spacing; fail values where `value % 4 != 0`.
  Fix: snap to the 4/8pt scale via a spacing token.
- **AR-T11** `raw-pixel-spacing` ADVISORY — raw numeric spacing in screen code instead of a token.
  Fix: use `s.gutter` / `s.stackLg` / scale tokens.
- **AR-T12** `cramped-card-padding` BLOCK — a text-bearing card with internal padding < 12. **Confirm element is a card.**
  Fix: ≥12 (ideally 16–24); 20 for glass cards.
- **AR-T13** `percent-width-row-children` BLOCK — `flexDirection: 'row'` siblings using percentage widths (breaks with `gap`).
  Fix: `flex: 1` children + `gap` on the parent.

## D — Typography

- **AR-T14** `overused-mobile-font` BLOCK — primary face in the monoculture set: Inter, Roboto, Poppins, Nunito, Montserrat, Lato, Open Sans, DM Sans, Plus Jakarta Sans, Outfit, Space Grotesk, Sora, Manrope, Fraunces, Playfair Display, Syne — or `SF Pro`/`System` used as the app's *only* face by default.
  Fix: run SKILL.md `<font_selection_procedure>` (deliberate system-honest choice excepted).
- **AR-T15** `single-font` BLOCK — exactly one non-system family across the screen. **Harvest confirm.**
  Fix: pair a distinctive display face with a refined body face (unless system-honest is the chosen direction).
- **AR-T16** `four-plus-text-sizes` BLOCK — ≥4 distinct `fontSize` values on one screen. Harvest sizes per screen file.
  Fix: three sizes max (display/body/label); hierarchy via weight + color.
- **AR-T17** `sub-14-body-text` BLOCK — body text below 14px. **Confirm it's body, not an 11–12px uppercase label.**
  Fix: ≥14px (16 ideal) for body.
- **AR-T18** `unscalable-body-text` BLOCK — `allowFontScaling={false}` on body content (breaks Dynamic Type).
  Fix: only a hero numeric display may justify it; gate with `adjustsFontSizeToFit` instead.
- **AR-T19** `missing-numberoflines` ADVISORY — user-content `Text` without `numberOfLines`. **Harvest + manual.**
  Fix: `numberOfLines` + `ellipsizeMode` on unknown-length strings.

## E — Platform fidelity & RN translation

- **AR-T20** `shadow-without-elevation` BLOCK — iOS `shadow*` present but no Android `elevation` in the same style (flat on Android).
  Fix: set both via `Platform.select`.
- **AR-T21** `untinted-flat-shadow` ADVISORY — shadows everywhere, none tinted toward the accent on hero CTAs (iOS). **Visual.**
  Fix: tint hero-CTA shadows (iOS only); keep ambient shadows soft and neutral.
- **AR-T22** `backdrop-filter-in-rn` BLOCK — web `backdropFilter` / CSS `filter: blur()` written in RN style (does not exist).
  Fix: `expo-blur` `BlurView` as a sibling layer.
- **AR-T23** `position-fixed-in-rn` BLOCK — `position: 'fixed'` in RN (does not exist).
  Fix: `position: 'absolute'` inside the screen root.
- **AR-T24** `radial-or-conic-gradient-in-rn` BLOCK — `radial-gradient` / `conic-gradient` literal in RN.
  Fix: fake mesh with `LinearGradient` + circle Views; rings via `react-native-svg`.
- **AR-T25** `incomplete-glass-card` BLOCK — a `BlurView` without all three glass layers (tinted fill + 0.5px inner-glow border + soft ambient shadow). **Visual all-three-layers confirm** + harvest.
  Fix: add the missing layers, or don't use glass here.
- **AR-T26** `platform-asymmetric-blur-missing` ADVISORY — a single `intensity` literal with no `Platform.select` (Android needs higher intensity).
  Fix: `intensity={Platform.select({ ios: 28, android: 18 })}` (cards) / higher for bars.

## F — Safe area & device

- **AR-T27** `bare-or-deprecated-safeareaview` BLOCK — `SafeAreaView` imported from `react-native` (deprecated), or a `SafeAreaView` with no explicit `edges` prop.
  Fix: import from `react-native-safe-area-context` and pass `edges` explicitly.
- **AR-T28** `no-safe-area-handling` BLOCK — a top-level screen with neither `useSafeAreaInsets` nor `SafeAreaView`. **Per-screen manual/harvest.**
  Fix: handle top + bottom insets on every screen.

## G — Motion & content

- **AR-T29** `layout-property-animation` BLOCK — an animated value driving `width`/`height`/`padding`/`margin` instead of `transform`/`opacity`. **Harvest + confirm the animated target.**
  Fix: animate transform + opacity on the UI thread; use layout/`Layout` animations or `height` via measured transforms.
- **AR-T30** `bounce-elastic-easing` BLOCK — `Easing.bounce`/`Easing.elastic`, or a spring tuned for visible overshoot/bounciness.
  Fix: ease-out (quart/quint/expo) — real objects decelerate smoothly.
- **AR-T31** `placeholder-copy` BLOCK — lorem ipsum, bracketed placeholders, or TODO/FIXME/TBD stand-in copy in rendered `Text`.
  Fix: write the real copy before presenting — the teeth of the real-content rule.

Porting notes: per-screen analyzers (AR-T15, T16, T28) evaluate a whole screen file, not a fragment
— run them per screen. Many B/C/D/E rules **harvest** candidates that need a one-line manual or
runtime confirm (size/element context, card-ness, animated target). Confirm grep hits against the
intent before rewriting.

---

## Grep sheet

**MANDATORY CANARY — run BEFORE trusting any zero-hit result.** A clean sheet is only valid if the toolchain demonstrably detects a violation:

```bash
echo "position: 'fixed'" | rg "position\s*:\s*['\"]fixed['\"]"   # MUST print the line
```

**If the canary does not match, the toolchain is broken (rg missing, shimmed, or exiting 127) and ALL zero-hit results are VOID — do not present them.** Known trap: in Claude Code, `rg` can be a shell *function* (a shim to the bundled ripgrep) that child bash scripts do not inherit — running the sheet via a saved script file silently 127s every rule and reports a false-clean ZERO. Run the sheet in the interactive shell, never via a child script.

```bash
# Helpers — run from the project root.
# M = React Native source/styles; X = native iOS/Android source.
M() { rg -n "$@" -g '!node_modules' -g '*.{ts,tsx,js,jsx}' .; }
X() { rg -n "$@" -g '!node_modules' -g '*.{swift,kt,xml}' .; }

# A — Touch & interaction
M 'TouchableOpacity|TouchableHighlight'                              # AR-T03 (and AR-T02 if no 'pressed'/'activeOpacity'/scale co-occurs)
M '\b(Pressable|TouchableOpacity)\b'                                 # AR-T02 harvest — fail files with these but no pressed/activeOpacity/scale:0.9
M '(width|height)\s*:\s*([1-9]|[1-3][0-9])\b'                        # AR-T01 candidates <40 — confirm element is interactive & lacks hitSlop
M 'accessibilityRole|accessibilityLabel'                            # AR-T04 inverse — files with Pressable but neither -> fail

# B — Color & tokens
M '#[0-9a-fA-F]{3,8}\b'                                              # AR-T05 — fail outside theme|palette|tokens|colors files
X '0x[fF]{2}[0-9a-fA-F]{6}|Color\(red:|UIColor\(red:'               # AR-T05 native inline color literals
M "#0{3,6}\b|#f{3,6}\b|['\"](black|white)['\"]"                     # AR-T06 pure black/white
M 'backgroundColor[^,;}\n]*\b(error|danger|warning|success)\b'      # AR-T07 raw status fill (\b already excludes errorContainer — no -P needed)
M '#(7c3aed|8b5cf6|a855f7|6366f1|667eea|764ba2)\b'                  # AR-T08 ai-app-palette hex tells (ADVISORY; purple→blue / neon-on-dark hue call is visual — see subset)

# C — Spacing & layout
M '(padding|margin)(Top|Bottom|Left|Right|Horizontal|Vertical|Start|End)?\s*:\s*\d+|gap\s*:\s*\d+'   # AR-T10/T11 harvest — fail value %4!=0 / raw literal
M 'padding\w*\s*:\s*([0-9]|1[01])\b'                                # AR-T12 candidates <12 — confirm element is a card
M "width\s*:\s*'\d+%'"                                              # AR-T13 — confirm parent is flexDirection:'row'

# D — Typography
M "fontFamily\s*:\s*['\"](Inter|Roboto|Poppins|Nunito|Montserrat|Lato|Open Sans|DM Sans|Plus Jakarta Sans|Outfit|Space Grotesk|Sora|Manrope|Fraunces|Playfair Display|Syne|SF Pro|System)\b"   # AR-T14
M "fontFamily\s*:\s*([^,;}\n]+)"                                    # AR-T15 harvest — dedupe non-system families; fail if set size == 1
M 'fontSize\s*:\s*\d+'                                              # AR-T16 harvest — fail if >=4 distinct per screen file
M 'fontSize\s*:\s*(1[0-3]|[1-9])\b'                                 # AR-T17 candidates <14 — confirm body, not an 11-12 uppercase label
M 'allowFontScaling\s*=\s*\{?\s*false'                             # AR-T18 (only a hero numeric display may justify)
M 'numberOfLines'                                                  # AR-T19 inverse — user-content Text without it -> advisory

# E — Platform fidelity & RN translation
M 'shadowColor|shadowOpacity|shadowRadius|shadowOffset'            # AR-T20 harvest — fail if file has these but no 'elevation'
M 'backdropFilter|filter\s*:\s*[^;\n]*blur'                        # AR-T22 use expo-blur BlurView
M "position\s*:\s*['\"]fixed['\"]"                                 # AR-T23 use position:'absolute'
M 'radial-gradient|conic-gradient'                                # AR-T24 fake mesh / react-native-svg
M '\bBlurView\b'                                                   # AR-T25 harvest — confirm tinted fill + 0.5px border + soft shadow present
M 'intensity\s*=\s*\{?\s*\d+\s*\}?'                                # AR-T26 fail if no Platform.select around the blur intensity

# F — Safe area & device
M -U "SafeAreaView[\s\S]{0,80}from\s*['\"]react-native['\"]"       # AR-T27 deprecated import (-U: the named-import list may wrap across lines — without -U a wrapped import is a false-clean)
M -P '<SafeAreaView(?![^>]*\bedges=)[^>]*>'                        # AR-T27 missing explicit edges (PCRE2)
M 'useSafeAreaInsets|SafeAreaView'                                 # AR-T28 inverse — screen files with neither -> fail

# G — Motion & content
M 'useAnimatedStyle|withTiming|withSpring|Animated\.timing'        # AR-T29 harvest — fail if the animated value drives width/height/padding/margin
M 'Easing\.(bounce|elastic)|bounciness\s*:|withSpring\([^)]*overshootClamping\s*:\s*false' # AR-T30
M -i 'lorem ipsum|dolor sit amet|\[(placeholder|todo|tbd|your [^\]]{1,40} here)\]|\b(TODO|FIXME|TBD)\b'   # AR-T31
```

## Visual-judgment subset

These rules have no faithful static pattern — verify them by eye or on a rendered device frame
(mobile MCP screenshot / Expo preview / simulator) per [platform-verification.md](platform-verification.md):

- **AR-T01** sub-min-touch-target — measure the actual tappable box; try tapping with the side of a thumb.
- **AR-T04** missing-a11y-on-interactive — per-element; icon-only buttons especially. Confirm with VoiceOver/TalkBack.
- **AR-T08** ai-app-palette — the purple→blue gradient / cyan-on-near-black / neon-on-dark call is a hue judgment with no faithful static pattern; eyeball the hero gradient and accent-on-dark surfaces on the rendered frame. (The grep harvest catches only the common hex tells.)
- **AR-T09** gray-on-color — confirm the background is genuinely chromatic before flagging.
- **AR-T12** cramped-card-padding — confirm the element is a bordered/filled card, not a flush list row.
- **AR-T16 / AR-T17** size context — confirm a flagged size is on a real screen and is body vs label.
- **AR-T19** missing-numberoflines — confirm the `Text` renders user content of unknown length.
- **AR-T21** untinted-flat-shadow — a taste call on whether hero CTAs want a tinted lift.
- **AR-T25** incomplete-glass-card — confirm all three glass layers are present on the rendered card.
- **AR-T28** no-safe-area-handling — per top-level screen; confirm content clears the notch + home indicator.

Additionally, these grep-harvested rules need a manual confirmation step after a hit:
AR-T02 (no co-occurring pressed style), AR-T10 (the %4 math on the harvest), AR-T13 (parent is a row),
AR-T14/T15 (system-honest exception), AR-T20 (no co-occurring `elevation`), AR-T29 (the animated target).
