# Mobile Option Boards — screen variations Leo can point at

Purpose: the device-frame form of the option board, for the exploration mode where the right move is to put **several** built screens in front of Leo and let him mix and match. Use during shape/craft, never as the shipped artifact.

**This page inherits the protocol; it does not restate it.** The board protocol — stable `{turn}{letter}` ids, newest turn on top, ids permanent and never reused, every id reference a link, a `.dv-next` follow-up line — lives in [option-boards.md](../../impeccable/reference/option-boards.md) and is identical here. Read it first. What follows is only what a phone changes.

## What mobile changes: real size becomes affordable

On the web a board is a compromise — a 1440px design shown at 360px wide is a thumbnail, and you argue about things the thumbnail invented. A phone screen is ~390pt wide, so **device frames sit side by side at true logical size, unscaled.** The board stops being a preview of the design and becomes the design.

**Do the arithmetic before promising three across.** Three standard frames plus the board's gaps and padding need roughly `3×393 + 2×28 + 88 ≈ 1330px`; the default `shot.mjs` viewport is 1280, so the third wraps to a second row. Either render wider — `--viewport 1400x1200` — or put two options per turn. (This paragraph exists because the first draft claimed three-across and the render proved otherwise.)

That changes the stance in two ways:

1. **Never scale a frame.** No `transform: scale()`, no `zoom`, no "it's roughly right". The whole advantage is that the type size, the touch targets, and the line breaks on the board are the ones the user will get. A scaled frame quietly lies about all three.
2. **Show fewer, more finished options.** Because each option is a real screen at real size, three fully-built variants beat six sketches. A half-filled frame reads as unfinished, not as schematic — [imagery-and-icons.md](imagery-and-icons.md)'s rule applies: empty-but-honest beats generic-but-filled.

## Frame sizing: read it off the device, don't look it up

Logical point sizes drift with every hardware generation, and the tables that list them go stale quietly. Take the number from the target instead:

- `node ~/.claude/skills/tactile/scripts/device-shot.mjs frame.png` prints the real screen size of the connected device and verifies the capture matches it.
- Or `adb shell wm size` directly.

Then set it once as a CSS variable. Two anchors worth knowing: the **compact class is 375×667pt** (the iPhone SE / iPhone 7 lineage — [Apple developer forums](https://developer.apple.com/forums/thread/76113), checked 2026-08-13), and it is the class that breaks layouts, so a board that only shows the standard class has not tested anything. Current-generation devices sit around 390–430pt wide; confirm rather than assume.

**Always include one compact frame in the board.** If the design only works at 393pt, it does not work.

## Frame skeleton

Board chrome stays neutral — the frame is furniture, the screen inside it is the design. The bezel exists to establish scale and to place the safe-area chrome honestly, nothing more.

```html
<style>
  /* one place to change the class you're designing for */
  .mf { --w: 393px; --h: 852px; --top-inset: 59px; --bottom-inset: 34px; }
  .mf.compact { --w: 375px; --h: 667px; --top-inset: 20px; --bottom-inset: 0px; }

  .mf-frame {
    width: var(--w); height: var(--h); flex: none;
    border-radius: 44px; padding: 0; overflow: hidden;
    background: #000; box-shadow: 0 0 0 10px #1a1a1a, 0 8px 28px rgba(0,0,0,.28);
    position: relative;
  }
  .mf.compact .mf-frame { border-radius: 22px; }
  .mf-screen { width: 100%; height: 100%; overflow: hidden; position: relative; }

  /* Safe-area chrome, drawn so the design cannot quietly ignore it.
     These mirror the real insets — see safe-area-and-devices.md. */
  .mf-safe-top    { position:absolute; inset:0 0 auto 0; height: var(--top-inset); pointer-events:none; }
  .mf-safe-bottom { position:absolute; inset:auto 0 0 0; height: var(--bottom-inset); pointer-events:none; }
  .mf-indicator {
    position:absolute; left:50%; bottom:8px; transform:translateX(-50%);
    width:134px; height:5px; border-radius:3px; background: currentColor; opacity:.35;
  }
</style>

<div class="mf">
  <div class="mf-frame">
    <div class="mf-screen">
      <!-- the option's real screen: real tokens, real copy, one archetype -->
      <div class="mf-safe-top"></div>
      <div class="mf-safe-bottom"><span class="mf-indicator"></span></div>
    </div>
  </div>
</div>
```

Wrap each frame in the `.dv-opt` / `.dv-oid` structure from the inherited protocol so `#2a` still scrolls one option into view.

## Show light and dark together

Mobile's default is `userInterfaceStyle: "automatic"` — half the users will see the dark register, and `app-preflight.mjs` warns when a project opts out of it. So a board with only light frames has reviewed half the design. Pair them: same option id, two frames side by side, labelled `2a light` / `2a dark`. If a variant only survives in one register, that is the finding, and it belongs on the board rather than in a later surprise.

## What goes inside the frame

- **One archetype per option**, named — see [screen-archetypes.md](screen-archetypes.md). "Dashboard vs Feed for the home tab" is a board worth building; "three shades of the same dashboard" usually is not.
- **Real copy**, budgeted to the container — [mobile-copy.md](mobile-copy.md). Lorem ipsum in a frame produces a layout that collapses the moment real words arrive, and it is an AR-T31 BLOCK anyway.
- **Real tokens** from the project's palette, not board-local colours. If the option needs a colour the palette lacks, that is a token decision to surface, not to invent inline.
- **The states that matter**, if the variants differ there — an empty feed and a full one are two different designs wearing one name.

## Showing it

Write the board to the scratchpad for throwaway exploration, or the project for one that will be revisited. Then capture it headlessly rather than through the Browser pane:

```bash
node ~/.claude/skills/impeccable/scripts/shot.mjs board.html board.png --viewport 1400x1200
```

`shot.mjs` takes a bare file path, needs no dev server and no pane, and exits 1 when the page is mechanically broken — which on a board almost always means a frame collapsed and the option is not actually showing. Send Leo the PNG and the file.

## Exit condition

The board's job is done when Leo names one option (or one mix) to build. Then stop boarding and go to [craft.md](craft.md) step 3 — the board is exploration scaffolding, never the deliverable, and continuing to riff after the decision is made is how a build loses a week.

## Cross-references

- The protocol this page inherits: [option-boards.md](../../impeccable/reference/option-boards.md)
- Which shape each option should take: [screen-archetypes.md](screen-archetypes.md)
- The insets the frame draws: [safe-area-and-devices.md](safe-area-and-devices.md)
- The words inside the frame: [mobile-copy.md](mobile-copy.md)
- Where this sits in the build: [craft.md](craft.md)
