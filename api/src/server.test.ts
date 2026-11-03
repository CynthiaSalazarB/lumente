import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";

const exec = promisify(execFile);
// Mock only the SDK boundary; execute the actual server entry point in a separate process.
const prelude = `
  import { Surreal } from 'surrealdb';
  Surreal.prototype.connect = async () => true;
  Surreal.prototype.close = async () => true;
`;
const env = {
  PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
  NODE_ENV: "test", PORT: "0", SURREAL_URL: "ws://127.0.0.1:8000",
  SURREAL_NAMESPACE: "test", SURREAL_DATABASE: "test", SURREAL_USER: "test", SURREAL_PASS: "test",
};

test("server exits without listening when schema initialization fails", async () => {
  await assert.rejects(exec(process.execPath, ["--input-type=module", "-e", `${prelude}
    Surreal.prototype.query = () => ({ signal: () => ({ collect: async () => { throw new Error('schema unavailable'); } }) });
    await import('./server.ts');
  `], { cwd: import.meta.dirname, env, timeout: 8_000, windowsHide: true }), (error: unknown) => {
    const result = error as { code: number; stdout: string; stderr: string; killed: boolean };
    assert.equal(result.code, 1);
    assert.equal(result.killed, false);
    assert.match(result.stderr, /schema unavailable/);
    assert.doesNotMatch(result.stdout, /api listening/);
    return true;
  });
});

test("server waits for schema initialization before listening", async () => {
  const { stdout } = await exec(process.execPath, ["--input-type=module", "-e", `${prelude}
    Surreal.prototype.query = () => ({ signal: () => ({ collect: async () => {
      await new Promise(resolve => setTimeout(resolve, 50)); console.log('schema ready');
    } }) });
    const log = console.log;
    console.log = (...args) => { log(...args); if (String(args[0]).startsWith('api listening')) process.exit(0); };
    await import('./server.ts');
  `], { cwd: import.meta.dirname, env, timeout: 8_000, windowsHide: true });
  assert.match(stdout, /schema ready[\s\S]*api listening/);
});
