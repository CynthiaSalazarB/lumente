# Mobile Spacing & Layout

The mobile spacing system — the 4/8pt grid, a token scale, the canonical breath numbers and why they're load-bearing, `gap`-driven flex layout, the bento pattern, and visual rhythm. SKILL.md states the always-apply rules inline; this is the deeper material those pointers reference.

## The 4/8pt grid

Every padding, gap, margin, height, and radius is a multiple of 4 — preferably 8. A random `13px` gap is the clearest tell that someone *eyeballed* a layout instead of *designing* it (`AR-T10` fails any spacing literal where `value % 4 != 0`). The grid isn't pedantry: when everything snaps to the same lattice, edges align across unrelated components for free, and the screen reads as one system rather than a pile of one-off decisions.

8pt is the primary step; 4pt is the half-step for tight, intentional cases (icon-to-label, a chip's inner padding). Below 4 you're in hairline territory (borders) — that's fine, it's not spacing.

## A spacing-token scale

Never write raw pixel spacing in screen code (`AR-T11`, advisory). Define the scale once, name the steps by *intent*, and reference tokens everywhere:

```tsx
// theme/space.ts
export const s = {
  xs:       4,    // icon↔label, chip inner
  sm:       8,    // related items in a group
  md:       12,   // card-padding floor — never go below this
  base:     16,   // default internal padding
  glassPad: 20,   // internal padding for glass cards
  gutter:   24,   // page horizontal gutter (canonical)
  lg:       32,   // large card / between cards
  stackLg:  40,   // breath between distinct vertical sections
  xl:       56,   // hero offset
} as const;
```

Named-by-intent tokens make the layout self-documenting: `paddingHorizontal: s.gutter` says *"this is the page gutter"*, where `paddingHorizontal: 24` says nothing. When a designer says "tighten the section breath," you change `stackLg` in one place and the whole app responds.

## The canonical numbers — and why compressing them kills quality

These four are the load-bearing spacing values on almost every mobile screen:

| Token | Value | Role |
|-------|-------|------|
| `s.gutter` | **24** | page horizontal gutter (20 acceptable; below 16 is cramped) |
| `s.stackLg` | **40** | breath between distinct vertical *sections* |
| `s.glassPad` | **20** | internal padding for glass cards |
| `s.md` | **12** | the card-padding *floor* — text any closer to a card edge reads as broken |

**Why you must not compress them.** The reflex under "fit more content" is to shave each by ~30% — gutter 24→16, section 40→28, card-pad 20→14. That single move is the most common quality killer in AI-generated mobile UI. Here's the mechanism:

- **The 40pt section breath is what tells the eye "different topic."** Drop it to 28 and two unrelated sections read as one continuous list — the information architecture collapses visually even though the data is correct.
- **The 24pt gutter is what makes content feel *placed* rather than *crammed against the bezel*.** At 16 the screen feels like a budget app; at 24 it feels considered. The difference is felt before it's noticed.
- **Below the 12pt card floor, text touches the card edge** and every card reads as a rendering bug.

Mobile screens are small, but the fix for "not enough room" is *fewer things on the screen*, never *less space between them*. Compressing the breath to cram in more content trades the one thing that signals quality for the one thing that signals slop. CHECKLIST.md items 11–13 are the review-time version of this table.

## `gap` over margins

Use `gap` on the flex parent for spacing *between* siblings — not `margin` on each child. `gap` is declared once, can't double up at boundaries, and survives reordering or conditional children without leaving an orphaned margin.

```tsx
// WRONG — margins on children: doubles at the seam, breaks when a child is conditional
<View>
  <Card style={{ marginBottom: s.sm }} />
  <Card style={{ marginBottom: s.sm }} />
</View>

// RIGHT — gap on the parent
<View style={{ gap: s.sm }}>
  <Card />
  <Card />
</View>
```

Reserve `margin` for offsetting an element from its *parent's* edge in a way padding can't express; use `padding` for internal space and `gap` for between-sibling space.

## RN flex/gap row layout

The single most common row-layout bug (PITFALLS #12, `AR-T13`): mixing `flexDirection: 'row'` with percentage widths on the children. Percentage widths don't account for the `gap`, so three "33%" cards plus two gaps overflow the row — or one ends up visibly wider.

```tsx
// WRONG — percentage widths on row siblings overflow once gap is added
<View style={{ flexDirection: 'row', gap: s.md }}>
  <View style={{ width: '33%' }} />
  <View style={{ width: '33%' }} />
  <View style={{ width: '33%' }} />
</View>

// RIGHT — flex:1 children share the leftover space AFTER the gap is subtracted
<View style={{ flexDirection: 'row', gap: s.md }}>
  <View style={{ flex: 1 }} />
  <View style={{ flex: 1 }} />
  <View style={{ flex: 1 }} />
</View>
```

`flex: 1` on each child means "split whatever remains after gaps equally" — it's gap-aware by construction. `AR-T13` greps for `width: '<n>%'` on row siblings; confirm the parent is `flexDirection: 'row'` before rewriting (a percentage width is fine in a column).

## The 2-column bento pattern

For an asymmetric tile grid that wraps, don't fight it with fixed widths — use `flexWrap` + a `minWidth` floor so tiles reflow on narrow phones and large phones alike:

```tsx
<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: s.md }}>
  {tiles.map((t) => (
    <View key={t.id} style={{ flexGrow: 1, flexBasis: '47%', minWidth: 150 }}>
      {/* tile content */}
    </View>
  ))}
</View>
```

- `flexBasis: '47%'` (not 50%) leaves room for the `gap` between two columns — two tiles sit side by side, the rest wrap.
- `minWidth: 150` is the floor below which a tile would be unusably narrow; on a very small phone it forces a single column instead of squeezing two.
- `flexGrow: 1` lets a lone trailing tile expand to fill its row rather than sitting half-width.

This is the gap-aware analogue of a CSS grid; it's what a Fasting-Tracker-style `bentoGrid` uses.

## Visual rhythm via varied spacing

Don't apply the same padding everywhere — uniform spacing reads as flat and machine-stamped. Hierarchy and rhythm come from *varying* the space:

- **Tight inside a group, generous between groups.** Items that belong together get `s.sm` (8); the boundary to the next topic gets `s.stackLg` (40). The contrast — not any single value — is what the eye reads as structure.
- **The proximity principle:** elements close together are perceived as related; elements far apart as separate. Spacing *is* grouping. A label sitting `s.xs` (4) above its value belongs to it; the same label `s.base` (16) away floats free.

```tsx
<View style={{ gap: s.stackLg }}>{/* 40 between sections */}
  <View style={{ gap: s.sm }}>{/* 8 within a section's items */}
    <Text style={type.label}>Today's intake</Text>
    <Text style={type.display}>1,840 ml</Text>{/* label hugs its number */}
  </View>
  <View style={{ gap: s.sm }}>{/* next section, also tight internally */}
    ...
  </View>
</View>
```

The same idea drives radii: a consistent corner system is spatial rhythm at the component scale. Snap radii to the grid too — inputs/chips 12, standard cards 18–22, large feature cards 26–32, pills 999. A card with a `13` radius is the same eyeballed tell as a `13` gap. Keep nested radii concentric: an inner element inside a 22-radius card with 12 padding wants ~`10` (outer minus padding), or the corners fight.

## One hero per screen

Spacing serves focus. Give the screen **one** clear hero — the element the eye lands on first without thinking — and let space frame it (CHECKLIST.md item 1, SKILL.md `<spatial_rules>`). Two elements competing for "biggest + most space" means *no* hero and a screen with no center of gravity. The most saturated, most-spaced, largest element should be the one thing the screen is *for* (and, per [mobile-color.md](mobile-color.md), the primary action is the most saturated). Surround the hero with more breath than anything else on the screen; that breath is what makes it read as primary.

Related: don't wrap everything in cards or nest cards in cards. Flatten with spacing, type, and dividers instead — a section separated by `s.stackLg` doesn't *need* a card border to read as distinct.

## List & scroll spacing

Spacing inside a scroll container goes on `contentContainerStyle`, not `style`. `style` sizes the scroll *viewport*; `contentContainerStyle` pads the *content* — putting padding on `style` clips rows at the edges instead of insetting them.

```tsx
<FlatList
  data={items}
  contentContainerStyle={{
    paddingHorizontal: s.gutter,           // gutter applies to the rows, not the viewport
    paddingTop: s.base,
    paddingBottom: insets.bottom + s.stackLg, // clear the home indicator AND a floating tab bar
    gap: s.sm,                             // RN 0.71+ supports gap on the content container
  }}
  ItemSeparatorComponent={() => <View style={{ height: s.sm }} />} // pre-gap fallback
  showsVerticalScrollIndicator={false}
/>
```

Two things that bite:
- **Bottom padding must clear the home indicator *and* any floating/translucent chrome.** `insets.bottom + s.stackLg` keeps the last row from hiding under a glass tab bar — see [safe-area-and-devices.md](safe-area-and-devices.md). A list that ends exactly at the tab bar always looks like a bug.
- Prefer `gap` on the content container (RN 0.71+) over per-row `marginBottom`; fall back to `ItemSeparatorComponent` only on older RN, since it doesn't add a trailing gap (which is usually what you want anyway).

## See also

- [mobile-typography.md](mobile-typography.md) — type tiers and the weight/color hierarchy that spacing reinforces (`AR-T14`–`AR-T19`).
- [mobile-color.md](mobile-color.md) — tokens for color mirror tokens for space (`AR-T05`–`AR-T09`).
- **mobile-app-design (SK-126)** `CHECKLIST.md` items 11–13 (spacing) and `RN_PITFALLS.md` #12 (row layout) — the review-time and translation-trap versions.
