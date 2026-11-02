# Mobile Copy

Purpose: the words, where mobile makes them different. Not a general writing guide — the parts of copy that a phone changes, plus the one string Apple actually reads before approving your app.

**What this page does not own.** The store listing — title, subtitle, keywords, description — is discoverability, not interface copy; that lives with ASO. The *detector* for fake copy is **AR-T31** in [audit-rules.md](audit-rules.md) (BLOCK on lorem ipsum, bracketed placeholders, TODO/TBD in rendered `Text`). The *rule* that real copy comes first is [craft.md](craft.md) step 0. This page is what to write once you accept that rule. For a final human-sounding pass on any longer prose, run `/ghost`.

## The inversion: on mobile, the container writes the copy

On a wide screen you write the sentence and the layout accommodates it. On a phone the container is fixed, narrow, and often shared with two siblings — so **length is a design constraint you decide before the sentence, not a problem you discover after.**

The practical consequence: when a label does not fit, the fix is almost never a smaller font or a wider box. It is a shorter word. "Reschedule" becomes "Change". "Configuration" becomes "Settings". Treat the character budget as part of the spec.

### The four containers that bite

| Container | Why it bites | What to do |
|---|---|---|
| **Tab bar label** | Shares the width with 3–5 siblings and cannot wrap. Truncates to an ellipsis that looks like a bug. | One word. Nouns, not verbs. If two tabs need the same word, the IA is wrong — see [navigation-and-ia.md](navigation-and-ia.md). |
| **Button in a row** | Two or three buttons split one screen width. The longest label sets the size of all of them. | Write the longest label first, then design the row. A verb, not a sentence. |
| **Notification** | Truncated on the lock screen, and the cut point differs by OS version and device. | Front-load the payload: the *specific thing* in the first few words, the framing after. "Fast complete — 16h" beats "Congratulations! You have completed…". |
| **Home-screen app name** | iOS truncates it hard, and it is not the same field as the store title. | Both stores cap the app *name* at 30 characters (verified in `app-preflight.mjs` § store-name), but the home screen shows far fewer. Aim for one short word. |

**Do not trust a character count you read somewhere — including from me.** The truncation points move between OS versions and device classes. Budget short, then *prove* it: render the longest realistic string and screenshot it on the smallest device class you support, with `node ~/.claude/skills/tactile/scripts/device-shot.mjs`. That is the same discipline [platform-verification.md](platform-verification.md) applies to blur and shadows, for the same reason.

## Permission strings — the only copy Apple reads before approving

An iOS usage description (`NSCameraUsageDescription`, `NSLocationWhenInUseUsageDescription`, …) is user-facing copy *and* a review artifact. Expo's config plugins inject a boilerplate reason automatically, which is exactly why it gets shipped unread. Expo's own documentation is direct about the consequence: those defaults *"will most likely need to be tailored to your specific use case for your app to be accepted by the App Store"* ([Permissions](https://docs.expo.dev/guides/permissions/), checked 2026-08-13).

Write the string as **purpose, not mechanism** — say what the user gets, not what the app accesses:

```
BAD   "This app uses the camera."                 ← mechanism, no purpose
BAD   "Allow MyApp to access your camera"          ← the injected default
GOOD  "Scan a barcode to log a meal without typing it."
```

`app-preflight.mjs` warns when a permission-bearing module ships without an explicit string. That check is the reminder; this section is the how.

**The priming screen is separate copy from the system prompt.** The system dialog is Apple's or Google's words plus your usage string; your priming screen (see [state-patterns.md](state-patterns.md) § permission-prompt priming) is where you earn the yes. It should name the benefit and, crucially, say what happens if they decline — an app that hides the cost of "Don't Allow" reads as a trap.

## Error copy: mobile's failures are different failures

Web error copy is mostly about server responses. A phone's errors are dominated by four cases the web rarely sees, and each has a shape:

- **Offline / no network.** Never "Something went wrong." Say the state and the recovery: *"You're offline. Your last 3 entries are saved and will sync."* If work was preserved, saying so is the entire message.
- **Permission denied.** The user already said no; do not re-ask in prose. State what is unavailable and offer the one route back: *"Photos access is off, so you can't attach an image. Turn it on in Settings."*
- **Sync conflict.** Name both sides and let them choose. Never resolve silently and never say "conflict".
- **Background failure.** Something failed while the app was closed. Say when, not just what: *"Yesterday's backup didn't finish."*

The formula across all four: **what happened → what it cost them → the one thing to do next.** No apology, no exclamation mark, no "Oops". A toast that says "Oops! Something went wrong 😞" is three sentences of nothing.

## Destructive confirmations: use the platform's verb

Confirm only when the action is irreversible *and* not undoable. Prefer an undo snackbar over a confirm dialog wherever the action can be reversed — a dialog costs every user a tap to protect the rare mistake.

When you do confirm, **the button says the verb, never "OK"**. "OK" forces the user to re-read the question to know what they are agreeing to.

```
BAD    Title: "Are you sure?"        Buttons: [Cancel] [OK]
GOOD   Title: "Delete this fast?"    Buttons: [Cancel] [Delete]
```

The destructive button carries the error colour and, on iOS, the destructive role so the platform styles it. See [platform-conventions.md](platform-conventions.md) for action sheet vs dialog.

## Dynamic Type makes word choice an accessibility decision

At the largest accessibility text sizes a single long word can overflow its container, and no amount of layout work saves it — the word is simply wider than the phone. **Choosing a shorter synonym is an accessibility fix, not a style preference.**

This is also why `allowFontScaling={false}` is not the answer: it fixes the layout by breaking the user's setting, and `app-preflight.mjs` fails a build that does it. Cap with `maxFontSizeMultiplier` if you must, and shorten the word.

Check the copy at the largest text size the same way you check it on the smallest device — render it and look.

## Terminology: pick one word and never vary it

The same concept must use the same word in the tab bar, the empty state, the notification, the error, and the settings row. Synonym variety reads as sophistication in prose and as *different features* in an interface. If it is a "fast" on the home screen, it is not a "session" in history and a "log" in notifications.

Keep the list in `.tactile.md` alongside the design context, so it survives the session that invented it.

## Empty-state words

[state-patterns.md](state-patterns.md) § empty states that TEACH owns the pattern. The words follow one rule: **an empty state is an instruction, not an apology.** It names what will appear here and the single action that puts something there. "No data" describes the screen; "Start your first fast and it'll show up here" describes the way out.

## Cross-references

- Fake-copy detector: [audit-rules.md](audit-rules.md) AR-T31
- Real-copy-first rule: [craft.md](craft.md) step 0
- Where each string lives on screen: [screen-archetypes.md](screen-archetypes.md)
- The states these words fill: [state-patterns.md](state-patterns.md)
- Type sizes the words must survive: [mobile-typography.md](mobile-typography.md)
- Proving it fits on a real device: [platform-verification.md](platform-verification.md)
