# Glass & Depth

The iOS-modern glass + depth playbook and its restraint rules: how to build real glass in React Native, the squircle radius system, faked mesh backgrounds, accent-tinted shadows — and, just as important, when NOT to reach for any of it.

Pairs with [rn-translation-traps.md](rn-translation-traps.md) — every effect here is a web idiom that breaks if you port it literally; that file is the translation layer. The deterministic checks live in [audit-rules.md](audit-rules.md): **AR-T25** (incomplete-glass-card), **AR-T21** (untinted-flat-shadow), **AR-T26** (platform-asymmetric-blur-missing), plus the BLOCK rules **AR-T22/T23/T24** that this file's snippets are built to satisfy.

---

## When NOT to glass (read this first)

Glass is a finishing material, not a base coat. It is expensive (every `BlurView` is a live native effect compositing everything behind it) and **decorative blur reads as slop** — a screen where every card is frosted is the single most common "fake iOS" tell.

Reserve glass for exactly three jobs:

1. **App bars / top chrome** — a translucent header that lets content scroll under it.
2. **Tab bars** — a floating pill that hovers over the content.
3. **Genuine overlays** — sheets, popovers, and context menus that sit above the screen.

**The default surface is opaque.** A content card is a solid tinted fill with a soft shadow — not glass. If you cannot point at the layer that shows *through* the blur, there is nothing to blur, and the glass is pure costume. When in doubt: opaque card, soft ambient shadow, done.

If you do use glass, it is all-or-nothing on the three layers below. A `BlurView` with only one of its layers is **AR-T25** and renders as a flat translucent gray panel — worse than an honest opaque card.

---

## The glass card — 3-layer recipe

A real glass card is **three stacked layers** under the content, in this order (back to front):

1. **BlurView (back)** — the native blur, `expo-blur`, filling the card via `StyleSheet.absoluteFill`. This is the only layer that actually frosts what's behind.
2. **Tinted fill** — a 60–74% opacity near-white (or near-black in dark mode) over the blur. Pure blur alone has no body; the fill gives the glass its milkiness and keeps text legible.
3. **0.5px inner-glow border** — a hairline white border at ~40% opacity on the card's own `borderWidth`/`borderColor`. This is the "inner glow" edge that defines the card against a light surface.

…wrapped by a **soft ambient shadow** on the card container itself (numbers below).

```tsx
import { BlurView } from 'expo-blur';
import { Platform, StyleSheet, View } from 'react-native';

function GlassCard({ children, isDark }: { children: React.ReactNode; isDark: boolean }) {
  return (
    <View style={[styles.card, styles.ambientShadow]}>
      {/* layer 1 — native blur (back). Android: real blur is OFF by default — opt in with
          blurMethod (SDK 55+) / experimentalBlurMethod (SDK 54). Without it Android renders a
          flat gray panel = AR-T25. */}
      <BlurView
        intensity={Platform.select({ ios: 28, android: 18, web: 0 })}
        tint={isDark ? 'dark' : 'light'}
        blurMethod="dimezisBlurView"
        style={StyleSheet.absoluteFill}
      />
      {/* layer 2 — tinted fill */}
      <View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: isDark ? 'rgba(20,22,26,0.55)' : 'rgba(255,255,255,0.65)' },
        ]}
      />
      {/* layer 3 — 0.5px inner-glow border lives on the card container's border */}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 22,                 // squircle — see radius system below
    overflow: 'hidden',               // clips the BlurView to the rounded corners
    padding: 20,                      // never below 12 for a glass card
    borderWidth: 0.5,                 // the inner-glow hairline
    borderColor: 'rgba(255,255,255,0.40)',
  },
  ambientShadow: {
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 22, shadowOffset: { width: 0, height: 10 } },
      android: { elevation: 4 },
    }),
  },
});
```

Order matters: **blur first (back), then tinted fill, then content.** `overflow: 'hidden'` on the container is mandatory — without it the `BlurView` bleeds past the rounded corners. On iOS `expo-blur` makes the real native call (`UIVisualEffectView`). **On Android the blur is OFF by default** — it renders only when you opt in via the `blurMethod` prop (named `experimentalBlurMethod` before SDK 55, default `'none'`), which uses the Dimezis BlurView library (RenderNode on Android 12+/SDK 31, RenderScript below) — *not* a built-in Android `RenderEffect`. Skip the opt-in and Android shows a flat translucent panel no matter the `intensity` (= the AR-T25 failure). There is no `backdrop-filter` in RN (see [rn-translation-traps.md](rn-translation-traps.md) §1, **AR-T22**).

