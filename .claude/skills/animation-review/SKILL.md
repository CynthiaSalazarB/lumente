---
name: animation-review
description: "Audit motion that exists or find motion that should: review (grade animations against a strict craft bar), find (sweep a UI for motion that would genuinely help, rejecting most), vocabulary (name an effect the user can only describe). Use for \"review my animations\", \"are these transitions any good\", \"what could be animated here\", \"what's it called when…\". Judges and names."
license: MIT (emilkowalski/skills). See NOTICE.md.
metadata:
  author: Emil Kowalski
  version: "1.0.0"
  vendored_from: "github:emilkowalski/skills@e879241"
  argument-hint: "review <path> | find <path> | vocabulary <description>"
---

> **In the ATLAS motion stack, this is the missing verb.** The stack had *plan* (SK-148
> `motion-principles`) and *build* (`css-keyframe-animations` → `motion-animation` → `gsap` (unified:
> core + ScrollTrigger + plugins), plus `lenis-smooth-scroll`) — but nothing that **judged** motion after it existed, and
> nothing that answered "should this animate at all?" with a rule instead of a vibe. This skill is the
> review/critique end. It never writes implementation code.
>
> Precedence: impeccable's `reference/motion-design.md` remains the house authority on duration and easing for
> web builds. Where this skill's standards are stricter (they usually are), the stricter number wins — that is
> the point of a review bar. Real conflicts get flagged in the report, not silently resolved.

# Animation Review

Three modes. Pick by what the user asked for; never run more than one at a time.

| Mode | Trigger | What it does | Reference |
|---|---|---|---|
| **review** | "review my animations", "is this transition good", a diff touching motion | Grades existing motion against the standards. Default to flagging — approval is earned, not given. | [review-procedure.md](reference/review-procedure.md) + [review-standards.md](reference/review-standards.md) |
| **find** | "what could be animated here", "make this feel more alive" | Sweeps a UI for moments that would *genuinely* benefit. Expect to reject most candidates; caps at 5–7 for a whole app. | [find-opportunities.md](reference/find-opportunities.md) |
| **vocabulary** | "what's it called when…", user describes an effect they can't name | Reverse-lookup glossary: description → exact term. | [vocabulary.md](reference/vocabulary.md) |

**Read-only, all three modes.** They report, propose, and name. If the user wants a fix implemented, hand the
recipe to the build skills — don't write it here.

## The rule that does the most work

Before anything else, ask **how often a user sees this**:

| Frequency | Verdict |
|---|---|
| 100+ ×/day (keyboard shortcuts, command palette, core nav) | **No animation. Ever.** Not a judgment call. |
| Tens ×/day (hover states, list nav, frequent toggles) | Remove, or reduce to near-imperceptible |
| Occasional (modals, drawers, toasts, settings) | Standard animation |
| Rare / first-time (onboarding, empty states, success) | Where the delight budget lives |

Raycast has no open/close animation, and that is correct for something opened hundreds of times a day. Motion
on a frequently-repeated action does not read as polish; it reads as lag.

## Apple's fluid-interface principles

[apple-fluid-design.md](reference/apple-fluid-design.md) — response, direct manipulation, interruptibility,
and behaviour-over-animation, distilled from Apple's WWDC design talks and translated to the web (Pointer
Events, springs, `prefers-reduced-motion`). It is the standard for anything **gesture-driven** — drag, swipe,
sheets, momentum, anything the user can grab mid-flight. Consult it during `review` when the motion under
review responds to a pointer, and during any build of that kind.

Its load-bearing claim: animate from the *current presentation value*, never the target value, and never lock
out input during a transition. That single rule separates interfaces that feel alive from ones that feel like
they are playing a cutscene at you.

## Reporting

Cite a specific standard for every finding — `file:line`, the rule, the number it should be. "This feels slow"
is not a finding; "180ms would feel more responsive than this 400ms dropdown (UI ceiling is 300ms)" is.

Say plainly when a section produced nothing. A silent section and an unchecked section read identically.
