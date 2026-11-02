# Screen Archetypes

Purpose: the small set of shapes a mobile *content* screen actually takes, so a build reads as designed from the first frame instead of being assembled component-by-component. The mobile answer to impeccable's `layout-archetypes.md` — but the catalog is different, because a phone screen is one column, one thumb, and one thing at a time.

**Scope, and what this page deliberately does not own.** Three neighbours already carry the rest, and duplicating them is how a skill rots:

- **State screens** — onboarding, permission priming, empty, loading, error, offline, success — are [state-patterns.md](state-patterns.md). Every archetype below assumes those states exist; none of them re-specifies one.
- **Containers** — tabs vs stack vs modal vs sheet, Expo Router file conventions, deep links — are [navigation-and-ia.md](navigation-and-ia.md). This page is what lives *inside* one route.
- **Insets, keyboard, device class** are [safe-area-and-devices.md](safe-area-and-devices.md). Every skeleton here is written assuming `useSafeAreaInsets` is already in play.

## How to use this catalog

Pick **one** archetype per route and commit to it. A screen that is half feed and half dashboard reads as indecision. Then break it deliberately in exactly one place — one break is a point of view, three are noise.

Pick by **what the user came to do**, not by what data you happen to have:

| They came to… | Archetype |
|---|---|
| see where they stand right now | 1. Dashboard |
| browse many of something | 2. Feed |
| study or act on one thing | 3. Detail |
| change how the app behaves | 4. Settings |
| put something in | 5. Composer |
| decide whether to pay | 6. Paywall |

Search and Profile are not separate archetypes: search is a Feed with a query header, profile is a Detail with a Settings tail.

## The physics every archetype obeys

Three constraints that do not exist on the web and that decide these skeletons:

1. **The thumb owns the bottom third.** Primary actions live in the lower half; destructive and rare actions live at the top where they are hard to hit by accident. A primary CTA pinned to the top of a phone screen is a desktop layout wearing a phone's clothes.
2. **Vertical is the only free axis.** There is no sidebar to hide things in. Anything that does not earn its vertical space pushes the real content below the fold — and on mobile, below the fold is a decision the user has to make, not a scroll they make absently.
3. **The first frame is the whole impression.** It is roughly 800×400 points above the fold. Whatever is there IS the screen as far as first impressions go — which is why every skeleton below specifies what occupies it.

---

## 1. Dashboard — "where do I stand?"

**When it fits:** the app has one number or state the user opens it to check. Trackers, finance, health, habit apps. Almost always the first tab.

**Skeleton, top to bottom:**
- Greeting or context line — small, quiet, one line. Not a hero.
- **The hero metric** — one number, display-scale, unambiguous. If you cannot name the single number, this is a Feed, not a Dashboard.
- Its supporting shape — ring, sparkline, or progress bar. One visual, not a chart wall.
- Primary action, thumb-reachable: the verb that changes the hero metric (Start, Log, Add).
- Secondary cards below the fold — deliberately below, so the hero owns the first frame.

**The move that makes it read designed:** the hero metric and its action are the *same visual object* — the ring is the button, or the button sits inside the ring's negative space. Two separate boxes reads as a form; one object reads as an instrument.

**Failure mode:** four equal-weight cards. Equal weight means no hierarchy, and no hierarchy on a phone reads as a settings screen with pictures.

---

## 2. Feed — "show me many"

**When it fits:** a scrolling collection where items are comparable and the user is scanning, not studying. History, activity, library, search results, inbox.

**Skeleton:**
- Header that can collapse on scroll (iOS large title, Material large top app bar) — it buys back vertical space the moment the user commits to scrolling.
- Optional filter/segment row, sticky only if filtering is genuinely frequent.
- **Rows or cards, one rhythm, no exceptions.** Every item the same height class; variable heights are for content-driven feeds only (photos, posts), never for records.
- Section headers if and only if time or category actually groups the data.

**The move:** commit to either rows *or* cards for the whole feed. Rows with three cards mixed in reads as a bug. If one item must stand out, change its *emphasis* (weight, accent bar, background tint), never its shape.

**Non-negotiable:** a windowed list (`FlatList`/`FlashList`), never `.map()` inside a `ScrollView`. A mapped list of 200 rows mounts 200 rows, and the jank shows up on exactly the device you do not own. Pair with the end states in [state-patterns.md](state-patterns.md) § pull-to-refresh and infinite-scroll.

