# NOTICE — Vendored Third-Party Content

## Source

- **Repository:** https://github.com/emilkowalski/skills
- **Commit:** `e879241fab3cdb22e8d95587cdbf40b57a88d7da`
- **License:** MIT — `Copyright (c) 2026 Emil Kowalski` (full text in `LICENSE`, copied verbatim from repo root)
- **Vendored:** 2026-08-19 from `C:/tmp/claude-scratchpad/design-vendor-quarantine/emilkowalski-skills/`
- **Author context:** Emil Kowalski — design engineer (Vercel, Linear), author of Sonner and Vaul, runs
  animations.dev. The rules are domain expertise, not aggregated blog advice, which is why they are worth
  taking as a *standard* rather than a suggestion.

## Why one skill instead of four

Upstream ships these as four separate skills. They were consolidated into one because the ATLAS motion stack
already carries several skills (`motion-principles`, `motion-animation`, `gsap` — since 2026-08-19 one unified skill absorbing `gsap-advanced`/`gsap-plugins`,
`css-keyframe-animations`, `lenis-smooth-scroll`), and every top-level skill costs description tokens in every
session's skill listing whether or not it fires. Four more entries for one capability — *judging* motion —
would be real, permanent context cost for a marginal routing gain.

They are genuinely one capability: all four are read-only, none implements, and they share a single standards
document. Modes inside one skill preserve the distinction at zero listing cost.

## Vendored files (6)

| Local path | Upstream path | Modified? |
|---|---|---|
| `reference/review-procedure.md` | `skills/review-animations/SKILL.md` | Frontmatter stripped only |
| `reference/review-standards.md` | `skills/review-animations/STANDARDS.md` | No |
| `reference/find-opportunities.md` | `skills/find-animation-opportunities/SKILL.md` | Frontmatter stripped only |
| `reference/vocabulary.md` | `skills/animation-vocabulary/SKILL.md` | Frontmatter stripped only |
| `reference/apple-fluid-design.md` | `skills/apple-design/SKILL.md` | Frontmatter stripped only |
| `LICENSE` | `LICENSE` (repo root) | No |

`SKILL.md` and this `NOTICE.md` are original local files, not from upstream.

**"Frontmatter stripped only"** means the leading `---` YAML block (`name`, `description`,
`disable-model-invocation`) was removed because these are now reference documents rather than skill entry
points. Every line of rule content below the frontmatter is verbatim — no rules were reworded, reordered,
dropped, or renumbered.

## Not vendored

- `skills/improve-animations/` (SKILL.md, AUDIT.md, PLAN-TEMPLATE.md) — codebase-sweep-then-plan. Its finding
  half duplicates `review-animations`, and its planning half produces work-orders for another agent to
  execute, which is not how this system routes work. **Held, not rejected** — revisit if a real project needs
  a bulk motion-refactor plan.
- `skills/animate/`, `skills/animate-expo/` — *build* skills. They would compete with the existing
  implementation lane (`motion-animation`, `gsap*`, `css-keyframe-animations`) and with `react-native` on the
  Expo side. Deliberately out of scope: this skill judges, it does not build.
- `skills/pick-ui-library/` — a curated library-picker. Overlaps `wiki/web-dev/capability-map.md` and
  `stack.md`, which already carry this decision for Leo's actual stack and stay current. **Held.**
- `skills/ask-sonner/` — Sonner-specific setup and recipes. Narrow; adopt only if a project uses Sonner.
- `skills/emil-design-eng/`, `skills/prototype/` — broad design-engineering and prototype-variation skills;
  both are entry points that would compete with `impeccable`. Rejected on the same non-redundancy grounds that
  kept hallmark and taste-skill out.

## Safety verification (2026-08-19)

The entire upstream `skills/` tree is **pure markdown — zero executable files** (`find skills -type f ! -name
"*.md"` returned 0). Danger-pattern sweep across the whole tree (`curl … | sh`, `eval(`, `exec(`,
`child_process`, `base64 -d`, `wget`, URL `require`/`fetch`, telemetry env, analytics calls) returned **zero
hits**. No install scripts, no marketplace or plugin manifests, no network calls.

## Relationship to existing skills

- **`motion-principles` (SK-148, LottieFiles, MIT)** — plans motion: personality archetypes, emotion→motion
  mapping, choreography budgets, and a craft `quality-checklist.md` (arcs, layering, the 1/3 rules). It does
  **not** answer "should this animate at all", and it has no review verb. Complementary, not overlapping.
- **`impeccable` `reference/motion-design.md`** — the house authority on duration/easing for web builds, and
  owner of the frequency gate for impeccable's own flow. Where this skill is stricter, stricter wins in a
  review; genuine conflicts get flagged rather than silently resolved.
- **`impeccable` `reference/audit-rules.md`** — AR-35/36/37 and the new AR-49/50/51/52/62 cover motion as
  *grep-detectable defects*. This skill covers motion as *craft judgement*. Run the audit sheet for what a
  regex can catch; run this for what it cannot.

## Refresh procedure

```
git -C <quarantine>/emilkowalski-skills fetch --depth 1 origin main
```

Diff the five vendored files, re-strip frontmatter, re-verify the danger sweep, then update the SHA here and
in `SKILL.md`'s `vendored_from`.
