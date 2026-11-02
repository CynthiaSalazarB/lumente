# NOTICE — Vendored Third-Party Content

## Source

- **Repository:** https://github.com/vercel-labs/web-interface-guidelines
- **Commit:** `e3d624baaf29dc1fc645aff3e38f03e564d2d6b1`
- **License:** MIT — `Copyright (c) 2025 Vercel Labs` (full text in `LICENSE`, copied verbatim from repo root)
- **Vendored:** 2026-08-19 from `C:/tmp/claude-scratchpad/design-vendor-quarantine/vercel-labs-web-interface-guidelines/`

## Why this skill was re-vendored (v1.0.0 → v2.0.0)

The original skill was installed from **`vercel-labs/agent-skills`**, which carries **no LICENSE file at all**
(verified 2026-08-19 via `gh api repos/vercel-labs/agent-skills/license` → 404). Under the skill-vet licensing
gate that is a hard reject: unlicensed content is redistribution-unsafe regardless of how permissive the
author probably intended it to be.

That skill was a ~40-line router whose only real job was to fetch the rules at review time from a *different*
repo — `vercel-labs/web-interface-guidelines` — which **is** properly MIT-licensed. So the rules themselves
were always safe; only the wrapper was not.

Re-vendoring from the correctly-licensed source fixes three things at once:

1. **Licence** — the content now travels with a real MIT LICENSE file naming its copyright holder.
2. **Reliability** — reviews no longer depend on a live WebFetch, the weakest rung of the fetch cascade. A
   network failure previously turned a rules-based review into an unanchored one, with nothing making that
   degradation visible.
3. **Reproducibility** — the standard is pinned to a SHA, so a review run today and one run next month grade
   against the same rules unless the pin is deliberately moved.

## Vendored files (2)

| Local path | Upstream path | Modified? |
|---|---|---|
| `RULES.md` | `command.md` | **Yes — scaffolding stripped, see below** |
| `LICENSE` | `LICENSE` | No |

`SKILL.md` and this `NOTICE.md` are original local files, not from upstream.

### `RULES.md` modifications

Upstream `command.md` is authored as a *slash-command* file, so it opens with command scaffolding that is
meaningless in a reference document. Exactly three things were removed:

1. The YAML frontmatter block (lines 1–4: `description`, `argument-hint`) — a command header, not a rule.
2. The line `Review these files for compliance: $ARGUMENTS` — `$ARGUMENTS` is a slash-command placeholder.
3. Leading blank lines left behind by (1).

**Every rule is verbatim.** Verified mechanically: bullet-rule count before = 103, after = 103; section count
before = 17, after = 17. No rule text, ordering, or section heading was altered.

## Excluded files

- `install.sh` — installer machinery; writes into a live skills directory. Never vendored, never run.
- `README.md`, `AGENTS.md` — repo documentation; does not travel.

## Safety verification (2026-08-19)

`RULES.md` and `LICENSE` are pure markdown/text with zero executable content. Danger-pattern sweep
(`curl … | sh`, `eval(`, `exec(`, `child_process`, `base64 -d`, `wget`, URL `require`/`fetch`, telemetry)
returned zero hits across the vendored files and zero across the whole upstream repo apart from `install.sh`,
which was excluded.

## Refresh procedure

```
crwl "https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md" -o markdown
```

Diff against `RULES.md`, port genuine rule changes, re-apply the three scaffolding strips above, re-verify the
bullet/section counts, and update the commit SHA in this file and in `SKILL.md`'s `vendored_from`.
