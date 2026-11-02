#!/usr/bin/env node
/**
 * generate-tokens.mjs — the tactile starter-token generator + WCAG-AA verifier.
 *
 * The mobile analog of impeccable's web token computation. React Native style takes
 * hex/rgb, NOT OKLCH (mobile-color.md: "you don't ship OKLCH at runtime — bake the
 * hex once"). So this script is where the OKLCH reasoning lives: it generates a full
 * MD3-role light+dark palette from ONE brand hue, gamut-maps each colour into sRGB,
 * bakes the hex, and PROVES every mounted text/background pair clears WCAG AA before
 * the values are allowed to ship. This is the computation that makes the AA claim in
 * starter-tokens.ts true rather than asserted.
 *
 * USAGE
 *   node generate-tokens.mjs            verify — print the contrast table; exit 1 if any pair misses AA
 *   node generate-tokens.mjs --emit     print the full theme/tokens.ts to stdout (retint output)
 *   node generate-tokens.mjs --emit > ../../path/to/project/theme/tokens.ts
 *
 * RETINT (mobile parity with web's "change one --brand-h"): change BRAND_H below,
 * re-run to confirm AA still holds, then --emit to regenerate. The committed
 * starter-tokens.ts IS the --emit output for the default hue, so it never drifts.
 *
 * No dependencies — pure Node. Why a script and not hand-tuned hex: the OKLCH→sRGB→
 * contrast math caught real sub-AA misses on the web side (a 4.14:1 white-on-brand);
 * the only honest way to claim AA on a retintable palette is to recompute it.
 */
'use strict';

// ── Brand hue — change THIS one number (0–360) to retint the whole palette ──────────
const BRAND_H = 185; // placeholder deep teal-cyan. Set to your brand's hue, then re-verify + --emit.
const HUES = { error: 25, warning: 70, success: 150, info: 250 };

// OKLCH spec per role: [L, C, Hoverride?]. H defaults to BRAND_H (brand + neutrals borrow
// a sliver of it; chroma drops toward the extremes so the tint is felt, not seen).
const SPEC = {
  light: {
    surface:            [0.985, 0.004], surfaceRaised:      [0.995, 0.003],
    surfaceVariant:     [0.935, 0.008],
    onSurface:          [0.22,  0.014], onSurfaceVariant:   [0.44,  0.016],
    outline:            [0.57,  0.012], outlineVariant:     [0.85,  0.008],
    primary:            [0.52,  0.11],  onPrimary:          [0.99,  0.01],
    primaryContainer:   [0.90,  0.05],  onPrimaryContainer: [0.32,  0.07],
    error:              [0.55,  0.17, HUES.error],   onError:            [0.99, 0.01, HUES.error],
    errorContainer:     [0.91,  0.05, HUES.error],   onErrorContainer:   [0.34, 0.10, HUES.error],
    success:            [0.53,  0.12, HUES.success], onSuccess:          [0.99, 0.01, HUES.success],
    successContainer:   [0.91,  0.05, HUES.success], onSuccessContainer: [0.32, 0.08, HUES.success],
    warning:            [0.70,  0.13, HUES.warning], onWarning:          [0.20, 0.04, HUES.warning],
    warningContainer:   [0.92,  0.06, HUES.warning], onWarningContainer: [0.36, 0.07, HUES.warning],
    info:               [0.54,  0.12, HUES.info],    onInfo:             [0.99, 0.01, HUES.info],
    infoContainer:      [0.91,  0.05, HUES.info],    onInfoContainer:    [0.34, 0.08, HUES.info],
    shadow:             [0.18,  0.02],
  },
  dark: {
    surface:            [0.16,  0.008], surfaceRaised:      [0.21,  0.009],
    surfaceVariant:     [0.28,  0.010],
    onSurface:          [0.93,  0.006], onSurfaceVariant:   [0.77,  0.012],
    outline:            [0.58,  0.012], outlineVariant:     [0.36,  0.010],
    primary:            [0.80,  0.10],  onPrimary:          [0.24,  0.05],
    primaryContainer:   [0.34,  0.07],  onPrimaryContainer: [0.90,  0.05],
    error:              [0.72,  0.13, HUES.error],   onError:            [0.22, 0.05, HUES.error],
    errorContainer:     [0.33,  0.09, HUES.error],   onErrorContainer:   [0.90, 0.05, HUES.error],
    success:            [0.78,  0.11, HUES.success], onSuccess:          [0.22, 0.05, HUES.success],
    successContainer:   [0.32,  0.07, HUES.success], onSuccessContainer: [0.90, 0.05, HUES.success],
    warning:            [0.82,  0.12, HUES.warning], onWarning:          [0.24, 0.05, HUES.warning],
    warningContainer:   [0.34,  0.07, HUES.warning], onWarningContainer: [0.92, 0.05, HUES.warning],
    info:               [0.78,  0.10, HUES.info],    onInfo:             [0.22, 0.05, HUES.info],
    infoContainer:      [0.33,  0.07, HUES.info],    onInfoContainer:    [0.90, 0.05, HUES.info],
    shadow:             [0.05,  0.01],
  },
};

