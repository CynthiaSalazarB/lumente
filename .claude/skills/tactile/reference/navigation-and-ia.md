# Navigation & Information Architecture

How to structure a mobile app's screens and the routes between them — when to reach for tabs vs stacks vs modals vs sheets vs full-screen-cover, and how to lay that out in Expo Router without fighting the file system.

tactile **orchestrates** the heavy implementation: once the IA is decided, route Expo Router structure, native tabs, sheets, and headers to the **building-native-ui** skill. This page is the decision layer; that skill is the build layer.

---

## The container decision rule

Pick the container by the relationship between the new content and the screen it came from. One rule per container — match the strongest fit, don't stack them.

| Container | Use when | Don't use when |
|-----------|----------|----------------|
| **Tabs** | 3–5 **peer destinations** the user switches between freely all session (Home / Search / Library / Profile). Top-level only. | The set is a linear flow, or there are 2 or 6+ items. Two tabs = use a segmented control; 6+ = use a "More" screen or a list. |
| **Stack (push)** | Navigating **deeper into the same subject** — list → detail → sub-detail. The back affordance is the whole point. | Lateral moves between unrelated areas (that's a tab), or a self-contained task (that's a modal/sheet). |
| **Modal (full sheet)** | A **self-contained task** that interrupts the flow and ends in commit/cancel — compose, new entry, login, paywall. Has its own nav context. | Light, dismissible content you want the parent visible behind (use a detent sheet). |
| **Sheet (detent / form sheet)** | **Contextual, partial-height** content that keeps the parent in view — filters, share, quick actions, a picker, a confirm. Resizable via detents (`[0.5, 1.0]`). | A multi-screen flow (push a stack instead), or anything that needs the full screen. |
| **Full-screen cover** | **Immersive, takeover** content with no parent context — onboarding, camera, media viewer, a full-bleed reader. | Anything the user should be able to glance past back to. That's a sheet. |

Decision shortcut: *peer? → tab. deeper? → push. task with commit/cancel? → modal. contextual & parent stays useful? → sheet. immersive takeover? → cover.*

**Don't double-wrap.** A modal that contains a stack is fine (a flow). A sheet that pushes full screens is a sign you picked the wrong container — promote it to a modal or a tab-pushed stack.

---

## Expo Router file conventions

Expo Router is **file-based** — the `app/` directory *is* the route tree. Get the structure right and navigation is almost free; fight it and every screen leaks.

