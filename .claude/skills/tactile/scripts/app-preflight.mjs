#!/usr/bin/env node
/**
 * app-preflight.mjs — the store-ready mobile-app completeness gate.
 *
 * The mobile mirror of impeccable/scripts/web-preflight.mjs. The other tactile
 * gates check the QUALITY of what exists (audit-rules AR-T01..AR-T31 = anti-slop
 * and platform-feel, generate-tokens = palette contrast). This one checks what a
 * shippable app MUST HAVE — the boring existence layer where AI-built apps
 * quietly read "amateur" or, worse, get rejected at upload: icons at store
 * dimensions, adaptive icon, splash, bundle identifiers, permission purpose
 * strings, safe-area handling, a 404 route, an error boundary, Dynamic Type,
 * dark mode, New Architecture, and a version/build strategy.
 *
 * Static checks are Expo-aware (Leo's primary path: Expo managed + EAS on a
 * Windows host) and Tauri-aware for desktop; on neither it degrades to the generic
 * content checks and SKIPs the rest. The Tauri checks were written against a real
 * `npm create tauri-app --template react-ts` scaffold, not a hand-written fixture,
 * which is how the `"csp": null` default was found.
 *
 * Usage:
 *   node app-preflight.mjs [--dir <path>] [--store] [--strict] [--json] [--self-check]
 *     --dir         project root (default: cwd)
 *     --store       preparing a store submission: submission blockers escalate WARN -> FAIL
 *     --strict      all warnings count as failures
 *     --json        machine-readable output only
 *     --self-check  run the pure-helper self-tests and exit (no project needed)
 *
 * Exit 0 = no failures (ship-ready on completeness; warnings may remain)
 * Exit 1 = at least one failure (or, with --strict, warning)
 * Exit 2 = usage/setup error
 *
 * Facts baked in, each verified against a primary source:
 *  - Play target-API floor = API 36 (Android 16), effective 2026-08-31 (extension to
 *    2026-11-01). developer.android.com/google/play/requirements/target-sdk (checked
 *    2026-08-13 — it still read API 35 on 2026-07-12; this floor moves annually).
 *  - Expo config plugins inject a BOILERPLATE iOS purpose string; Expo's own docs say those
 *    defaults "will most likely need to be tailored to your specific use case for your app to
 *    be accepted by the App Store." docs.expo.dev/guides/permissions/ (checked 2026-08-13)
 *  - Store icon: 1024x1024 square, no alpha/transparency, is the App Store / Play listing size.
 */
'use strict';

import { readFileSync, readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';

const ARGS = process.argv.slice(2);
const flagVal = (name) => { const i = ARGS.indexOf(name); return i >= 0 && ARGS[i + 1] ? ARGS[i + 1] : null; };
const DIR = flagVal('--dir') || process.cwd();
const IS_STORE = ARGS.includes('--store');
const STRICT = ARGS.includes('--strict');
const JSON_OUT = ARGS.includes('--json');

// ---------- pure helpers (self-checked below) ----------

/** Read a PNG's intrinsic size from its IHDR header. Zero-dep, 24 bytes. null when not a PNG. */
function pngSize(file) {
  let fd = null;
  try {
    fd = openSync(file, 'r');
    const buf = Buffer.alloc(24);
    if (readSync(fd, buf, 0, 24, 0) < 24) return null;
    if (buf.readUInt32BE(0) !== 0x89504e47) return null;           // \x89PNG
    if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  } catch { return null; }
  finally { if (fd !== null) { try { closeSync(fd); } catch { /* already closed */ } } }
}

/** Compare dotted versions. Returns true when a >= b. Missing segments read as 0. */
function gte(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return true;
}

/** Extract the leading semver-ish triple from a dependency range ("~57.0.2" -> "57.0.2"). */
function pinnedVersion(range) {
  const m = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(range || ''));
  return m ? [m[1], m[2] || '0', m[3] || '0'].join('.') : null;
}

