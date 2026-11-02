# Safe Area & Devices

Purpose: how a screen survives contact with real hardware — insets and the `edges` discipline, the translucent-header offset, pinned chrome that taps through, notch / Dynamic Island / home-indicator / gesture-nav / Android 15 edge-to-edge, keyboard avoidance, and device-class + orientation adaptation. Safe areas are part of the layout, not an afterthought bolted on at the end. Sibling: [touch-and-interaction.md](touch-and-interaction.md) (the touchable chrome that sits in these zones), [motion-and-gesture.md](motion-and-gesture.md) (the edge-swipe-back gesture the home indicator hosts). Deterministic detectors for this page: **AR-T27** (bare/edgeless `SafeAreaView`) and **AR-T28** (no safe-area handling) in [audit-rules.md](audit-rules.md).

---

## `useSafeAreaInsets()` and the `edges` discipline

Every device carves reserved zones out of the screen — the status bar / notch / Dynamic Island up top, the home indicator and gesture-nav bar at the bottom, rounded corners on every side. Content drawn into them is clipped or untappable. Two non-negotiables:

1. **Never use the bare `SafeAreaView` from `react-native`** — it is deprecated for new code and unreliable on iOS 15+. Always import from `react-native-safe-area-context`, and wrap the app root in its `SafeAreaProvider`.
2. **Never rely on defaults — pass `edges` explicitly.** A `SafeAreaView` with no `edges` prop pads all four sides, which double-pads any screen that also has a translucent top bar handling its own inset. **AR-T27** is BLOCK on both the deprecated import and a missing explicit `edges`.

```tsx
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

// Declarative: a plain screen with a system (opaque) header — pad bottom only,
// the navigator already handled the top.
<SafeAreaView edges={['bottom']} style={{ flex: 1 }}>
  {/* content */}
</SafeAreaView>

// Imperative: when you need the raw numbers (custom bars, list padding, FABs).
const insets = useSafeAreaInsets();
<View style={{ paddingTop: insets.top, paddingBottom: insets.bottom }} />
```

**AR-T28** is BLOCK and per-screen: a top-level screen with *neither* `useSafeAreaInsets` nor `SafeAreaView` does not present. Reach for the hook when you need a number (offsets, list `contentContainerStyle` padding, an absolutely-positioned FAB); reach for the component when you just want a padded container.

---

## `useTopBarOffset` — translucent headers

A translucent/glass header floats over scrolling content, so the content must start *below* it. The offset is not just the status-bar height — it is status bar + bar height + a breathing gap. Encode it once and reuse it for the bar's own `paddingTop` and the scroll view's top padding.

```tsx
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const BAR_HEIGHT = 52;       // your visual bar height
const BREATHING_GAP = 8;     // air between bar and first content

export function useTopBarOffset() {
  const { top } = useSafeAreaInsets();
  return {
    barPaddingTop: Math.max(top, 12),               // bar's own status-bar clearance
    contentTop: top + BAR_HEIGHT + BREATHING_GAP,   // where scroll content begins
  };
}

// Usage:
const { barPaddingTop, contentTop } = useTopBarOffset();
<ScrollView contentContainerStyle={{ paddingTop: contentTop }} />
// ...and the bar pads itself with barPaddingTop (see pinned chrome below).
```

`Math.max(top, 12)` guarantees a sane minimum on devices that report a small or zero top inset.

---

## Pinned chrome: `position: 'absolute'`, not `fixed` (PITFALLS #5), and `pointerEvents="box-none"` (#6)

`position: 'fixed'` does not exist in React Native — it throws or silently fails (this is **AR-T23** territory). Pin a floating header or tab bar with `position: 'absolute'` inside the screen root, full-width via `top/left/right: 0` and a `zIndex`. And because an absolutely-positioned overlay covers the scroll content beneath it, give its **outermost wrapper** `pointerEvents="box-none"` so taps fall through to the content where the bar's own children don't sit — the bar's buttons still receive their taps; the gaps pass through (#6).

```tsx
<View style={styles.root}>
  <ScrollView contentContainerStyle={{ paddingTop: contentTop }}>{/* content */}</ScrollView>

  {/* floating glass header pinned over the scroll content */}
  <View
    pointerEvents="box-none"                 // taps fall through the gaps to the scroll view
    style={[styles.topBar, { paddingTop: barPaddingTop }]}
  >
    <BlurView intensity={Platform.select({ ios: 50, android: 48 })} style={StyleSheet.absoluteFill} />
    <View style={styles.barRow}>{/* title + buttons receive their own taps */}</View>
  </View>
</View>

const styles = StyleSheet.create({
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 50 },  // NOT 'fixed'
});
```

The same pattern pins a floating tab bar at the bottom — `bottom: 0` instead of `top: 0`.

---

## Notch, Dynamic Island, home indicator, gesture nav, Android 15 edge-to-edge

