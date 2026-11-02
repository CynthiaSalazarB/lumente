# RN Translation Traps

Things that work fine in CSS / web Figma exports but silently break when you implement them in React Native — read this before translating any glass / layered / iOS-modern design to RN.

This file is tactile's internal home for the same material as the loaded **mobile-app-design (SK-126)** `RN_PITFALLS.md` — it deliberately overlaps it so a tactile build never has to leave the skill to get the fixes. Each trap that has a deterministic detector is tagged with its rule ID from [audit-rules.md](audit-rules.md); the glass-side companion is [glass-and-depth.md](glass-and-depth.md). Targets current Expo / RN: `expo-blur`, `expo-linear-gradient`, `react-native-svg`, `react-native-safe-area-context`, `expo-image`.

---

## 1. `backdrop-filter` does not exist in RN — **AR-T22**

**Symptom:** glass cards render as flat tinted panels with no blur underneath.

**Fix:** use `BlurView` from `expo-blur` as a *sibling* under the card content, not as a CSS filter. The pattern:

```tsx
<View style={cardStyle}>
  {/* Android needs blurMethod to opt in (default 'none'); SDK 54 = experimentalBlurMethod */}
  <BlurView intensity={28} tint={isDark ? 'dark' : 'light'} blurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
  <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(255,255,255,0.65)' }]} />
  {children}
</View>
```

The order matters: blur first (back), then tinted fill, then content. `expo-blur` does the native platform-API call: `UIVisualEffectView` on iOS, and on Android the **Dimezis BlurView library** (RenderNode on Android 12+/SDK 31, RenderScript below) — but **only when you opt in** via the `blurMethod` prop (`experimentalBlurMethod` before SDK 55, default `'none'`). Skip the opt-in and Android stays a flat panel. Full three-layer recipe + the SDK-55 `BlurTargetView` caveat in [glass-and-depth.md](glass-and-depth.md).

## 2. `BlurView` intensity is platform-asymmetric — **AR-T26**

**Symptom:** glass effect looks great on iOS but flat / gray-fade on Android.

**Fix:** use `Platform.select` to set higher intensity on Android. Empirically:

```tsx
intensity={Platform.select({ ios: 28, android: 18, web: 0 })}  // cards
intensity={Platform.select({ ios: 50, android: 48, web: 0 })}  // app bars / headers (tab bar: ios 60 / android 32)
```

Below 16 on Android, the BlurView reads as a translucent gray panel, not blur. Web returns 0 because `BlurView` is a no-op there — use CSS `backdrop-filter` for web with a `Platform.OS === 'web'` branch. And note the Android intensities are moot until you opt in with `blurMethod="dimezisBlurView"` (default `'none'`) — see [glass-and-depth.md](glass-and-depth.md) § Android opt-in.

## 3. `radial-gradient` does not exist in RN — **AR-T24**

**Symptom:** the "mesh background" in your Figma export looks great. Yours looks like a flat color.

**Fix:** fake the mesh with `LinearGradient` (from `expo-linear-gradient`) for the base + 2–3 oversized circle `View`s with low opacity in the corners.

```tsx
<View style={{ flex: 1, overflow: 'hidden' }}>
  <LinearGradient colors={['#f9f9fe', '#ededf2']} style={StyleSheet.absoluteFill} />
  <View style={{ position: 'absolute', width: 360, height: 360, borderRadius: 180,
                 backgroundColor: '#72fe88', opacity: 0.22, top: -140, left: -130 }} />
  <View style={{ position: 'absolute', width: 300, height: 300, borderRadius: 150,
                 backgroundColor: '#d8e2ff', opacity: 0.18, bottom: -120, right: -120 }} />
  {children}
</View>
```

The blobs are *unblurred* — RN can't blur a View directly. The illusion holds because of the low opacity and the off-frame negative offsets that hide the hard edge.

## 4. `box-shadow` is iOS-only; Android needs `elevation` — **AR-T20**

**Symptom:** a card has a perfect soft shadow on iOS and is completely flat on Android.

**Fix:** always set both:

```tsx
{
  ...Platform.select({
    ios: { shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 22, shadowOffset: { width: 0, height: 10 } },
    android: { elevation: 4 },
  })
}
```