---

## Platform-asymmetric blur intensity

`BlurView` intensity is **not portable across platforms**. The same number that looks like crisp frosted glass on iOS reads as a flat gray fade on Android. Below ~16 on Android, the blur reads as a translucent gray panel — not blur at all. Always wrap the intensity in `Platform.select`; a bare numeric `intensity` literal is **AR-T26**.

```tsx
// cards
intensity={Platform.select({ ios: 28, android: 18, web: 0 })}
// app bars / headers (heavier, the chrome should clearly separate from content)
intensity={Platform.select({ ios: 50, android: 48, web: 0 })}
// floating tab bar uses ios: 60 / android: 32 — see the table below
```

| Surface          | iOS | Android | web |
|------------------|-----|---------|-----|
| Glass card       | 28  | 18      | 0   |
| App bar / header | 50  | 48      | 0   |
| Floating tab bar | 60  | 32      | 0   |

`web: 0` because `BlurView` is a no-op on web — branch with `Platform.OS === 'web'` and apply CSS `backdrop-filter` there instead. The exact numbers are starting points; confirm them on a **release build**, not `expo start` — dev-mode Android often renders blur as a flat color (see [rn-translation-traps.md](rn-translation-traps.md) §15).

**Android opt-in (critical):** these Android intensities only matter once Android blur is actually enabled. `blurMethod` (a.k.a. `experimentalBlurMethod` before SDK 55) defaults to `'none'` — set it to `'dimezisBlurView'` on the `BlurView` or Android renders no blur regardless of `intensity`. On SDK 55 the Dimezis path also requires wrapping the blurred content in a `BlurTargetView` and passing its ref via `blurTarget`, and it does **not** blur across a React Native `Modal` boundary. Because the exact prop name and setup are SDK-version-specific, check the current [expo-blur docs](https://docs.expo.dev/versions/latest/sdk/blur-view/) for your SDK before shipping Android glass.

---

## Squircle radius system

iOS-modern depth lives on the squircle. Pick the radius from the role, not by eye — and keep it on the 4pt grid:

| Element                       | Radius   |
|-------------------------------|----------|
| Inputs / small chips          | 12       |
| Standard cards                | 18–22    |
| Large feature cards           | 26–32    |
| Pills / buttons               | 999      |
| Decorative blobs              | full circle (`borderRadius: size / 2`) |

A feature card at 12 looks like a web `<div>`; an input at 28 looks like a balloon. Match the radius to the element's weight.

---

## Floating glass tab bar

The tab bar is a glass pill hovering above the content, not a full-width opaque strip welded to the bottom. Same three-layer recipe as the card, but heavier blur, an accent-tinted active pill, and it must clear the home indicator.

```tsx
import { BlurView } from 'expo-blur';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function FloatingTabBar({ tabs, activeKey, onSelect, isDark }: TabBarProps) {
  const { bottom } = useSafeAreaInsets();
  return (
    <View
      pointerEvents="box-none"                     // taps fall through to content — see traps §6
      style={[styles.wrap, { bottom: Math.max(bottom, 10) + 6 }]}
    >
      <View style={[styles.bar, styles.barShadow]}>
        {/* blurMethod = Android opt-in (default 'none'); SDK 54: experimentalBlurMethod */}
        <BlurView
          intensity={Platform.select({ ios: 60, android: 32, web: 0 })}
          tint={isDark ? 'dark' : 'light'}
          blurMethod="dimezisBlurView"
          style={StyleSheet.absoluteFill}
        />
        <View
          style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? 'rgba(20,22,26,0.55)' : 'rgba(255,255,255,0.62)' }]}
        />
        {tabs.map((t) => {
          const active = t.key === activeKey;
          return (
            <Pressable
              key={t.key}
              onPress={() => onSelect(t.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={t.label}
              style={[styles.item, active && styles.itemActive]}
            >
              {t.icon}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: '5%', right: '5%' }, // ~90% screen-width pill
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    height: 64,
    borderRadius: 999,                  // full pill
    overflow: 'hidden',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.40)',
  },
  barShadow: {
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.10, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
      android: { elevation: 8 },
    }),
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', height: '100%' },
  itemActive: {
    // active pill: ~20% accent background + an accent-tinted shadow (iOS only)
    backgroundColor: 'rgba(114,254,136,0.20)',  // tokenize this — raw rgba shown for clarity
    borderRadius: 999,
    ...Platform.select({
      ios: { shadowColor: '#34c759', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
      android: {}, // Android elevation can't be tinted — see accent-tinted shadows below
    }),
  },
});
```

Key points: the outer wrapper is `position: 'absolute'` (not `fixed` — [traps §5](rn-translation-traps.md), **AR-T23**) with `pointerEvents="box-none"` so the area *around* the buttons stays tappable for scroll content below ([traps §6](rn-translation-traps.md)). It sits 6–14dp above the home indicator using `useSafeAreaInsets().bottom`. The active pill carries a 20% accent fill and a tinted lift on iOS only.

The same `position: 'absolute'` + blur + tinted-fill pattern is how you build the translucent **app bar** that content scrolls under — pin it to `top: 0, left: 0, right: 0` with `zIndex: 50` and let `useSafeAreaInsets().top` drive its `paddingTop` (see [traps §5 and §7](rn-translation-traps.md)).

---

## Gradient-orb mesh background

RN has **no `radial-gradient`** (writing one is **AR-T24**). The mesh background you got from a Figma/Stitch export is faked with a `LinearGradient` base plus 2–3 oversized, very-low-opacity circle `View`s shoved off-frame in the corners.

```tsx
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

function MeshBackground({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flex: 1, overflow: 'hidden' }}>
      <LinearGradient colors={['#f9f9fe', '#ededf2']} style={StyleSheet.absoluteFill} />
      <View style={{ position: 'absolute', width: 360, height: 360, borderRadius: 180,
                     backgroundColor: '#72fe88', opacity: 0.22, top: -140, left: -130 }} />
      <View style={{ position: 'absolute', width: 300, height: 300, borderRadius: 150,
                     backgroundColor: '#d8e2ff', opacity: 0.18, bottom: -120, right: -120 }} />
      {children}
    </View>
  );
}
```

Why it works: the blobs are **unblurred** — RN can't blur a View directly — so the illusion rests entirely on **low opacity (16–22%)** and **heavy off-frame negative offsets** that push the hard circular edge out of frame. Oversize the circles (280–360dp), keep them faint, and let one warm corner play against one cool corner. The moment a blob's edge is visible on-screen, the offset is wrong. (In screen code these colors should be tokens, not raw hex — shown literal here for clarity.)

---

## Accent-tinted shadows (iOS only)

Untinted drop shadows on everything is flat and forgettable — and untinted hero-CTA shadows are **AR-T21**. Give the primary action a shadow tinted toward the accent so it reads as *lifting* off the surface in the brand color:

```tsx
// hero CTA — the shadow carries the accent hue (iOS only)
...Platform.select({
  ios: { shadowColor: palette.primary, shadowOpacity: 0.30, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } },
  android: { elevation: 6 },   // Android elevation produces a FIXED black shadow — cannot be tinted
}),
```

**Android's `elevation` cannot be tinted** — it draws a fixed black drop shadow and ignores `shadowColor`. So accent-tinted lift is an iOS-only flourish; on Android the CTA gets a neutral elevation and earns its prominence through size, color, and position instead. Don't fake an Android tint with a colored border — it looks wrong. (Reserve tinting for the *hero* CTA; ambient card shadows stay soft and neutral.)

---

## Soft ambient shadow numbers

The default card shadow is a whisper, not a slab. Use these as the ambient baseline (already in the recipes above):

```tsx
...Platform.select({
  ios: { shadowColor: '#000', shadowOpacity: 0.05–0.07, shadowRadius: 22, shadowOffset: { width: 0, height: 10 } },
  android: { elevation: 4 },
}),
```

- **Offset Y 10, blur (radius) 22, opacity 0.05–0.07, no tint** — the iOS ambient card shadow.
- Always set **both** `shadow*` and `elevation` — a shadow with no `elevation` is flat on Android (**AR-T20**, [traps §4](rn-translation-traps.md)).
- `elevation` only renders on a View with a non-transparent `backgroundColor`.
- Web ignores both — add a CSS `boxShadow` branch with `Platform.OS === 'web'`.

Bigger blur radius + lower opacity = softer, more expensive-looking lift. A small radius with high opacity reads as a hard cheap drop shadow — the opposite of what you want.
