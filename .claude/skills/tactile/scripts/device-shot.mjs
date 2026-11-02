#!/usr/bin/env node
/**
 * device-shot.mjs — rendered device proof for a mobile build, as one command.
 *
 * The mobile counterpart of impeccable/scripts/shot.mjs. Before this, device proof
 * meant driving the `mobile` MCP by hand, which is fine in a session and useless in
 * a loop, a script, or a gate. More importantly it captures a screenshot WITHOUT
 * checking whether the thing on screen is the app: the classic bad proof is a
 * screenshot of the launcher taken seconds after the app crashed.
 *
 * So this is a gate, not a camera. It captures, then asks the device three questions
 * a picture cannot answer: is the app actually in the foreground, did anything crash
 * into the crash buffer, and do the captured dimensions match the real screen.
 *
 * Usage:
 *   node device-shot.mjs <out.png> [--package <app.id>] [--device <serial>]
 *                                  [--adb <path>] [--json] [--self-check] [--ios]
 *     --package   the app that MUST be in the foreground; mismatch = exit 1
 *     --device    target serial when more than one device is attached
 *     --adb       explicit adb path (else $ADB_PATH, then PATH, then the SDK default)
 *     --diff <baseline.png>    visual regression: a missing baseline is SEEDED
 *                              (exit 0); later runs fail above --diff-threshold
 *     --diff-threshold <pct>   changed-pixel budget, default 1
 *     --json      machine-readable output only
 *     --self-check  run the pure-parser self-tests and exit (no device needed)
 *     --ios       print the macOS-only simctl equivalent and exit 2 (see below)
 *
 * The diff decodes both PNGs in-process (IHDR + IDAT + zlib inflate + un-filter, no
 * dependency) and compares pixels, so two captures of the same screen match even
 * though their bytes never do. It reports the changed-pixel bounding box rather than
 * writing an overlay image — in a terminal, "confined to a 1080x60 region at (0,0)"
 * identifies the status-bar clock faster than a red PNG you have to open.
 *
 * Exit 0 = captured, and the device state looks sane
 * Exit 1 = mechanically broken (app not foreground, crash in the buffer, empty capture)
 * Exit 2 = setup error (no adb, no device, ambiguous device, bad usage)
 *
 * iOS: a simulator screenshot is `xcrun simctl io booted screenshot out.png`, which
 * needs macOS + Xcode. This host is Windows, so rather than ship an untested code
 * path, --ios prints that command and exits 2. Leo's iOS builds go through EAS or a
 * macOS runner (wiki/app-dev/stack.md), and that is where the command belongs.
 *
 * There IS a third route this script can serve, though not on its own: the `mobile`
 * MCP can reserve a real iPhone from a remote fleet (`mobile_allocate_remote_device`,
 * platform "ios"), after which it behaves like any attached device and every check
 * below applies unchanged. It is a **billed** resource and its own docs say to use it
 * only when the user has explicitly asked — so this script never reaches for it.
 * See wiki/app-dev/resources.md § iOS from a Windows host.
 */
'use strict';

import { writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';
import { join, resolve } from 'node:path';
import { homedir, platform } from 'node:os';

const ARGS = process.argv.slice(2);
const flagVal = (name) => { const i = ARGS.indexOf(name); return i >= 0 && ARGS[i + 1] ? ARGS[i + 1] : null; };
const JSON_OUT = ARGS.includes('--json');

// ---------- pure parsers (self-checked below) ----------

/** PNG intrinsic size from the IHDR header. null when the buffer is not a PNG. */
function pngSize(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/** Foreground package from `dumpsys activity activities`. Handles both prop spellings. */
function foregroundPackage(dumpsys) {
  const m = /(?:mResumedActivity|topResumedActivity|mFocusedActivity)[^\n]*?\{[^}]*?\s([\w.]+)\/[\w.$]+/.exec(String(dumpsys || ''));
  return m ? m[1] : null;
}

/** Screen size from `wm size` ("Physical size: 1080x2400", possibly with an Override line). */
function screenSize(wmOut) {
  const s = String(wmOut || '');
  const over = /Override size:\s*(\d+)x(\d+)/.exec(s);
  const phys = /Physical size:\s*(\d+)x(\d+)/.exec(s);
  const m = over || phys;
  return m ? { w: +m[1], h: +m[2] } : null;
}

/** Fatal crashes in a `logcat -b crash` dump. Returns the offending process names. */
function crashesIn(logcat) {
  const out = [];
  const re = /FATAL EXCEPTION[^\n]*\n[^\n]*Process:\s*([\w.]+)/g;
  let m;
  while ((m = re.exec(String(logcat || '')))) if (!out.includes(m[1])) out.push(m[1]);
  // A FATAL EXCEPTION with no parseable Process: line still counts as a crash.
  if (!out.length && /FATAL EXCEPTION/.test(String(logcat || ''))) out.push('(unnamed process)');
  return out;
}

/**
 * Reverse the five PNG scanline filters in place. `raw` is the inflated IDAT stream:
 * per row, one filter byte then `w * bpp` sample bytes. Returns the unfiltered samples.
 * Spec: https://www.w3.org/TR/png/#9Filters
 */
function unfilter(raw, w, h, bpp) {
  const stride = w * bpp;
  if (raw.length < (stride + 1) * h) throw new Error(`IDAT too short: ${raw.length} < ${(stride + 1) * h}`);
  const out = Buffer.alloc(stride * h);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[pos++];
    const line = raw.subarray(pos, pos + stride); pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      switch (ft) {
        case 0: break;
        case 1: v = (v + a) & 0xff; break;
        case 2: v = (v + b) & 0xff; break;
        case 3: v = (v + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
          break;
        }
        default: throw new Error(`unknown PNG filter type ${ft} on row ${y}`);
      }
      cur[x] = v;
    }
  }
  return out;
}

