# Mobile Screen Review Checklist

Walk this list against any mobile screen — yours or someone else's. Any item that fails is a fix candidate. The list is ordered so the highest-impact gaps surface first.

## Hierarchy & focus (4)

1. **One clear hero per screen.** The eye lands there first without thinking. Two competing heroes = no hero.
2. **Max three text sizes** in primary content. Hierarchy comes from weight and color, not from a fourth font ladder rung.
3. **Eyebrow + headline + body** trio on any major card. Eyebrow categorizes (uppercase label), headline labels, body explains.
4. **The action button is the most saturated element.** If a decorative gradient or an inactive chip competes with the CTA for attention, the screen is broken.

## Typography (3)

5. **Display / headline uses a display-grade font** (Hanken Grotesk, SF Pro Display, or the platform system display). Body never uses display fonts.
6. **Body uses a body-grade font.** Inter or system. Light (300) for long prose paragraphs; Regular (400) for UI body, lists, labels. Don't use Light for short labels — it reads as washed out at small sizes.
7. **Labels are uppercase, 11–12 pt, with generous letter-spacing** (`letterSpacing: 1.4` in RN, `0.08em` in CSS). They should look like newspaper section labels, not screaming.

## Color (3)

8. **No raw hex in screen code.** Every color is a token (`palette.primary`, `palette.onSurfaceVariant`). If you can't satisfy this without adding a palette entry, add the entry.
9. **Status colors use the container variant.** Errors: `errorContainer` (soft) bg + `onErrorContainer` text. Never the raw `error` red as a chip background.
10. **Dark mode verified.** Every text + background pair has ≥ 4.5:1 contrast (≥ 3:1 for ≥ 18 pt). Use the WebAIM contrast checker or VS Code's color tool.

## Spacing (3)

11. **Page gutter is on the token scale.** 24 px is the canonical mobile gutter (Stitch + most modern design systems). 20 px is acceptable; below 16 px is cramped.
12. **Sections are separated by `stackLg` (40 px).** This is the breath that distinguishes "another card" from "a different topic."
13. **Internal card padding is `glassPad` (20) or explicit 16/24.** Never less than 12 px — text against the edge of a card always reads as broken.

## Components (3)

14. **Glass cards have all three layers.** BlurView + tinted fill + inner-glow border + ambient shadow. Missing any of them produces a flat panel, not glass.
15. **Touch targets ≥ 44 × 44 pt.** Smaller? Add `hitSlop`. Test by trying to tap with the side of your thumb.
16. **Segmented-control selected thumb is visibly elevated.** Shadow OR border OR background contrast — but at least one of the three. On Android, add `elevation: 2` because soft shadows often vanish.

## Motion (2)

17. **Press feedback within 150 ms.** Either `transform: [{ scale: 0.96 }]` or `opacity: 0.88` on pressed state. Without this, buttons feel dead even when they work.
18. **Modal style matches its purpose.** Sheets use `animationType="slide"`. Confirmations use `"fade"`. Alerts use the native `Alert.alert`. Don't mix them.

## Accessibility & platform (4)

19. **Every interactive has `accessibilityRole` + `accessibilityLabel`.** No exceptions for icon-only buttons.
20. **Selected / checked / expanded state is reported via `accessibilityState`.** Screen readers can't see your green pill — they need the data.
21. **Safe areas respected.** `useSafeAreaInsets()` for top + bottom. Horizontal padding ≥ 20 px on phones, optionally more on tablets. Bottom-of-screen content clears the home indicator.
22. **Text scales with system font setting** (no `allowFontScaling={false}` on body content). The exception is a hero numeric display where layout would visibly break — gate it behind `adjustsFontSizeToFit` instead.

---

## Severity rubric for review reports

When reporting findings, tag each one:

- **🔴 Blocker** — broken interaction, illegible text, accessibility violation, broken layout
- **🟠 Important** — visible polish gap that any user would notice in the first 5 seconds
- **🟡 Refinement** — would-be-nice; the kind of thing a designer would flag in a pixel review
- **🟢 Optional** — preference, taste, or alternative-direction commentary; not a defect

Report blockers and important items by default. Mention refinements only if asked or if there's a cluster of 3+ in one section.
