# References — Mobile App Design

Canonical sources. Each is annotated with *what to look at* — don't read the whole thing every time.

## Platform guidelines (authoritative)

### Apple Human Interface Guidelines
- **URL:** https://developer.apple.com/design/human-interface-guidelines/
- **What to look for:** *Foundations → Layout* (44 pt touch targets, 20 pt safe-area side margins), *Foundations → Typography* (SF Pro pairing, Dynamic Type), *Components → Navigation* (tab bar, navigation bar, sheet conventions), *Patterns → Modality* (sheet vs alert vs full-screen)
- **Why it matters:** authoritative for iOS conventions and motion timing; users have internalized these patterns whether you have or not

### Material Design 3 (Google)
- **URL:** https://m3.material.io/
- **What to look for:** *Styles → Color* (dynamic color, tonal palettes, semantic roles), *Foundations → Layout* (responsive grid + density), *Components → Cards* (elevation tiers), *Foundations → Accessibility* (touch + contrast)
- **Why it matters:** even on iOS-leaning designs, the MD3 color role system (`primary` / `primaryContainer` / `onPrimary` / `onPrimaryContainer`) is the cleanest way to think about palette tokens

### WCAG 2.2 Mobile Accessibility
- **URL:** https://www.w3.org/WAI/standards-guidelines/wcag/
- **What to look for:** contrast minimums (4.5:1 normal, 3:1 ≥ 18 pt), touch target sizing (Success Criterion 2.5.5), focus indicators, text resizing (1.4.4)
- **Why it matters:** the legal/ethical floor below which a mobile app should not ship

## Craft references (taste-makers)

### Refactoring UI (Steve Schoger & Adam Wathan)
- **URL:** https://www.refactoringui.com/
- **What to look for:** *Hierarchy is everything*, *Don't use grey text on coloured backgrounds*, *Establishing a spacing and sizing system*, *Designing around a fixed-width container*
- **Why it matters:** the most concentrated set of "why does this look unprofessional" lessons in modern UI design; reads in 2 hours, pays back forever

### Stitch DESIGN.md (in this repo)
- **Local path:** `C:/tmp/stitch-design/stitch_fasting_tracker/fast_coach_design_system/DESIGN.md`
- **What to look for:** §Colors, §Typography, §Layout & Spacing, §Elevation & Depth, §Components — these are an exemplar of how a mobile design system should be specified before any code is written
- **Why it matters:** when generating designs via Stitch / Figma plugins, the DESIGN.md is the source of truth — implement against it, not against the rendered PNG

## Visual / pattern inspiration

### Linear mobile app
- **URL:** https://linear.app
- **What to look for:** the floating glass tab bar, the dense list patterns, the snappy modal transitions, the type hierarchy at small sizes
- **Why it matters:** considered the gold standard for "professional and minimal" on mobile

### Things 3 (Cultured Code)
- **URL:** https://culturedcode.com/things/
- **What to look for:** how aggressive type-weight contrast (heavy headlines, light body) creates hierarchy without color
- **Why it matters:** mobile + macOS app that proves you can be feature-rich without being visually noisy

### Stripe mobile dashboards
- **URL:** https://stripe.com/payments / Stripe Dashboard mobile screenshots
- **What to look for:** data-density patterns — how numbers, labels, and trend indicators compose in tight space
- **Why it matters:** finance-grade clarity that translates well to any data-heavy mobile screen

### Apple Design Award winners (mobile)
- **URL:** https://developer.apple.com/design/awards/
- **What to look for:** Inclusivity / Visuals & Graphics / Interaction categories — the winners often pioneer patterns that propagate across the platform within a year
- **Why it matters:** future-tense aesthetic radar

## RN-specific tooling docs

### Expo `expo-blur`
- **URL:** https://docs.expo.dev/versions/latest/sdk/blur-view/
- **What to look for:** `intensity` range (1–100), `tint` options, platform notes (Android API 31+ for real blur)
- **Why it matters:** the calibration table at the bottom of that page is the difference between "real glass" and "gray fade"

### Expo `expo-linear-gradient`
- **URL:** https://docs.expo.dev/versions/latest/sdk/linear-gradient/
- **What to look for:** `start`/`end` coordinate system (0–1 normalized), `locations` for non-linear stops
- **Why it matters:** the only way to fake mesh backgrounds in RN

### `react-native-safe-area-context`
- **URL:** https://github.com/AppAndFlow/react-native-safe-area-context
- **What to look for:** `SafeAreaView` `edges` prop, `useSafeAreaInsets()` hook
- **Why it matters:** the built-in RN `SafeAreaView` is deprecated for new code; this library is the standard

### `react-native-svg`
- **URL:** https://github.com/software-mansion/react-native-svg
- **What to look for:** `Circle` + `strokeDasharray` for progress rings, `Defs`/`LinearGradient`/`Stop` for gradient strokes
- **Why it matters:** the only realistic way to build the progress-ring patterns Stitch designs

## Books / longer reads (worth one weekend each)

### "Designing for the Digital Age" (Kim Goodwin)
- **What to look for:** chapters on personas, scenarios, interaction patterns — pre-2010 but the methodology aged well
- **Why it matters:** trains the "design isn't decoration" muscle

### "Universal Principles of Design" (Lidwell, Holden, Butler)
- **What to look for:** *Fitts's Law*, *Hick's Law*, *Cost-Benefit*, *Inverted Pyramid*, *Signal-to-Noise Ratio*
- **Why it matters:** vocabulary for explaining design decisions to engineers and PMs

## When to load which reference

- *Starting a new screen from scratch:* HIG + MD3 + Stitch DESIGN.md
- *Reviewing an existing screen:* `CHECKLIST.md` (sibling file) + Refactoring UI
- *Translating a Figma export to RN:* `RN_PITFALLS.md` (sibling file) + Expo Blur / SVG docs
- *Hitting an accessibility issue:* WCAG 2.2 + platform a11y docs
- *Lost on aesthetic direction:* Linear / Things / Stripe screenshots for tone-setting
