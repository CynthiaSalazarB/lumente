# Cross-Platform Parity

Where identical React Native code renders **differently** on iOS vs Android, why, and how to either reconcile it with `Platform.select` or deliberately diverge to honor each platform.

The trap: you develop on one simulator, it looks right, you ship — and the other platform renders flat, washed out, or unresponsive. "Write once, run anywhere" is true for *logic*, not for *feel*. This page is the divergence catalog. It pairs with [platform-conventions.md](platform-conventions.md) (the honor-vs-unify decision) and [rn-translation-traps.md](rn-translation-traps.md) (web→RN translation bugs).

For *each* divergence below: the two outcomes are not a bug to "fix" into sameness — sometimes you reconcile (make them match), sometimes you diverge on purpose (let each platform be itself). The policy in `.tactile.md` decides which.

---

## The divergence catalog

### 1. Shadow (iOS) vs elevation (Android)

The single most common parity break. iOS reads `shadowColor` / `shadowOpacity` / `shadowRadius` / `shadowOffset` and ignores `elevation`; Android reads `elevation` and ignores every `shadow*` prop.

- **Symptom:** a card with only `shadow*` is perfectly lifted on iOS and **dead flat** on Android (AR-T20).
- **Critically: Android elevation shadows cannot be tinted.** `elevation` casts a fixed neutral key+ambient shadow. The accent-tinted CTA "lift" you can do on iOS has **no Android equivalent** (AR-T21).
- **Reconcile:** always set both.
  ```tsx
  ...Platform.select({
    ios: { shadowColor: t.shadowTint, shadowOpacity: 0.18, shadowRadius: 22, shadowOffset: { width: 0, height: 10 } },
    android: { elevation: 6 },
  })
  ```
- **Diverge deliberately:** tint the shadow toward the accent on iOS for hero CTAs; on Android, get separation from **tonal elevation** (a lighter/tinted surface) instead — that's the M3 idiom, not a fallback.

### 2. BlurView intensity asymmetry

`expo-blur` blur is **weaker on Android** at the same `intensity`. A value tuned on iOS looks like real glass there and a gray translucent panel on Android.

- **Symptom:** glass card / tab bar reads as flat gray on Android; a bare single `intensity` literal trips AR-T26.
- **Reconcile:** asymmetric intensity, always.
  ```tsx
  intensity={Platform.select({ ios: 28, android: 18 })}   // cards
  intensity={Platform.select({ ios: 60, android: 32 })}   // bars
  ```
- Android real blur needs API 31+; below that it degrades. If the brand can't tolerate weak Android glass, **diverge**: use an opaque tinted surface (tonal elevation) on Android and reserve glass for iOS. Glass earns its place — see [glass-and-depth.md](glass-and-depth.md).

### 3. Ripple (Android) vs opacity/scale press feedback (iOS)

Android's tactile language is the **ink ripple** spreading from the touch point; iOS uses a subtle opacity dim or scale-down. Shipping iOS-style opacity to Android feels lifeless; shipping a ripple to iOS feels foreign.

- **Reconcile per platform** inside one `Pressable`:
  ```tsx
  <Pressable
    android_ripple={{ color: t.ripple, borderless: false }}
    style={({ pressed }) => [
      styles.btn,
      pressed && process.env.EXPO_OS === "ios" && { opacity: 0.88, transform: [{ scale: 0.97 }] },
    ]}
  />
  ```
- Every interactive needs *a* press state on *both* (AR-T02) — but the **right** state differs. This is a deliberate divergence, not a parity fix: give Android its ripple, iOS its scale/opacity.

### 4. Font availability & default system faces

The default face differs: **SF Pro** on iOS, **Roboto** on Android. `fontWeight` maps to different concrete faces, and a custom font bundled but not loaded silently falls back to *different* system faces per platform.

