# Platform Conventions — iOS HIG vs Material 3

The side-by-side of Apple's Human Interface Guidelines and Material Design 3, and a single rule for deciding when to honor each platform and when to unify to one brand intent.

This is the *decision* page. For native implementation, tactile orchestrates the deep skills: route iOS/SwiftUI work to **swiftui-pro**, native Android/Compose work to **android-development**. For cross-platform RN, pair this with [cross-platform-parity.md](cross-platform-parity.md).

---

## The core rule

> **Honor the platform unless the brand has a deliberate reason to unify — and if you unify, do it everywhere.**

iOS users and Android users have internalized different conventions whether you have or not. The default is to *honor*: use each platform's navigation chrome, modality, system controls, iconography, and motion. You break from that only when a strong brand reason exists (a distinctive product identity that must read identically on both) — and then you commit to it on **every** surface. The failure mode is half-unifying: a custom iOS-styled nav bar bolted onto an otherwise-native Android app reads as broken on both. Pick one stance per surface and hold it.

This decision is not yours to improvise — it comes from the **Platform Conventions Policy** in the project's `.tactile.md` (see below). Read it first.

---

## Side-by-side

| Concern | iOS (HIG) | Material 3 (Android) |
|---|---|---|
| **Navigation chrome** | Tab bar at bottom; navigation bar with large titles that collapse on scroll; back chevron + previous-title at leading edge | Navigation bar (bottom) or navigation rail (wide); top app bar (small / center / medium / large); back arrow at start |
| **Primary modality** | Sheet (detents), modal, full-screen cover; alerts for blocking decisions | Bottom sheet (modal / standard), full-screen dialog, dialog; snackbar for transient feedback |
| **Switches** | `Switch` — green track when on, pill thumb, subtle | `Switch` — tonal track, thumb with checkmark/icon when on, larger |
| **Pickers** | Wheel `DateTimePicker`, inline calendar, context menu picker | Date/time picker dialogs, dropdown / exposed dropdown menu |
| **Segmented choice** | `SegmentedControl` — equal-width segments, sliding selected pill | Segmented buttons (M3) or tabs — outlined, checkmark on selected |
| **Iconography** | **SF Symbols** — weight/scale match adjacent text, optical sizing, hierarchical/multicolor rendering | **Material Symbols** — outlined/rounded/sharp families, fill + weight + grade + optical-size axes |
| **Elevation / depth** | Shadow-based — soft ambient `shadow*`; blur for translucency (glass). Tintable shadows. | **Tonal elevation** — surface gets lighter/tinted with elevation; `elevation` casts an untintable key+ambient shadow |
| **Typography defaults** | SF Pro (Text/Display optical), Dynamic Type ramp (LargeTitle → Caption2) | Roboto / Roboto Flex, M3 type scale (Display / Headline / Title / Body / Label) |
| **Back behavior** | Leading back chevron + interactive **edge-swipe-from-left** pop | **System back** (gesture/button) is primary; also dismisses sheets/dialogs |
| **Haptics** | Rich, expected — selection ticks, impact on commit, notification haptics (`expo-haptics`, `UIFeedbackGenerator`) | Present but lighter; `HapticFeedbackConstants`. Don't over-buzz |
| **FAB** | No FAB convention — primary action lives in nav bar / toolbar | FAB is a first-class M3 pattern for the screen's primary creative action |

Use the **MD3 color role system** (`primary` / `primaryContainer` / `onPrimary` / `onPrimaryContainer`) as your token mental model on *both* platforms — it's the cleanest way to keep light + dark coherent even on an iOS-leaning app. That's a token-architecture choice, not a visual-convention one; honoring iOS visuals and using MD3 token roles are not in conflict.

---

## Deciding per the `.tactile.md` policy

The Design Context's **Platform Conventions Policy** is the source of truth. It resolves to one of three stances — apply it per surface:

- **Honor each platform (default).** Native chrome, native controls, native modality on each. iOS gets SF Symbols + sheets + shadow/glass; Android gets Material Symbols + bottom sheets + tonal elevation. Most apps, especially system-honest and utility apps, want this. Branch with `Platform.select` / `process.env.EXPO_OS` where the look diverges.
- **Unify to one brand intent.** A custom design language overriding native defaults on both platforms — same nav, same controls, same icons everywhere. Justified only for a strong, recognizable product identity. If chosen, it is **everywhere**: a unified switch component, a unified sheet, a unified icon set, both platforms. No native leakage on one side.
- **iOS-first / Android-first.** Lead with one platform's conventions, port faithfully to the other, and accept the lead platform's idioms as the brand's. State which is lead so divergences resolve predictably.

When the policy is silent on a specific control, default to **honor**. Never silently unify by accident — an unstyled custom component that happens to look iOS-ish on Android is the most common slop tell here.

---

## When native components beat custom (and vice versa)

**Prefer the native/system component when:**

- It carries built-in behavior users expect — `Switch`, `DateTimePicker`, `SegmentedControl`, the system share sheet, context menus, the nav/tab bar. Reimplementing these means reimplementing their haptics, accessibility, RTL, Dynamic Type, and platform animations — and you will get them subtly wrong.
- The direction is **system-honest** — leaning on platform components *is* the aesthetic.
- Accessibility matters and the native control already speaks VoiceOver/TalkBack correctly (it does; your custom one probably won't on the first pass).

**Build custom when:**

- The brand direction (per the unify policy) requires a look the native control can't express — and you accept owning every state, every platform, and full a11y parity (`accessibilityRole`, `accessibilityState`, focus order).
- The interaction is genuinely novel (a custom gesture, a bespoke visualization) with no native equivalent.

Default to native; earn custom. A custom switch that's missing its disabled state, its haptic, or its TalkBack label is strictly worse than the system one.

---

## Routing to the deep skills

tactile sets the convention policy; the native skills implement it:

- **Native iOS / SwiftUI** → **swiftui-pro** (modern SwiftUI APIs, navigation, performance). Pair **swift-concurrency-pro** for async, **swift-testing-pro** for tests.
- **Native Android / Jetpack Compose** → **android-development** (Compose + MVVM + Hilt + Room, Google architecture guidance).
- **`@expo/ui` native styling bridges** → **expo-ui-swiftui** (SwiftUI views/modifiers in RN) and **expo-ui-jetpack-compose** (Compose views/modifiers in RN) — the path to *real* native controls inside an Expo app.
- **Expo Router structure, native tabs, SF Symbols, sheets, liquid glass** → **building-native-ui**.

Don't hand-build a native iOS picker or a Compose bottom sheet inside tactile — route it. tactile decides *which* convention and *whether* to honor it; the deep skill builds it idiomatically.

---

## Cross-references

- [cross-platform-parity.md](cross-platform-parity.md) — where identical React Native code renders differently across the two platforms, and how to reconcile or deliberately diverge (the practical companion to the policy decision here).
- [navigation-and-ia.md](navigation-and-ia.md) — the navigation containers referenced in the chrome/modality rows above.
- [glass-and-depth.md](glass-and-depth.md) — the iOS shadow/blur depth model versus Android tonal elevation, in detail.
- craft.md AR-T20 (shadow without elevation) and AR-T26 (platform-asymmetric blur) are the deterministic teeth behind the elevation/depth divergence row.