- **Notch / Dynamic Island (top).** Covered by `insets.top`. The Dynamic Island is taller than a classic notch, so a hard-coded status-bar height will collide with it — always read `insets.top`, never assume 44 or 47.
- **Home indicator (bottom, iOS).** The horizontal pill at the bottom of Face-ID iPhones. Bottom content (tab bars, sticky CTAs) must clear it via `insets.bottom`. A **tab bar sits 6–14dp above the home indicator** — add a margin on top of `insets.bottom`, don't let icons touch the pill.
- **Gesture-nav bar (bottom, Android).** Android's gesture pill behaves like the home indicator; `insets.bottom` covers it. On legacy 3-button nav, `insets.bottom` is ~0 and that's correct.
- **Android 15 edge-to-edge (mandatory).** Apps targeting SDK 35 (Android 15) draw edge-to-edge by default — the system bars become transparent and content extends under them. You **must** consume insets or your content sits under the status/nav bars. Expo SDK 52+ wires `react-native-safe-area-context` for this; honor the insets rather than fighting them, and prefer transparent system bars styled to match the screen.

The throughline: read every inset from the hook. Hard-coded device dimensions break on the next form factor.

---

## Keyboard avoidance (PITFALLS #14)

When an input sits in the lower half of the screen, the keyboard covers it. Wrap the screen (or just the input section) in `KeyboardAvoidingView` with platform-specific `behavior`, and configure the Android manifest to resize.

```tsx
import { KeyboardAvoidingView, Platform } from 'react-native';

<KeyboardAvoidingView
  behavior={Platform.OS === 'ios' ? 'padding' : undefined}
  keyboardVerticalOffset={contentTop}     // offset by any fixed header
  style={{ flex: 1 }}
>
  {/* scrollable form */}
</KeyboardAvoidingView>
```

On Android, leave `behavior` undefined and rely on `android:windowSoftInputMode="adjustResize"` (via `app.json` → `android.softwareKeyboardLayoutMode: "resize"` in Expo, or directly in `AndroidManifest.xml`) — the native resize pushes a `flex: 1` container up on its own; `behavior="height"` on Android double-compensates and leaves a bottom gap. For multi-input forms, `KeyboardAwareScrollView` from `react-native-keyboard-controller` is the more robust modern alternative. Test on a **small phone**, where the input is most likely to sit under the keyboard; a large phone can hide the bug.

For a scrolling form, pair `KeyboardAvoidingView` with a `ScrollView` set to `keyboardShouldPersistTaps="handled"` so a tap on another field (or a submit button) lands instead of being swallowed by the keyboard-dismiss, and `contentContainerStyle` bottom padding equal to `insets.bottom` so the last field clears the home indicator when scrolled to. On a dense form, a `Pressable` backdrop calling `Keyboard.dismiss()` gives the user an obvious way out — the keyboard has no visible dismiss affordance on Android otherwise.

---

## Device-class adaptation and orientation

Don't just stretch one phone layout across every screen. Adapt across four classes, and across orientation — read the live window with `useWindowDimensions()` (it updates on rotation and on foldable fold/unfold), not the one-shot `Dimensions.get()`.

```tsx
import { useWindowDimensions } from 'react-native';

const { width } = useWindowDimensions();
const cols = width < 380 ? 1 : width < 700 ? 2 : width < 1024 ? 3 : 4;
//          small phone   large phone     tablet         foldable / large tablet
```

- **Small phone (<380dp):** single column, tighter section breath but never below the 16dp gutter floor; watch for the keyboard-avoidance trap above.
- **Large phone (380–700dp):** the baseline — two-column bento grids work here.
- **Tablet (700–1024dp):** don't full-width a 700dp text column (unreadable line length); cap content width and center it, or move to a master-detail split.
- **Foldable / large tablet (≥1024dp):** master-detail, multi-column. Foldables also change dimensions mid-session at the fold — `useWindowDimensions()` re-renders on the change; a cached `Dimensions.get()` value strands the layout.
- **Orientation:** decide deliberately — lock portrait in `app.json` if landscape adds nothing, or genuinely re-flow (a media/reading app earns landscape). Don't ship a portrait layout stretched sideways. **Test the decision, don't just make it:** `mcp__mobile__mobile_set_orientation` rotates the device and `mobile_get_orientation` confirms it, so re-screenshot after rotating — if you locked portrait, verify the lock actually holds; if you re-flowed, verify the re-flow is a layout and not a stretch. Locked-portrait is the one case where "it looks wrong sideways" is a pass rather than a bug, and only a rotation tells you which case you are in.

---

## Quick reference

- Import `SafeAreaView`/`useSafeAreaInsets` from `react-native-safe-area-context`, never bare RN; pass `edges` explicitly — **AR-T27**.
- Every top-level screen handles top + bottom insets — **AR-T28**.
- Translucent header → `useTopBarOffset` (status bar + bar height + breathing gap).
- Pin chrome with `position: 'absolute'` (#5), `pointerEvents="box-none"` on the wrapper (#6) — never `fixed`.
- Read `insets.top` (notch/Island) and `insets.bottom` (home indicator/gesture nav); tab bar 6–14dp above the indicator; consume insets for Android 15 edge-to-edge.
- `KeyboardAvoidingView` (`padding` iOS / `height` Android) + `adjustResize` manifest (#14); test on a small phone.
- Adapt small → large phone → tablet → foldable with `useWindowDimensions()`; handle orientation deliberately.

Walk the full review with the SK-126 [CHECKLIST.md](../../mobile-app-design/CHECKLIST.md) — item 21 (safe areas respected; bottom content clears the home indicator) is this page's source. Reference it; do not duplicate it.
