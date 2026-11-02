# NOTICE — Attribution Ledger

This skill (`tactile`) is the mobile-first entry point of the ATLAS design system. It mirrors the
structure of Leo's **`impeccable`** skill (itself based on Anthropic's Apache-2.0 **frontend-design**)
and wraps Leo's **`mobile-app-design`** skill (SK-126) as its principles library. All external sources
below are referenced for their published guidance — no proprietary text is copied verbatim; numeric
facts, role names, and conventions are uncopyrightable and are cited for provenance.

| Source | License / status | Used in | What was taken / modified |
|---|---|---|---|
| Leo's `mobile-app-design` (SK-126) — `SKILL.md`, `RN_PITFALLS.md`, `CHECKLIST.md`, `REFERENCES.md` | Leo's own | most of `reference/*` + `reference/audit-rules.md` | The 8-rule model, glass/squircle playbook, the 15 RN translation traps, and the 22-item review checklist — reorganized from one review playbook into a per-topic build library + a deterministic detector sheet. SK-126 remains the loaded principles library; its `CHECKLIST.md` is still the canonical manual review list. |
| Anthropic `frontend-design` / Leo's `impeccable` | Apache 2.0 | `SKILL.md`, `reference/craft.md`, `reference/audit-rules.md` (structure) | The entry-point pattern: modes (craft/teach), Context Gathering Protocol, `<absolute_bans>` shape, `<font_selection_procedure>`, the AI-slop test, the 5-step craft flow, and the audit-sheet format + mandatory-canary concept. |
| Apple Human Interface Guidelines | Apple — referenced, not copied | `reference/platform-conventions.md`, `reference/navigation-and-ia.md`, `reference/motion-and-gesture.md`, `reference/safe-area-and-devices.md`, `reference/touch-and-interaction.md` | 44pt touch targets, 20pt safe-area side margins, navigation/modality conventions, native motion timing, Dynamic Type. |
| Material Design 3 (Google) | CC-BY 4.0 — referenced | `reference/mobile-color.md`, `reference/platform-conventions.md`, `reference/touch-and-interaction.md` | Semantic color roles (`primary`/`primaryContainer`/`onPrimary`/`onPrimaryContainer`), elevation tiers, tonal surfaces, 48dp targets, density. |
| Refactoring UI (Schoger & Wathan) | book — ideas referenced | `reference/mobile-typography.md`, `reference/mobile-color.md`, `reference/mobile-spacing.md` | Hierarchy-via-weight-and-color, "don't use grey text on coloured backgrounds," establishing a spacing/sizing system. |
| WCAG 2.2 (W3C) | W3C — referenced | `reference/touch-and-interaction.md`, `reference/mobile-color.md` | Contrast floors (4.5:1 body / 3:1 large), target sizing (SC 2.5.5), text resize (1.4.4). |
| Stitch `DESIGN.md` glassmorphism patterns | Leo's reference exemplar | `reference/glass-and-depth.md` | 24px gutter / 40px section breath / 20px card padding, the glass-layer recipe, the squircle radius system. |
| Expo docs — `expo-blur`, `expo-linear-gradient`, `react-native-safe-area-context`, `react-native-svg`, `expo-image` | MIT / docs | `reference/rn-translation-traps.md`, `reference/glass-and-depth.md`, `reference/safe-area-and-devices.md`, `reference/imagery-and-icons.md`, `reference/platform-verification.md` | Blur intensity calibration, gradient coordinate system, safe-area API, SVG progress-ring pattern, image caching/ATS rules. |

**Original synthesis (no single upstream):** `reference/cross-platform-parity.md`,
`reference/state-patterns.md`, and `reference/platform-verification.md`.

`reference/audit-rules.md` uses the `AR-T##` ID prefix to keep its rule namespace distinct from
impeccable's web `AR-##` rules.