/** iOS purpose-string keys each permission-bearing module needs before review. */
const PERMISSION_KEYS = {
  'expo-camera': ['NSCameraUsageDescription'],
  'expo-image-picker': ['NSPhotoLibraryUsageDescription'],
  'expo-media-library': ['NSPhotoLibraryUsageDescription'],
  'expo-location': ['NSLocationWhenInUseUsageDescription'],
  'expo-contacts': ['NSContactsUsageDescription'],
  'expo-calendar': ['NSCalendarsUsageDescription'],
  'expo-audio': ['NSMicrophoneUsageDescription'],
  'expo-av': ['NSMicrophoneUsageDescription'],
  'expo-sensors': ['NSMotionUsageDescription'],
  'expo-local-authentication': ['NSFaceIDUsageDescription'],
  'expo-tracking-transparency': ['NSUserTrackingUsageDescription'],
  'expo-speech-recognition': ['NSSpeechRecognitionUsageDescription'],
};

/** Which declared purpose-string keys are missing for the modules actually installed. */
function missingPurposeStrings(deps, infoPlist) {
  const missing = [];
  for (const [mod, keys] of Object.entries(PERMISSION_KEYS)) {
    if (!deps[mod]) continue;
    for (const k of keys) {
      const v = infoPlist[k];
      if (typeof v !== 'string' || v.trim().length === 0) missing.push(`${k} (${mod})`);
    }
  }
  return missing;
}

// ---------- self-check ----------
if (ARGS.includes('--self-check')) {
  const t = [];
  const eq = (name, got, want) => t.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
  eq('gte equal', gte('35', '35'), true);
  eq('gte below', gte('34', '35'), false);
  eq('gte above minor', gte('57.0.2', '57'), true);
  eq('gte deep below', gte('16.2.5', '16.2.6'), false);
  eq('pinned tilde', pinnedVersion('~57.0.2'), '57.0.2');
  eq('pinned caret major', pinnedVersion('^5.0.0-preview.1'), '5.0.0');
  eq('pinned garbage', pinnedVersion('workspace:*'), null);
  eq('purpose missing', missingPurposeStrings({ 'expo-camera': '1' }, {}), ['NSCameraUsageDescription (expo-camera)']);
  eq('purpose present', missingPurposeStrings({ 'expo-camera': '1' }, { NSCameraUsageDescription: 'To scan barcodes.' }), []);
  eq('purpose blank', missingPurposeStrings({ 'expo-camera': '1' }, { NSCameraUsageDescription: '  ' }), ['NSCameraUsageDescription (expo-camera)']);
  eq('purpose unrelated dep', missingPurposeStrings({ react: '19' }, {}), []);
  eq('png not a png', pngSize(new URL(import.meta.url).pathname), null);
  const bad = t.filter((x) => !x.ok);
  for (const x of t) console.log(`${x.ok ? 'ok  ' : 'FAIL'} ${x.name}${x.ok ? '' : ` — got ${JSON.stringify(x.got)}, want ${JSON.stringify(x.want)}`}`);
  console.log(`\n${t.length - bad.length}/${t.length} self-checks passed`);
  process.exit(bad.length ? 1 : 0);
}

try { if (!statSync(DIR).isDirectory()) throw new Error('not a dir'); }
catch { console.error(`not a directory: ${DIR}`); process.exit(2); }

// ---------- fs helpers (zero-dep, Windows-safe) ----------
const EXCLUDE_DIRS = new Set(['node_modules', '.git', 'ios', 'android', 'dist', 'build', '.expo', '.expo-shared', 'coverage', '.turbo', 'web-build', 'TRASH']);
const MAX_FILES = 4000, MAX_BYTES = 512 * 1024;

