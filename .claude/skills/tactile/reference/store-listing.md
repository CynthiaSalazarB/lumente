# Store Listing

Purpose: the storefront — screenshots, preview video, icon, and the fields around them. This is the mobile answer to web's SEO layer: the surface that decides whether anyone ever opens the app you spent a month designing. A beautiful app with a bad listing is an app nobody installs.

**Scope.** The *submission blockers* (bundle identifiers, permission strings, version strategy, the 30-character name cap) are mechanical and belong to `app-preflight.mjs` and § A0 of `ship-verify` — run those, don't restate them. The *voice* of any string here is [mobile-copy.md](mobile-copy.md). This page is what the assets should be and how to produce them.

> **Every number below was verified on 2026-08-13 against the primary source linked beside it. Re-verify before a submission** — Apple revises accepted sizes with each hardware generation and Play revises its asset rules independently. The whole point of citing the source inline is that you can re-check in one click rather than trusting a page that has aged.

## The first screenshots carry the decision

Apple is explicit about what a searcher actually sees:

> *"Depending on the orientation of your screenshots, the first one to three images will appear in search results when no app preview is available, so make sure these highlight the essence of your app."*
> — [Creating Your Product Page](https://developer.apple.com/app-store/product-page/)

So the listing has two audiences and they are not the same person. **Screenshots 1–3 are the advertisement**, seen by someone scrolling a results list who has not decided anything. **Screenshots 4–10 are the brochure**, seen only by someone already interested. Apple's own guidance for the rest: *"Focus each subsequent screenshot on a main benefit or feature so that you fully convey your app's value."*

Practical consequences:

- **Lead with the outcome, not the interface.** The first frame answers "what do I get", not "what does the app look like". A screenshot of an empty dashboard is a screenshot of nothing.
- **Caption them.** A bare device frame at search-result size is unreadable; a short overlaid line is the only text that survives the scale-down. Keep it to a phrase — this is [mobile-copy.md](mobile-copy.md)'s container rule again, at its most brutal.
- **One idea per screenshot.** Ten screenshots showing one feature each beats three showing everything.
- **Order by decreasing persuasiveness**, not by app navigation order. The store is not a tour.

## Preview video

Apple: up to **3 app previews** per product page, and — *"App previews autoplay with muted audio when users view your product page, so make sure the first few seconds of your video are visually compelling"* ([product page docs](https://developer.apple.com/app-store/product-page/)).

Play: **one preview video** per listing, must be public or unlisted with ads disabled and no age restriction, and **autoplays up to 30 seconds** ([Play Console Help](https://support.google.com/googleplay/android-developer/answer/9866151)).

Both autoplay muted. Design for that: no voiceover carrying the message, no title card burning the first two seconds, motion in frame one. Produce it with **hyperframes (SK-143)** — deterministic HTML/CSS/GSAP → MP4, headless, no keys — feeding it real device captures rather than mockups.

**Capture the motion with the device, not a mockup tool.** `mcp__mobile__mobile_start_screen_recording` → drive the flow with the ordinary tap/swipe/type tools → `mobile_stop_screen_recording`. That recording is the raw material hyperframes composes; a preview built from static frames and animated afterwards shows transitions the app does not actually have, which is the fastest way to make a listing dishonest. Record the flow you would demo to a person, then cut — do not perform features in an order no user would.

## The asset specs, and the asymmetry that catches people

| | Apple App Store | Google Play |
|---|---|---|
| Store icon | 1024×1024, **no alpha** | 512×512, **32-bit PNG *with* alpha**, ≤1024KB |
| Feature graphic | — (no equivalent) | **1024×500**, JPEG or 24-bit PNG, no alpha |
| Screenshots | 1–10 per size; `.jpeg`/`.jpg`/`.png`; *"Images can't include alpha channels or transparencies"* | min **2** across device types; 320–3840px with max ≤ 2× min; recommended **≥4 at ≥1080px**, 16:9 or 9:16 |
| Required size | **iPhone 6.9″ — 1320×2868 portrait.** iPad 13″ (2064×2752) required if the app runs on iPad | no fixed pixel size |
| Smaller sizes | auto-scaled: *"If screenshots with the accepted sizes aren't provided, scaled screenshots for 6.9″ displays are used"* | n/a |
| Video | up to 3 app previews | 1 video, public/unlisted, ads off |

Sources: Apple [screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/); Play [store listing assets](https://support.google.com/googleplay/android-developer/answer/9866151). Both checked 2026-08-13.

**The two traps in that table:**

1. **Alpha is required in one place and forbidden in another.** Play's icon is 32-bit PNG *with* alpha; Apple's screenshots must have *none*. Exporting one set of assets with one setting breaks one of the two stores, and the rejection message rarely says "alpha".
2. **You only need the largest iPhone size.** Apple scales down from the 6.9″ set, so producing every historical device size is wasted work. Produce 6.9″ (plus 13″ iPad if you ship for iPad) and stop. Note this is the opposite of the in-app rule — [mobile-option-boards.md](mobile-option-boards.md) insists you *design* on the compact class, because that is where layouts break; you just don't have to *ship listing assets* for it.

## Producing the assets

1. **Capture real frames, not mockups.** `node ~/.claude/skills/tactile/scripts/device-shot.mjs shot-1.png --package <app.id>` — it also proves the app was actually in the foreground, which matters more here than anywhere else, since a listing screenshot of a crashed launcher is a public artifact.
2. **Compose the caption + frame** in a plain HTML board and render it with `shot.mjs` at the required pixel size (`--viewport`), the same mechanism as [mobile-option-boards.md](mobile-option-boards.md). No design tool required, and it is reproducible when the copy changes.
3. **Strip alpha for Apple.** Verify before upload; the export default in most tools keeps it.
4. **Check the field lengths** — name ≤30 on both stores (enforced by `app-preflight.mjs` § store-name), Apple subtitle ≤30, Play short description ≤80.

## What ASO is not

It is not keyword stuffing the title, and it is not a different app than the one you built. The listing's job is to be an honest, well-argued version of the actual product — a listing that oversells produces installs that uninstall, which both stores measure. If the screenshots are more exciting than the app, fix the app.

## Cross-references

- Mechanical submission blockers: `app-preflight.mjs`, and § A0 in `ship-verify` (SK-128)
- Guideline-level rejection patterns: `app-store-review` (SK-135)
- Voice and length of every string here: [mobile-copy.md](mobile-copy.md)
- Capturing real device frames: [platform-verification.md](platform-verification.md)
- The rendering mechanism reused for caption composition: [mobile-option-boards.md](mobile-option-boards.md)
- Icon and splash inside the app (a different asset from the store icon): [imagery-and-icons.md](imagery-and-icons.md)
