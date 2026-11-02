# Mobile Color & Tokens

The mobile color system — semantic tokens over raw hex, the MD3 role model, status containers, perceptual neutral-tinting, and the contrast floor. SKILL.md states the always-apply rules inline; this is the deeper material those pointers reference.

## Semantic tokens, never raw hex

`palette.primary` always; `#34c759` never (`AR-T05`). The moment a screen file holds an inline color, dark mode is dead and the design system drifts — that color won't flip with the theme, and the next screen will pick a slightly different green.

The rule: **the only files that contain hex are the token definition files** (`theme/`, `palette/`, `tokens/`, `colors/`). Everything downstream references tokens. If you need a color you don't have, the bug is the missing token — add it, don't inline it. `AR-T05` greps for `#rgb`/`#rrggbb`/`#rrggbbaa` (and native `0xFF…` / `Color(red:)` literals) *outside* those definition files; CHECKLIST.md item 8 is the review version.

## The MD3 role system as the mental model

Use Material Design 3's role system as your mental model even on an iOS-leaning glass app. It is the cleanest way to keep light and dark coherent: every surface has a role, every role has an `on*` counterpart guaranteed to sit legibly on it.

Core roles you actually use:
- `primary` / `onPrimary` — the brand color and what reads on top of it (a filled button + its label).
- `primaryContainer` / `onPrimaryContainer` — a *softer* tonal fill of the brand, for selected chips, highlighted cards, tinted backgrounds. `onPrimaryContainer` is the text that sits on it.
- `surface` / `onSurface` — the page/card background and its primary ink.
- `surfaceVariant` / `onSurfaceVariant` — a subtly differentiated surface (a nested row, an input) and its secondary ink.
- `outline` — borders and dividers; `outlineVariant` for the faintest hairlines.

A concrete light + dark token object:

```tsx
// theme/palette.ts  — the ONLY place hex literals are allowed
const light = {
  primary:            '#2f6b4f',
  onPrimary:          '#ffffff',
  primaryContainer:   '#b8e6cb',
  onPrimaryContainer: '#06210f',

  surface:            '#f9faf7',   // near-white, tinted green — not #fff
  onSurface:          '#1a1c1a',   // near-black, tinted green — not #000
  surfaceVariant:     '#e2e8e1',
  onSurfaceVariant:   '#414941',
  outline:            '#717971',

  errorContainer:     '#ffdad6',
  onErrorContainer:   '#410002',
  successContainer:   '#b8e6cb',
  onSuccessContainer: '#06210f',
} as const;

const dark: typeof light = {
  primary:            '#9dd3b0',
  onPrimary:          '#06210f',
  primaryContainer:   '#15512f',
  onPrimaryContainer: '#b8e6cb',

  surface:            '#11140f',   // near-black, tinted — not #000
  onSurface:          '#e2e3de',
  surfaceVariant:     '#414941',
  onSurfaceVariant:   '#c1c9c0',
  outline:            '#8b938a',

  errorContainer:     '#93000a',
  onErrorContainer:   '#ffdad6',
  successContainer:   '#15512f',
  onSuccessContainer: '#b8e6cb',
};

export const palette = { light, dark };
export type Palette = typeof light;
```

Screen code touches `c.primary`, `c.onSurfaceVariant`, never the hex. Dark mode is then a one-line swap of which object `c` points at.

## `outline` is load-bearing; `outlineVariant` is decorative — measured, not assumed

Two independently-authored MD3 palettes, measured with `scripts/check-contrast.mjs` on 2026-08-13 — this skill's own `starter-tokens.ts` and a shipped app's hand-tuned theme — agree to within 0.3:1 on both roles, in both registers:

| Token vs `surface` | starter-tokens (light / dark) | shipped app (light / dark) |
|---|---|---|
| `outline` | 4.24 / 4.57 | 4.26 / 3.82 |
| `outlineVariant` | 1.52 / 1.80 | 1.62 / 1.82 |

`outline` clears the 3:1 non-text floor everywhere. `outlineVariant` misses it everywhere, by a wide margin, in palettes that share no author. That is not two mistakes — it is what the role is *for*.

**So: any boundary a user must perceive — a focused field, a selected card, a control edge, a divider that carries meaning — takes `outline`. `outlineVariant` is for separation you would not miss if it vanished.** Reaching for the variant to "soften" a real boundary produces a hairline nobody can see, and the gate will report it (advisory, since WCAG 1.4.11 covers only information *required* to identify a component — a decorative separator is out of scope).

## Status colors via the container pair

Never paint a status using the *raw* role as a fill. A chip background in raw `error` red is loud, fails contrast against its own text, and reads as an alarm where you meant an annotation. Use the **`*Container` background + `on*Container` text** pair (`AR-T07`, CHECKLIST.md item 9):

```tsx
// WRONG — raw status color as a fill
<View style={{ backgroundColor: c.error }}><Text style={{ color: c.onSurface }}>Sync failed</Text></View>

// RIGHT — soft container fill + matched on-container ink
<View style={{ backgroundColor: c.errorContainer, ... }}>
  <Text style={{ color: c.onErrorContainer }}>Sync failed</Text>
</View>
```

The container is a desaturated tonal version (soft pink for error, soft green for success); the `on*` is a dark, legible ink of the same hue. The pair guarantees contrast in both themes — that's the entire point of the role system. `AR-T07` greps for `backgroundColor: error|danger|warning|success` (without the `Container` suffix).

## OKLCH / perceptual neutral-tinting

Pure neutrals look sterile and disconnected from the brand. Tint every neutral *subtly* toward the brand hue so the whole surface system feels of-a-piece — a green app's "gray" carries a whisper of green. (See the `surface`/`onSurface`/`outline` values above — all nudged green, never literal gray.)

