#!/usr/bin/env node
// Checks a static export before it is deployed or published as an update (docs/deploy.md): the JavaScript has to carry
// the API host and the Clerk publishable key, or the build runs in demo mode (no API URL, so every session is the
// recorded one about API) or can't sign anyone in (no Clerk key), as a web deploy did for five minutes on Oct 23 when
// `expo export` reused its cache. No dependencies, so it runs anywhere Node does:
//
//   node scripts/check-export.mjs [dist]        from app/; dist defaults to app/dist
//
// Not an npm script on purpose: Expo hashes app/package.json's `scripts` into the native fingerprint, so a new one
// would strand the installed build (docs/deploy.md). The expected values are the ones Expo inlined: EXPO_PUBLIC_API_URL
// and EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY from the process, else from the .env files next to dist, in Expo's order for an
// export (.env.production.local, .env.local, .env.production, .env). Exit 0 when every check passes, 1 otherwise.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/** The .env files Expo reads for an export, first one wins. */
const ENV_FILES = [".env.production.local", ".env.local", ".env.production", ".env"];
/** Where `expo export` puts the JavaScript: the web chunks (web/*.js) and the Android bundle (android/*.hbc). */
const JS_DIR = join("_expo", "static", "js");
const CLERK_KEY = /^pk_(test|live)_[A-Za-z0-9]+$/;
const ANY_CLERK_KEY = /pk_(test|live)_[A-Za-z0-9]{20,}/;
/** A deployed build can't reach these: the export was made with a local .env. */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|\d+\.\d+\.\d+\.\d+)(:\d+)?$/;
/** Check URL host literals, not harmless Expo/URL-runtime error text that also mentions "localhost". */
const LOCAL_ENDPOINTS = [
  ["localhost", /(?:https?:)?\/\/localhost(?::\d+)?(?:[/?#"'`\x00]|$)/i],
  ["127.0.0.1", /(?:https?:)?\/\/127\.0\.0\.1(?::\d+)?(?:[/?#"'`\x00]|$)/i],
  ["[::1]", /(?:https?:)?\/\/\[::1\](?::\d+)?(?:[/?#"'`\x00]|$)/i],
  ["0.0.0.0", /(?:https?:)?\/\/0\.0\.0\.0(?::\d+)?(?:[/?#"'`\x00]|$)/i],
  ["10.0.2.2", /(?:https?:)?\/\/10\.0\.2\.2(?::\d+)?(?:[/?#"'`\x00]|$)/i],
];

/** KEY=value lines of one .env file, as Expo reads them (comments skipped, quotes stripped); {} when it is missing. */
function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const values = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    let value = match[2];
    const quoted = /^(["'])(.*)\1$/.exec(value);
    if (quoted) value = quoted[2];
    else value = value.replace(/\s+#.*$/, "");
    values[match[1]] = value;
  }
  return values;
}

/** The two values Expo inlined into the export: the process first, then the .env files in `projectDir`. */
function expectedFrom(env, projectDir) {
  const names = ["EXPO_PUBLIC_API_URL", "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY", "EXPO_PUBLIC_DEV_KEY"];
  const found = Object.fromEntries(names.map((name) => [name, env[name]?.trim() || undefined]));
  for (const file of ENV_FILES) {
    const values = readEnvFile(join(projectDir, file));
    for (const name of names) found[name] ??= values[name]?.trim() || undefined;
  }
  return { apiUrl: found.EXPO_PUBLIC_API_URL, clerkKey: found.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY, devKey: found.EXPO_PUBLIC_DEV_KEY };
}

/** Every file under dist/_expo/static/js, whatever the platform. */
function bundlesIn(dist) {
  const root = join(dist, JS_DIR);
  if (!existsSync(root)) return [];
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else files.push(path);
    }
  };
  walk(root);
  return files.sort();
}

/**
 * Checks the export in `dist` against the values the environment named. Returns the problems (none means the export is
 * fit to deploy) and what was found where.
 */
function checkExport(dist, { apiUrl, clerkKey, devKey }) {
  const problems = [];
  const found = [];
  let host = null;
  if (!apiUrl) {
    problems.push("EXPO_PUBLIC_API_URL is not set (the process, or a .env file next to dist): the export ran in demo mode, with no API");
  } else if (!URL.canParse(apiUrl)) {
    problems.push(`EXPO_PUBLIC_API_URL is not a URL: ${apiUrl}`);
  } else {
    host = new URL(apiUrl).host;
    if (LOCAL_HOST.test(host)) problems.push(`EXPO_PUBLIC_API_URL points at ${host}, which no phone or browser out there can reach`);
  }
  if (clerkKey && !CLERK_KEY.test(clerkKey)) problems.push("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is not a Clerk publishable key (pk_test_… or pk_live_…)");

  const bundles = bundlesIn(dist);
  if (bundles.length === 0) {
    problems.push(`no JavaScript under ${join(dist, JS_DIR)}: run \`npx expo export --platform web --clear\` first`);
    return { ok: false, problems, found };
  }
  let hostIn = null;
  let keyIn = null;
  let devKeyIn = null;
  for (const path of bundles) {
    const bytes = readFileSync(path);
    const name = relative(dist, path);
    const source = bytes.toString("latin1");
    const normalized = source.replace(/\\+\//g, "/");
    const endpoints = path.endsWith(".hbc") ? normalized.replaceAll("http://localhost:8081/", "") : normalized;
    for (const [host, pattern] of LOCAL_ENDPOINTS) {
      if (pattern.test(endpoints)) problems.push(`${host} endpoint appears in ${name}: local-only references must not be in a production export`);
    }
    if (devKey && devKeyIn === null && bytes.includes(devKey)) devKeyIn = name;
    if (host && hostIn === null && bytes.includes(host)) hostIn = name;
    if (keyIn === null) {
      // the key Expo was given when it is known, else any publishable key
      if (clerkKey ? bytes.includes(clerkKey) : ANY_CLERK_KEY.test(bytes.toString("latin1"))) keyIn = name;
    }
  }
  if (host) {
    if (hostIn) found.push(`${host} in ${hostIn}`);
    else problems.push(`${host} is in none of ${bundles.length} bundle files: demo mode, or exported without --clear or without the environment. Don't deploy`);
  }
  if (devKeyIn) problems.push(`EXPO_PUBLIC_DEV_KEY is present in ${devKeyIn}: it is for the local harness only`);
  if (keyIn) found.push(`${clerkKey ? `the Clerk key ${clerkKey.slice(0, 8)}…` : "a Clerk key"} in ${keyIn}`);
  else problems.push(`${clerkKey ? `the Clerk key ${clerkKey.slice(0, 8)}…` : "no Clerk publishable key (pk_…)"} is in none of ${bundles.length} bundle files: nobody could sign in. Don't deploy`);
  return { ok: problems.length === 0, problems, found };
}

function main(argv) {
  const dist = resolve(argv[2] ?? "dist");
  const { ok, problems, found } = checkExport(dist, expectedFrom(process.env, dirname(dist)));
  for (const line of found) console.log(`ok    ${line}`);
  for (const line of problems) console.error(`FAIL  ${line}`);
  console.log(ok ? `\n${dist} carries the API and the Clerk key: fit to deploy` : `\n${problems.length} problem(s) with ${dist}: don't deploy`);
  return ok ? 0 : 1;
}

process.exitCode = main(process.argv);