// Mounted pairs to verify: [fg, bg, kind]. body → ≥4.5:1, ui (large text / borders / icons) → ≥3:1.
const PAIRS = [
  ['onSurface', 'surface', 'body'], ['onSurfaceVariant', 'surface', 'body'],
  ['onSurface', 'surfaceVariant', 'body'], ['onSurfaceVariant', 'surfaceVariant', 'body'],
  ['onSurface', 'surfaceRaised', 'body'], ['onSurfaceVariant', 'surfaceRaised', 'body'],
  ['onPrimary', 'primary', 'body'], ['onPrimaryContainer', 'primaryContainer', 'body'],
  ['onError', 'error', 'body'], ['onErrorContainer', 'errorContainer', 'body'],
  ['onSuccess', 'success', 'body'], ['onSuccessContainer', 'successContainer', 'body'],
  ['onWarning', 'warning', 'body'], ['onWarningContainer', 'warningContainer', 'body'],
  ['onInfo', 'info', 'body'], ['onInfoContainer', 'infoContainer', 'body'],
  ['primary', 'surface', 'ui'], ['primary', 'surfaceRaised', 'ui'],
  ['outline', 'surface', 'ui'], ['outline', 'surfaceVariant', 'ui'], ['error', 'surface', 'ui'],
];

// ── OKLCH → sRGB (Björn Ottosson), with chroma-only gamut mapping ───────────────────
function oklchToRgb(L, C, H) {
  const h = (H * Math.PI) / 180, a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  const gamma = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
  const R = gamma(r), G = gamma(g), B = gamma(bb);
  const clipped = [R, G, B].some((v) => v < -0.001 || v > 1.001);
  const to8 = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return { R: to8(R), G: to8(G), B: to8(B), clipped };
}
// Hold L + H exact (lightness drives contrast); shrink C until sRGB can represent it.
function mapToGamut(L, C, H) {
  let c = C;
  while (c > 0 && oklchToRgb(L, c, H).clipped) c = Math.round((c - 0.001) * 1000) / 1000;
  return { L, C: c, H, reduced: c < C };
}
const h2 = (n) => n.toString(16).padStart(2, '0');
function specHex(theme, role) {
  const [L, C, H = BRAND_H] = SPEC[theme][role];
  const g = mapToGamut(L, C, H), { R, G, B } = oklchToRgb(g.L, g.C, g.H);
  return `#${h2(R)}${h2(G)}${h2(B)}`;
}

