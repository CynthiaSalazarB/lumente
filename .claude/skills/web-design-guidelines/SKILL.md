---
name: web-design-guidelines
description: Review UI code against the Vercel Web Interface Guidelines — 103 rules across accessibility, focus, forms, animation, typography, performance, touch, dark mode, i18n, and hydration. Use when asked to "review my UI", "check accessibility", "audit design", "review UX", or "check my site against best practices".
license: MIT (vercel-labs/web-interface-guidelines). See NOTICE.md.
metadata:
  author: vercel-labs
  version: "2.0.0"
  vendored_from: "github:vercel-labs/web-interface-guidelines@e3d624b"
  argument-hint: <file-or-pattern>
---

> **In the ATLAS web-dev system:** the *external-standard* review pass. It checks a build against Vercel's
> published interface guidelines — a different axis from impeccable's `reference/audit-rules.md`, which hunts
> AI-tells and house-style violations. Run both on anything shipping: this one catches "your form inputs lack
> `autocomplete`", audit-rules catches "this looks like every other LLM page". Neither subsumes the other.

# Web Interface Guidelines

Review files against the rules in [RULES.md](RULES.md) — vendored locally, MIT, 103 rules in 17 sections.

## How to run it

1. **Read [RULES.md](RULES.md).** It is on disk; do not fetch anything.
2. Read the target files (if the user gave no path, ask which files to review).
3. Check each file against every applicable section.
4. Report findings as `file:line — rule violated → fix`. Terse. Sacrifice grammar for signal.
   Say so explicitly when a section has zero findings; a silent section reads identically to an unchecked one.

## What it covers

Accessibility · Focus States · Forms · Animation · Typography · Content Handling · Images · Performance ·
Navigation & State · Touch & Interaction · Safe Areas & Layout · Dark Mode & Theming · Locale & i18n ·
Hydration Safety · Hover & Interactive States · Content & Copy · Anti-patterns

## Refreshing the rules

The rules are pinned, not live. Upstream moves slowly, and a review that silently changes its standard
mid-project is worse than one that is a few weeks stale. To update deliberately:

```
crwl "https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md" -o markdown
```

Diff it against `RULES.md`, port real rule changes, then update the pinned SHA in `NOTICE.md`.

**Why local rather than fetch-on-every-run** (this skill used to fetch): the network path made every review
depend on WebFetch — the weakest rung of the fetch cascade — so a review could fail, or silently degrade to
guessing, over a transient network problem. It also meant the skill shipped no licence of its own, because the
repo it was installed from carries none. Both are fixed by pinning. See `NOTICE.md`.
