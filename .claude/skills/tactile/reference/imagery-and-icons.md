# Imagery & Icons

App iconography and imagery — choosing one icon system and holding its weight, shipping a real app icon and splash, loading images the RN-native way with `expo-image`, and avoiding the generic-stock / uncanny-AI tells that read as instant slop.

Cross-link: [glass-and-depth.md](glass-and-depth.md) for the restraint rules on decorative imagery (gradient orbs, mesh, blur) — this page is about *content* imagery and *icons*; that page is about *decoration*.

---

## Pick ONE icon system and hold it

Icons carry more of a mobile UI's character than any other element because they repeat everywhere. The rule: **choose one system and hold a consistent optical weight and fill state.** Mixing a filled icon next to an outline icon in the same row is the SK-126 "common mistakes" #7 tell — it reads as someone grabbing icons from three packs.

Choose one of:

- **SF Symbols** (iOS-leaning) — via `expo-symbols` (`SymbolView`) on iOS; the system face for an iOS-native feel. Pair with a Material fallback on Android, or render the same glyph set cross-platform.
- **Material Symbols** (Android-leaning or unified) — three axes (weight, fill, grade) you must pin consistently.
- **A single custom set** — Phosphor, Lucide-native, or one icon family via `@expo/vector-icons`. One family, one weight.

**Hold the fill state.** If your tab bar uses filled icons for the active tab and outline for inactive, that's a *deliberate selected-state system* — fine. What's not fine is one filled and one outline icon sitting side by side at the same hierarchy level. Decide filled-vs-outline per *role* (active vs inactive), never at random. This is the visual-judgment companion to the SKILL's "Mix icon optical weights → DON'T" rule.

```tsx
// One family, weight held. Active/inactive is a deliberate fill system, not a mix.
import { House, HouseSimple } from 'phosphor-react-native';
const TabIcon = ({ active }: { active: boolean }) =>
  active ? <House weight="fill" size={26} color={t.primary} />
         : <HouseSimple weight="regular" size={26} color={t.onSurfaceVariant} />;
```

