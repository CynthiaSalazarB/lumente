# Mobile Typography

The mobile type system — three tiers, a concrete RN scale, platform display faces, Dynamic Type discipline, and the font-loading gate. SKILL.md states the always-apply rules inline; this is the deeper material those pointers reference.

## The three-tier system: display / body / label

Every screen runs on exactly three roles. Not three *fonts* — three *roles*, each with one size and a deliberate weight.

- **Display** — the hero. A timer, a balance, a screen title, the one number someone remembers. Display-grade face, heavy weight (700–800), tight tracking.
- **Body** — paragraphs, list rows, descriptions. Body-grade face, 400 for UI body, 300 only for genuinely long prose.
- **Label** — eyebrows, captions, tab text, metadata. Uppercase, small, wide-tracked. Reads as a newspaper section label, not a shout.

**Max three sizes per screen.** A fourth size is the single most common typography tell. When you feel the urge to add one, you actually want a different *weight* or a different *color* at an existing size. Hierarchy comes from weight + color, never from a four-rung font ladder (`AR-T16` fails ≥4 distinct `fontSize` values on one screen). This is item 2 of the loaded **mobile-app-design (SK-126)** `CHECKLIST.md` — don't re-derive it, walk that list when reviewing.

DON'T set sizes within 1.25× of each other — that flat ladder reads as "no hierarchy was designed." A real scale jumps: 13 → 17 → 34, not 15 → 16 → 18.

## A concrete RN type scale

Define type as tokens once, never inline. Five named roles, three of which you actually mount per screen.

```tsx
// theme/type.ts
export const type = {
  display:  { fontFamily: 'HankenGrotesk_800ExtraBold', fontSize: 34, lineHeight: 38, letterSpacing: -0.5 },
  headline: { fontFamily: 'HankenGrotesk_700Bold',      fontSize: 24, lineHeight: 28, letterSpacing: -0.3 },
  title:    { fontFamily: 'HankenGrotesk_700Bold',      fontSize: 17, lineHeight: 22, letterSpacing: 0 },
  body:     { fontFamily: 'Inter_400Regular',           fontSize: 16, lineHeight: 24, letterSpacing: 0 },
  bodyLong: { fontFamily: 'Inter_300Light',             fontSize: 16, lineHeight: 26, letterSpacing: 0 },
  label:    { fontFamily: 'Inter_600SemiBold',          fontSize: 12, lineHeight: 16, letterSpacing: 1.4,
              textTransform: 'uppercase' },
} as const;
```

Notes that matter:
- **Negative tracking scales with size.** Big display text wants `-0.3` to `-0.5`; body wants `0`; labels want *positive* (`+1.4`). Tight tracking on a 12px label closes the letters into mud.
- **`lineHeight` is part of the token, not an afterthought.** Body at 16/24 (1.5×) breathes; display at 34/38 (1.12×) sits tight on purpose.
- **Light (300) is for long prose only.** Never a 12px label in Light — it reads washed-out and thin at small sizes. Use 400+ for anything short. (CHECKLIST.md item 6.)

Hierarchy via weight + color on the *same* size:

```tsx
<Text style={[type.body, { color: c.onSurface }]}>Almond milk latte</Text>
<Text style={[type.body, { color: c.onSurfaceVariant, fontFamily: 'Inter_600SemiBold' }]}>$5.40</Text>
```

Same `fontSize: 16`, different weight + color — that's a hierarchy without a fourth size.

## Platform display faces vs custom

Two legitimate paths. Choose deliberately; don't fall into the system face out of habit (`AR-T14`).

**Platform faces (system-honest direction):**
- iOS: **SF Pro Display** (≥20pt optical), **SF Pro Text** (<20pt), and **New York** when you want a serif voice. iOS auto-swaps Display/Text at 20pt — you get the optical sizing for free with `System`.
- Android: **Roboto** and the variable **Roboto Flex** (weight, width, optical-size axes), or **Google Sans** on newer devices.

Using the platform face for *everything* is valid only when system-honest is the chosen aesthetic, paired with strong weight/color hierarchy — not a default you reached for. `AR-T14` flags `SF Pro`/`System` as the app's *only* face when it's a reflex, not a decision.

**Custom faces via `@expo-google-fonts/*`:** the right move for a branded app. Pair a distinctive display face with a refined body face (`AR-T15` fails a single non-system family). Run SKILL.md's `<font_selection_procedure>` before typing any font name — it exists precisely to stop the "rejected Inter, defaulted to Poppins" monoculture. Do not duplicate that procedure here; go run it.

## The uppercase-label spec

Labels are the most-botched tier. The spec:

