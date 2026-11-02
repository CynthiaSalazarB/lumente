# Platform Verification

How to get RENDERED proof that a screen actually looks and behaves right on the thing it ships to — tactile's analogue of impeccable's cross-browser verification, retargeted to iOS and Android frames, and (rung 4) to Tauri desktop windows. This is the concrete procedure that [craft.md](craft.md) Step 4b runs, immediately after the deterministic audit ([audit-rules.md](audit-rules.md), Step 4a).

A grep sheet and a glance at `expo start` are blind to how a screen *renders*. Verification means a screenshot from a real frame, on the platforms your parity policy demands, on a build that renders the way production renders.

---

## The single most important principle: dev ≠ release

**Blur, shadow/elevation, font fallbacks, and remote-image ATS rules only render *truly* in a release build.** This is PITFALLS #15, and it is the principle this whole page exists to enforce. "It looked fine in `expo start`" is not verification — dev-mode rendering diverges from release, especially on Android, in exactly the four areas most likely to be the thing you just changed:

- **BlurView intensity** — release renders the real native blur (`UIVisualEffectView` on iOS; the Dimezis BlurView library on Android, and only when `blurMethod` is set — default `'none'`); dev sometimes shows a flat gray panel. A glass card ([AR-T25](audit-rules.md#e--platform-fidelity--rn-translation)) can only be confirmed in release.
- **Shadow / elevation** — release applies Android `elevation` correctly; dev sometimes drops it, so [AR-T20](audit-rules.md#e--platform-fidelity--rn-translation) (shadow-without-elevation) hides in dev.
- **Font fallbacks** — release fails *harder* if a face isn't bundled; a font that silently falls back to system in dev exposes the gap only in the build.
- **Remote images** — release respects ATS (iOS HTTPS-only) and Android cleartext rules; an image that loads in dev can vanish in release (PITFALLS #13).

**The rule:** if you changed a **blur intensity, a shadow/elevation, a font weight, or an image source**, you verify on a **release-style build** — not `expo start`. The dev-server check answers "does the layout work?"; the release check answers "does it actually look right?" Both are required.

---

## The tooling ladder

Reach for the lightest tool that gives real rendered proof for the question at hand.

### 1. mobile MCP (`mcp__mobile__*`) — the primary device tool

Drive a real simulator/emulator: list devices, launch the app, screenshot, tap, read elements. This is the default for "show me the screen on a device frame."

- `mcp__mobile__mobile_list_available_devices` → pick the simulator/emulator
- `mcp__mobile__mobile_launch_app` → bring the app up
- `mcp__mobile__mobile_take_screenshot` / `mcp__mobile__mobile_save_screenshot` → the rendered frame (the actual proof)
- `mcp__mobile__mobile_list_elements_on_screen` → confirm structure and labels (also a fast a11y check)
- `mcp__mobile__mobile_click_on_screen_at_coordinates` / `mobile_swipe_on_screen` → tap a control or pull a sheet, then re-screenshot to confirm the resulting state
- `mcp__mobile__mobile_install_app` + `mobile_type_keys` → the two verbs a real flow needs beyond tapping: get the build onto the device, and fill a field. **The `e2e-testing` skill was archived in v10 precisely because device flows run through this MCP** — so these are the e2e vocabulary, not extras.
- `mcp__mobile__mobile_set_orientation` / `mobile_get_orientation` → rotate and re-screenshot. This is the **only** way to exercise the orientation decision [safe-area-and-devices.md](safe-area-and-devices.md) demands you make deliberately.
- `mcp__mobile__mobile_list_crashes` / `mobile_get_crash` → read crashes off the device. `device-shot.mjs` already checks the Android crash buffer through `adb logcat -b crash`, but **`adb` does not exist on iOS** — these tools do, which makes them the crash check for the platform the script cannot reach. Distinct from the *post-release* crash-rate gate in [[stack]] § Android vitals: that is field data from real users, this is what just happened on the device in front of you.
- `mcp__mobile__mobile_start_screen_recording` / `mobile_stop_screen_recording` → capture **motion**, not a frame. See [store-listing.md](store-listing.md) for its main use.

Use it to confirm touch-target geometry by *tapping* (not measuring source), to screenshot each edge-case state from [state-patterns.md](state-patterns.md), and to walk press feedback.

### 2. Browser preview (`mcp__Claude_Browser__*`) — web-target / quick layout

For the **web target** of an Expo app, or a fast layout/spacing sanity check before booting a simulator: `preview_start` → `computer` (`action:"screenshot"`). It is *not* a substitute for a device frame — `BlurView` is a no-op on web, shadows differ, and platform fonts fall back — so never confirm a blur/shadow/native-font rule here. Layout rhythm and copy presence, yes; native rendering fidelity, no.

### 3. e2e-testing (SK-027) / Maestro — multi-step flows

When verification spans more than one screen — onboarding → permission prime → first action, or a form submit → success → list reconciliation — drive it with the **e2e-testing skill (SK-027)**, which runs **Maestro** across platforms with natural-language assertions ("tap Allow, see the empty state replaced by one card"). Use it for the flows that a single screenshot can't prove, and to assert optimistic-UI reconciliation actually lands.

### 4. tauri-mcp (`mcp__tauri-mcp__*`) — Tauri **desktop** apps

Rungs 1–3 are iOS/Android. A Tauri desktop build is proven through a different MCP, and the mobile habits transfer — a frame, an element tree, a log surface — but the names and two of the semantics differ. **Every tool named on this rung was executed against a running Tauri v2 app (2026-08-13, `tauri.version` 2.11.5) — 18 of the 20, with the two exceptions called out by name and reason.** Where a tool did not behave as its own description claims, the measured behaviour is what is written here.

**Prerequisite: the app must be wired for it, and the scaffold is not.** These tools talk to `tauri-plugin-mcp-bridge`, a debug-only crate compiled into the app — so a stock `npm create tauri-app` project cannot be driven at all until you add it. Four edits under `src-tauri/` (run `get_setup_instructions` for the authoritative current text):

| File | Edit |
|---|---|
| `Cargo.toml` | `tauri-plugin-mcp-bridge = "0.12"` |
| `src/lib.rs` | register the plugin inside `#[cfg(debug_assertions)]` |
| `tauri.conf.json` | `"withGlobalTauri": true` in `app` — **without it the bridge cannot reach the webview** |
| `capabilities/default.json` | add `"mcp-bridge:default"` |

**Bind it to loopback:** `Builder::new().bind_address("127.0.0.1").build()`. The plugin defaults to **`0.0.0.0:9223`** — a socket that can screenshot the app and execute JS in it, offered to the whole local network. Debug-only either way, but not a default worth inheriting. (`app-preflight.mjs` passes either way; its `tauri-capabilities` check reads permissions, not bind address.)

Then `npm run tauri dev`, and:

- `driver_session {action:"start"}` → **required before every other tool on this rung.** Returns e.g. `Session started with app: Tauri App (localhost:9223)`. `{action:"status"}` before starting reports `{"connected":false,…}` — that is the honest "no app is running" signal, not an error. First compile of a fresh Tauri app is slow (~85s here, after `cargo fetch`); wait on the port, not on a guess.
- `webview_screenshot` → the rendered frame — **the actual proof**. Pass `filePath` to save a PNG instead of returning base64. Captures the **visible viewport only**, so it is the webview client area, not the window.
- `webview_dom_snapshot {type:"accessibility"}` → **the desktop analogue of `mobile_list_elements_on_screen`.** Returns roles, names, states and `[ref=eN]` handles you can feed straight back into the interaction tools. This is the AR-T04 confirmation on desktop: it announced the scaffold's own input as `textbox Enter a name...` — an accessible name sourced from the placeholder, with no `<label>` and no `aria-label` anywhere in the markup. **The official Tauri scaffold ships that defect**, and only a snapshot of a *running* app surfaces it.
- `webview_dom_snapshot {type:"structure"}` → tags, ids and classes instead of semantics. Use `selector` (CSS by default; `xpath` and `text` via `strategy`) to scope to a subtree when the whole document is noise.
- `read_logs {source:"console"}` → the runtime error surface (webview JS). `"system"` for desktop-level logs; `"android"` / `"ios"` exist for Tauri **mobile**. Bridge lines are prefixed `[MCP][BRIDGE]`, so filter them out when reading app output.
- `manage_window` → `list` (labels, titles, URLs, visibility), `info` (size, position, focus), `resize`. The desktop-only rung of the ladder: mobile has no window to size.
- `webview_interact {action:"click"}` + `webview_keyboard {action:"type"}` → the two verbs a real flow needs, matching `mobile_click_on_screen_at_coordinates` + `mobile_type_keys`. Type into a field, click, then re-snapshot to confirm the resulting state — the same tap-then-re-screenshot loop as rung 1. `webview_interact` also does `double-click`, `long-press`, `scroll`, `swipe`, `focus`.

**Three tools, three coordinate spaces — measured, and nothing warns you.** On a 125%-scaled display, an 800×600 window declared in `tauri.conf.json` reports as:

| Surface | Value | Space |
|---|---|---|
| `tauri.conf.json` | 800×600 | logical |
| `manage_window resize` **input** | 900×700 (`logical:true`, the default) | logical |
| `webview_screenshot` **output** | 1125×875 | physical, **viewport only** |
| `manage_window info` **output** | 1143×922 | physical, **outer window incl. decorations** |

So `info` will never equal what you passed to `resize`, and a screenshot's pixel dimensions are neither. Compare like with like before calling a size wrong.

**`ipc_execute_command` does not do what its description implies — do not reach for it.** It is documented as "invoke Rust backend functions", but it rejected both an app-defined command and a core one: `greet` → `{"success":false,"error":"Unsupported Tauri command: greet"}`, and `plugin:app|version` → the same. The command was genuinely registered via `generate_handler![greet]` and works perfectly through the UI — clicking the button rendered *"Hello, ATLAS! You've been greeted from Rust!"*. **The limitation is the bridge's allowlist, not your app.** **Use this instead** — verified working, same command the tool refused:

```
webview_execute_js → (() => { window.__TAURI__.core.invoke('greet', {name:'x'})
                               .then(r => { window.__probe = r }); return 'sent' })()
```

then read `window.__probe` back with a second `webview_execute_js`. Returned *"Hello, via-global! You've been greeted from Rust!"*. Requires `withGlobalTauri: true` (already needed for the bridge). Driving the UI and reading the result back also works and proves more of the round-trip — prefer it when there is a control to click.

**`list_devices` is not a desktop tool.** It runs without a driver session, but it lists Android emulators and iOS simulators — it is for Tauri **mobile**. On a desktop-only host it correctly returns `None` for both; that is not a failure and not a desktop check.

**The rest of the surface, also executed (2026-08-13) — 8 work, 2 need you at the keyboard:**

| Tool | Verdict | What it actually returned |
|---|---|---|
| `ipc_get_backend_state` | ✅ | identifier, name, version, **`tauri.version` 2.11.5**, arch/os/family, window list — and **`debug: true`**, which is the fastest way to confirm you are *not* looking at a release build |
| `webview_execute_js` | ✅ | JSON round-trip; `window.__TAURI__` is present (keys incl. `core`, `event`, `window`, `path`, `menu`). **IIFE syntax is required** for a return value. Independently confirmed the DPI finding above: `devicePixelRatio` 1.25, `innerWidth/Height` 800×600 |
| `webview_find_element` | ✅ | the element's HTML — `<button type="submit">Greet</button>`, found via `strategy:"text"` |
| `webview_get_styles` | ✅ | computed CSS, filtered by property list. Returned `rgba(15, 15, 15, 0.596)` — **alpha-composited, so the same care `check-contrast.mjs` takes applies here** |
| `webview_wait_for` | ✅ | `Element found: button[type=submit]` |
| `ipc_emit_event` | ✅ | `Event 'atlas-ladder-probe' emitted successfully`. Emit path only — the scaffold has no listener, so delivery was not observed |
| `ipc_monitor` | ✅ | starts/stops cleanly — **but read the caveat below before trusting it** |
| `ipc_get_captured` | ⚠️ works, **with a trap** | see below |
| `webview_get_pointed_element` | 🙋 needs you | responds correctly with its precondition: *"No element has been pointed. Use Alt+Shift+Click on an element in the Tauri app first."* |
| `webview_select_element` | 🙋 needs you | **deliberately not run.** It activates a picker overlay and blocks up to 120s waiting for a human click — firing it at an unattended screen proves nothing. Both of these are collaboration tools: reach for them when Leo is watching and can point at the thing he means |

**The `ipc_monitor` trap, measured — it will silently miss your app's own IPC.** Monitoring was started, then the Greet button was clicked, and `greet` demonstrably ran (the greeting rendered). `ipc_get_captured` returned **only the bridge's own `plugin:mcp-bridge|script_result` traffic — the invoke was absent.** The same command called through `window.__TAURI__.core.invoke` *was* captured, in full:

```json
{"args":{"name":"via-global"},"command":"greet","duration_ms":4,
 "error":null,"result":"Hello, via-global! You've been greeted from Rust!"}
```

**So the monitor sees only IPC crossing the global bridge, and the default scaffold pattern — `import { invoke } from '@tauri-apps/api/core'`, bundled by Vite — bypasses it entirely.** An empty capture is therefore *not* evidence that your app made no IPC calls. Use it to inspect calls you make yourself through the global; do not use it to audit what the app does on its own.

**Desktop still owes the dev ≠ release check.** The principle at the top of this page is mobile-worded (blur, elevation, ATS) but the shape holds: the bridge is `#[cfg(debug_assertions)]`, so **the build you can drive with these tools is by definition not the build you ship.** A release Tauri binary has no bridge and cannot be inspected this way — verify behaviour in dev, then confirm the actual installer with ship-verify (SK-128) below.

---

## Capture BOTH iOS and Android when the policy is parity

If the brief's platform-parity policy is **strict parity**, every verified screen needs **both** an iOS and an Android frame, side by side. This is where the divergences the audit only *harvested* get confirmed:

- shadow vs elevation (AR-T20) — Android elevation is a fixed black drop shadow and can't be tinted (AR-T21)
- platform-asymmetric blur (AR-T26) — Android needs a higher `intensity`; confirm the glass doesn't read flat
- ripple vs opacity press feedback, SF Symbols vs Material Symbols, system font metrics

For iOS-first or Android-first policies, lead with the primary platform but still spot-check the other before claiming done — an iOS-tuned screen shipped to Android unchecked is the classic regression.

---

## design-check (SK-127): pre-flight the visual diff

When there's a **Figma / Stitch / screenshot reference**, run **design-check (SK-127)** *before* writing code — it diffs the current build against the reference and produces the concrete gap list (spacing, color, type, missing elements, dark-mode breaks) you get signed off on first. At the end of craft, re-screenshot and diff again to confirm the gaps closed. This front-loads the "match the design" work instead of discovering the mismatch at the end.

## ship-verify (SK-128): confirm the actual artifact

Never claim "shipped" on an `UP-TO-DATE` message or an exit-zero. When the task is a build or deploy, run **ship-verify (SK-128)**: confirm the **actual APK / IPA exists, has a fresh mtime, and is the correct variant** (release, right flavor, right version). A screenshot proves the screen renders; ship-verify proves the binary the user will install is the one you just built. Both are required before "done."

---

## The screen-reader walk (VoiceOver / TalkBack) — the procedure

`craft.md` Step 4c has always asked for "a VoiceOver / TalkBack walk of the primary flow" without saying how to do one, so it got skipped or faked. This is how.

### 1. The mechanical pass first — it needs no gestures and catches most of it

`mcp__mobile__mobile_list_elements_on_screen` returns the **accessibility tree**: the same labels and roles the screen reader will speak. Read that before touching a gesture, because it finds the common failures instantly and without skill:

- An interactive element with **no label**, or a label that is the icon's filename.
- A control whose role is generic (`button`) where the behaviour is a toggle, tab, or link — the role tells the user what will happen, so a wrong one is a lie.
- **State missing entirely** — selected, disabled and busy live in `accessibilityState`, and a screen reader cannot see your green pill (see [touch-and-interaction.md](touch-and-interaction.md)).

That is the **AR-T04** confirmation. Everything below is what the tree cannot tell you.

### 2. Turn the reader on

- **iOS** — Settings → Accessibility → VoiceOver, or **triple-click the side button** (Home button on older devices). Set that shortcut first; you will want to turn it off in a hurry. ([Apple Support](https://support.apple.com/guide/iphone/turn-on-and-practice-voiceover-iph3e2e415f/ios), [Accessibility Shortcut](https://support.apple.com/en-us/111771))
- **Android** — enable TalkBack in Accessibility settings. ([Android Accessibility Help](https://support.google.com/accessibility/android/answer/6151827))

### 3. Walk it — the gestures are effectively the same on both platforms

| Action | VoiceOver | TalkBack |
|---|---|---|
| Next / previous element | swipe right / left | swipe right / left (one finger) |
| Activate the focused element | **double-tap** | **double-tap** |
| Scroll | (three-finger swipe) | two-finger swipe up/down |
| Hear the whole screen | two-finger swipe up | — |

One walk, two platforms, the same hands. Verified against the vendor docs above, 2026-08-13.

**Walk the primary flow end to end without looking at the screen.** That is the entire test, and looking defeats it.

### 4. What a pass looks like

- **Swipe order matches visual order.** If focus jumps from the header to a footer button and back, the reading order is wrong — usually an absolutely-positioned element or a mis-ordered `View`.
- **Every stop announces role + label + state**, and the label says what the control *does*, not what it looks like. "Play", not "triangle icon".
- **Nothing announces as just "button"**, and no stop is silent. A silent stop is an unlabeled control.
- **Focus lands somewhere sensible after navigation** — pushing a screen should move focus into it, not leave it on the button you just pressed.
- **Nothing unreachable.** If you cannot swipe to a control, it does not exist for a screen-reader user, whatever it looks like.
- **Decorative images are skipped**, not read out as filenames.

### 5. Scope, honestly

Once per major screen, on the flow that matters — not every screen every build. The mechanical pass in step 1 is cheap enough to run every time; the human walk is the one that catches order and focus, and those break when layout changes. **iOS note:** VoiceOver needs a real device or a simulator, so on this Windows host the walk runs on Android (TalkBack) and iOS goes through EAS / a macOS runner — see [[resources]] § iOS from a Windows host.

---

## Which audit rules get confirmed here

The [audit-rules.md](audit-rules.md) **visual-judgment subset** is the part the grep sheet can only *harvest* — it is confirmed here, on a rendered frame:

- **AR-T01** sub-min-touch-target — measure/tap the actual box on the frame (mobile MCP tap).
- **AR-T04** missing-a11y-on-interactive — per element; confirm with `mobile_list_elements_on_screen` and the screen-reader walk **above**, which is now written out rather than assumed.
- **AR-T09** gray-on-color — confirm the background is genuinely chromatic before flagging.
- **AR-T12** cramped-card-padding — confirm the element is a real card, not a flush list row.
- **AR-T25** incomplete-glass-card — confirm all three glass layers render (this is the one that *only* shows truly in release).
- **AR-T28** no-safe-area-handling — confirm content clears the notch / Dynamic Island and the home indicator on the frame.

(AR-T16/T17 size-context and AR-T19 numberOfLines are also eyeball-confirmed here.) A clean grep sheet plus these visual confirmations on a release-style frame, on every platform the parity policy requires, is what "verified" means in tactile — nothing less.
