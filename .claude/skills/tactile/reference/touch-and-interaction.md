# Touch & Interaction

Purpose: how a mobile UI answers the finger. Targets, the full interaction-state matrix, pressed feedback, optimistic updates, progressive disclosure, and per-element accessibility — the things that make a screen feel alive in the hand instead of dead under it. Sibling: [motion-and-gesture.md](motion-and-gesture.md) (timing/easing for the feedback below), [safe-area-and-devices.md](safe-area-and-devices.md) (where the touchable chrome sits). Deterministic detectors for this page: **AR-T01–T04** in [audit-rules.md](audit-rules.md).

A finger is not a cursor. It is ~9mm wide, it hides the thing it touches, and it expects the surface to push back. Every rule here follows from that.

---

## Touch targets ≥ 44pt (iOS) / 48dp (Android)

The visible glyph can be small. The *tappable box* cannot. Apple HIG sets the floor at 44×44pt; Material 3 at 48×48dp. When the icon is smaller than the floor — a 20pt close X, a 16pt chevron — do not grow the icon. Grow the touch zone with `hitSlop`, which extends the responder region without affecting layout. **AR-T01** flags any interactive whose box falls below the floor with no compensating `hitSlop`. (The 44/48 platform floors also satisfy **WCAG 2.2 SC 2.5.8 Target Size (Minimum)** — a normative Level-AA criterion since Oct 2023 requiring ≥ 24×24 CSS px with a spacing exception — so meeting the platform minimum clears the web-standard floor too.)

```tsx
import { Pressable } from 'react-native';

// A 20pt icon in a 44pt zone: visible glyph stays small, the tappable box is honest.
<Pressable
  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}  // 20 + 12 + 12 = 44
  accessibilityRole="button"
  accessibilityLabel="Close"
  onPress={onClose}
>
  <CloseIcon size={20} />
</Pressable>
```

`hitSlop` accepts a number (uniform) or `{top,bottom,left,right}`. It does **not** change the visual box, so two icons can sit 8pt apart visually while their touch zones tile edge-to-edge. Test the result by trying to hit it with the side of a thumb, not a fingertip — that is the geometry **AR-T01** is confirmed against on a real frame.

---

## `Pressable` over `TouchableOpacity` for new code

`TouchableOpacity` only animates opacity and gives you one state. `Pressable` exposes the full responder lifecycle, supports `hitSlop` + `pressRetentionOffset`, and lets `style` and `children` be functions of `{ pressed }`. Reach for it on every new interactive. **AR-T03** flags legacy `TouchableOpacity`/`TouchableHighlight` in new code as ADVISORY.

```tsx
<Pressable
  onPress={onPress}
  disabled={disabled}
  hitSlop={8}
  accessibilityRole="button"
  accessibilityLabel="Start fast"
  accessibilityState={{ disabled }}
  style={({ pressed }) => [
    styles.btn,
    pressed && styles.btnPressed,   // see pressed-style requirement below
    disabled && styles.btnDisabled,
  ]}
>
  {({ pressed }) => (
    <Text style={[styles.btnLabel, pressed && styles.btnLabelPressed]}>Start</Text>
  )}
</Pressable>
```

---

## The interaction-state matrix

Every interactive owns five states. Designing only the default (the "happy path" of interaction) is the most common reason a screen feels unfinished. Each state needs a visible answer and an accessibility answer.

| State | Visual | Accessibility | Notes |
|-------|--------|---------------|-------|
| **Default** | resting fill, full opacity | role + label | the baseline |
| **Pressed** | `opacity 0.88` **or** `scale 0.96`, within 150ms | (transient) | mandatory — see below |
| **Disabled** | reduced opacity (~0.4) + no press response | `accessibilityState={{ disabled: true }}` | also set `disabled` so taps no-op |
| **Selected** | persistent fill/border/elevation shift | `accessibilityState={{ selected: true }}` | the screen reader cannot see your green pill |
| **Loading** | spinner/skeleton replaces label; control inert | `accessibilityState={{ busy: true }}` + label like "Saving…" | block re-entry while in flight |

```tsx
const styles = StyleSheet.create({
  btn:          { paddingVertical: 16, paddingHorizontal: 24, borderRadius: 16, backgroundColor: palette.primary },
  btnPressed:   { opacity: 0.88 },                       // OR transform: [{ scale: 0.96 }]
  btnDisabled:  { opacity: 0.4 },
  btnSelected:  { backgroundColor: palette.primaryContainer, borderColor: palette.primary, borderWidth: 1 },
});
```

### The pressed-style requirement (AR-T02)

A button with no pressed feedback feels broken even when the tap works — the user assumes the touch missed and taps again. **Every interactive must show a pressed state**: either `opacity: 0.88` or `transform: [{ scale: 0.96 }]`, applied within ~150ms (see the press timing in [motion-and-gesture.md](motion-and-gesture.md)). 0.96 is the sweet spot for scale — perceptible, not bouncy. **AR-T02** is BLOCK: an interactive with no `pressed` style callback, `activeOpacity`, scale-to-0.96, or ripple does not present.

On Android, the platform-honest pressed feel is the ripple. `Pressable` with `android_ripple` gives it for free:

