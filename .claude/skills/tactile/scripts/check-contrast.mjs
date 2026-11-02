#!/usr/bin/env node
/**
 * check-contrast.mjs — measure the contrast a mobile build actually ships.
 *
 * `generate-tokens.mjs` proves AA at token-GENERATION time, for the palette it
 * generates. That leaves two gaps this closes: a project whose palette came from
 * anywhere else (a Stitch export, a Figma hand-off, a hand-tuned theme) has never
 * been measured at all, and a screen can pair two individually-valid tokens into a
 * combination nobody ever checked.
 *
 * How this differs from the web sibling (impeccable/scripts/check-contrast.mjs):
 * that one needs a hand-written `contrast-pairs.json` manifest, because CSS gives
 * you no way to know which ink lands on which ground. **Mobile does not have that
 * problem.** Material 3 token names encode their own pairing — `onSurface` is by
 * definition the ink for `surface`, `onPrimaryContainer` for `primaryContainer` —
 * so the pairs derive from the names, with no manifest to write or keep in sync.
 * Mirror the structure, not the content.
 *
 * Three sources of pairs, in order of authority:
 *   1. CONVENTION — every `onX` token vs its `X` ground. The design system's own
 *      promise; a failure here is a broken palette, not a misused one.
 *   2. CODE — style objects that declare a background and a foreground together.
 *      What the build actually renders, whatever the names claim.
 *   3. NON-TEXT — outline/border/divider tokens vs the surfaces they sit on, at the
 *      3:1 floor (WCAG 1.4.11), because a 1px hairline nobody can see is not a border.
 *
 * Light and dark are both checked, and both must pass — a palette is only as good
 * as its worse register.
 *
 * ALPHA IS NOT DROPPED. Hex, rgb()/rgba() and hsl()/hsla() all parse, and a
 * translucent ink is composited over its ground before measuring, because that is
 * the colour a user actually sees. When the GROUND itself is translucent — every
 * glass surface — there is no single answer, so the pair is measured over white and
 * over black and the row reports the range; a hard failure is reserved for the case
 * where even the most flattering backdrop misses the floor.
 *
 * Usage:
 *   node check-contrast.mjs [--dir <project>] [--tokens <file>] [--json] [--self-check]
 *     --dir      project root (default: cwd)
 *     --tokens   token module; else auto-detected (theme/tokens.ts, constants/*Theme.ts, ...)
 *     --json     machine-readable output only
 *     --self-check  run the pure-function self-tests and exit (no project needed)
 *
 * Exit 0 = every measured pair clears its floor · 1 = any pair below · 2 = setup error.
 */
'use strict';

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ARGS = process.argv.slice(2);
const flagVal = (name) => { const i = ARGS.indexOf(name); return i >= 0 && ARGS[i + 1] ? ARGS[i + 1] : null; };
const JSON_OUT = ARGS.includes('--json');

// ---------- pure colour maths (self-checked below) ----------

/**
 * Any colour literal React Native actually accepts -> [r, g, b, a] with a in 0..1.
 * Hex (3/6/8), rgb()/rgba(), hsl()/hsla(). Alpha is KEPT: a translucent ink's real
 * contrast depends on what it is composited over, and dropping alpha silently
 * reports a ratio the user never sees.
 */
function parseColor(s) {
  const v = String(s || '').trim().replace(/^['"`]|['"`]$/g, '');
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(v);
  if (hex) {
    let h = hex[1];
    if (h.length <= 4) h = h.split('').map((c) => c + c).join('');
    const p = [0, 2, 4, 6].map((i) => (i < h.length ? parseInt(h.slice(i, i + 2), 16) : 255));
    return [p[0], p[1], p[2], p[3] / 255];
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.%]+))?\s*\)$/i.exec(v);
  if (rgb) return [+rgb[1], +rgb[2], +rgb[3], alphaOf(rgb[4])];
  const hsl = /^hsla?\(\s*([\d.-]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:[\s,/]+([\d.%]+))?\s*\)$/i.exec(v);
  if (hsl) return [...hslToRgb(+hsl[1], +hsl[2] / 100, +hsl[3] / 100), alphaOf(hsl[4])];
  return null;
}
const alphaOf = (raw) => {
  if (raw == null || raw === '') return 1;
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return 1;
  return Math.min(1, Math.max(0, String(raw).includes('%') ? n / 100 : n));
};
function hslToRgb(h, s, l) {
  const hh = ((h % 360) + 360) % 360 / 60;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const [r, g, b] = hh < 1 ? [c, x, 0] : hh < 2 ? [x, c, 0] : hh < 3 ? [0, c, x]
    : hh < 4 ? [0, x, c] : hh < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  return [r, g, b].map((v) => Math.round((v + m) * 255));
}
/** Composite a translucent colour over an opaque backdrop (source-over). */
const over = (fg, bg) => [0, 1, 2].map((i) => Math.round(fg[i] * fg[3] + bg[i] * (1 - fg[3])));
const OPAQUE_WHITE = [255, 255, 255, 1], OPAQUE_BLACK = [0, 0, 0, 1];
const srgb = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const luminance = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
/** WCAG 2.x contrast ratio, 1..21. */
function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  return Number((((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05))).toFixed(2));
}