// ── WCAG 2.x relative-luminance contrast, computed from the FINAL baked hex ──────────
function lum(hx) {
  const v = [1, 3, 5].map((i) => parseInt(hx.slice(i, i + 2), 16) / 255);
  const lin = v.map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

// ── Verify ──────────────────────────────────────────────────────────────────────────
function verify({ quiet = false } = {}) {
  let failures = 0;
  const worst = { light: { body: Infinity, ui: Infinity }, dark: { body: Infinity, ui: Infinity } };
  for (const theme of ['light', 'dark']) {
    if (!quiet) console.log(`\n=== ${theme.toUpperCase()} (brand H=${BRAND_H}) ===`);
    for (const [fg, bg, kind] of PAIRS) {
      const min = kind === 'body' ? 4.5 : 3.0;
      const r = contrast(specHex(theme, fg), specHex(theme, bg));
      worst[theme][kind] = Math.min(worst[theme][kind], r);
      const ok = r >= min;
      if (!ok) failures++;
      if (!quiet) console.log(`  ${ok ? 'PASS' : 'FAIL'} ${r.toFixed(2)}:1 (>=${min}) ${fg} / ${bg}  [${specHex(theme, fg)} on ${specHex(theme, bg)}]`);
    }
  }
  if (!quiet) console.log(`\n${failures === 0 ? '✓ ALL PAIRS PASS WCAG AA' : '✗ ' + failures + ' FAILURE(S)'}`);
  return { failures, worst };
}

// ── Emit theme/tokens.ts ─────────────────────────────────────────────────────────────
function paletteBlock(theme) {
  const roles = Object.keys(SPEC[theme]);
  const pad = Math.max(...roles.map((r) => r.length));
  return roles.map((r) => `    ${(r + ':').padEnd(pad + 1)} '${specHex(theme, r)}',`).join('\n');
}
function emit() {
  const { worst } = verify({ quiet: true });
  const f = (n) => (Math.floor(n * 10) / 10).toFixed(1); // floor — never round a contrast claim UP
  return `/**
 * theme/tokens.ts — tactile starter tokens. A non-generic, WCAG-AA-verified baseline so
 * every mobile build starts DESIGNED, not default. The ONLY file allowed to hold raw hex
 * (tactile AR-T05): screen code references these tokens, never a literal colour.
 *
 * Runtime-proven 2026-06-26: the tactile token system was rendered in a live Expo SDK 56 app
 * (RN 0.85) on Android — light + dark via useColors(), retinted across hues with all 42 AA pairs
 * holding, strict tsc clean. Integration gotcha the render caught: set app.json
 * "userInterfaceStyle": "automatic", or the OS dark-mode setting never reaches useColorScheme()
 * and the dark palette below stays dormant.
 *
 * Generated by skills/tactile/scripts/generate-tokens.mjs at brand hue ${BRAND_H}°.
 * To retint: change BRAND_H in that script, re-run to confirm AA, then re-emit — do not
 * hand-edit the hex (the generator is the source of truth and the contrast proof).
 *
 * NativeWind-version-agnostic by design: NativeWind v5 (Tailwind-v4 @theme) is still
 * preview-only as of mid-2026 (npm view nativewind dist-tags → latest 4.2.6 / preview 5.x),
 * so these are plain typed StyleSheet tokens — they work with StyleSheet, NativeWind v4,
 * a future v5, or no styling lib at all. See app-dev/stack.md for the version trap.
 *
 * Change exactly two things for a new project: (1) the brand hue (regenerate), and
 * (2) the three font faces below (run tactile's <font_selection_procedure> first).
 *
 *   import { useColors, type, space, radius, elevation, motion, touch } from '@/theme/tokens';
 *   const c = useColors();                 // light/dark picked from the system setting
 *   <View style={{ backgroundColor: c.surface, padding: space.gutter, ...elevation.md }}>
 *     <Text style={[type.label, { color: c.onSurfaceVariant }]}>TODAY</Text>
 *     <Text style={[type.display, { color: c.onSurface }]}>1,840 ml</Text>
 *   </View>
 */
import { Platform, useColorScheme, type TextStyle, type ViewStyle } from 'react-native';

// ── Colour — MD3 role system, light + dark. Every \`on*\` is AA-legible on its surface. ──
export const palette = {
  light: {
${paletteBlock('light')}
  },
  dark: {
${paletteBlock('dark')}
  },
} as const;

// Widen to string values (the palette is \`as const\`, so \`typeof palette.light\` would be the LIGHT
// hex *literals* — then returning palette.dark wouldn't assign). Keys stay exact for autocomplete.
export type Colors = Record<keyof typeof palette.light, string>;

/** Pick the colour set for a scheme (the RN analog of CSS \`light-dark()\`). */
export const getColors = (scheme: 'light' | 'dark' | null | undefined): Colors =>
  scheme === 'dark' ? palette.dark : palette.light;

/** Hook: follow the system light/dark setting. Pin a single theme here if the brief calls for it. */
export function useColors(): Colors {
  // useColorScheme() can return 'unspecified' (and null under the strict API) — narrow to the two we map.
  return getColors(useColorScheme() === 'dark' ? 'dark' : 'light');
}

// ── Typography — three roles you actually mount per screen (display / body / label). ──
// Hierarchy is weight + colour at one size, never a 4th size (AR-T16). Run tactile's
// <font_selection_procedure> (SKILL.md) before naming a face — do NOT ship the reflex set.
export const fonts: { display?: string; body?: string; bodyLong?: string } = {
  // e.g. display: 'ClashDisplay_600SemiBold', body: 'Inter_400Regular'. Until set, RN uses
  // the platform face (SF Pro / Roboto) — acceptable for scaffolding, NOT for shipping.
};

export const type = {
  display:  { fontFamily: fonts.display, fontSize: 34, lineHeight: 38, letterSpacing: -0.5, fontWeight: '800' },
  headline: { fontFamily: fonts.display, fontSize: 24, lineHeight: 28, letterSpacing: -0.3, fontWeight: '700' },
  title:    { fontFamily: fonts.display, fontSize: 17, lineHeight: 22, letterSpacing: 0,    fontWeight: '700' },
  body:     { fontFamily: fonts.body,    fontSize: 16, lineHeight: 24, letterSpacing: 0,    fontWeight: '400' },
  bodyLong: { fontFamily: fonts.bodyLong ?? fonts.body, fontSize: 16, lineHeight: 26, letterSpacing: 0, fontWeight: '300' },
  label:    { fontFamily: fonts.body,    fontSize: 12, lineHeight: 16, letterSpacing: 1.4,  fontWeight: '600',
              textTransform: 'uppercase' },
} satisfies Record<string, TextStyle>;

// ── Spacing — 4/8pt grid, named by intent. Never compress the canonical four (mobile-spacing.md). ──
export const space = {
  xs: 4,        // icon↔label, chip inner
  sm: 8,        // related items in a group
  md: 12,       // card-padding floor — never below this
  base: 16,     // default internal padding
  glassPad: 20, // internal padding for glass cards
  gutter: 24,   // page horizontal gutter (canonical — 20 acceptable, below 16 is cramped)
  lg: 32,       // large card / between cards
  stackLg: 40,  // breath between distinct vertical sections — the IA separator
  xl: 56,       // hero offset
} as const;

// ── Radius — squircle scale by role (glass-and-depth.md). Keep nested radii concentric. ──
export const radius = {
  chip: 12,     // inputs / small chips
  card: 18,     // standard cards
  cardLg: 22,   // glass / larger cards
  feature: 28,  // large feature cards
  pill: 999,    // buttons / pills / fully-rounded
} as const;

// ── Elevation — ALWAYS sets both iOS shadow* and Android elevation (AR-T20). Shadow colour is a ──
// brand-tinted near-black (never a flat pure black), soft + ambient: big radius + low opacity = expensive lift.
const SHADOW = palette.light.shadow; // brand-tinted near-black shadow — retints with BRAND_H
export const elevation = {
  sm: Platform.select({
    ios: { shadowColor: SHADOW, shadowOpacity: 0.06, shadowRadius: 8,  shadowOffset: { width: 0, height: 2 } },
    android: { elevation: 2 },
    default: {},
  }) as ViewStyle,
  md: Platform.select({
    ios: { shadowColor: SHADOW, shadowOpacity: 0.07, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } },
    android: { elevation: 4 },
    default: {},
  }) as ViewStyle,
  lg: Platform.select({
    ios: { shadowColor: SHADOW, shadowOpacity: 0.10, shadowRadius: 24, shadowOffset: { width: 0, height: 12 } },
    android: { elevation: 8 },
    default: {},
  }) as ViewStyle,
} as const;

// ── Motion — native timing + ease-out/in curves. No bounce/elastic (AR-T30). ───────────
// Use the bezier tuples with Easing.bezier(...): import { Easing } from 'react-native-reanimated'.
export const motion = {
  duration: { instant: 0, press: 120, base: 240, exit: 200, slow: 320 }, // >300ms reads laggy
  easing: {
    out: [0.16, 1, 0.3, 1] as const,   // entrances decelerate into place
    in: [0.4, 0, 1, 1] as const,        // exits accelerate away
    inOut: [0.65, 0, 0.35, 1] as const,
  },
} as const;

// ── Touch targets — iOS 44pt / Android 48dp minimum hit region (app-dev/principles). ───
// Size the HIT AREA, not just the glyph; hitSlop(visible) pads a small control up to 48dp.
export const touch = {
  ios: 44,
  android: 48,
  min: 48, // 48 satisfies both platforms
  hitSlop(visible: number) {
    const pad = Math.max(0, Math.round((this.min - visible) / 2));
    return { top: pad, bottom: pad, left: pad, right: pad };
  },
} as const;

/*
 * WCAG-AA verified at brand H=${BRAND_H} (OKLCH→sRGB→WCAG, computed on the baked hex by
 * generate-tokens.mjs — re-run after any retint). Worst-case mounted pairs:
 *   LIGHT  body ≥ ${f(worst.light.body)}:1 · large/UI ≥ ${f(worst.light.ui)}:1
 *   DARK   body ≥ ${f(worst.dark.body)}:1 · large/UI ≥ ${f(worst.dark.ui)}:1
 * (AA floor: 4.5:1 body, 3:1 large-text/borders/icons.) Neutrals are near-zero chroma, so
 * their contrast is hue-stable; brand-on-surface IS hue-sensitive — warm yellow-green hues
 * (~90–140) make the brand more luminous, so re-run the generator after retinting and, if a
 * pair dips, lower the brand L (~0.46) or darken onPrimary.
 */
`;
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────
if (process.argv.includes('--emit')) {
  process.stdout.write(emit());
  process.exit(0);
}
const { failures } = verify();
process.exit(failures === 0 ? 0 : 1);
