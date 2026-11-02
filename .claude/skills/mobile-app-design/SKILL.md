---
name: mobile-app-design
description: "Design principles and review playbook for mobile apps (iOS / Android / React Native): Apple HIG, Material Design 3, Refactoring UI axioms, Stitch glassmorphism, and the RN traps that break web-to-mobile translations. Use when designing or reviewing a mobile screen, translating a Figma/Stitch reference to RN, or critiquing a screenshot against best practice."
---

## When to load this skill

- Editing files under `app/`, `screens/`, or `src/screens/` in an Expo or React Native project
- Reviewing a mobile screen against a Figma, Stitch, or designer spec
- Building or auditing a glass / floating / iOS-modern aesthetic
- The user asks "review my mobile UI", "polish this screen", "match the design", or "what's wrong with this screenshot"

## How to use this skill

1. **Quick reference**: read the *Core principles* section below for the 8-rule mental model.
2. **Review a screen**: load `CHECKLIST.md` and walk the 22 items — anything that fails is a fix candidate.
3. **Implementing in React Native**: load `RN_PITFALLS.md` before writing any layered/glass UI — most translation bugs are listed there with their fixes.
4. **Reference / inspiration**: load `REFERENCES.md` for canonical sources (HIG, MD3, Refactoring UI) with one-line "what to look for" notes.

Do not blindly apply every rule. Mobile design is contextual — a finance dashboard breathes differently from a fasting tracker. The rules are defaults; deviate when the screen has a specific reason to.

---

## Core principles (the 8-rule mental model)

### 1. Touch targets ≥ 44 × 44 pt (iOS) / 48 × 48 dp (Android)
Fingers are not cursors. If the visible icon is smaller, expand the touch zone with `hitSlop`. Apply this to every interactive — icons, chips, close buttons, segmented-control items.

### 2. Everything snaps to a 4 / 8 pt grid
Every padding, gap, margin, height, and radius is a multiple of 4 (preferably 8). Random `13px` gaps are a tell that someone eyeballed instead of designing. Use a spacing token scale (`s.gutter`, `s.stackLg`, etc.) — never raw pixel values in screen code.

### 3. Three text sizes per screen, max
Pick a display (timer/headline), a body (paragraph), and a label (eyebrow/caption). Resist adding a fourth. Hierarchy comes from **weight and color**, not from a 4-step font ladder. Refactoring UI: "Don't use grey text on colored backgrounds — change the opacity of the text color instead."

### 4. Semantic tokens, never raw hex
`palette.primary` always, `#34c759` never. The moment a screen has an inline color, dark mode is dead and design systems drift. Status colors (error/warning/info) use the *container* variant for backgrounds and the *on-color* for text — never raw primary.

### 5. Generous breath: 40 pt between sections, 24 pt page gutter
Mobile screens are small but should not feel cramped. Stitch's DESIGN.md prescribes: 24 px container padding, 40 px between distinct vertical sections, 20 px internal padding for glass cards. Compressing these by 30% to "fit more" is the single most common quality killer.

### 6. Native motion: 200–280 ms with ease-out for entries, ease-in for exits
- Sheets / modal entry: 240 ms
- Press feedback: 100–150 ms scale (0.96 is the sweet spot)
- Tab transition: instant (no fade — disorienting on mobile)
- Anything longer than 300 ms reads as laggy

### 7. Safe areas on every edge — `useSafeAreaInsets` is non-optional
Status bar, home indicator, gesture nav, dynamic island, notched corners. `SafeAreaView` alone is unreliable on iOS 15+; pass `edges={['top', 'bottom']}` (or just `bottom` when you have a fixed top bar) explicitly. The `useTopBarOffset` pattern (status-bar + bar-height + breathing gap) belongs in every screen with a translucent header.

### 8. Accessibility from day 1
Every Pressable has `accessibilityRole` and `accessibilityLabel`. Selected state uses `accessibilityState={{ selected: true }}`. Body text scales with system font setting unless there's a specific reason to lock it. Contrast ≥ 4.5:1 on light, ≥ 3:1 on dark. Verify with VoiceOver / TalkBack at least once per major screen.

---

## Modern iOS aesthetic playbook (Stitch / glassmorphism)

When the design direction is "modern iOS / High-Performance Zen / Glass":

### Glass cards
- Background: 60–74% opacity white over a tinted mesh background (e.g. `rgba(255,255,255,0.65)`)
- Backdrop blur: 20 px (CSS) → `BlurView intensity 28` (iOS) / `18` (Android) at the card level, higher (40–60) at app-bar/tab-bar level
- Border: 0.5 px white at 40% opacity — the "inner glow" that defines the edge against light surfaces
- Shadow: very soft ambient — `Y 10, blur 22, opacity 0.05–0.07`, no tint
- Radius: 22–32 px (squircle aesthetic)

### Floating tab bar
- 90% screen width pill, glass fill (same recipe as cards but higher blur — 60 iOS / 32 Android)
- Active pill: 20% accent-color background + tinted shadow (iOS only — Android can't tint shadows)
- Sits 6–14 dp above the home indicator (factor in safe-area bottom inset)

### Gradient orbs (mesh background)
RN has no `radial-gradient`. Fake it with 2–3 oversized circle Views (280–360 dp), heavily off-frame negative offset, very low opacity (16–22%). One green corner + one blue corner is typical. The illusion comes from blur (which RN can't do on Views) so the offset and low opacity carry it.

### Squircle radii (corner system)
- Inputs / small chips: 12
- Standard cards: 18–22
- Large feature cards: 26–32
- Pills / buttons: 999
- Decorative blobs: full circle

### Display typography
- Hanken Grotesk for display + headlines, 700–800 weights, negative letter-spacing (-0.01 to -0.02 em)
- Inter for body + labels, 300 (long-form) / 400 (UI body) / 600 (labels)
- Labels are UPPERCASE, 11–12 px, letter-spacing 0.08 em (1.4–1.8 in RN's letterSpacing units)

---

## Common mistakes (the smell test)

When a mobile screen "feels off" but you can't say why, scan for these:

1. **Sub-16 px body text** → unreadable for users with normal vision in normal lighting
2. **Pure black `#000` on pure white `#fff`** → too high contrast, reads as harsh; use `#1a1c1f` on `#f9f9fe` (Stitch's defaults)
3. **Untinted shadows everywhere** → flat. Use accent-tinted shadows on hero CTAs (iOS only) for "lift"
4. **Buttons that don't press** → no `active:scale-95` or `pressed && opacity 0.88` style — feels broken even though it works
5. **Modal sheets without a grabber** → users don't know they can dismiss; add the 44 × 5 rounded bar
6. **Status messages in raw `error` red** → use `errorContainer` (soft pink) bg + `onErrorContainer` (dark red) text
7. **Icons of mismatched optical weight** → e.g. one filled, one outline in a row of three quick-add buttons. Pick a consistent fill state and stick to it
8. **`numberOfLines` not set on user content** → long titles overflow or push layout

---

## Sister pages

- `CHECKLIST.md` — 22-item review checklist (load when reviewing a screen)
- `RN_PITFALLS.md` — React Native translation traps (load when implementing)
- `REFERENCES.md` — canonical sources with annotations
