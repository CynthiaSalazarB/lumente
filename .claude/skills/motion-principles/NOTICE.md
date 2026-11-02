# NOTICE — motion-principles (SK-148)

Vendored into the ATLAS web-dev system on 2026-07-20 (repo-integration round 3).

- **Source:** github:lottiefiles/motion-design-skill
- **Pinned commit:** `f9a8a041b85185ee4881b3471d3415e939aac772`
- **License:** MIT — Copyright (c) 2025 LottieFiles (see `LICENSE`)
- **Rename:** upstream skill name `motion-design` → `motion-principles` here, to name its lane (the *planning* layer) and avoid confusion with the mechanics skills (css-keyframe-animations / motion-animation / gsap*).

## Vendored files (verbatim unless noted)
| Path | Notes |
|---|---|
| `SKILL.md` | frontmatter adapted (name→motion-principles, +`vendored_from`, +ATLAS routing note); body verbatim |
| `director/*.md` (8) | verbatim |
| `patterns/*.md` (4) | verbatim |
| `reference/*.md` (4) | verbatim |
| `LICENSE` | upstream MIT, verbatim |

## Excluded
- `README.md`, `.gitignore` (repo packaging).

## Safety verification
Pure markdown (prose + tables). Danger scan (`curl|bash`, `eval`, `child_process`, `postinstall`, remote fetch, telemetry) = **clean**. No code, no auto-exec. Read-only vetting; cloned into quarantine (`C:/tmp/claude-scratchpad/webdev-r3-quarantine`), never installed via `npx skills add`.

## Misnomer note
Despite the LottieFiles name, this skill teaches **motion-design principles** (timing/easing/choreography/Disney-12/personality), NOT Lottie tooling. Lottie player usage is covered by the hyperframes runtime adapter (SK-143).