/** Decode a PNG to raw samples. Zero-dep; handles what `screencap -p` actually emits. */
function decodePng(buf) {
  const size = pngSize(buf);
  if (!size) throw new Error('not a PNG');
  const bitDepth = buf[24], colorType = buf[25], interlace = buf[28];
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth} (need 8)`);
  if (interlace !== 0) throw new Error('interlaced PNGs (Adam7) are not supported');
  const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };
  const bpp = CHANNELS[colorType];
  if (!bpp) throw new Error(`unsupported colour type ${colorType}${colorType === 3 ? ' (palette)' : ''}`);
  const idat = [];
  for (let p = 8; p + 8 <= buf.length;) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    if (type === 'IDAT') idat.push(buf.subarray(p + 8, p + 8 + len));
    if (type === 'IEND') break;
    p += 12 + len;                               // length + type + data + CRC
  }
  if (!idat.length) throw new Error('no IDAT chunks');
  return { ...size, bpp, data: unfilter(inflateSync(Buffer.concat(idat)), size.w, size.h, bpp) };
}

// Real devices dither slightly between frames, so an exact compare reports noise as
// change. 4/255 per channel is below anything a human reads as different.
const CHANNEL_TOLERANCE = 4;

/** Compare two decoded frames. Returns changed-pixel count, % and the changed bbox. */
function diffFrames(a, b) {
  if (a.w !== b.w || a.h !== b.h) return { sizeMismatch: true, changedPct: 100, baselineSize: `${a.w}x${a.h}`, currentSize: `${b.w}x${b.h}` };
  const total = a.w * a.h, bpp = Math.min(a.bpp, b.bpp);
  let changed = 0, x0 = a.w, y0 = a.h, x1 = -1, y1 = -1;
  for (let y = 0; y < a.h; y++) {
    for (let x = 0; x < a.w; x++) {
      const ia = (y * a.w + x) * a.bpp, ib = (y * b.w + x) * b.bpp;
      let differs = false;
      for (let c = 0; c < bpp && !differs; c++) if (Math.abs(a.data[ia + c] - b.data[ib + c]) > CHANNEL_TOLERANCE) differs = true;
      if (differs) {
        changed++;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return {
    sizeMismatch: false, changed, total,
    changedPct: Number(((changed / total) * 100).toFixed(3)),
    bbox: x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 },
  };
}

/** Attached device serials from `adb devices` (skips offline/unauthorized entries). */
function parseDevices(adbOut) {
  return String(adbOut || '')
    .split('\n').slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter((p) => p.length >= 2 && p[1] === 'device')
    .map((p) => p[0]);
}

// ---------- self-check ----------
if (ARGS.includes('--self-check')) {
  const t = [];
  const eq = (name, got, want) => t.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
  const png = Buffer.alloc(24);
  png.writeUInt32BE(0x89504e47, 0); png.write('IHDR', 12, 'ascii');
  png.writeUInt32BE(1080, 16); png.writeUInt32BE(2400, 20);
  eq('png size', pngSize(png), { w: 1080, h: 2400 });
  eq('png rejects non-png', pngSize(Buffer.from('not a png at all........')), null);
  eq('png rejects short', pngSize(Buffer.alloc(8)), null);
  eq('fg mResumedActivity', foregroundPackage('  mResumedActivity: ActivityRecord{a1b2c3 u0 com.leooa.fastingtracker/.MainActivity t42}'), 'com.leooa.fastingtracker');
  eq('fg topResumedActivity', foregroundPackage('topResumedActivity=ActivityRecord{ff u0 com.android.launcher3/.Launcher t1}'), 'com.android.launcher3');
  eq('fg none', foregroundPackage('nothing resumed here'), null);
  eq('wm physical', screenSize('Physical size: 1080x2400'), { w: 1080, h: 2400 });
  eq('wm override wins', screenSize('Physical size: 1440x3120\nOverride size: 1080x2340'), { w: 1080, h: 2340 });
  eq('wm garbage', screenSize('adb: no devices'), null);
  eq('crash named', crashesIn('E AndroidRuntime: FATAL EXCEPTION: main\nE AndroidRuntime: Process: com.leooa.app, PID: 9\n'), ['com.leooa.app']);
  eq('crash unnamed', crashesIn('FATAL EXCEPTION: main\n at Foo.bar\n'), ['(unnamed process)']);
  eq('crash none', crashesIn('--------- beginning of crash\n'), []);
  eq('devices ok', parseDevices('List of devices attached\nemulator-5554\tdevice\n1234abcd\tdevice\n'), ['emulator-5554', '1234abcd']);
  eq('devices skips offline', parseDevices('List of devices attached\nemulator-5554\toffline\nZZ\tunauthorized\n'), []);
  eq('devices empty', parseDevices('List of devices attached\n\n'), []);
  // Filters, hand-computed. One 3px row, bpp=1, then a second row for Up/Average/Paeth.
  eq('unfilter None', [...unfilter(Buffer.from([0, 10, 20, 30]), 3, 1, 1)], [10, 20, 30]);
  eq('unfilter Sub', [...unfilter(Buffer.from([1, 10, 20, 30]), 3, 1, 1)], [10, 30, 60]);
  eq('unfilter Up', [...unfilter(Buffer.from([0, 10, 20, 30, 2, 1, 2, 3]), 3, 2, 1)].slice(3), [11, 22, 33]);
  eq('unfilter Average', [...unfilter(Buffer.from([0, 10, 20, 30, 3, 0, 0, 0]), 3, 2, 1)].slice(3), [5, 12, 21]);
  eq('unfilter Paeth', [...unfilter(Buffer.from([0, 10, 20, 30, 4, 0, 0, 0]), 3, 2, 1)].slice(3), [10, 20, 30]);
  eq('unfilter rejects bad type', (() => { try { unfilter(Buffer.from([9, 1]), 1, 1, 1); return 'no throw'; } catch (e) { return e.message; } })(), 'unknown PNG filter type 9 on row 0');
  eq('unfilter rejects short IDAT', (() => { try { unfilter(Buffer.from([0]), 4, 1, 1); return 'no throw'; } catch (e) { return e.message.slice(0, 15); } })(), 'IDAT too short:');
  // Diff maths on synthetic frames.
  const frame = (w, h, fill) => ({ w, h, bpp: 1, data: Buffer.alloc(w * h, fill) });
  eq('diff identical', diffFrames(frame(4, 4, 100), frame(4, 4, 100)).changedPct, 0);
  eq('diff within tolerance', diffFrames(frame(4, 4, 100), frame(4, 4, 100 + CHANNEL_TOLERANCE)).changedPct, 0);
  eq('diff beyond tolerance', diffFrames(frame(4, 4, 100), frame(4, 4, 100 + CHANNEL_TOLERANCE + 1)).changedPct, 100);
  eq('diff size mismatch', diffFrames(frame(4, 4, 0), frame(5, 4, 0)).sizeMismatch, true);
  eq('diff bbox of one pixel', (() => {
    const b = frame(4, 4, 0); b.data[2 * 4 + 1] = 255;      // (x=1, y=2)
    return diffFrames(frame(4, 4, 0), b).bbox;
  })(), { x: 1, y: 2, w: 1, h: 1 });
  const bad = t.filter((x) => !x.ok);
  for (const x of t) console.log(`${x.ok ? 'ok  ' : 'FAIL'} ${x.name}${x.ok ? '' : ` — got ${JSON.stringify(x.got)}, want ${JSON.stringify(x.want)}`}`);
  console.log(`\n${t.length - bad.length}/${t.length} self-checks passed`);
  process.exit(bad.length ? 1 : 0);
}

// ---------- setup ----------
const die = (code, msg, hint = '') => {
  if (JSON_OUT) console.log(JSON.stringify({ ok: false, error: msg, hint, exitCode: code }, null, 2));
  else { console.error(msg); if (hint) console.error(`  -> ${hint}`); }
  process.exit(code);
};

if (ARGS.includes('--ios')) {
  die(2, 'iOS capture needs macOS + Xcode — not available on this host.',
    'On a Mac: xcrun simctl io booted screenshot out.png   (Leo\'s iOS builds run through EAS / a macOS runner — see wiki/app-dev/stack.md)');
}

const OUT = ARGS.find((a) => !a.startsWith('--') && ARGS[ARGS.indexOf(a) - 1] !== '--package'
  && ARGS[ARGS.indexOf(a) - 1] !== '--device' && ARGS[ARGS.indexOf(a) - 1] !== '--adb');
if (!OUT) die(2, 'usage: node device-shot.mjs <out.png> [--package <app.id>] [--device <serial>]');

function resolveAdb() {
  const explicit = flagVal('--adb') || process.env.ADB_PATH;
  if (explicit) return existsSync(explicit) ? explicit : null;
  const onPath = spawnSync('adb', ['version'], { encoding: 'utf8' });
  if (!onPath.error && onPath.status === 0) return 'adb';
  const candidates = platform() === 'win32'
    ? [join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Android', 'Sdk', 'platform-tools', 'adb.exe')]
    : [join(homedir(), 'Library', 'Android', 'sdk', 'platform-tools', 'adb'), join(homedir(), 'Android', 'Sdk', 'platform-tools', 'adb')];
  return candidates.find(existsSync) || null;
}

const ADB = resolveAdb();
if (!ADB) die(2, 'adb not found.', 'install Android platform-tools, or pass --adb <path> / set $ADB_PATH');

const DEVICE = flagVal('--device');
const PKG = flagVal('--package');
const adb = (args, opts = {}) => spawnSync(ADB, DEVICE ? ['-s', DEVICE, ...args] : args, { timeout: 60000, ...opts });
const adbText = (args) => { const r = adb(args, { encoding: 'utf8' }); return r.status === 0 ? String(r.stdout || '') : ''; };

const listed = adb(['devices'], { encoding: 'utf8' });
if (listed.error) die(2, `adb failed to run: ${listed.error.message}`, `path tried: ${ADB}`);
const devices = parseDevices(listed.stdout);
if (!devices.length) die(2, 'no device or emulator attached.', 'start one: emulator -avd <name>   (list: emulator -list-avds)');
if (devices.length > 1 && !DEVICE) die(2, `${devices.length} devices attached: ${devices.join(', ')}`, 'pick one with --device <serial>');
const serial = DEVICE || devices[0];

if (adbText(['shell', 'getprop', 'sys.boot_completed']).trim() !== '1') {
  die(2, `${serial} is attached but has not finished booting.`, 'wait for sys.boot_completed=1, then re-run');
}

// ---------- capture ----------
const shot = adb(['exec-out', 'screencap', '-p'], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
if (shot.status !== 0 || !shot.stdout || !shot.stdout.length) {
  die(1, 'screencap produced no data.', String(shot.stderr || '').trim() || 'device may be locked or mid-transition');
}
const size = pngSize(shot.stdout);
if (!size) die(1, 'screencap output is not a valid PNG.', `got ${shot.stdout.length} bytes`);
writeFileSync(OUT, shot.stdout);
const bytes = statSync(OUT).size;

// ---------- state checks (the part a picture cannot answer) ----------
const checks = [];
const add = (id, status, detail, hint = '') => checks.push({ id, status, detail, hint });

const wm = screenSize(adbText(['shell', 'wm', 'size']));
if (!wm) add('screen-size', 'info', 'could not read `wm size` — capture dimensions unverified');
else if (wm.w === size.w && wm.h === size.h) add('screen-size', 'pass', `capture ${size.w}x${size.h} matches the device screen`);
else add('screen-size', 'fail', `capture is ${size.w}x${size.h} but the screen is ${wm.w}x${wm.h}`, 'the capture is not a full frame — stale or cropped');

const fg = foregroundPackage(adbText(['shell', 'dumpsys', 'activity', 'activities']));
if (!PKG) add('foreground', 'info', fg ? `foreground: ${fg} (pass --package to make this a gate)` : 'foreground app unknown');
else if (!fg) add('foreground', 'fail', 'could not read the foreground activity', 'cannot prove the app was on screen');
else if (fg === PKG) add('foreground', 'pass', `${PKG} is in the foreground`);
else add('foreground', 'fail', `expected ${PKG} in the foreground, found ${fg}`, fg.includes('launcher') ? 'the app is not running — it likely crashed to the launcher' : 'a different app is on screen');

const crashed = crashesIn(adbText(['logcat', '-d', '-b', 'crash', '-t', '200']));
const relevant = PKG ? crashed.filter((p) => p === PKG) : crashed;
relevant.length
  ? add('crash-buffer', 'fail', `fatal exception in the crash buffer: ${relevant.join(', ')}`, 'adb logcat -b crash -t 200 for the stack; clear with `adb logcat -b crash -c` once fixed')
  : add('crash-buffer', 'pass', crashed.length ? `no crash for ${PKG} (other entries present: ${crashed.join(', ')})` : 'crash buffer clean');

// ponytail: compressed-size heuristic, not pixel analysis — a solid-colour frame
// compresses to almost nothing. Advisory only; upgrade to a real decode if it misfires.
const bpmp = bytes / ((size.w * size.h) / 1e6);
bpmp < 15000
  ? add('frame-content', 'warn', `${(bytes / 1024).toFixed(0)}KB for ${size.w}x${size.h} — the frame may be blank or a solid colour`, 'open the PNG and confirm the app actually rendered')
  : add('frame-content', 'pass', `${(bytes / 1024).toFixed(0)}KB of image data — the frame has real content`);

// ---------- visual regression (--diff) ----------
const DIFF = flagVal('--diff');
if (DIFF) {
  const base = resolve(DIFF);
  const threshold = Number(flagVal('--diff-threshold') || 1);
  if (!Number.isFinite(threshold) || threshold < 0) die(2, `--diff-threshold must be a non-negative number, got "${flagVal('--diff-threshold')}"`);
  if (!existsSync(base)) {
    writeFileSync(base, shot.stdout);
    add('visual-diff', 'info', `baseline seeded at ${DIFF} — later runs compare against it`);
  } else {
    try {
      const r = diffFrames(decodePng(readFileSync(base)), decodePng(shot.stdout));
      if (r.sizeMismatch) {
        add('visual-diff', 'fail', `dimensions changed ${r.baselineSize} -> ${r.currentSize} vs ${DIFF}`, 'intentional? delete the baseline to re-seed');
      } else if (r.changedPct > threshold) {
        const bb = r.bbox ? ` in a ${r.bbox.w}x${r.bbox.h} region at (${r.bbox.x},${r.bbox.y})` : '';
        add('visual-diff', 'fail', `${r.changedPct}% of pixels changed${bb} (threshold ${threshold}%) vs ${DIFF}`, 'intentional redesign? delete the baseline to re-seed');
      } else {
        const bb = r.bbox ? `, confined to a ${r.bbox.w}x${r.bbox.h} region at (${r.bbox.x},${r.bbox.y})` : '';
        add('visual-diff', 'pass', `${r.changedPct}% of pixels changed${bb} — within the ${threshold}% threshold`);
      }
    } catch (e) {
      add('visual-diff', 'fail', `could not compare against ${DIFF}: ${e.message}`, 'baseline may be corrupt or in an unsupported PNG form — re-seed it');
    }
  }
}

// ---------- verdict ----------
const fails = checks.filter((c) => c.status === 'fail').length;
const warns = checks.filter((c) => c.status === 'warn').length;
const verdict = fails ? 'BROKEN PROOF — do not present this screenshot' : warns ? 'captured, with warnings' : 'captured, device state sane';

if (JSON_OUT) {
  console.log(JSON.stringify({ ok: !fails, out: OUT, serial, size, bytes, checks, verdict, exitCode: fails ? 1 : 0 }, null, 2));
} else {
  console.log(`# device-shot — ${serial} -> ${OUT} (${size.w}x${size.h}, ${(bytes / 1024).toFixed(0)}KB)`);
  console.log('');
  for (const c of checks) console.log(`${c.status.toUpperCase().padEnd(5)} ${c.id.padEnd(14)} ${c.detail}${c.hint ? `\n      ${' '.repeat(14)} -> ${c.hint}` : ''}`);
  console.log('');
  console.log(`${verdict}`);
}
process.exit(fails ? 1 : 0);
