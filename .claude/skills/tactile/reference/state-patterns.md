# State Patterns

Every screen is a set of states, not a single happy-path layout — this page covers the full lifecycle (first-run, empty, loading, error, offline, success, sheet, end-of-list) and how to make each one feel designed rather than defaulted.

The governing rule from the SKILL: **design every state.** The happy path is the easy 20%; the empty, loading, error, and offline states are where apps feel finished or feel like a template. Tie every piece of copy on these screens to [AR-T31](audit-rules.md#g--motion--content) — no lorem ipsum, no `[placeholder]`, no "Something went wrong" stand-in. Write the real copy from the brief *before* building the layout; placeholder copy produces placeholder design.

Cross-link: [touch-and-interaction.md](touch-and-interaction.md) for the per-element interaction-state matrix (default / pressed / disabled / selected / loading) that lives *inside* these screens.

---

## Onboarding / first-run

The first run is one chance to convert. Structure it: **splash → value-first → permission priming**, in that order. Never cold-prompt on launch.

- **Splash** is a brand frame, not a loading screen. Use `expo-splash-screen` to hold the native splash while fonts and the first data fetch resolve, then hide it deliberately — don't flash an unstyled frame (font-flash is a build failure; gate on `useFonts`).

```tsx
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from '@expo-google-fonts/hanken-grotesk';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded] = useFonts({ /* display + body faces */ });
  const onReady = useCallback(async () => {
    if (loaded) await SplashScreen.hideAsync();
  }, [loaded]);
  if (!loaded) return null;
  return <View onLayout={onReady}>{/* ... */}</View>;
}
```

- **Value-first**: let the user *see or do* something before you ask for anything. A 2–3 screen carousel that shows the payoff, or — better — a live, no-account-required first action. The reflex to gate everything behind sign-up and three permission dialogs is the slop tell.
- **Permission priming** comes last and in context (see below).

## Permission-prompt priming

Never fire the OS permission dialog cold — a denied prompt is usually permanent, and a cold prompt gets denied. Show a **priming screen first**: explain *why*, in the brief's voice, with a clear "Allow" affordance that *then* triggers the real OS prompt. Ask in context, at the moment the permission pays off (request camera when they tap "Scan", not on launch).

```tsx
// Priming UI is your own screen — the OS prompt only fires on confirm.
async function requestNotifications() {
  const { status } = await Notifications.getPermissionsAsync();
  if (status === 'granted') return true;
  // show your own priming sheet; only on its "Allow" press:
  const { status: next } = await Notifications.requestPermissionsAsync();
  return next === 'granted';
}
```

If denied, degrade gracefully and offer a one-tap route to Settings (`Linking.openSettings()`) — never trap the user.

## Biometric / auth-gate state

A lock screen is its own state, and the cardinal rule is **never ship a biometric-only gate**: Face ID / Touch ID can fail, be disabled, or change (a new enrollment invalidates it), and a gate with no other door locks the user out of their own account. Always offer a visible non-biometric fallback (device passcode / PIN / password / passkey) — not buried, not hidden.

The flow with `expo-local-authentication`:

1. **Capability-check first.** `hasHardwareAsync()` + `isEnrolledAsync()` *before* you offer biometrics; if either is false, go straight to the passcode path — don't show a Face ID button that can't work.
2. **Prime if the value isn't obvious** (same discipline as permission priming above) — a one-line "Unlock with Face ID" affordance, not a cold prompt on launch.
3. **Keep the device fallback on.** Leave `disableDeviceFallback` at its default `false` unless you have a hard security reason — turning it off removes the escape hatch.
4. **Feedback on fail.** A failed scan gets instant feedback — a shake, a `notificationAsync(Error)` haptic, and a *visible* "Use passcode" button — never a dead prompt.

```tsx
import * as LocalAuthentication from 'expo-local-authentication';

async function unlock(): Promise<boolean> {
  const ready = (await LocalAuthentication.hasHardwareAsync())
    && (await LocalAuthentication.isEnrolledAsync());
  if (!ready) return promptPasscode();                 // fallback path — always present
  const { success } = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Unlock Habit',
    fallbackLabel: 'Use passcode',                      // iOS passcode-fallback label
    // disableDeviceFallback left false on purpose — keep the escape hatch
  });
  return success || promptPasscode();
}
```

**iOS config:** any app that touches Face ID must declare `NSFaceIDUsageDescription` in `Info.plist` (`app.json` → `ios.infoPlist`) — its absence crashes on the first prompt. Treat a sensor lockout (too many fails) as a normal state with a passcode route, not an error, and never gate content the user has no other way to reach.

## Empty states that TEACH

An empty state is the most-seen screen of any new account, and "Nothing here yet" wastes it. An empty state must do three things: **say what goes here, show why it's worth it, and give one primary action to fill it.** It teaches the interface.

- One illustration or icon (on-system weight — see [imagery-and-icons.md](imagery-and-icons.md)), a one-line headline, a one-line subhead, and a single primary button. No competing CTAs.
- Distinguish *first-run empty* ("Add your first habit") from *filtered/search empty* ("No results for 'kale' — try a broader term") — they need different copy and different actions.
- Copy is real and specific to the brief (AR-T31). "Your week is clear. Add a session to start your streak." beats "No data."

## Loading: skeleton vs spinner

Pick by whether you know the **shape** of what's coming:

- **Skeleton** when the content shape is known (a feed, a profile, a list of cards). Mirror the real layout with neutral blocks on the 4/8pt grid, and animate a **shimmer** (a translucent gradient sweeping left→right via `transform: translateX` on the UI thread — never animate width/height, per [AR-T29](audit-rules.md#g--motion--content)). Skeletons reduce *perceived* latency because the eye pre-loads the layout.
- **Spinner** only for indeterminate, shapeless waits (a form submit, an auth round-trip) where there's no layout to preview. A full-screen spinner on a known-shape feed is the lazy choice.
- Avoid the double-flash: if data resolves in <200ms, don't show a loader at all — it reads as a flicker.

## Error states: inline vs full-screen

Match the blast radius to the failure:

- **Inline** when one piece failed but the screen is otherwise usable — a field validation, a single failed list row, a failed image (show a placeholder, not a broken frame). Keep the rest interactive.
- **Full-screen** only when nothing on the screen is usable — the initial fetch failed entirely.
- Every error gets a **retry affordance** (a real button, not just red text) and **friendly, specific copy** in the brand voice. "We couldn't reach the server. Check your connection and try again." — never a raw stack trace, error code as headline, or "Error: undefined" (AR-T31 treats stand-in error copy as a build failure).

## Offline / no-network and optimistic reconciliation

Mobile lives on flaky networks; offline is a *first-class* state, not an error.

- Show a **persistent, quiet offline banner** (not a blocking modal) when the network drops — detect with `@react-native-community/netinfo`. The user keeps reading cached content.
- Use **optimistic UI**: apply the user's action to local state immediately, queue the write, and reconcile when the network returns. On success, drop the pending marker silently; on failure, roll back visibly and surface an inline retry. The cardinal sin is a spinner that blocks the UI on every tap because the dev assumed a perfect connection.

```tsx
function toggleLike(id: string) {
  setLiked(id, true);                 // optimistic — instant feedback
  api.like(id).catch(() => {
    setLiked(id, false);              // visible rollback
    toast('Couldn’t save — tap to retry');
  });
}
```

## Success / confirmation states

Confirm completion without nagging. A brief inline checkmark, a toast, or a subtle haptic (`expo-haptics` `notificationAsync(Success)`) is usually right. Reserve a full success *screen* for genuine milestones (purchase complete, onboarding finished) — and even then, give it one clear "what's next" action. Don't trap the user on a celebration screen with no exit.

## Modal-sheet grabber affordance

Any bottom sheet or `presentation: 'modal'` screen needs the **grabber** — the small rounded bar at the top (the SK-126 "common mistakes" #5 tell). Without it, users don't know the sheet is dismissible by drag, so they hunt for a close button that isn't there. Spec: **~44pt wide × 5pt tall, ~999 radius**, centered, in a muted neutral token, ~8pt from the top edge.

```tsx
<View style={styles.sheet}>
  <View style={styles.grabber} /* w:44 h:5 radius:999 bg:t.outlineVariant, alignSelf:'center', marginTop:8 */ />
  {children}
</View>
```

If using `@gorhom/bottom-sheet`, its default handle satisfies this; if you build the sheet by hand (the `transparent` Modal pattern from PITFALLS #9), add the grabber yourself.

## Pull-to-refresh and infinite-scroll end states

- **Pull-to-refresh**: use the platform `RefreshControl` (FlatList/FlashList `refreshControl` prop) so the gesture and spinner feel native — don't hand-roll a custom drag. Tint it to the brand accent.
- **Infinite scroll** needs an honest **end state**. A list that silently stops looks broken. When more data is loading, show a small inline footer spinner; when the list is exhausted, show a quiet "You're all caught up" / "End of results" footer so the user knows there's nothing more — not an eternal spinner. And design the **load-more failure** too: a footer "Couldn't load more — tap to retry," not a frozen list.

---

**State checklist before presenting any screen:**
first-run · empty (first-run vs filtered) · loading (skeleton or spinner, chosen deliberately) · error (inline vs full-screen, with retry) · offline · success · sheet grabber present · list end / load-more states · auth-gate (if any: visible non-biometric fallback). Every one has **real copy** (AR-T31) and feels intentional, not defaulted.