/** `onPrimaryContainer` -> `primaryContainer`. Returns null for non-`on` names. */
function groundFor(token) {
  const m = /^on([A-Z]\w*)$/.exec(token);
  return m ? m[1][0].toLowerCase() + m[1].slice(1) : null;
}

/** Non-text tokens answer to the 3:1 floor (WCAG 1.4.11), not 4.5:1. */
const isNonText = (token) => /outline|border|divider|stroke|scrim/i.test(token);

/**
 * A `*Variant` hairline is advisory, not a failure. WCAG 1.4.11 covers "visual
 * information required to identify user interface components and states" and "parts
 * of graphics required to understand the content" (w3.org/WAI/WCAG22/Understanding/
 * non-text-contrast.html, checked 2026-08-13) — a divider that only separates
 * content decoratively carries no required information and is out of scope. The
 * script cannot tell which use it is, so it reports and lets a human decide instead
 * of failing every design-system app forever.
 */
const isAdvisoryNonText = (token) => isNonText(token) && /variant$/i.test(token);

/**
 * Pull `{ name: '#hex' }` maps out of a token module. Returns { light, dark } when
 * the file declares those registers, else a single `default` register.
 */
function parsePalettes(src) {
  const text = String(src || '');
  // Values may be hex OR rgb()/hsl() — a glass palette is mostly the latter, and a
  // hex-only harvest silently drops exactly the tokens most likely to fail contrast.
  const grab = (body) => {
    const out = {};
    for (const m of body.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*['"`](#[0-9a-fA-F]{3,8}|rgba?\([^)'"`]*\)|hsla?\([^)'"`]*\))['"`]/g)) out[m[1]] = m[2];
    return out;
  };
  /** Body of `key: {` ... balanced `}`. */
  const block = (key) => {
    const at = new RegExp(`\\b${key}\\s*:\\s*\\{`).exec(text);
    if (!at) return null;
    let depth = 0, i = at.index + at[0].length - 1;
    for (let j = i; j < text.length; j++) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}' && --depth === 0) return text.slice(i + 1, j);
    }
    return null;
  };
  const light = block('light'), dark = block('dark');
  if (light || dark) {
    const reg = {};
    if (light) reg.light = grab(light);
    if (dark) reg.dark = grab(dark);
    return reg;
  }
  const flat = grab(text);
  return Object.keys(flat).length ? { default: flat } : {};
}

/**
 * Read the value after `key:` up to the terminator, ignoring commas INSIDE parens —
 * without this, `rgba(30,32,36,0.82)` truncates to `rgba(30` and parses as nothing.
 */
function valueAfter(body, keyRe) {
  const m = keyRe.exec(body);
  if (!m) return null;
  let depth = 0, out = '';
  for (let i = m.index + m[0].length; i < body.length; i++) {
    const ch = body[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (depth === 0 && (ch === ',' || ch === '\n' || ch === '}')) break;
    out += ch;
  }
  return out.trim() || null;
}

/**
 * Style objects that declare a ground and an ink together — the pairs the build
 * really renders. Brace-matched outward from each `backgroundColor:`.
 */
function codePairs(src) {
  const text = String(src || '');
  const pairs = [];
  for (const m of text.matchAll(/backgroundColor\s*:/g)) {
    let start = -1, depth = 0;
    for (let i = m.index; i >= 0; i--) {                       // walk back to this object's `{`
      if (text[i] === '}') depth++;
      else if (text[i] === '{') { if (depth === 0) { start = i; break; } depth--; }
    }
    if (start < 0) continue;
    let end = -1; depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}' && --depth === 0) { end = i; break; }
    }
    if (end < 0) continue;
    const body = text.slice(start, end);
    const bg = valueAfter(body, /backgroundColor\s*:\s*/);
    const fg = valueAfter(body, /(?<!background)(?<![\w$])color\s*:\s*/);
    if (bg && fg) pairs.push({ bg, fg });
  }
  return pairs;
}