- **Symptom:** the same screen looks tighter/heavier on one platform; numerals align differently.
- **Reconcile:** bundle your chosen face explicitly (`@expo-google-fonts/*` or local `.ttf`) and gate render on `useFonts(...)` so neither platform flashes its own fallback. Never rely on a named system font string resolving the same way.
- Custom fonts often need an explicit `fontWeight` *and* the weight-specific family name on Android, which is stricter than iOS about synthetic weights.

### 5. Status-bar handling

iOS and Android differ on status-bar style, translucency, and whether content draws behind it.

- iOS: `StatusBar` style (`light`/`dark`) follows the bar's content; with a translucent header you compute the top offset from `useSafeAreaInsets().top`.
- Android: the status bar can be translucent/edge-to-edge with its own background color; under edge-to-edge (the modern default) content draws behind it and you must pad by the top inset.
- **Reconcile:** drive style from theme, handle the top inset on every screen (AR-T28), and verify on both. Don't hardcode a status-bar height — it's notch/Dynamic-Island/punch-hole dependent. See [safe-area-and-devices.md](safe-area-and-devices.md).

### 6. Nav chrome & back gesture

Covered in depth in [platform-conventions.md](platform-conventions.md): iOS large-title nav bar + edge-swipe-back; Android top app bar + system back. **Almost always diverge** — these are the most internalized conventions on each platform. Let the Expo Router `Stack` header render each platform's native chrome rather than forcing one look.

### 7. Default control look (Switch, DatePicker, etc.)

The same `<Switch />` and `@react-native-community/datetimepicker` render with each platform's native styling — green pill vs tonal track; wheel picker vs Material dialog.

- **Default to diverge:** let them be native. Users expect their platform's control, and the native versions ship correct haptics + a11y for free (see [platform-conventions.md](platform-conventions.md) § native vs custom).
- Only **reconcile** (build one unified custom control) when the unify policy demands it — and then own every state on both platforms.

### 8. Text rendering & letter-spacing units

- RN `letterSpacing` is in **density-independent points on both**, but the *visual* result differs because the default faces have different metrics — a value tuned to SF Pro looks looser on Roboto.
- Line-height rounding and baseline alignment differ subtly; uppercase labels can shift.
- **Reconcile:** tune `letterSpacing` against your *bundled* face (not the system fallback), and verify labels on both. For aligned numerals use `fontVariant: ['tabular-nums']` — consistent across platforms.

### 9. RTL / writing direction (locale-conditional)

Only relevant when the app targets a right-to-left locale (Arabic, Hebrew, Farsi, Urdu) or ships global — but then it's load-bearing, and it's the divergence most often missed because you don't *see* it on a left-to-right simulator. React Native flips *some* of the layout for you and leaves the rest to you.

- **Use direction-aware (logical) style props, not physical ones.** `marginStart`/`marginEnd`, `paddingStart`/`paddingEnd`, and `start`/`end` (instead of `left`/`right`) flip automatically with `I18nManager.isRTL`. Physical `marginLeft`/`marginRight`/`left`/`right` do **not** flip reliably (they depend on `doLeftAndRightSwapInRTL`) — they are the RTL bug. `flexDirection: 'row'` already reverses under RTL; don't fight it with hardcoded positions.
- **Mirror directional icons, not content.** A back chevron, a send arrow, a progress bar should flip in RTL; a logo, a checkmark, media artwork, and play/pause must **not**. Gate the mirror on `I18nManager.isRTL` (e.g. `transform: [{ scaleX: I18nManager.isRTL ? -1 : 1 }]` on the glyph).
- **Leave text alignment to the writing direction.** Don't force `textAlign: 'left'` on body copy — let it follow the locale so Arabic right-aligns. Reserve explicit alignment for deliberate cases.
- **Budget for text expansion.** Translations run ~30% longer than English (German, Finnish, Arabic) — never pin a button or label to an English-fit fixed width; let it flex and cap with `numberOfLines` (ties to the typography rules). Fixed-width chrome is where i18n visibly breaks.
- **Test it.** `I18nManager.forceRTL(true)` + reload (it persists across restarts) to preview the flipped layout without changing device language; reach for `isRTL` only where logical props can't express it (absolute positioning).

