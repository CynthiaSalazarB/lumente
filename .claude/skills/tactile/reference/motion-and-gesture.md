# Motion & Gesture

Purpose: native motion timing, easing discipline, the GPU-only animation contract, a practical Reanimated press-scale, the gesture vocabulary and when each gesture is conventional, and reduced-motion respect. Mobile motion is *native* motion — it decelerates like a physical object and never blocks the thread. Sibling: [touch-and-interaction.md](touch-and-interaction.md) (the pressed states this page animates), [safe-area-and-devices.md](safe-area-and-devices.md) (where dismissible chrome lives). Deterministic detectors for this page: **AR-T29** (layout-property animation) and **AR-T30** (bounce/elastic easing) in [audit-rules.md](audit-rules.md).

---

## Native timing table

Mobile users have a calibrated sense of native speed from thousands of hours in iOS and Android. Miss it and the app feels either sluggish or twitchy. Anything over ~300ms reads as laggy; anything under ~80ms on an entrance reads as a glitch.

| Transition | Duration | Easing | Note |
|------------|----------|--------|------|
| Sheet / modal entry | **240ms** | ease-out | the canonical sheet speed |
| Sheet / modal exit | ~200ms | ease-in | exits a touch faster than entries |
| Press feedback | **100–150ms** | ease-out | `scale 0.96` — the sweet spot |
| Tab switch | **instant** | — | **no fade** — cross-fading tabs is disorienting on mobile |
| List item enter | 200–260ms | ease-out | stagger by ~30ms for a cascade, not a wave |
| Toast / snackbar in | 200ms | ease-out | out ~150ms ease-in |

The single most useful number: **>300ms reads laggy.** When in doubt, go faster.

---

## Easing discipline

- **Ease-out for entrances.** A thing arriving decelerates into place — fast at first, settling at the end. (`Easing.out(Easing.quad)` / `cubic-bezier(0.16, 1, 0.3, 1)`.)
- **Ease-in for exits.** A thing leaving accelerates away. (`Easing.in(Easing.quad)`.)
- **No bounce, no elastic.** Real objects do not overshoot and spring back. `Easing.bounce` and `Easing.elastic` — and springs tuned for visible overshoot — read as toy-like and amateur. **AR-T30** is BLOCK on `Easing.bounce`/`Easing.elastic` and on springs with `overshootClamping: false` tuned bouncy. A spring is fine; a *bouncy* spring is the tell. Tune for a critically-damped settle, not a wobble.

```tsx
import { Easing } from 'react-native-reanimated';
const ENTER = { duration: 240, easing: Easing.out(Easing.quad) };
const EXIT  = { duration: 200, easing: Easing.in(Easing.quad) };
```

---

## The GPU-only contract: animate transform + opacity, on the UI thread

Two rules, one principle — keep animation off the JS thread and off the layout engine.

1. **Animate only `transform` (translate/scale/rotate) and `opacity`.** These composite on the GPU without re-running layout. Animating `width`, `height`, `padding`, `margin`, `top`, `left` forces a layout pass every frame — janky, especially on Android and in lists. **AR-T29** is BLOCK: an animated value driving a layout property instead of transform/opacity. Need a size change? Animate `scaleX`/`scaleY`, or use a measured-height transform, or Reanimated's `Layout`/entering-exiting layout animations — never raw animated `height`.
2. **Drive it with Reanimated on the UI thread (worklets).** The legacy `Animated` API runs on JS and stutters under load; Reanimated 3 runs the animation in a worklet on the UI thread, so it holds 60fps even while JS is busy. Use `useSharedValue` + `useAnimatedStyle` + `withTiming`/`withSpring`. Mark cross-thread callbacks with `runOnJS`.

```tsx
// JANK — layout property on the JS thread:
Animated.timing(this.state.h, { toValue: 200 }).start();   // animates height → relayout every frame

// SMOOTH — transform + opacity in a UI-thread worklet:
scale.value = withTiming(0.96, { duration: 120, easing: Easing.out(Easing.quad) });
```

---

## Practical Reanimated press-scale

The pressed-state requirement from [touch-and-interaction.md](touch-and-interaction.md), done on the UI thread. The shared value lives on the UI thread; `useAnimatedStyle` reads it without a JS round-trip, so the scale tracks the finger with no lag.