Sizing on the 4pt grid (20 / 24 / 28). Icon-only buttons still need a ≥44pt touch zone ([AR-T01](audit-rules.md#a--touch--interaction)) and `accessibilityRole` + `accessibilityLabel` ([AR-T04](audit-rules.md#a--touch--interaction)) — an icon is not a label.

## App icon & splash — specs and where they live

A shipped app ships a real icon and splash. A default Expo icon at audit is a build failure. Config lives in **app.json / app.config.js**:

```jsonc
{
  "expo": {
    "icon": "./assets/icon.png",                 // 1024×1024, no alpha, no rounding (the OS masks it)
    "ios": { "icon": "./assets/icon.png" },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-foreground.png",  // 1024×1024, art safe inside center 66%
        "backgroundColor": "#1a1c1f"                            // or backgroundImage
      }
    }
  },
  "plugins": [
    ["expo-splash-screen", {
      "image": "./assets/splash-icon.png",        // centered logo, generous transparent padding
      "imageWidth": 200,
      "resizeMode": "contain",
      "backgroundColor": "#1a1c1f"                 // matches the first frame of your app, not white
    }]
  ]
}
```

Notes that bite:

- **iOS icon**: 1024×1024, **no alpha channel**, square — the OS applies the squircle mask. A pre-rounded icon shows a double corner.
- **Android adaptive icon**: foreground + background as separate layers; keep critical art inside the **center ~66% safe zone** because launchers mask to circle / squircle / teardrop and the edges get clipped. Don't put the logo edge-to-edge.
- **Splash via `expo-splash-screen`** (config plugin): the `backgroundColor` should match your app's first real frame so there's no flash-of-white on launch. Hold it programmatically with `SplashScreen.preventAutoHideAsync()` until fonts + first data resolve (see [state-patterns.md](state-patterns.md)), then `hideAsync()`.

## `expo-image` over RN `Image`

Use **`expo-image`** for all content imagery, not React Native's built-in `Image`. It gives disk+memory caching, smooth crossfade transitions, and `blurhash`/`thumbhash` placeholders out of the box (PITFALLS #13 — the built-in lacks all of these).

```tsx
import { Image } from 'expo-image';

<Image
  source={{ uri: item.photoUrl }}
  style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: t.radius.card }}
  contentFit="cover"                              // not resizeMode — expo-image uses contentFit
  placeholder={{ blurhash: item.blurhash }}       // instant, no layout shift
  transition={200}                                // crossfade in, no pop
  cachePolicy="memory-disk"
/>
```

**Remote-image rules that silently fail (PITFALLS #13):**

- **HTTPS only in production.** iOS ATS blocks plain HTTP; Android blocks cleartext on API 28+. If you genuinely need HTTP, add explicit ATS exceptions / `usesCleartextTraffic` — but default to HTTPS and confirm in a **release** build (dev tolerates more — see [platform-verification.md](platform-verification.md)).
- **Explicit dimensions are mandatory.** RN can't compute intrinsic size like web. Give every remote image a concrete `width`/`height` or an `aspectRatio` + bounded parent, or it collapses to zero and "never loads" when the URL is fine.
- A failed image gets a **placeholder**, never a broken frame — wire the empty/error visual from [state-patterns.md](state-patterns.md).

## Illustration vs photo

Decide per surface, and commit:

- **Illustration** — onboarding, empty states, abstract/data-led apps. It's lighter (vector / small PNG), themeable (recolor to your tokens, so it survives dark mode), and avoids the literalness of a photo. A small consistent illustration set is the cleanest way to give empty states personality.
- **Photo** — content apps where the image *is* the content (food, travel, social, commerce). Then the photo carries the color and the UI chrome should recede (let the image lead; keep surfaces near-neutral).

Don't mix illustration styles. Two different illustration vocabularies on one app reads as slop just like mixed icon weights.

## Avoid the slop tells: stock clichés and uncanny AI imagery

The instant "an AI made this" image tells, to refuse:

- **Generic stock clichés** — the diverse-team-laughing-at-a-laptop, the lone-figure-on-a-mountain-at-sunrise, the abstract-blue-tech-swoosh. They signal "we had no real content."
- **Uncanny AI imagery** — too-smooth skin, melted hands, garbled background text, that over-rendered hyperreal sheen, impossible lighting. These are detected instantly and torch credibility.
- **The purple→blue gradient hero** as a stand-in for a real image (this overlaps the [AR-T08](audit-rules.md#b--color--tokens) AI-app-palette tell).

Prefer: real product/content imagery, a custom illustration set in the brand voice, or a deliberate typographic/blank treatment over a fake stock-y image. Empty-but-honest beats generic-but-filled.

## Image performance

- **Size to the slot.** Don't load a 4000px image into a 120px thumbnail — request a sized URL or downscale. Oversized images are the most common mobile memory/scroll-jank cause.
- **`contentFit`** (`cover` / `contain` / `fill`) deliberately — `cover` for hero/thumbnails, `contain` for logos/illustrations that must not crop.
- **`placeholder` + `blurhash`/`thumbhash`** to reserve layout and eliminate the load-pop — a tiny hash string that renders instantly while the real image streams in.
- **`cachePolicy="memory-disk"`** for anything that repeats (avatars, list thumbnails) so scrolling back doesn't re-fetch.
- In long lists, pair sized `expo-image` thumbnails with FlashList (see the **react-native** skill) — the image strategy and the list strategy together are what keep a feed at 60fps.

---

**Imagery & icons checklist:** one icon family, weight + fill held (no filled-next-to-outline) · real app icon (no alpha, Android safe-zone respected) · `expo-splash-screen` background matches first frame · `expo-image` with explicit dimensions, HTTPS, `contentFit`, blurhash placeholder · no stock clichés, no uncanny AI imagery · images sized to their slot.