This is deliberately **not** a universal AR-T BLOCK rule — physical `marginLeft` is perfectly fine in an LTR-only app, so flagging it everywhere would be noise. It's a *conditional discipline*: when `.tactile.md` says the app targets RTL/global, sweep screen code for `marginLeft|marginRight|left:|right:|textAlign` and convert to logical props before shipping.

---

## How to decide: reconcile or diverge

| Divergence | Default move |
|---|---|
| Shadow/elevation, blur intensity, status-bar inset, fonts | **Reconcile** — set both / asymmetric values so the *intended* look survives on each |
| Ripple vs scale, nav chrome, back gesture, native controls | **Diverge** — each platform's idiom is the right answer; forcing sameness reads as foreign |
| Letter-spacing, line-height | **Reconcile by tuning against the bundled face**, then eyeball both |
| RTL / writing direction (if targeting RTL/global) | **Reconcile via logical props** — `start`/`end` + `marginStart`/`End` flip for free; mirror directional icons only |

The meta-rule from [platform-conventions.md](platform-conventions.md): honor the platform unless the brand has a deliberate reason to unify. Reconcile *how something looks* (so the lift/glass/type intent lands); diverge *how the platform behaves* (so it feels native). And whatever you choose — **verify on both**, on a real frame, in a release-style build (blur, shadow/elevation, and fonts all differ between dev and release).

---

## SwiftUI ↔ Jetpack Compose concept map

For teams doing native on both sides (routed to **swiftui-pro** and **android-development**), the mental models map closely — useful when porting a screen between the two:

| Concept | SwiftUI | Jetpack Compose |
|---|---|---|
| Declarative view | `View` (struct, `body`) | `@Composable fun` |
| Vertical / horizontal stack | `VStack` / `HStack` | `Column` / `Row` |
| Overlay / z-stack | `ZStack` | `Box` |
| Local state | `@State` | `remember { mutableStateOf(...) }` |
| Two-way binding | `@Binding` | state hoist + `(value, onValueChange)` |
| Observable model | `@Observable` / `@StateObject` | `ViewModel` + `StateFlow` / `collectAsState` |
| Layout modifiers | `.padding()` `.frame()` | `Modifier.padding()` `.size()` |
| Lazy list | `List` / `LazyVStack` | `LazyColumn` |
| Navigation | `NavigationStack` / `.sheet` | `NavHost` / `ModalBottomSheet` |
| Theming tokens | `Color`/`Font` + environment | `MaterialTheme.colorScheme` / `.typography` |
| Animation | `.animation` / `withAnimation` | `animate*AsState` / `AnimatedVisibility` |
| Icon system | SF Symbols (`Image(systemName:)`) | Material Symbols (`Icon(...)`) |

The structural ideas transfer; the **idioms and the look do not**. A faithful port still honors each platform's controls, elevation model, and motion — don't make Compose mimic SwiftUI's shadow-glass or make SwiftUI fake tonal elevation. Build each idiomatically via its deep skill.

---

## Cross-references

- [platform-conventions.md](platform-conventions.md) — the honor-vs-unify decision that governs every reconcile/diverge call here.
- [rn-translation-traps.md](rn-translation-traps.md) — web→React Native translation bugs (the *other* class of "renders wrong" problems).
- [glass-and-depth.md](glass-and-depth.md) — the iOS shadow/blur vs Android tonal-elevation depth models in detail.
- [safe-area-and-devices.md](safe-area-and-devices.md) — status-bar/inset handling referenced above.
- Deterministic teeth: craft.md **AR-T20** (shadow without elevation) and **AR-T26** (platform-asymmetric blur) catch divergences 1 and 2 mechanically; run the audit before presenting.