Caveats:
- Android's `elevation` produces a **fixed black drop shadow** — you cannot tint it (no green-tinted accent shadows on Android; see **AR-T21** + [glass-and-depth.md](glass-and-depth.md))
- `elevation` only works on Views with `backgroundColor` set (not transparent)
- Web ignores both — use CSS `boxShadow` directly with a third Platform branch

## 5. `position: 'fixed'` does not exist — **AR-T23**

**Symptom:** the fixed-header pattern from Stitch's HTML produces an error or just doesn't stick.

**Fix:** `position: 'absolute'` inside the root container of the screen. Combine with `zIndex: 50` and `top: 0; left: 0; right: 0` for full-width:

```tsx
<View style={styles.wrap}>  {/* { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 50 } */}
  <BlurView intensity={48} style={StyleSheet.absoluteFill} />
  <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(249,249,254,0.92)' }]} />
  <View style={styles.row}>{/* title + buttons */}</View>
</View>
```

## 6. Pressables under a floating tab bar need `pointerEvents="box-none"` on wrappers

**Symptom:** the area behind the tab bar can't be tapped — the wrapper steals the gestures.

**Fix:** any absolutely-positioned overlay (top bar, tab bar) should have `pointerEvents="box-none"` on its outermost wrapper so taps fall through to underlying scroll content where the bar's children don't cover. The Pressable buttons themselves still receive their own taps. (See the floating tab-bar recipe in [glass-and-depth.md](glass-and-depth.md).)

## 7. `SafeAreaView` defaults are unreliable — **AR-T27 / AR-T28**

**Symptom:** content overlaps the status bar on iOS 16+ or doesn't clear the home indicator.

**Fix:** always pass the `edges` prop explicitly:

```tsx
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

// In a screen with a fixed translucent top bar, you don't want SafeAreaView
// to add top inset (the top bar handles it). Only opt into bottom:
<SafeAreaView edges={['bottom']}>...</SafeAreaView>

// For the bar itself, use the hook directly:
const { top } = useSafeAreaInsets();
<View style={{ paddingTop: Math.max(top, 12) }}>...</View>
```

Never use `react-native`'s built-in `SafeAreaView` (deprecated for new code); always import from `react-native-safe-area-context`.

## 8. `numberOfLines` + `ellipsizeMode` are required for user content — **AR-T19**

**Symptom:** a long meal title pushes the card height to 200 px and breaks the grid.

**Fix:** any `Text` rendering a string of unknown length:

```tsx
<Text numberOfLines={2} ellipsizeMode="tail">{item.title}</Text>
```

For numeric displays (timer values, progress %), use `adjustsFontSizeToFit` + `minimumFontScale` instead — truncation is wrong there:

```tsx
<Text adjustsFontSizeToFit numberOfLines={1} minimumFontScale={0.85}>{elapsed}</Text>
```

## 9. Modal `transparent` must be true for sheet-style modals

**Symptom:** your slide-up sheet has a solid white background that fills the screen.

**Fix:** `<Modal transparent visible={...} animationType="slide">` and then render your sheet as a positioned child:

```tsx
<Modal transparent visible={open} animationType="slide" onRequestClose={onClose}>
  <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}>
    <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
    <View style={{ backgroundColor: 'white', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22 }}>
      {/* sheet content */}
    </View>
  </View>
</Modal>
```

The dismissing Pressable is a **sibling** filling the backdrop, not the parent of the sheet content. Wrapping the sheet in a Pressable steals scroll gestures on Android.

## 10. Conic gradients (for progress rings) need `react-native-svg` — **AR-T24**

**Symptom:** Stitch shows a circular progress ring with a conic gradient. You can't build that with `LinearGradient` alone.

**Fix:** use `react-native-svg`'s `Circle` with `strokeDasharray` + `strokeDashoffset` for the ring, plus an SVG `LinearGradient` for the stroke color. The pattern:

