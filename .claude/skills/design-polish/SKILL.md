---
name: design-polish
description: "Final quality pass fixing alignment, spacing, consistency, and micro-detail issues before shipping. Use when the user mentions polish, finishing touches, pre-launch review, something looks off, or wants to go from good to great."
---

## Preparation

Load the `frontend-design` skill (SK-005) — it contains design principles and anti-patterns to check against.

Also run the deterministic detector pass: `skills/impeccable/reference/audit-rules.md` (90 rules + copy-pasteable grep sheet). Mechanical hits found there are fix-first items before any manual polish below.

---

Perform a meticulous final pass to catch all the small details that separate good work from great work. The difference between shipped and polished.

**CRITICAL**: Polish is the last step, not the first. Don't polish work that's not functionally complete.

## Pre-Polish Assessment

1. **Review completeness**: Is it functionally complete? What's the quality bar (MVP vs flagship)?
2. **Identify polish areas**: Visual inconsistencies, spacing/alignment issues, interaction state gaps, copy inconsistencies, edge cases, loading/transition smoothness.

## Polish Systematically

### Visual Alignment & Spacing
- Pixel-perfect alignment to grid
- Consistent spacing using spacing scale (no random 13px gaps)
- Optical alignment adjustments (icons may need offset)
- Responsive consistency across breakpoints

### Typography Refinement
- Hierarchy consistency (same elements use same sizes/weights throughout)
- Line length 45-75 characters for body text
- Appropriate line height for font size and context
- No widows/orphans (single words on last line)
- Font loading settled (no FOUT/FOIT flashes)

### Color & Contrast
- All text meets WCAG contrast standards
- Consistent design token usage (no hard-coded colors)
- Works in all theme variants
- Tinted neutrals (no pure gray or pure black — add subtle 0.01 chroma)
- Never gray text on colored backgrounds — use a shade of that color

### Interaction States
Every interactive element needs ALL states: Default, Hover, Focus, Active, Disabled, Loading, Error, Success. **Missing states create confusion and broken experiences.**

### Micro-interactions & Transitions
- All state changes animated (150-300ms)
- Consistent easing: ease-out-quart/quint/expo. Never bounce or elastic.
- 60fps animations, only animate transform and opacity
- Respects `prefers-reduced-motion`

### Content & Copy
- Consistent terminology (same things called same names)
- Consistent capitalization (Title Case vs Sentence case)
- No typos, appropriate length, punctuation consistency

### Icons & Images
- Consistent icon style (all from same family)
- Proper optical alignment with adjacent text
- All images have descriptive alt text
- No layout shift (proper aspect ratios, lazy loading)

### Forms & Inputs
- All inputs properly labeled
- Consistent required indicators and error messages
- Logical tab order
- Consistent validation timing

### Edge Cases & Error States
- Loading states for all async actions
- Helpful empty states (not just blank space)
- Clear error messages with recovery paths
- Long content handling (very long names, descriptions)
- Missing data handling
- Checked with worst-case data behind a dev-only `?data=worst` toggle: long, CJK, right-to-left and emoji names, counts of 1 and 1,284 (`impeccable/reference/stress-data.md`)

### Responsiveness
- All breakpoints tested (mobile, tablet, desktop)
- Touch targets 44x44px minimum
- No text smaller than 14px on mobile
- No horizontal scroll
- Content adapts logically

### Performance
- No layout shift (CLS)
- Smooth interactions (no jank)
- Optimized images
- Lazy loading for off-screen content

### Code Quality
- Remove console logs, commented code, unused imports
- Consistent naming conventions
- Type safety (no TypeScript `any`)
- Proper ARIA labels and semantic HTML

## Polish Checklist

- [ ] Visual alignment perfect at all breakpoints
- [ ] Spacing uses design tokens consistently
- [ ] Typography hierarchy consistent
- [ ] All interactive states implemented
- [ ] All transitions smooth (60fps)
- [ ] Copy is consistent and polished
- [ ] Icons consistent and properly sized
- [ ] All forms properly labeled and validated
- [ ] Error states helpful
- [ ] Loading states clear
- [ ] Empty states welcoming
- [ ] Touch targets 44x44px minimum
- [ ] Contrast ratios meet WCAG AA
- [ ] Keyboard navigation works
- [ ] Focus indicators visible
- [ ] No console errors or warnings
- [ ] No layout shift on load
- [ ] Respects reduced motion preference
- [ ] Code clean (no TODOs, console.logs, commented code)
- [ ] audit-rules grep sheet: zero detector hits (impeccable/reference/audit-rules.md)
- [ ] Cross-browser + feel pass (animated/public builds): `verify-browsers.mjs` exits 0 — Chromium/Firefox/WebKit render clean, motion observed, reduced-motion content visible (impeccable/reference/cross-browser-and-feel.md)

## Final Verification

Before marking as done:
- **Use it yourself**: Actually interact with the feature
- **Test on real devices**: Not just browser DevTools
- **Compare to design**: Match intended design
- **Check all states**: Don't just test happy path

**IMPORTANT**: Polish is about details. Zoom in. Squint at it. The little things add up.

**NEVER**: Polish before functionally complete. Introduce bugs while polishing. Perfect one thing while leaving others rough. Ignore systematic issues.