**Failure mode:** a card per row with 16pt margins on both sides — you have spent a quarter of a narrow screen's width on air, and every row now looks like a button that is not one.

---

## 3. Detail — "tell me about this one"

**When it fits:** one entity, arrived at from a Feed. Item, recipe, workout, transaction, profile.

**Skeleton:**
- Hero — image, or a large typographic treatment of the title when there is no image worth showing. A grey placeholder rectangle is worse than no hero.
- Title + the two or three facts that identify it. Not every field you have.
- Primary action, pinned to the bottom over a scrim or glass bar if it must always be reachable; inline if the screen is short.
- Body, then related items last.

**The move:** let the hero scroll under a transparent header that fades in as it goes, so the back affordance is always available without a bar sitting on top of the image. See [glass-and-depth.md](glass-and-depth.md) for the three-layer bar, and [navigation-and-ia.md](navigation-and-ia.md) § back affordance — the edge-swipe must survive whatever you do here.

**Failure mode:** every available field rendered as a label/value row. That is a database view, not a detail screen. Decide what identifies the thing; put the rest behind a disclosure.

---

## 4. Settings — "change how this behaves"

**When it fits:** configuration, account, preferences. The one archetype where being boring is correct — users are here to find one switch and leave.

**Skeleton:**
- Grouped sections with quiet uppercase labels (see SKILL.md's label register).
- Rows with a single affordance each: switch, chevron, or value. Never two.
- Destructive actions in their own section at the very bottom, in the error colour, never adjacent to anything routine.

**The move:** there isn't one, and that is the point. Invention here costs the user time. Spend the design budget on making the *language* precise — a switch labelled with what it does when on, never a noun.

**Failure mode:** a custom control where the platform has one. A hand-rolled toggle loses the platform animation, the accessibility role, and the muscle memory, and gains nothing.

---

## 5. Composer — "let me put something in"

**When it fits:** the input IS the screen. Add entry, write note, log a measurement, compose a message.

**Skeleton:**
- Minimal chrome: cancel and a single commit action. No tab bar — a composer is a modal or a pushed route, never a tab.
- The primary input focused on mount, keyboard up immediately.
- Secondary fields below, reachable without dismissing the keyboard.
- Commit action **above the keyboard**, not behind it.

**The move:** default everything defaultable. A composer that opens with the date, time, and last-used category pre-filled turns a five-field form into one confirmation tap.

**Failure mode:** the commit button under the keyboard. Keyboard avoidance is not optional here — [safe-area-and-devices.md](safe-area-and-devices.md) § keyboard covers the mechanics. Test with the keyboard open on the smallest device class you support, or you have not tested the screen at all.

---

## 6. Paywall — "decide whether to pay"

**When it fits:** conversion. The only archetype where the brand register is fully licensed, because this screen is marketing.

**Skeleton:**
- One value claim — what the user gets, in their words, not the feature name.
- Three benefit lines maximum. A feature matrix on a phone is a wall.
- **Plans as a segmented choice with one visually pre-selected**, annual by default if that is the honest recommendation.
- Primary CTA, thumb-reachable, stating the actual charge.
- Restore purchases and terms links, small but genuinely tappable — 44pt zones via `hitSlop`, not 11pt text.

**The move:** show the price *and* the trial terms in the button or immediately under it. Hiding the number is a dark pattern, and reviewers on both stores look for exactly this.

**Failure mode, and this one is a documented rejection:** shipping without a restore mechanism. Apple is explicit — *"Your app must include a restore mechanism for any restorable In-App Purchases, per App Review Guideline 3.1.1"* ([App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), checked 2026-08-13). Run the `app-store-review` skill (SK-135) and § A0 in `ship-verify` before submitting.

**Second failure mode, usability rather than policy:** a close affordance that is missing, delayed, or a 12pt grey × in a corner. A user who cannot leave a paywall leaves the app, and a trapped-feeling paywall converts worse than an honest one. Give it a real 44pt zone like any other control.

---

## Cross-references

- State layers for every archetype: [state-patterns.md](state-patterns.md)
- Which container the archetype sits in: [navigation-and-ia.md](navigation-and-ia.md)
- Insets, keyboard, device classes: [safe-area-and-devices.md](safe-area-and-devices.md)
- Touch-target geometry for every action named above: [touch-and-interaction.md](touch-and-interaction.md)
- Deterministic checks: [audit-rules.md](audit-rules.md) — AR-T01 (targets), AR-T27/28 (safe area) apply to all six.