```tsx
<Pressable
  android_ripple={{ color: palette.rippleOnPrimary, borderless: false }}
  style={({ pressed }) => [styles.btn, Platform.OS === 'ios' && pressed && styles.btnPressed]}
>
```

Use `android_ripple` on Android and the opacity/scale fallback on iOS — branch with `Platform.OS` so each platform gets its native answer.

---

## Segmented-control selected thumb must be visibly elevated

A segmented control (the iOS-style pill switcher) communicates selection through a moving thumb. If the selected segment differs from its neighbours by text color alone, the control reads as flat and the user loses track of where they are. The selected thumb needs **at least one of**: a shadow, a border, or a background-contrast shift — and on Android, soft shadows frequently vanish, so add `elevation: 2`.

```tsx
const seg = StyleSheet.create({
  thumb: {
    backgroundColor: palette.surface,        // contrast vs the track
    borderRadius: 12,
    ...Platform.select({
      ios:     { shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 2 },              // soft iOS shadow vanishes on Android without this
    }),
  },
});
```

Pair the visual with `accessibilityRole="tab"` per segment and `accessibilityState={{ selected }}` so the elevation has a screen-reader equivalent.

---

## Optimistic UI

Mobile networks are slow and intermittent; a finger expects an instant answer. Update local state the moment the tap lands, render the new reality immediately, and reconcile with the server in the background — rolling back visibly only if the request fails.

```tsx
async function toggleLike(id: string) {
  setLiked(prev => ({ ...prev, [id]: !prev[id] }));     // 1. flip immediately — the UI never waits
  try {
    await api.setLike(id, !liked[id]);                  // 2. sync in the background
  } catch {
    setLiked(prev => ({ ...prev, [id]: !!prev[id] }));  // 3. roll back + surface a quiet error toast
    showToast('Could not update. Tap to retry.');
  }
}
```

The like turns red under the thumb instantly; the round-trip is invisible. Reserve the loading state (above) for actions the user must *wait on* — submitting a form, completing a purchase — not for every tap.

---

## Progressive disclosure

Show the basic, high-frequency options first; tuck the advanced, low-frequency ones behind an expandable section, a "More" affordance, or a sheet. A flat wall of every possible control is a desktop habit that reads as clutter on a phone held one-handed.

- **Inline expand** for a small set of secondary options (an "Advanced" accordion under a form).
- **Bottom sheet** for a self-contained sub-task (filters, a date picker, sharing options) — see the sheet/grabber motion in [motion-and-gesture.md](motion-and-gesture.md).
- **Detail push** for drilling into one item from a list.

The rule of thumb: the primary screen should answer the one job the user opened the app to do. Everything else is one deliberate tap away.

---

## Accessibility on every interactive (AR-T04)

Every `Pressable` carries `accessibilityRole` and `accessibilityLabel` — **no exception for icon-only buttons**, which are exactly the ones a screen reader cannot name on its own. Dynamic state is reported through `accessibilityState`, because VoiceOver and TalkBack cannot see your selected pill, your disabled dimming, or your busy spinner.

```tsx
<Pressable
  accessibilityRole="button"                       // button | tab | switch | link | checkbox | …
  accessibilityLabel="Add water"                    // what it does, in plain words
  accessibilityHint="Logs one glass to today's total"  // optional: what happens after
  accessibilityState={{ selected, disabled, busy }} // the state the eye sees, for the ear
>
```

**AR-T04** is BLOCK and per-element: an interactive missing `accessibilityRole` + `accessibilityLabel` does not present. Match the role to the behaviour — a toggle is `switch`, a tab is `tab`, a navigational text is `link`. Confirm with VoiceOver/TalkBack at least once per major screen; the grep harvest finds candidates, the device pass confirms them.

---

## Icon optical-weight consistency

Pick one icon system (SF Symbols, Material Symbols, or a single custom set) and hold a consistent **fill state and weight** across a screen. A row of three quick-add buttons where one icon is filled and two are outline reads as a bug — the eye snags on the mismatch even when nothing is wrong. This is a visual-judgment check (no faithful grep): scan any row or cluster of icons and confirm they share fill, stroke weight, and corner treatment. When an icon is selected/active, the convention is to switch *the whole set's* selected member to the filled variant — never to mix fill states for decoration.

---

## Quick reference

- Touch zone ≥ 44pt / 48dp; expand with `hitSlop`, don't grow the glyph — **AR-T01**.
- `Pressable` for new code; pressed style mandatory (`opacity 0.88` / `scale 0.96`, ≤150ms) — **AR-T02/T03**.
- Design all five states: default, pressed, disabled, selected, loading.
- Selected segmented thumb: shadow / border / bg-contrast, `+elevation: 2` on Android.
- Optimistic update on tap; roll back visibly on failure.
- Progressive disclosure: basics first, advanced behind expand/sheet.
- `accessibilityRole` + `Label` on every interactive, `accessibilityState` for dynamic state — **AR-T04**.
- One icon system, one fill state per screen.

Walk the full review with the SK-126 [CHECKLIST.md](../../mobile-app-design/CHECKLIST.md) — items 15 (touch targets), 16 (segmented thumb), 17 (press feedback), 19–20 (a11y role/label + state) are this page's source. Do not duplicate the checklist; reference it.