```tsx
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated';
import { Pressable } from 'react-native';

function PressableCard({ onPress, children }: { onPress: () => void; children: React.ReactNode }) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Pressable
      onPressIn={() => { scale.value = withTiming(0.96, { duration: 120, easing: Easing.out(Easing.quad) }); }}
      onPressOut={() => { scale.value = withTiming(1, { duration: 150, easing: Easing.out(Easing.quad) }); }}
      onPress={onPress}
      accessibilityRole="button"
    >
      <Animated.View style={[styles.card, animatedStyle]}>{children}</Animated.View>
    </Pressable>
  );
}
```

`onPressIn` fires the moment the finger lands (not on release), so the scale is instant — well within the 150ms budget. `withTiming` with an ease-out curve gives the settle; no spring needed for a press.

For an entrance (a sheet sliding up, a card fading in), the same primitives drive `translateY` + `opacity` together — and Reanimated's `entering`/`exiting` props handle mount/unmount transitions declaratively without a manual shared value:

```tsx
import Animated, { FadeInUp, FadeOutDown } from 'react-native-reanimated';

<Animated.View
  entering={FadeInUp.duration(240).easing(Easing.out(Easing.quad))}
  exiting={FadeOutDown.duration(200).easing(Easing.in(Easing.quad))}
>
  {/* sheet body */}
</Animated.View>
```

These presets translate + fade (transform + opacity) under the hood, so they satisfy the GPU-only contract for free. Reach for them before hand-rolling a mount animation — and override the default duration/easing to match the timing table above, since the un-tuned presets run their own curve.

---

## Gesture vocabulary — and when each is conventional

Gestures are a vocabulary the platform already taught the user. Use them where they are *expected*; inventing novel gestures for core actions strands users. Implement with `react-native-gesture-handler` (UI-thread gestures) composed with Reanimated.

- **Swipe-to-dismiss (sheets / cards).** Bottom sheets are dragged down to dismiss; cards in a stack swipe away. Conventional for any modal sheet and for dismissible list items (swipe-to-delete/archive). Pair the drag with a **grabber** — the ~44×5 rounded bar at the top of a sheet — so the affordance is visible; a sheet with no grabber leaves users unsure it can be dismissed.
- **Long-press.** Reveals a context menu or enters a selection/reorder mode. Conventional for "more actions on this item" and drag-to-reorder. Give it haptic feedback on trigger (`expo-haptics` `impactAsync`) — long-press has no visual until it fires, so the haptic *is* the feedback.
- **Pull-to-refresh.** The standard refresh gesture for any scrollable feed. Use `RefreshControl` on the `ScrollView`/`FlatList` — don't reinvent it; users already know to pull.
- **Edge-swipe back.** iOS pops the navigation stack on a left-edge swipe; Android uses the system back gesture. Both come free with the navigator (React Navigation / Expo Router) — **do not** intercept the screen edge with a custom horizontal gesture (e.g. a carousel that reaches the edge), or you break the platform's back affordance.

The principle: a gesture for a *secondary* action is delight; a gesture as the *only* way to do a *primary* action is a trap. Always pair a gesture with a visible button or affordance for the core path.

---

## Haptics — match the generator to the meaning

Haptics are motion you *feel* instead of see, and `expo-haptics` exposes Apple's three feedback generators directly. The craft is matching the right generator to the kind of moment — and spending them sparingly. Over-buzzing (a haptic on every tap) is the slop tell; a screen that vibrates constantly feels broken, not premium.

| Moment | Call | When it fires |
|--------|------|---------------|
| Discrete value change | `selectionAsync()` | a picker/slider crosses a notch, a segmented control flips, a stepper ticks — the lightest tap, fired on *every* step of a continuous selection |
| An element snaps / collides | `impactAsync(ImpactFeedbackStyle.Light\|Medium\|Heavy\|Soft\|Rigid)` | a toggle flips, a drag snaps to a slot, pull-to-refresh crosses the trigger, a weighty button commits. `Soft`/`Light` for subtle, `Medium` (default) for standard, `Heavy`/`Rigid` for forceful |
| An outcome resolves | `notificationAsync(NotificationFeedbackType.Success\|Warning\|Error)` | an operation *finishes* — saved, submitted, payment failed. Always paired with the visual state, never alone |

