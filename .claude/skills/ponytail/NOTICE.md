# NOTICE — ponytail (SK-155)

| Field | Value |
|---|---|
| Source | https://github.com/DietrichGebert/ponytail |
| Pinned SHA | `09c434ab73ca43761c5d8b0c5d341926c2fba710` (upstream `main`, 2026-10-18) |
| License | MIT (`LICENSE` copied from repo root; `gh api repos/DietrichGebert/ponytail` reports MIT) |
| Vendored | 2026-10-19, at Leo's request during the starred-repo harvest |

## Vendored files

| Path | Origin |
|---|---|
| `SKILL.md` | `skills/ponytail/SKILL.md`, verbatim except frontmatter `metadata.vendored_from` and one ATLAS routing note |
| `references/review.md` | `skills/ponytail-review/SKILL.md`, verbatim |
| `references/audit.md` | `skills/ponytail-audit/SKILL.md`, verbatim |
| `references/debt.md` | `skills/ponytail-debt/SKILL.md`, verbatim |
| `LICENSE` | repo root |

The three companion skills live as references of one skill, the router pattern skill-vet asks for (one registry entry, the bulk loads on demand).

## Excluded

- Plugin and host machinery: `.claude-plugin/`, `.codex-plugin/`, `.cursor/`, `.kiro/`, `.windsurf/`, `.clinerules/`, `.qoder/`, `.agents/`, `.openclaw/`, `.opencode/`, `.github/`, `plugin.json`, `plugin.yaml`, `gemini-extension.json`, `opencode.json`, `pi-extension/`, `__init__.py`.
- `hooks/` (session activation, mode tracker, statusline "band", subagent and instruction injectors): CLAUDE.md already loads the core rules every session, so a hook would add a second copy.
- `skills/ponytail-gain` (a benchmark scoreboard card) and `skills/ponytail-help` (a command card for the plugin build).
- `commands/`, `scripts/`, `tests/`, `benchmarks/`, `examples/`, `docs/`, `i18n/`, `assets/`.

## Safety verification

- `node scripts/untrusted-check.js` over the six upstream SKILL.md files: 6 files, 0 high, 0 medium, 0 low.
- The vendored files are markdown only: no scripts, no network calls, no telemetry. The excluded hooks are where the plugin reads config and writes state.

## Quality score (SkillNet five dimensions)

| Dimension | Score | Note |
|---|---|---|
| Safety | pass | see above |
| Completeness | high | the rule set, three levels, and review / audit / debt verbs with fixed report formats |
| Executability | high | prose only; runs anywhere |
| Maintainability | medium | single maintainer, very active (pushed 2026-10-18); refresh by re-pinning a newer SHA |
| Cost-Awareness | high | SKILL.md is ~4 KB; the verbs load only when used. The always-on core already lives in CLAUDE.md |
