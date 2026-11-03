---
title: Project Wiki Index
type: index
updated: 2026-10-28
total_pages: 8
---

# Lumente project wiki

Shared notes for Lumente: context, research and analysis that don't belong in the code.
Decisions go in [`DECISIONS.md`](../DECISIONS.md) and nowhere else. Longer reasoning behind one goes
in the entry itself, or in a `context/` page the entry links to. Connection details and secrets never
go here: the repo is public.

To add a page, put it in `context/` or `synthesis/` with this frontmatter, then add a row below and a
line in [`log.md`](log.md):

```yaml
---
title: "Page title"
type: context | synthesis
related: []
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

Source documents (PDFs, saved articles) stay out of the repo, since it's public. Link to them from the
page under a Sources heading, the way the SurrealDB prize page does.

## Context

| Page | Summary | Updated |
|------|---------|---------|
| [SurrealDB sponsor prize](context/surrealdb-sponsor-prize.md) | SurrealDB sponsors the Agent Memory prize: what judges want, how Lumente meets the three criteria with code pointers and tests, the demo walkthrough, the limits, what the live context does, the Oct 25 deadline | 2026-10-24 |
| [Hosting setup](context/hosting-setup.md) | The SurrealDB Cloud instance and the Render service for the API: plans, regions, settings, the #8 numbers, and what changed on Render since Oct 20 | 2026-10-24 |
| [Evidence](context/evidence.md) | The problem, the buyers and the competitors: what learners describe, the research, prices, and what it doesn't prove yet | 2026-10-21 |
| [Status](context/status-oct22.md) | The live-state page, started Oct 22 night and kept current since: what is live (API, web, APK, updates, the demo account), the open PRs and what each waits on, what is open on Cynthia and on Leo, the dates to the freeze; it opens with Nov 2: the `summary` branch (#207), audited, fixed and waiting for Cynthia's review, then the Oct 27 to 28 code reviews | 2026-11-02 |
| [Submission checklist](context/submission-checklist.md) | What Devpost and each prize ask for, read from the source pages: the dates, who can enter, what the page must include, each prize's evidence, the criteria, with an owner and a date per line | 2026-10-24 |

## Synthesis

| Page | Summary | Updated |
|------|---------|---------|
| [Product thesis](synthesis/product-thesis.md) | What Lumente solves now, why it should work, what we claim and don't yet, the hard questions, and where it goes | 2026-10-22 |
| [Plan to win](synthesis/plan-to-win.md) | The plan, adopted Oct 22 with Cynthia's decisions: our user (CS students who build with coding agents), the story and its sources, each judging criterion, the prizes we enter, the changes for the new user, the days to Oct 29, owners, the cut list, the decisions, and the free tools and credits; done items carry their PR numbers | 2026-10-24 |
| [Expo prize plan](synthesis/expo-prize-plan.md) | Best Use of Expo in full: what Expo rewards, the EAS setup with config, every judge's path (APK, the web; no TestFlight), native feel, SDK 58 features, the evidence, owners and risks | 2026-10-24 |