/** `palette.onSurface` / `colors.onSurface` / `theme.colors.onSurface` -> `onSurface`. */
function tokenName(expr) {
  const m = /(?:^|\.)([A-Za-z_$][\w$]*)\s*$/.exec(String(expr || '').replace(/[;'"`]/g, '').trim());
  if (!m) return null;
  return /^(palette|colors|theme|c)$/i.test(m[1]) ? null : m[1];
}

// ---------- self-check ----------
if (ARGS.includes('--self-check')) {
  const t = [];
  const eq = (name, got, want) => t.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
  eq('hex 6', parseColor('#1a1c1f'), [26, 28, 31, 1]);
  eq('hex 3 expands', parseColor('#fff'), [255, 255, 255, 1]);
  eq('hex 8 keeps alpha', parseColor('#000000ff'), [0, 0, 0, 1]);
  eq('rgb', parseColor('rgb(30, 32, 36)'), [30, 32, 36, 1]);
  eq('rgba keeps alpha', parseColor('rgba(30,32,36,0.82)'), [30, 32, 36, 0.82]);
  eq('rgba quoted', parseColor("'rgba(255,255,255,0.78)'"), [255, 255, 255, 0.78]);
  eq('hsl', parseColor('hsl(0, 0%, 100%)'), [255, 255, 255, 1]);
  eq('hsla green', parseColor('hsla(120, 100%, 50%, 0.5)'), [0, 255, 0, 0.5]);
  eq('colour rejects garbage', parseColor('palette.surface'), null);
  eq('composite half white over black', over([255, 255, 255, 0.5], [0, 0, 0, 1]), [128, 128, 128]);
  eq('composite opaque is identity', over([10, 20, 30, 1], [255, 255, 255, 1]), [10, 20, 30]);
  eq('value stops at comma', valueAfter('{ color: palette.onSurface, padding: 8 }', /color\s*:\s*/), 'palette.onSurface');
  eq('value keeps rgba commas', valueAfter('{ backgroundColor: rgba(30,32,36,0.82), flex: 1 }', /backgroundColor\s*:\s*/), 'rgba(30,32,36,0.82)');
  eq('contrast black/white', contrast([0, 0, 0], [255, 255, 255]), 21);
  eq('contrast identical', contrast([18, 18, 18], [18, 18, 18]), 1);
  eq('contrast is symmetric', contrast([0, 110, 40], [255, 255, 255]), contrast([255, 255, 255], [0, 110, 40]));
  eq('ground onSurface', groundFor('onSurface'), 'surface');
  eq('ground onPrimaryContainer', groundFor('onPrimaryContainer'), 'primaryContainer');
  eq('ground of a ground', groundFor('surface'), null);
  eq('ground ignores lowercase on', groundFor('online'), null);
  eq('non-text outline', isNonText('outlineVariant'), true);
  eq('non-text glassBorder', isNonText('glassBorder'), true);
  eq('non-text onSurface is text', isNonText('onSurface'), false);
  eq('palette registers', parsePalettes(`export const P = { light: { surface: '#ffffff', onSurface: '#000000' }, dark: { surface: '#000000', onSurface: '#ffffff' } }`),
    { light: { surface: '#ffffff', onSurface: '#000000' }, dark: { surface: '#000000', onSurface: '#ffffff' } });
  eq('palette flat', parsePalettes(`export const colors = { bg: '#fff', fg: '#111' }`), { default: { bg: '#fff', fg: '#111' } });
  eq('palette none', parsePalettes('export const space = { sm: 4 }'), {});
  eq('code pair found', codePairs('const s = { card: { backgroundColor: palette.surface, color: palette.onSurface } }'),
    [{ bg: 'palette.surface', fg: 'palette.onSurface' }]);
  eq('code pair ignores bg-only', codePairs('{ box: { backgroundColor: palette.surface, padding: 8 } }'), []);
  eq('code pair not confused by borderColor', codePairs('{ a: { backgroundColor: "#fff", borderColor: "#eee" } }'), []);
  eq('token from member', tokenName('palette.onSurfaceVariant'), 'onSurfaceVariant');
  eq('token from nested', tokenName('theme.colors.primary'), 'primary');
  eq('token rejects bare namespace', tokenName('colors'), null);
  const bad = t.filter((x) => !x.ok);
  for (const x of t) console.log(`${x.ok ? 'ok  ' : 'FAIL'} ${x.name}${x.ok ? '' : ` — got ${JSON.stringify(x.got)}, want ${JSON.stringify(x.want)}`}`);
  console.log(`\n${t.length - bad.length}/${t.length} self-checks passed`);
  process.exit(bad.length ? 1 : 0);
}

// ---------- setup ----------
const DIR = flagVal('--dir') || process.cwd();
const die = (code, msg, hint = '') => {
  if (JSON_OUT) console.log(JSON.stringify({ ok: false, error: msg, hint, exitCode: code }, null, 2));
  else { console.error(msg); if (hint) console.error(`  -> ${hint}`); }
  process.exit(code);
};
try { if (!statSync(DIR).isDirectory()) throw new Error('not a dir'); } catch { die(2, `not a directory: ${DIR}`); }

const exists = (p) => { try { statSync(p); return true; } catch { return false; } };
const rel = (p) => relative(DIR, p).split('\\').join('/');
const EXCLUDE = new Set(['node_modules', '.git', 'ios', 'android', 'dist', 'build', '.expo', 'coverage', 'TRASH']);
function walk(dir, acc = [], depth = 0) {
  if (depth > 8 || acc.length >= 3000) return acc;
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) { if (!EXCLUDE.has(e.name)) walk(full, acc, depth + 1); }
    else if (/\.(tsx?|jsx?)$/.test(e.name) && !/\.(test|spec)\./.test(e.name)) acc.push(full);
  }
  return acc;
}
const read = (f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };

const files = walk(DIR);
if (!files.length) die(2, `no TS/JS source found under ${DIR}`);

// Locate the token module: explicit flag, then the conventional homes, then any file
// whose name says "theme"/"tokens"/"colors" that actually parses to a palette.
let tokenFile = flagVal('--tokens') ? join(DIR, flagVal('--tokens')) : null;
if (tokenFile && !exists(tokenFile)) tokenFile = flagVal('--tokens');
if (tokenFile && !exists(tokenFile)) die(2, `--tokens file not found: ${flagVal('--tokens')}`);
if (!tokenFile) {
  const named = files.filter((f) => /(theme|tokens|colou?rs|palette)[\w.-]*\.(tsx?|jsx?)$/i.test(f));
  tokenFile = named.find((f) => Object.keys(parsePalettes(read(f))).length) || null;
}
if (!tokenFile) {
  die(2, 'no token module found (looked for theme/tokens/colors/palette files containing hex maps).',
    'pass --tokens <file>, or seed one: cp ~/.claude/skills/tactile/starter-tokens.ts theme/tokens.ts');
}

const registers = parsePalettes(read(tokenFile));
const registerNames = Object.keys(registers);
if (!registerNames.length) die(2, `no hex colour map parsed out of ${rel(tokenFile)}`, 'expected entries like `surface: "#f9f9fe"`');

// ---------- measure ----------
const findings = [];
/**
 * Measure one ink/ground pair, honouring alpha.
 *
 * A translucent GROUND (every glass surface) has no single answer — what is behind
 * it is a runtime fact. So it is measured against both extremes, white and black,
 * and the row reports the range. A hard failure is reserved for the unambiguous
 * case: even the most flattering backdrop misses the floor. Otherwise it is an
 * advisory, same reasoning as the `*Variant` rule — a gate that fails every glass
 * UI gets switched off, and then it protects nothing.
 */
const record = (source, register, fgName, bgName, fgC, bgC, floor) => {
  const backdropDependent = bgC[3] < 1;
  const grounds = backdropDependent
    ? [over(bgC, OPAQUE_WHITE), over(bgC, OPAQUE_BLACK)]
    : [bgC];
  const ratios = grounds.map((g) => contrast(fgC[3] >= 1 ? fgC : over(fgC, g), g));
  const worst = Math.min(...ratios), best = Math.max(...ratios);
  const severity = worst >= floor ? 'pass'
    : isAdvisoryNonText(fgName) ? 'warn'
      : backdropDependent && best >= floor ? 'warn'
        : 'fail';
  findings.push({
    source, register, fg: fgName, bg: bgName, fgHex: fgC.literal, bgHex: bgC.literal,
    ratio: worst, best, floor, severity, pass: severity === 'pass', backdropDependent,
    translucentInk: fgC[3] < 1,
  });
};
const rgbOf = (literal) => { const v = parseColor(literal); return v ? Object.assign(v, { literal }) : null; };

for (const reg of registerNames) {
  const p = registers[reg];
  const has = (n) => typeof p[n] === 'string';

  // 1. CONVENTION — onX vs X
  for (const token of Object.keys(p)) {
    const ground = groundFor(token);
    if (!ground || !has(ground)) continue;
    const fg = rgbOf(p[token]), bg = rgbOf(p[ground]);
    if (fg && bg) record('convention', reg, token, ground, fg, bg, isNonText(token) ? 3 : 4.5);
  }

  // 3. NON-TEXT — outline/border/divider vs the grounds they sit on
  for (const token of Object.keys(p)) {
    if (!isNonText(token) || groundFor(token)) continue;
    for (const ground of ['surface', 'background']) {
      if (!has(ground) || ground === token) continue;
      const fg = rgbOf(p[token]), bg = rgbOf(p[ground]);
      if (fg && bg) record('non-text', reg, token, ground, fg, bg, 3);
    }
  }
}

// 2. CODE — pairs the build actually declares together
const codeSeen = new Set();
const rawHex = [];
// resolve() both sides: --tokens may arrive absolute with forward slashes while walk()
// yields backslashes, and a raw === would then re-scan the token module as "raw hex".
const tokenFileAbs = resolve(tokenFile);
for (const f of files) {
  if (resolve(f) === tokenFileAbs) continue;
  const src = read(f);
  for (const m of src.matchAll(/['"`](#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?|rgba?\([^)]*\)|hsla?\([^)]*\))['"`]/g)) {
    if (rawHex.length < 12) rawHex.push({ file: rel(f), hex: m[1] });
  }
  for (const { bg, fg } of codePairs(src)) {
    const bgT = tokenName(bg), fgT = tokenName(fg);
    const bgHex = parseColor(bg) ? bg.replace(/['"`;]/g, '').trim() : null;
    const fgHex = parseColor(fg) ? fg.replace(/['"`;]/g, '').trim() : null;
    for (const reg of registerNames) {
      const p = registers[reg];
      const bgVal = bgHex || (bgT && p[bgT]), fgVal = fgHex || (fgT && p[fgT]);
      if (!bgVal || !fgVal) continue;
      const key = `${reg}|${fgT || fgHex}|${bgT || bgHex}`;
      if (codeSeen.has(key)) continue;
      codeSeen.add(key);
      const a = rgbOf(fgVal), b = rgbOf(bgVal);
      if (a && b) record('code', reg, fgT || fgHex, bgT || bgHex, a, b, isNonText(fgT || '') ? 3 : 4.5);
    }
  }
}

// ---------- verdict ----------
const failed = findings.filter((f) => f.severity === 'fail');
const warned = findings.filter((f) => f.severity === 'warn');
const bySource = (s) => findings.filter((f) => f.source === s);

if (JSON_OUT) {
  console.log(JSON.stringify({ dir: DIR, tokens: rel(tokenFile), registers: registerNames, findings, rawHex, failed: failed.length, warned: warned.length, exitCode: failed.length ? 1 : 0 }, null, 2));
} else {
  console.log(`# check-contrast — ${rel(tokenFile)} (${registerNames.join(' + ')}) over ${files.length} source files`);
  console.log('');
  for (const s of ['convention', 'code', 'non-text']) {
    const rows = bySource(s);
    if (!rows.length) continue;
    const bad = rows.filter((r) => r.severity !== 'pass');
    console.log(`${s.toUpperCase()} — ${rows.length} pair(s), ${bad.length} below floor`);
    for (const r of bad) {
      const range = r.backdropDependent ? `${r.ratio}:1–${r.best}:1 depending on the backdrop` : `${r.ratio}:1`;
      console.log(`  ${r.severity.toUpperCase()} [${r.register}] ${r.fg} (${r.fgHex}) on ${r.bg} (${r.bgHex}) = ${range}, needs ${r.floor}:1`);
    }
    if (bad.some((r) => r.backdropDependent)) {
      console.log('       -> translucent ground: measured over white and over black, since what sits behind');
      console.log('          it is a runtime fact. Pin a backdrop, or raise the fill opacity.');
    }
    if (bad.some((r) => r.severity === 'warn')) {
      console.log('       -> a `*Variant` hairline: WCAG 1.4.11 covers only information REQUIRED to identify a');
      console.log('          component, so a decorative separator is out of scope. Load-bearing boundary? fix it.');
    }
    if (!bad.length) console.log(`  all clear (min ${Math.min(...rows.map((r) => r.ratio))}:1)`);
    console.log('');
  }
  if (rawHex.length) {
    console.log(`RAW COLOUR — ${rawHex.length}${rawHex.length === 12 ? '+' : ''} literal(s) outside the token module; these bypass the verified palette entirely`);
    for (const h of rawHex.slice(0, 6)) console.log(`  ${h.hex}  ${h.file}`);
    console.log('');
  }
  const warnNote = warned.length ? ` · ${warned.length} advisory` : '';
  console.log(failed.length
    ? `${failed.length} pair(s) below floor${warnNote} — NOT AA CLEAN`
    : `${findings.length} pair(s) measured, none below a hard floor${warnNote} — AA CLEAN`);
}
process.exit(failed.length ? 1 : 0);