function walk(dir, acc = [], depth = 0) {
  if (depth > 8 || acc.length >= MAX_FILES) return acc;
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (acc.length >= MAX_FILES) break;
    const full = join(dir, e.name);
    if (e.isDirectory()) { if (!EXCLUDE_DIRS.has(e.name)) walk(full, acc, depth + 1); }
    else acc.push(full);
  }
  return acc;
}
function read(file) {
  try { if (statSync(file).size > MAX_BYTES) return ''; return readFileSync(file, 'utf8'); } catch { return ''; }
}
const exists = (p) => { try { statSync(p); return true; } catch { return false; } };
const listDir = (p) => { try { return readdirSync(p); } catch { return []; } };
const rel = (p) => relative(DIR, p).split('\\').join('/');
/** Resolve an app.json asset path ("./assets/icon.png") against the project root. */
const assetPath = (p) => (typeof p === 'string' && p ? (isAbsolute(p) ? p : join(DIR, p.replace(/^\.\//, ''))) : null);

// ---------- project shape ----------
const pkg = (() => { try { return JSON.parse(readFileSync(join(DIR, 'package.json'), 'utf8')); } catch { return null; } })();
const deps = pkg ? { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) } : {};

const tauriConfFile = [join(DIR, 'src-tauri', 'tauri.conf.json'), join(DIR, 'tauri.conf.json')].find(exists) || null;
const tauriConf = (() => { try { return tauriConfFile ? JSON.parse(readFileSync(tauriConfFile, 'utf8')) : null; } catch { return null; } })();
const isTauri = Boolean(tauriConfFile);

const appJsonFile = [join(DIR, 'app.json'), join(DIR, 'app.config.json')].find(exists) || null;
const dynamicCfg = ['app.config.js', 'app.config.ts', 'app.config.mjs'].map((n) => join(DIR, n)).find(exists) || null;
const appJson = (() => { try { return appJsonFile ? JSON.parse(readFileSync(appJsonFile, 'utf8')) : null; } catch { return null; } })();
const cfg = (appJson && (appJson.expo || appJson)) || {};
const isExpo = Boolean(deps.expo && (appJsonFile || dynamicCfg));

const allFiles = walk(DIR);
const ext = (f) => { const m = /\.([a-z0-9]+)$/i.exec(f); return m ? m[1].toLowerCase() : ''; };
const CODE_EXTS = new Set(['tsx', 'jsx', 'ts', 'js', 'mjs']);
const SHIP_DIRS = ['app', 'src', 'components', 'screens', 'lib', 'hooks'].map((d) => join(DIR, d));
const inShipped = (f) => SHIP_DIRS.some((d) => f.startsWith(d + '\\') || f.startsWith(d + '/'));
const isTestPath = (f) => /(^|[\\/])(tests?|__tests__|e2e|fixtures|__mocks__)([\\/])|\.(test|spec)\./.test(f);
const codeFiles = allFiles.filter((f) => CODE_EXTS.has(ext(f)) && inShipped(f) && !isTestPath(f));
const copyFiles = allFiles.filter((f) => (CODE_EXTS.has(ext(f)) || ['md', 'json'].includes(ext(f))) && inShipped(f) && !isTestPath(f));

function grepFiles(files, re, cap = 5) {
  const hits = [];
  for (const f of files) { if (re.test(read(f))) { hits.push(rel(f)); if (hits.length >= cap) break; } }
  return hits;
}
function countInFiles(files, re) {
  let n = 0;
  for (const f of files) { const m = read(f).match(re); if (m) n += m.length; }
  return n;
}

// ---------- checks ----------
const checks = [];
const add = (id, status, detail, hint = '') => checks.push({ id, status, detail, hint });
// Submission blockers: a warning here becomes a failure under --store.
const STORE_BLOCKERS = new Set(['permission-strings', 'adaptive-icon', 'version-strategy', 'eas-config', 'store-name',
  'tauri-csp', 'tauri-icons', 'tauri-bundle-targets']);
const P = (id, d) => add(id, 'pass', d);
const F = (id, d, h) => add(id, 'fail', d, h);
const W = (id, d, h) => add(id, IS_STORE && STORE_BLOCKERS.has(id) ? 'fail' : 'warn', d, h);
const I = (id, d) => add(id, 'info', d);
const S = (id, d) => add(id, 'skip', d);

const EXPO_IDS = ['app-icon', 'adaptive-icon', 'splash-screen', 'store-name', 'ios-bundle-id', 'android-package',
  'play-target-api', 'permission-strings', 'new-architecture', 'dark-mode', 'version-strategy', 'eas-config'];

if (!isExpo) {
  const why = isTauri ? 'Tauri desktop project — see the tauri-* checks' : deps.expo ? 'no app.json / app.config.* found' : 'not an Expo project (no `expo` dependency)';
  for (const id of EXPO_IDS) S(id, why);
} else {
  if (!appJson && dynamicCfg) I('config-source', `dynamic config only (${rel(dynamicCfg)}) — config checks below run against defaults and may under-report`);

  // 1. store icon — 1024x1024 is the App Store / Play listing size
  (() => {
    const p = assetPath(cfg.icon);
    if (!p) return F('app-icon', 'no `expo.icon` in the app config', 'a missing icon ships the blank placeholder — 1024x1024 PNG, no transparency');
    if (!exists(p)) return F('app-icon', `expo.icon points at "${cfg.icon}" — file not found`, 'fix the path or add the asset');
    const s = pngSize(p);
    if (!s) return W('app-icon', `icon present (${cfg.icon}) but not a readable PNG`, 'stores want a 1024x1024 PNG');
    if (s.w !== s.h) return F('app-icon', `icon is ${s.w}x${s.h} — not square`, 'stores reject non-square icons; export 1024x1024');
    if (s.w < 1024) return F('app-icon', `icon is ${s.w}x${s.w} — below the 1024x1024 store size`, 'App Store Connect and Play both want 1024x1024');
    P('app-icon', `icon ${s.w}x${s.h} (${cfg.icon})`);
  })();

  // 2. android adaptive icon
  (() => {
    const fg = cfg.android?.adaptiveIcon?.foregroundImage;
    const p = assetPath(fg);
    if (!p) return W('adaptive-icon', 'no android.adaptiveIcon.foregroundImage', 'without it Android shows the legacy icon letterboxed inside the system mask');
    if (!exists(p)) return F('adaptive-icon', `adaptiveIcon.foregroundImage points at "${fg}" — file not found`, 'fix the path or add the asset');
    P('adaptive-icon', `adaptive icon present (${fg})`);
  })();

  // 3. splash
  (() => {
    const plugins = Array.isArray(cfg.plugins) ? cfg.plugins : [];
    const hasPlugin = plugins.some((x) => (Array.isArray(x) ? x[0] : x) === 'expo-splash-screen');
    const legacy = cfg.splash?.image;
    const p = assetPath(legacy);
    if (hasPlugin) return P('splash-screen', 'expo-splash-screen plugin configured');
    if (!legacy) return F('splash-screen', 'no splash configured (no expo-splash-screen plugin, no expo.splash.image)', 'cold start flashes a bare white screen — the first frame a user ever sees');
    if (!exists(p)) return F('splash-screen', `expo.splash.image points at "${legacy}" — file not found`, 'fix the path or add the asset');
    P('splash-screen', `splash image present (${legacy})`);
  })();

  // 3b. store name length — both stores cap the app name at 30 characters:
  // Apple (developer.apple.com/help/app-store-connect/reference/app-information/) and
  // Google Play (support.google.com/googleplay/android-developer/answer/9859152),
  // both checked 2026-08-13. Warn rather than fail: the listing title can be
  // maintained in the console separately from `expo.name`.
  (() => {
    const name = cfg.name;
    if (typeof name !== 'string' || !name.trim()) return F('store-name', 'no expo.name', 'the app has no display name — it ships as the slug');
    if (name.length <= 30) return P('store-name', `expo.name "${name}" (${name.length}/30 chars)`);
    W('store-name', `expo.name is ${name.length} chars — both stores cap the app name at 30`, `it will be truncated in listings and on the home screen; shorten to <=30 ("${name.slice(0, 30)}")`);
  })();

  // 4-5. identifiers — hard submission blockers
  cfg.ios?.bundleIdentifier
    ? P('ios-bundle-id', `ios.bundleIdentifier = ${cfg.ios.bundleIdentifier}`)
    : F('ios-bundle-id', 'no ios.bundleIdentifier — an iOS build cannot be submitted', 'set a reverse-DNS id (com.you.app); it is permanent once shipped');
  cfg.android?.package
    ? P('android-package', `android.package = ${cfg.android.package}`)
    : F('android-package', 'no android.package — an Android build cannot be submitted', 'set a reverse-DNS package; it is permanent once shipped');

  // 6. Play target-API floor. Google raised this to API 36 (Android 16) effective
  // 2026-08-31, with extensions available to 2026-11-01:
  // "New apps and app updates must target Android 16 (API level 36) or higher to be
  // submitted to Google Play" — developer.android.com/google/play/requirements/target-sdk,
  // checked 2026-08-13. (On 2026-07-12 the same page still said API 35 and referenced 36
  // only for behavior changes; this floor moves annually, so re-read before trusting it.)
  (() => {
    const plugins = Array.isArray(cfg.plugins) ? cfg.plugins : [];
    const bp = plugins.find((x) => Array.isArray(x) && x[0] === 'expo-build-properties');
    const pinned = bp?.[1]?.android?.targetSdkVersion;
    if (pinned == null) return P('play-target-api', 'no targetSdkVersion override — the Expo SDK default is used (confirm it reaches API 36 before a post-2026-08-31 submission)');
    if (gte(String(pinned), '36')) return P('play-target-api', `targetSdkVersion ${pinned} >= the Play floor (36)`);
    F('play-target-api', `targetSdkVersion ${pinned} is BELOW the Play floor of API 36`,
      'Play requires API 36+ for new apps and updates from 2026-08-31 (extension available to 2026-11-01) — drop the override or raise it');
  })();

  // 7. iOS purpose strings for the permission modules actually installed
  (() => {
    const infoPlist = cfg.ios?.infoPlist || {};
    const missing = missingPurposeStrings(deps, infoPlist);
    const installed = Object.keys(PERMISSION_KEYS).filter((m) => deps[m]);
    if (!installed.length) return P('permission-strings', 'no permission-bearing Expo modules installed');
    if (!missing.length) return P('permission-strings', `explicit purpose strings for all ${installed.length} permission module(s)`);
    W('permission-strings', `no explicit purpose string for ${missing.join(', ')}`,
      'the config plugin injects a boilerplate reason; Expo docs say those defaults "will most likely need to be tailored to your specific use case for your app to be accepted by the App Store" — write the real reason in ios.infoPlist');
  })();

  // 8. New Architecture (mandatory in current SDKs)
  cfg.newArchEnabled === false
    ? F('new-architecture', 'newArchEnabled is explicitly false', 'the New Architecture is mandatory in current Expo/RN — opting out strands you on an unsupported path')
    : P('new-architecture', cfg.newArchEnabled === true ? 'newArchEnabled: true' : 'New Architecture on (SDK default)');

  // 9. dark mode
  (() => {
    const ui = cfg.userInterfaceStyle;
    if (ui === 'automatic' || ui === 'dark') return P('dark-mode', `userInterfaceStyle: ${ui}`);
    const usesScheme = grepFiles(codeFiles, /useColorScheme|useThemeColor/, 1).length > 0;
    W('dark-mode', ui ? `userInterfaceStyle: ${ui} — the app is locked out of dark mode` : 'no userInterfaceStyle (defaults to light-only)',
      usesScheme ? 'the code reads the color scheme but the config pins it — set "automatic"' : 'set "automatic" and give the tokens a dark register (tactile reference/mobile-color.md)');
  })();

  // 10. version / build-number strategy
  (() => {
    const easRaw = read(join(DIR, 'eas.json'));
    const autoInc = /"autoIncrement"\s*:\s*(true|"version"|"buildNumber"|"versionCode")/.test(easRaw);
    const manual = cfg.ios?.buildNumber || cfg.android?.versionCode;
    if (!cfg.version) return F('version-strategy', 'no expo.version', 'stores key every upload on the version string');
    if (autoInc || manual) return P('version-strategy', `version ${cfg.version} + ${autoInc ? 'EAS autoIncrement' : 'manual build number'}`);
    W('version-strategy', `version ${cfg.version} but no buildNumber/versionCode and no EAS autoIncrement`, 'the second upload of the same build number is rejected — set autoIncrement in eas.json');
  })();

  // 11. EAS build config
  (() => {
    if (!exists(join(DIR, 'eas.json'))) return W('eas-config', 'no eas.json', 'iOS builds cannot run on this Windows host without EAS or a macOS runner — `eas build:configure`');
    let profiles = {};
    try { profiles = JSON.parse(read(join(DIR, 'eas.json'))).build || {}; } catch { return F('eas-config', 'eas.json is not valid JSON', 'fix the syntax — EAS will refuse the build'); }
    const names = Object.keys(profiles);
    if (!names.length) return F('eas-config', 'eas.json has no build profiles', 'add development / preview / production profiles');
    names.includes('production')
      ? P('eas-config', `eas.json build profiles: ${names.join(', ')}`)
      : W('eas-config', `eas.json profiles (${names.join(', ')}) include no "production"`, 'store builds come from a production profile');
  })();
}

// ---------- Tauri desktop ----------
// Shapes verified against a real `npm create tauri-app --template react-ts` scaffold
// (2026-08-13), not a hand-written fixture — including its default `"csp": null`.
if (isTauri) {
  const conf = tauriConf;
  const confDir = tauriConfFile.slice(0, tauriConfFile.lastIndexOf(tauriConfFile.includes('\\') ? '\\' : '/'));
  if (!conf) {
    F('tauri-config', `${rel(tauriConfFile)} is not valid JSON`, 'the build will refuse it');
  } else {
    // The identifier is permanent once distributed, exactly like a mobile bundle id.
    (() => {
      const id = conf.identifier;
      if (!id) return F('tauri-identifier', 'no `identifier` in tauri.conf.json', 'reverse-DNS, and permanent once shipped');
      if (/^com\.tauri\.dev$/i.test(id) || /^com\.example\./i.test(id)) return F('tauri-identifier', `identifier is the placeholder "${id}"`, 'set a real reverse-DNS id before distributing');
      P('tauri-identifier', `identifier = ${id}`);
    })();
    conf.productName ? P('tauri-product-name', `productName = ${conf.productName}`) : F('tauri-product-name', 'no `productName`', 'the window title and installer name come from this');
    conf.version ? P('tauri-version', `version = ${conf.version}`) : F('tauri-version', 'no `version`', 'installers and the updater key off it');

    // Bundle icons: every declared path must resolve, and the platform-native
    // formats must be present or the macOS/Windows bundles ship a default icon.
    (() => {
      const icons = conf.bundle?.icon;
      if (!Array.isArray(icons) || !icons.length) return F('tauri-icons', 'no `bundle.icon` list', 'the app ships the default Tauri icon');
      const missing = icons.filter((p) => !exists(join(confDir, p)));
      if (missing.length) return F('tauri-icons', `declared icon(s) not found: ${missing.join(', ')}`, 'fix the paths or run `tauri icon <source.png>`');
      const has = (ext) => icons.some((p) => p.toLowerCase().endsWith(ext));
      const gaps = [!has('.icns') && 'icns (macOS)', !has('.ico') && 'ico (Windows)'].filter(Boolean);
      gaps.length
        ? W('tauri-icons', `${icons.length} icon(s) resolve, but no ${gaps.join(' or ')}`, 'that platform\'s bundle falls back to a default icon')
        : P('tauri-icons', `${icons.length} icon(s) resolve, incl. icns + ico`);
    })();

    // Tauri: "The CSP protection is only enabled if set on the Tauri configuration
    // file." (tauri.app/security/csp, checked 2026-08-13) — null means no protection.
    (() => {
      const csp = conf.app?.security?.csp;
      if (csp == null) return W('tauri-csp', 'app.security.csp is null — CSP protection is OFF (the scaffold default)', 'Tauri enables CSP only when set; make it as restricted as possible, and required if the webview loads any remote content');
      P('tauri-csp', 'a Content Security Policy is set');
    })();

    conf.bundle?.targets
      ? P('tauri-bundle-targets', `bundle.targets = ${JSON.stringify(conf.bundle.targets)}`)
      : W('tauri-bundle-targets', 'no `bundle.targets`', 'declare the installers you actually ship rather than defaulting');

    // Capabilities: a wildcard permission hands the webview the whole API surface.
    (() => {
      const capDir = join(confDir, 'capabilities');
      const files = listDir(capDir).filter((n) => n.endsWith('.json'));
      if (!files.length) return W('tauri-capabilities', 'no capabilities/*.json found', 'v2 gates every command through a capability — without one the app can call nothing, or an older config is in play');
      const wide = [];
      for (const f of files) {
        let perms = [];
        try { perms = JSON.parse(read(join(capDir, f))).permissions || []; } catch { continue; }
        for (const p of perms) if (typeof p === 'string' && /(^|:)allow-all|\*/.test(p)) wide.push(`${f}: ${p}`);
      }
      wide.length
        ? F('tauri-capabilities', `wildcard permission(s): ${wide.join(', ')}`, 'grant the specific commands the app uses, never the whole surface')
        : P('tauri-capabilities', `${files.length} capability file(s), no wildcard permissions`);
    })();

    // An updater without a pubkey cannot verify what it installs.
    (() => {
      const up = conf.plugins?.updater;
      if (!up || up.active === false) return S('tauri-updater', 'no updater configured');
      up.pubkey ? P('tauri-updater', 'updater configured with a pubkey') : F('tauri-updater', 'updater is active but has no `pubkey`', 'unsigned updates cannot be verified — generate one with `tauri signer generate`');
    })();
  }
} else {
  for (const id of ['tauri-identifier', 'tauri-product-name', 'tauri-version', 'tauri-icons', 'tauri-csp', 'tauri-bundle-targets', 'tauri-capabilities', 'tauri-updater']) {
    S(id, 'not a Tauri project (no src-tauri/tauri.conf.json)');
  }
}

// ---------- cross-stack checks (run on any RN project) ----------
const isRN = Boolean(deps['react-native']);

// 12. safe-area handling (existence layer under AR-T27 / AR-T28)
(() => {
  if (!isRN) return S('safe-area', 'not a React Native project');
  if (!deps['react-native-safe-area-context']) {
    return F('safe-area', 'react-native-safe-area-context is not installed', 'every screen must survive the notch/Dynamic Island/gesture bar — tactile reference/safe-area-and-devices.md');
  }
  const bare = grepFiles(codeFiles, /SafeAreaView[\s\S]{0,120}from\s*['"]react-native['"]/);
  if (bare.length) return F('safe-area', `deprecated RN SafeAreaView imported in ${bare.join(', ')}`, 'AR-T27 BLOCK — import from react-native-safe-area-context and pass explicit `edges`');
  const used = grepFiles(codeFiles, /useSafeAreaInsets|SafeAreaProvider|SafeAreaView/, 1).length > 0;
  used ? P('safe-area', 'safe-area-context installed and used') : F('safe-area', 'safe-area-context installed but never used in shipped code', 'AR-T28 BLOCK — screens are drawing under the notch and the home indicator');
})();

// 13. 404 route (expo-router)
(() => {
  if (!deps['expo-router']) return S('not-found-route', 'not an expo-router project');
  const appDir = ['app', join('src', 'app')].map((p) => join(DIR, p)).find((p) => exists(p));
  if (!appDir) return F('not-found-route', 'expo-router installed but no app/ directory', 'expo-router needs app/');
  listDir(appDir).some((n) => /^\+not-found\.(tsx|jsx|js)$/.test(n))
    ? P('not-found-route', 'app/+not-found.* present')
    : F('not-found-route', 'no app/+not-found.* — a bad deep link dead-ends on the unstyled default', 'add a designed +not-found route with a way back');
})();

// 14. error boundary
(() => {
  if (!isRN) return S('error-boundary', 'not a React Native project');
  const hits = grepFiles(codeFiles, /export\s+(function|const)\s+ErrorBoundary|componentDidCatch|<ErrorBoundary[\s>]/, 1);
  hits.length ? P('error-boundary', `error boundary present (${hits[0]})`) : W('error-boundary', 'no ErrorBoundary / componentDidCatch in shipped code', 'a JS throw in production shows a red-screen crash, not a designed recovery state');
})();

// 15. Dynamic Type — a hard a11y floor on both platforms
(() => {
  if (!isRN) return S('dynamic-type', 'not a React Native project');
  const off = grepFiles(codeFiles, /allowFontScaling\s*=\s*\{\s*false\s*\}/);
  off.length
    ? F('dynamic-type', `allowFontScaling={false} in ${off.join(', ')}`, 'this hard-breaks iOS Dynamic Type / Android font scale — cap with maxFontSizeMultiplier instead of disabling')
    : P('dynamic-type', 'no allowFontScaling={false} — text respects the system size');
})();

// 16-17. hygiene + context
(() => {
  const hits = grepFiles(copyFiles, /lorem\s+ipsum|placehold\.co|via\.placeholder|placekitten|placeholder\.com/i);
  hits.length ? F('placeholder-copy', `placeholder content in ${hits.join(', ')}`, 'real copy before ship — tactile reference/craft.md') : P('placeholder-copy', 'no lorem ipsum / placeholder-image hosts in shipped code');
})();
(() => {
  const n = countInFiles(codeFiles, /console\.log\(/g);
  n ? W('console-noise', `${n} console.log call(s) in shipped code`, 'strip or demote to a logger before ship') : P('console-noise', 'no console.log in shipped code');
})();
exists(join(DIR, '.tactile.md'))
  ? P('design-context', '.tactile.md present (design context captured)')
  : W('design-context', 'no .tactile.md — design context was never captured', 'run /tactile teach (audience/brand/platform register cannot be inferred from code)');
(() => {
  const tokens = allFiles.filter((f) => /(^|[\\/])(tokens|theme|design-tokens)\.(ts|tsx|js)$/i.test(f) && inShipped(f));
  tokens.length ? I('design-tokens', `token module present (${rel(tokens[0])})`) : I('design-tokens', 'no tokens.ts/theme.ts found (tactile starter-tokens.ts not seeded?)');
})();
(() => {
  const nw = pinnedVersion(deps.nativewind);
  if (!nw) return;
  gte(nw, '5.0.0')
    ? W('nativewind-preview', `nativewind ${nw} — the v5 line is PREVIEW, not stable`, 'production-stable is NativeWind v4 + Tailwind v3 (wiki app-dev/stack.md); re-check dist-tags before shipping on v5')
    : P('nativewind-preview', `nativewind ${nw} (stable line)`);
})();
I('sdk-versions', `expo ${pinnedVersion(deps.expo) || 'n/a'} · react-native ${pinnedVersion(deps['react-native']) || 'n/a'} · react ${pinnedVersion(deps.react) || 'n/a'} — compare against wiki app-dev/stack.md`);
I('todo-markers', `${countInFiles(codeFiles, /\bTODO\b|\bFIXME\b|\bHACK\b/g)} TODO/FIXME/HACK marker(s) in shipped code`);

// ---------- verdict ----------
if (STRICT) for (const c of checks) if (c.status === 'warn') c.status = 'fail';
const count = (s) => checks.filter((c) => c.status === s).length;
const fails = count('fail'), warns = count('warn');
const verdict = fails ? 'NOT SHIP-READY (completeness)' : warns ? `SHIP-READY on completeness — ${warns} warning(s) to weigh` : 'SHIP-READY (completeness)';

if (JSON_OUT) {
  console.log(JSON.stringify({ dir: DIR, isExpo, isRN, store: IS_STORE, strict: STRICT, checks, counts: { pass: count('pass'), warn: warns, fail: fails, skip: count('skip'), info: count('info') }, verdict, exitCode: fails ? 1 : 0 }, null, 2));
} else {
  console.log(`# app-preflight — ${DIR}${isExpo ? '' : ' (generic mode: not an Expo project)'}${IS_STORE ? ' [--store]' : ''}${STRICT ? ' [--strict]' : ''}`);
  console.log('');
  for (const c of checks) {
    console.log(`${c.status.toUpperCase().padEnd(5)} ${c.id.padEnd(20)} ${c.detail}${c.hint ? `\n      ${' '.repeat(20)} -> ${c.hint}` : ''}`);
  }
  console.log('');
  console.log(`${count('pass')} pass · ${warns} warn · ${fails} fail · ${count('skip')} skip — ${verdict}`);
  console.log('');
  console.log('Beyond this script — still required before "done" (tactile craft.md):');
  console.log('  · audit-rules.md AR-T01..AR-T31 grep sheet, canary first — 0 BLOCK hits   [in-session]');
  console.log('  · run on a real device/simulator and screenshot it                        [mcp__mobile__*]');
  console.log('  · touch-target geometry confirmed visually on the frame (AR-T01)');
  console.log('  · VoiceOver / TalkBack walk of the primary flow    [procedure: reference/platform-verification.md]');
  console.log('  · states pass: loading / empty / error / offline on every screen');
}
process.exit(fails ? 1 : 0);