- **Size:** 11–12px. Below 11 is illegible; above 12 stops reading as a label.
- **Case:** `textTransform: 'uppercase'`. Never uppercase a long passage — caps is for short labels only.
- **Tracking:** `letterSpacing: 1.4` in RN (≈ `0.08em` in CSS). RN uses absolute point units, not em — `1.4` at 12px is the right openness. Do not copy a CSS `0.08em` value literally into RN; it'll be wildly too tight.
- **Weight:** 600. Light/Regular caps reads weak.

```tsx
<Text style={type.label}>Today's intake</Text>   // → TODAY'S INTAKE, 12px, +1.4 tracked
```

CHECKLIST.md item 7 is the review version of this. `AR-T17`'s sub-14px check explicitly *excludes* the 11–12px uppercase label — confirm a flagged small size is body, not a label, before "fixing" it.

## Dynamic Type & `allowFontScaling` discipline

Body text must honor the system font-size setting. Users bump it for a reason (eyesight, context, preference). Locking it out is an accessibility failure.

- **Default: leave `allowFontScaling` alone** (it's `true`). `AR-T18` fails `allowFontScaling={false}` on body content.
- **The one exception — a hero numeric display** where a scaled-up value would visibly break layout (a timer overflowing its ring, a balance wrapping to two lines). Even then, don't hard-lock — gate it so the number *shrinks to fit* instead:

```tsx
// Hero numeric only — never body copy
<Text
  style={type.display}
  numberOfLines={1}
  adjustsFontSizeToFit
  minimumFontScale={0.85}
>
  {elapsed}
</Text>
```

`adjustsFontSizeToFit` + `minimumFontScale={0.85}` shrinks the glyphs to stay on one line down to 85% — the value stays readable and the ring stays intact, while still respecting accessibility for everything else. Reach for this *instead of* `allowFontScaling={false}`, not alongside it. CHECKLIST.md item 22 codifies this hero-numeric exception.

If your layout breaks under Dynamic Type at the largest setting, that's a layout bug, not a reason to disable scaling — fix the container (wrap, scroll, or `adjustsFontSizeToFit`).

## `numberOfLines` / `ellipsizeMode` discipline

Any `Text` rendering a string of *unknown length* (user content, remote data) needs a line cap, or one long meal title pushes a card to 200px and breaks the grid (PITFALLS #8).

```tsx
<Text numberOfLines={2} ellipsizeMode="tail" style={type.body}>
  {item.title}
</Text>
```

- **User content of unknown length → `numberOfLines` + `ellipsizeMode`.** `AR-T19` harvests `Text` missing this (advisory — confirm it's genuinely user content first; a fixed label doesn't need it).
- **Numeric displays → `adjustsFontSizeToFit` instead.** Truncating a timer to `12:…` is wrong; shrink it (see above).
- **`ellipsizeMode`:** `'tail'` is the default and right for titles; `'middle'` for filenames/paths where the end carries meaning (`Report…2026.pdf`).

The split is the rule: **truncate prose, shrink numbers.**

## Font loading: gate the render

Custom fonts arrive a beat late, so the first frame flashes the system fallback and your whole design looks wrong for half a second (PITFALLS #11). Gate the root render on `useFonts` and hold the native splash until fonts resolve.

```tsx
// app/_layout.tsx
import { useFonts, HankenGrotesk_700Bold, HankenGrotesk_800ExtraBold } from '@expo-google-fonts/hanken-grotesk';
import { Inter_300Light, Inter_400Regular, Inter_600SemiBold } from '@expo-google-fonts/inter';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    HankenGrotesk_700Bold, HankenGrotesk_800ExtraBold,
    Inter_300Light, Inter_400Regular, Inter_600SemiBold,
  });

  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync();
  }, [loaded, error]);

  if (!loaded && !error) return null; // native splash stays up — no fallback flash
  return /* ...navigator... */;
}
```

Why both pieces:
- `useFonts(...)` + `if (!loaded) return null` prevents the app tree from mounting before the faces exist.
- `preventAutoHideAsync()` / `hideAsync()` from `expo-splash-screen` keeps the *native* splash on screen during that gap, so the user sees the splash, not a blank frame.
- Gate on `error` too, or a missing/renamed font hangs you on the splash forever. Failing open (render with the fallback) beats a frozen launch.

CHECKLIST.md (typography section) and `AR-T15`/`AR-T14` all assume the fonts actually loaded — a flash means the gate is missing.

## See also

- [mobile-color.md](mobile-color.md) — weight + color is half of hierarchy; the color half lives here (`AR-T05`–`AR-T09`).
- [mobile-spacing.md](mobile-spacing.md) — type tier spacing and visual rhythm (`AR-T10`–`AR-T13`).
- SKILL.md `<font_selection_procedure>` — run before naming any font. Not repeated here on purpose.
- **mobile-app-design (SK-126)** `CHECKLIST.md` items 5–7 (typography) and `RN_PITFALLS.md` #8, #11.
