// scripts/check-export.mjs, run as docs/deploy.md says: an export is fit to deploy only when its JavaScript carries the
// API host and the Clerk key (#163). Each case is a throwaway project folder with a dist and, where the case needs it,
// a .env file; the script runs as a child process, so what is tested is the command itself and its exit code.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
// Node's URL, not the DOM one the app's types also declare, so fileURLToPath accepts it
import { fileURLToPath, URL } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/check-export.mjs", import.meta.url));
const API = "https://api.example.test";
const KEY = "pk_test_Zm9yLWxvY2FsLXRlc3RzLW9ubHk";

/** A project folder with one web chunk holding `js`, an optional Android bundle, and an optional .env file. */
function project(t: TestContext, { js, hbc, env }: { js: string; hbc?: string; env?: Record<string, string> }) {
  const dir = mkdtempSync(join(tmpdir(), "lumente-export-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const web = join(dir, "dist", "_expo", "static", "js", "web");
  mkdirSync(web, { recursive: true });
  writeFileSync(join(web, "entry-abc123.js"), js);
  if (hbc !== undefined) {
    const android = join(dir, "dist", "_expo", "static", "js", "android");
    mkdirSync(android, { recursive: true });
    writeFileSync(join(android, "entry-def456.hbc"), Buffer.from(`\u0000\u0001${hbc}\u0000`, "latin1"));
  }
  if (env) writeFileSync(join(dir, ".env.local"), Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
  return join(dir, "dist");
}

type Expected = Partial<Record<"EXPO_PUBLIC_API_URL" | "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY" | "EXPO_PUBLIC_DEV_KEY", string>>;

/** Runs the script on `dist` as a deploy would, with `env` as the only EXPO_PUBLIC_* values in its environment. */
function check(dist: string, env: Expected = {}) {
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  delete childEnv.EXPO_PUBLIC_API_URL;
  delete childEnv.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
  delete childEnv.EXPO_PUBLIC_DEV_KEY;
  const run = spawnSync(process.execPath, [SCRIPT, dist], { encoding: "utf8", env: { ...childEnv, ...env } });
  return { code: run.status, out: run.stdout + run.stderr };
}

test("an export whose chunk carries the host and the key passes, with the values named in the output", (t) => {
  const dist = project(t, { js: `var u="${API}",k="${KEY}";`, hbc: `${API}\u0000${KEY}` });
  const { code, out } = check(dist, { EXPO_PUBLIC_API_URL: API, EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: KEY });
  assert.equal(code, 0, out);
  assert.match(out, /ok {4}api\.example\.test in _expo[\\/]static[\\/]js[\\/]android[\\/]entry-def456\.hbc/);
  assert.match(out, /ok {4}the Clerk key pk_test_… in/);
  assert.match(out, /fit to deploy/);
  // the key may be in the output's first 8 characters only: the whole key never prints
  assert.doesNotMatch(out, new RegExp(KEY));
});

test("the expected values come from the .env files next to dist when the process has none, and the process wins", (t) => {
  const dist = project(t, { js: `"${API}" "${KEY}"`, env: { EXPO_PUBLIC_API_URL: `"${API}"`, EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: `${KEY} # the dev instance` } });
  assert.equal(check(dist).code, 0);
  // the process names another host: the chunk doesn't carry it
  const other = check(dist, { EXPO_PUBLIC_API_URL: "https://other.example.test" });
  assert.equal(other.code, 1);
  assert.match(other.out, /other\.example\.test is in none of 1 bundle files/);
});

test("a demo-mode export fails: the host is in no chunk", (t) => {
  const dist = project(t, { js: `var k="${KEY}";` });
  const { code, out } = check(dist, { EXPO_PUBLIC_API_URL: API, EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: KEY });
  assert.equal(code, 1);
  assert.match(out, /FAIL {2}api\.example\.test is in none of 1 bundle files: demo mode/);
  assert.match(out, /don't deploy/);
});

test("an export with no Clerk key fails, whether the key is known or not", (t) => {
  const dist = project(t, { js: `var u="${API}";` });
  const known = check(dist, { EXPO_PUBLIC_API_URL: API, EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: KEY });
  assert.equal(known.code, 1);
  assert.match(known.out, /the Clerk key pk_test_… is in none of 1 bundle files: nobody could sign in/);
  const unknown = check(dist, { EXPO_PUBLIC_API_URL: API });
  assert.equal(unknown.code, 1);
  assert.match(unknown.out, /no Clerk publishable key \(pk_…\) is in none/);
  // with no key named, any publishable key in a chunk passes
  const anyKey = project(t, { js: `var u="${API}",k="pk_live_${"a".repeat(24)}";` });
  assert.equal(check(anyKey, { EXPO_PUBLIC_API_URL: API }).code, 0);
});

test("no API URL anywhere, a local one, or an empty dist each fail with the reason", (t) => {
  const dist = project(t, { js: `var u="${API}",k="${KEY}";` });
  const unset = check(dist, { EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: KEY });
  assert.equal(unset.code, 1);
  assert.match(unset.out, /EXPO_PUBLIC_API_URL is not set .*demo mode/);
  const local = check(project(t, { js: `var u="http://localhost:3000",k="${KEY}";` }), { EXPO_PUBLIC_API_URL: "http://localhost:3000", EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: KEY });
  assert.equal(local.code, 1);
  assert.match(local.out, /localhost:3000, which no phone or browser out there can reach/);
  const empty = mkdtempSync(join(tmpdir(), "lumente-empty-"));
  t.after(() => rmSync(empty, { recursive: true, force: true }));
  const nothing = check(join(empty, "dist"), { EXPO_PUBLIC_API_URL: API, EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: KEY });
  assert.equal(nothing.code, 1);
  assert.match(nothing.out, /no JavaScript under .*run `npx expo export --platform web --clear` first/);
});

test("a production export rejects the dev key and loopback references without printing the key", (t) => {
  const devKey = "local-harness-key-for-this-test-only";
  const dist = project(t, { js: `var u="${API}",k="${KEY}",d="${devKey}",a="http://localhost:18130",b="http://127.0.0.1:18130";` });
  const { code, out } = check(dist, {
    EXPO_PUBLIC_API_URL: API,
    EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: KEY,
    EXPO_PUBLIC_DEV_KEY: devKey,
  });
  assert.equal(code, 1);
  assert.match(out, /EXPO_PUBLIC_DEV_KEY is present/);
  assert.match(out, /localhost endpoint appears/);
  assert.match(out, /127\.0\.0\.1 endpoint appears/);
  assert.doesNotMatch(out, new RegExp(devKey));
});

test("a dev key loaded from the export .env files is also rejected", (t) => {
  const devKey = "local-harness-key-from-env";
  const dist = project(t, {
    js: `var u="${API}",k="${KEY}",d="${devKey}";`,
    env: { EXPO_PUBLIC_API_URL: API, EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: KEY, EXPO_PUBLIC_DEV_KEY: devKey },
  });
  const { code, out } = check(dist);
  assert.equal(code, 1);
  assert.match(out, /EXPO_PUBLIC_DEV_KEY is present/);
  assert.doesNotMatch(out, new RegExp(devKey));
});

test("runtime help text that mentions localhost is not mistaken for a local endpoint", (t) => {
  const dist = project(t, { js: `var u="${API}",k="${KEY}",fallback="hostname:'localhost'",message="localhost/https";` });
  const { code, out } = check(dist, { EXPO_PUBLIC_API_URL: API, EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: KEY });
  assert.equal(code, 0, out);
});


test("Hermes permits only the React Native localhost:8081 fallback", (t) => {
  const env = { EXPO_PUBLIC_API_URL: API, EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: KEY };
  assert.equal(check(project(t, { js: `"${API}" "${KEY}"`, hbc: "http://localhost:8081/" }), env).code, 0);
  assert.equal(check(project(t, { js: `"${API}" "${KEY}" "http://localhost:8081/"` }), env).code, 1);
});

test("loopback and emulator URLs, including escaped URLs, fail export checks", (t) => {
  for (const endpoint of ["http://[::1]:3000/", "http://0.0.0.0:3000/", "http://10.0.2.2:3000/", "http:\\/\\/127.0.0.1:3000/"]) {
    for (const native of [false, true]) {
      const dist = project(t, { js: `"${API}" "${KEY}" ${native ? "" : JSON.stringify(endpoint)}`, ...(native ? { hbc: endpoint } : {}) });
      const result = check(dist, { EXPO_PUBLIC_API_URL: API, EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: KEY });
      assert.equal(result.code, 1, `${endpoint}: ${result.out}`);
    }
  }
});