```tsx
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Stop } from 'react-native-svg';

<Svg width={size} height={size}>
  <Defs>
    <SvgGradient id="ring" x1="0" y1="0" x2="1" y2="1">
      <Stop offset="0" stopColor={gradientStart} />
      <Stop offset="1" stopColor={gradientEnd} />
    </SvgGradient>
  </Defs>
  <Circle cx={size/2} cy={size/2} r={radius} stroke={trackColor} strokeWidth={stroke} fill="none" />
  <Circle cx={size/2} cy={size/2} r={radius} stroke="url(#ring)" strokeWidth={stroke}
          fill="none" strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
          transform={`rotate(-90 ${size/2} ${size/2})`} />
</Svg>
```

True conic (sweeping color) isn't natively supported — the linear gradient applied to a stroked circle is the standard workaround and looks fine at typical sizes.

## 11. Font loading: every screen sees a flash if you don't gate

**Symptom:** custom fonts (Hanken Grotesk, Inter) only show up after a beat — your design looks wrong for the first half-second.

**Fix:** load fonts in `app/_layout.tsx` with `useFonts` from `@expo-google-fonts/<family>`, and gate the root return until `loaded === true`:

```tsx
const [loaded] = useFonts({ HankenGrotesk_700Bold, Inter_400Regular /* ... */ });
if (!loaded) return null;  // or a splash component
```

Otherwise `SplashScreen.preventAutoHideAsync()` + `SplashScreen.hideAsync()` from `expo-splash-screen` to keep the native splash visible during font load.

## 12. Layout direction: don't mix `flexDirection: 'row'` with `width: '100%'` on children — **AR-T13**

**Symptom:** a row with three equal-width cards overflows or has one card much wider than the others.

**Fix:** use `flex: 1` on children of a row, with `gap` on the parent. Avoid percentage widths for sibling layout — they don't account for the `gap`:

```tsx
<View style={{ flexDirection: 'row', gap: 12 }}>
  <View style={{ flex: 1 }}>{/* card */}</View>
  <View style={{ flex: 1 }}>{/* card */}</View>
  <View style={{ flex: 1 }}>{/* card */}</View>
</View>
```

For 2-column bento grids with wrap, use `flexWrap: 'wrap'` + `minWidth: '47%'` (or a calculated value) — this is what the Fasting Tracker `bentoGrid` uses.

## 13. Image sources from remote HTTPS work, but...

**Symptom:** images stay invisible / never load.

**Fix:**
- iOS: HTTPS only in production (no plain HTTP unless you add ATS exceptions to `Info.plist`)
- Android: HTTPS only in production after API 28+ unless you add `usesCleartextTraffic` to manifest
- Remote images need an explicit `width` and `height` (or both `flex: 1` and a parent with bounds) — RN can't compute intrinsic size like web
- Set `resizeMode="cover"` on the `Image` and verify it's filling its container before debugging the URL
- Cross-platform Image caching: use `expo-image`'s `Image` instead of RN's built-in for better caching + transition support

## 14. Keyboard avoidance

**Symptom:** when the user taps an input, the keyboard covers it.

**Fix:** wrap the screen (or just the input section) in `KeyboardAvoidingView` with `behavior={Platform.OS === 'ios' ? 'padding' : undefined}` — on Android leave `behavior` undefined and let `android:windowSoftInputMode="adjustResize"` (the Expo default) do the work; `'height'` on Android causes a known bottom-gap / double-compensation glitch. For multi-input forms, `KeyboardAwareScrollView` from `react-native-keyboard-controller` is the more robust modern alternative. Test on a small phone where the input might sit in the lower half of the screen.

## 15. Don't trust dev-mode rendering for blur / shadows / fonts

**Symptom:** "It looked fine in `expo start`!"

**Fix:** every time you change a blur intensity, a shadow opacity, a font weight, or a gradient → build a release APK / TestFlight build and verify. Dev-mode rendering (especially on Android) diverges from release in:
- BlurView intensity (release renders the real native blur; dev is sometimes a flat color)
- Shadow rendering (release uses `elevation` correctly; dev sometimes drops it)
- Font fallbacks (release fails harder if a font isn't bundled)
- Image loading (release respects ATS / cleartext rules)

For the Fasting Tracker pattern, the dev-server check is "does the layout work?" — the APK check is "does it actually look right?"