**Hard rules** (these mirror the building-native-ui Code Style — honor them, don't relitigate):

- **`app/` holds routes only.** Never co-locate components, hooks, types, or utilities under `app/`. A loose `app/Button.tsx` is an anti-pattern — it becomes a route. Components live in `components/`, `src/`, or a feature folder *outside* `app/`.
- **Route files are kebab-case.** `comment-card.tsx`, `edit-profile.tsx`. No PascalCase, no spaces, no special characters. (PascalCase is for the *component export*, kebab for the *file*.)
- **`_layout.tsx` defines the navigator** at each level — a `Stack`, `NativeTabs`, or a custom shell. Every routable folder that needs chrome gets one.
- **Always have a route matching `/`.** It may live inside a group (e.g. `app/(tabs)/index.tsx`).
- **Groups `(name)` organize without adding a URL segment.** `app/(tabs)/` groups the tab screens but `(tabs)` never appears in the path. Use them to attach a shared layout (the tab bar) to a set of screens.
- **Dynamic segments are `[id].tsx`**; catch-all is `[...rest].tsx`.
- **When you move a screen, delete the old route file.** Orphaned route files render as ghost routes.

A standard tabbed app:

```
app/
  _layout.tsx          # root: <NativeTabs /> (or a Stack wrapping tabs)
  (tabs)/
    _layout.tsx        # tab navigator definition
    index.tsx          # Home  → "/"
    search.tsx         # Search → "/search"
    library.tsx        # Library → "/library"
  item/
    [id].tsx           # detail pushed from any tab → "/item/123"
  compose.tsx          # presented as a modal (configured in a _layout)
```

For the deeper conventions — shared group routes so multiple tabs push the same screens, `segment`-driven titles, dynamic-route params — read `references/route-structure.md` in **building-native-ui**. Don't re-derive it here.

---

## Native tabs over JS tabs

Prefer **native tabs** (`expo-router/unstable-native-tabs` — `NativeTabs`, `Icon`, `Label`) over a hand-built JS tab bar. Native tabs get the platform's real tab-bar look, blur, haptics, large-title collapse, and iOS 26 liquid-glass behavior for free — and they read as *system-honest*, which is usually the right call.

```tsx
// app/_layout.tsx
import { NativeTabs, Icon, Label } from "expo-router/unstable-native-tabs";

export default function Layout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="(index)">
        <Icon sf="house" />
        <Label>Home</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(search)" role="search" />
    </NativeTabs>
  );
}
```

Build a **custom** tab bar only when the brand direction explicitly calls for the floating glass pill (below) and native tabs can't express it. That is a deliberate divergence from system-honest — make it on purpose, not by reflex. The full native-tabs API, JS-tab migration, and iOS 26 features live in `references/tabs.md` in **building-native-ui**.

### Tab count & labeling

- **3–5 tabs.** Two → use a segmented control on one screen instead. Six+ → collapse the tail into a "More" list or rethink the IA; a crowded tab bar has ~9pt of unreachable touch target per item.
- **Always label.** Icon-only tab bars fail the "what is this" test and tank accessibility. A one-word noun under each icon (`Home`, not `Dashboard Overview`).
- **One icon system, one fill state** across the bar — don't mix one filled and one outline glyph (see craft.md AR-T / icon weight rule). SF Symbols on iOS, Material Symbols on Android — see [platform-conventions.md](platform-conventions.md).
- The selected tab is the only filled/tinted one; the rest are the neutral resting weight.

---

## The floating glass tab bar

A 90%-width glass pill hovering above the home indicator is a signature *iOS-modern glass* pattern (Linear, Things). It is a **custom** tab bar — you are leaving native tabs behind, so own the consequences:

- It's the floating tab-bar recipe from [glass-and-depth.md](glass-and-depth.md): blur + tinted fill + 0.5px inner-glow border + soft ambient shadow. A `BlurView` with only one of those three layers is the incomplete-glass tell (AR-T25) — all three or none.
- Blur intensity is **higher** than a card and **platform-asymmetric**: roughly `intensity={Platform.select({ ios: 60, android: 32 })}` for the bar. A single bare `intensity` literal trips AR-T26.
- The active pill is a ~20% accent-tint background; tint its shadow toward the accent **on iOS only** — Android elevation can't be tinted (AR-T21).
- It sits **6–14dp above the home indicator** — compute that from `useSafeAreaInsets().bottom`, never a magic number (AR-T28). The bar is part of the safe-area layout, not floating over it.

Reserve this for apps whose whole aesthetic is glass. On a system-honest app it reads as decoration — use native tabs.

---

## Back affordance & gesture navigation

Honor each platform's back model; don't unify it (this is the kind of thing [platform-conventions.md](platform-conventions.md) says to leave native):

- **iOS** — a back chevron + (optionally minimal) previous-screen title at the leading edge of the nav bar, plus the **edge-swipe-from-left** interactive pop gesture. Never disable the swipe-back on a pushed screen; users rely on it one-handed. Don't add a custom "Back" text button — let the stack header own it (`headerBackButtonDisplayMode: "minimal"`).
- **Android** — the **system back** (gesture or button) is the primary affordance and must pop the stack predictably; it also dismisses sheets and modals. Don't draw a redundant top-left back arrow that competes with system back, and never intercept hardware/gesture back to do something surprising.
- **Modals & sheets** — provide an explicit dismiss (Cancel/Done, or a grabber on a detent sheet) *in addition to* gesture/swipe-down. A sheet with no visible grabber leaves users unsure it's dismissible.

Let the Expo Router `Stack` header manage titles and the back button rather than rendering your own — `building-native-ui` covers the header/toolbar API in `references/toolbar-and-headers.md`.

---

## Deep links & URL structure

Expo Router gives every screen a URL for free — design it like a real URL space, because it powers deep links, share targets, and web export:

- Set a single `scheme` in `app.json` (`myapp://`); the file tree defines the paths.
- **Nouns and IDs, kebab-case**: `myapp://item/123`, `myapp://settings/notifications`. Mirror the `app/` tree so the link map is obvious.
- Dynamic data through `[id]` params, not query strings, for primary navigation. Query params are for optional filters/state.
- Every deep-linkable screen must render correctly **cold** — launched directly with no parent in the stack. Test that a pushed detail still has a sane back target (Expo Router synthesizes one, but verify the title reads right).
- Keep the path **stable** — a deep link is a contract. Renaming a route file silently breaks shared links and push-notification targets.

---

## Cross-references

- [platform-conventions.md](platform-conventions.md) — iOS vs Android navigation chrome, modality, and back behavior side-by-side, plus the honor-vs-unify decision.
- [glass-and-depth.md](glass-and-depth.md) — the glass-card and floating tab-bar recipe used by the floating tab pattern above.
- [cross-platform-parity.md](cross-platform-parity.md) — where the same nav code renders differently per platform.
- **building-native-ui** skill — the implementation home for everything here: `route-structure.md`, `tabs.md`, `form-sheet.md`, `toolbar-and-headers.md`, `visual-effects.md`. tactile decides the IA; that skill builds it.