**Match the meaning; don't reach for the loudest one.** A button tap is `selectionAsync()` or a light `impactAsync` — *not* `notificationAsync(Success)` (reserved for a completed outcome). An error is `notificationAsync(Error)` — not a heavy impact. Mismatched haptics read as wrong even when the user can't say why.

```tsx
import * as Haptics from 'expo-haptics';
Haptics.selectionAsync();                                          // tab / segment / slider tick
Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);            // toggle / snap
Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); // failed submit (+ the visual error state)
```

- **Budget hard, and never make it the only feedback.** Haptics are iOS-rich and Android-restrained, and the iOS Taptic Engine goes silent in Low Power Mode, while the camera is active, or during dictation — so a haptic *complements* a visual state, it never *replaces* one. The single exception is a long-press trigger, where there's no visual until it fires; there the haptic **is** the confirmation (see the gesture vocabulary above).
- **Android-native effects:** the three cross-platform calls work on Android too, but for Android-specific feedback (`Keyboard_Tap`, `Long_Press`, `Toggle_On`/`Off`, `Reject`, …) use `performAndroidHapticsAsync(AndroidHaptics.*)`. Don't assume an iOS impact feels identical on Android.
- **No warm-up in `expo-haptics`:** Apple's native `UIFeedbackGenerator.prepare()` (which trims first-tap latency) is *not* exposed by the Expo module — if sub-frame haptic latency on a hot path ever matters, that's a native-module concern, not a one-liner. For normal UI it's a non-issue.

---

## Reduced-motion respect

A meaningful slice of users enable Reduce Motion (vestibular sensitivity, focus, battery). Honor it: cut large translate/scale transitions down to a plain opacity fade or no animation. Read the setting once and subscribe to changes.

```tsx
import { AccessibilityInfo } from 'react-native';
import { useEffect, useState } from 'react';

function useReduceMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduced);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => sub.remove();
  }, []);
  return reduced;
}

// At the call site: skip the dramatic transform, keep a quiet fade.
const reduced = useReduceMotion();
opacity.value = withTiming(1, { duration: reduced ? 0 : 240, easing: Easing.out(Easing.quad) });
translateY.value = reduced ? 0 : withTiming(0, ENTER);
```

Press feedback can stay (it is functional, not decorative); it is the large *spatial* motion — slide-ins, parallax, big scale entrances — that reduced motion should suppress.

---

## One motion personality from the brand words

Derive the app's motion personality from the **same three brand words** used in the SKILL.md font procedure. "Calm and clinical and careful" wants slower, longer ease-outs and minimal travel; "fast and dense and unimpressed" wants crisp 150–200ms snaps. Mixed motion personalities on one app — a springy bouncy tab here, a slow cinematic sheet there — read as slop, the same way mismatched fonts do. Pick the curve and the speed band once, encode them as shared constants (`ENTER`/`EXIT` above), and reuse them everywhere. Consistency *is* the personality.

---

## Quick reference

- Timing: sheet 240ms, press 100–150ms (`scale 0.96`), tab switch instant/no-fade, >300ms = laggy.
- Ease-out for entries, ease-in for exits. No bounce, no elastic, no bouncy springs — **AR-T30**.
- Animate `transform` + `opacity` only, in a Reanimated UI-thread worklet — never layout props — **AR-T29**.
- Press-scale: `useSharedValue` + `useAnimatedStyle` + `withTiming`, fired on `onPressIn`.
- Gestures where conventional: swipe-dismiss (+grabber), long-press (+haptic), pull-to-refresh, edge-swipe back. Always keep a visible fallback for primary actions.
- Haptics: `selectionAsync` (ticks) · `impactAsync` (snaps) · `notificationAsync` (outcomes). Match the generator to the meaning, budget hard, never the only feedback.
- Honor `AccessibilityInfo.isReduceMotionEnabled()` — suppress large spatial motion, keep functional feedback.
- One motion personality, derived from the brand words, encoded as shared constants.

Walk the full review with the SK-126 [CHECKLIST.md](../../mobile-app-design/CHECKLIST.md) — items 17 (press feedback ≤150ms) and 18 (modal style matches purpose) are this page's source. Reference it; do not duplicate it.