Reason in **OKLCH**, not HSL — OKLCH is perceptually uniform, so equal lightness steps look equally spaced and a chroma value means the same thing across hues. The discipline:

- **Pick the brand hue once** (e.g. `H ≈ 150` for green). Every neutral borrows a sliver of that hue.
- **Reduce chroma as you approach the extremes.** Near white (`L > 0.92`) and near black (`L < 0.15`), drop chroma toward ~`0.01–0.02`. A neutral that stays as saturated near white as it is mid-range looks tinted-by-accident, not designed. The tint should be *felt*, not *seen*.
- **Hold hue constant across the ramp.** Shifting hue between light steps is what makes a palette feel muddy.

You don't ship OKLCH at runtime — RN style takes hex/rgb. Use an OKLCH picker (or a tool like the Material Theme Builder seeded with your brand color) to *generate* the ramp, then bake the resulting hex into the token file once.

**The emittable form of all of this** is `skills/tactile/starter-tokens.ts` — a ready-to-copy `theme/tokens.ts` carrying the full MD3 light+dark role palette (plus spacing/type/radius/elevation/motion/touch tiers). It is generated by `skills/tactile/scripts/generate-tokens.mjs`, which does exactly the OKLCH→sRGB bake described above from **one** brand hue, gamut-maps each colour, and **proves every mounted pair clears WCAG AA** before emitting (the mobile analog of impeccable's web token computation). Retint = change `BRAND_H`, re-run to confirm AA, re-emit. Don't hand-tune the baked hex — the generator is the source of truth and the contrast proof. `/new-mobile-app` Step 1a copies it into greenfield apps.

## No pure black or white

`#000` on `#fff` is too high-contrast — it vibrates, reads harsh, and looks cheap (`AR-T06`, CHECKLIST.md). Use a tinted near-black on a tinted near-white: `#1a1c1a` on `#f9faf7` for a green app, shifted per brand hue. This is both the calmer look *and* the neutral-tinting rule applied to the two most-used colors on every screen. `AR-T06` greps `#000`/`#fff`/`'black'`/`'white'` used as surface or ink.

## No gray text on colored backgrounds

Refactoring UI axiom, and `AR-T09`: never drop achromatic gray text onto a chromatic background — it looks dirty and washed out. Instead, **derive the text color from the background's own hue**: a darker, less-saturated shade of the same color, or a transparency of the on-color against that surface.

```tsx
// WRONG — gray on the brand-tinted container
<Text style={{ color: '#888' }}>...</Text>   // (also AR-T05: raw hex)

// RIGHT — a darker tone of the surface's own hue, as a token
<Text style={{ color: c.onPrimaryContainer }}>...</Text>
```

`AR-T09` needs a visual confirm that the background is genuinely chromatic before flagging — a gray on a neutral surface is fine.

## No AI-app palette

There is a recognizable 2024–2025 AI default palette, and it's an instant tell (`AR-T08`, advisory). Refuse it on sight:

- **The purple→blue hero gradient.** Every AI demo's hero card. If your brand isn't *literally* purple-to-blue, this is borrowed plumage.
- **Cyan-on-near-black.** The "futuristic dashboard" reflex — neon cyan text on `#0a0a0a`.
- **Neon accents on a flat dark background.** Saturated lime/magenta/cyan glowing on near-black reads as a template, not a brand.

The fix is a *deliberate* palette derived from the brand's three words (the same words that drive the font procedure in SKILL.md), seeded from one real brand hue and expanded into the role system above — not a gradient you reached for because it looked "techy."

## Light vs dark, derived from context of use

Theme is **derived from audience and context**, not picked from a default. Ask: when is this opened, by whom, in what light?

- Meditation/sleep app, used in bed → **dark**.
- Fasting tracker, glanced at on a sunny walk → **light**.
- Trading app, fast focused sessions → **dark**.
- Kids' chore app → **light**.

Defaulting everything to dark "to look cool" or light "to be safe" is the lazy reflex either way. If the audience spans contexts (used both in bright sun and in bed), **support both** — which is exactly why you derive a full light *and* dark token set from the start, not light-only with dark bolted on later. The MD3 dark theme is not "invert the light theme": surfaces get lighter as they get more elevated, `primary` gets *lighter* (not darker), and container/on-container roles swap lightness. The token object above shows the swap.

## The contrast floor

Verify every text/background pair:
- **Body text: ≥ 4.5:1.**
- **Large text (≥ 18pt, or ≥ 14pt bold): ≥ 3:1.**

This is WCAG AA and CHECKLIST.md item 10. How to verify:
- Check each token *pair* you actually mount: `onSurface` on `surface`, `onSurfaceVariant` on `surfaceVariant`, `onPrimary` on `primary`, every `on*Container` on its `*Container` — **in both themes**. The role system makes this tractable: there's a finite set of legal pairs.
- Use the WebAIM contrast checker, the Material Theme Builder (reports tonal contrast), or VS Code's color hover. Dark mode is where pairs silently fail — `onSurfaceVariant` on `surfaceVariant` is the usual culprit.
- The lowest-contrast text you can ship is a *label* on a *variant* surface — check that pair first; if it passes, the rest usually do.

## See also

- [mobile-typography.md](mobile-typography.md) — weight + color is the hierarchy engine; color is half of it (`AR-T14`–`AR-T19`).
- [mobile-spacing.md](mobile-spacing.md) — tokens for space mirror tokens for color (`AR-T10`–`AR-T13`).
- **mobile-app-design (SK-126)** `CHECKLIST.md` items 8–10 (color) — the review-time version of `AR-T05`–`AR-T09`.
