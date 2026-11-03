import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test, type TestContext } from "node:test";
import { promisify } from "node:util";

const exec = promisify(execFile);
async function fixture(t: TestContext, stall?: "headers" | "body") {
  const server = createServer((req, res) => {
    if (req.url === "/health/db" && stall) {
      if (stall === "body") { res.writeHead(200, { "content-type": "application/json" }); res.write('{"ok":'); }
      return;
    }
    if (req.url?.startsWith("/health")) res.end(JSON.stringify({ ok: true, ms: 1 }));
    else if (req.url === "/me/mastery") res.writeHead(401).end();
    else if (req.url === "/sessions") res.writeHead(204, { "access-control-allow-origin": "*" }).end();
    else if (req.url === "/entry.js") res.end(`const api = '${req.headers.host}'`);
    else res.end('<title>Lumente</title><script src="/entry.js"></script>');
  }).listen(0, "127.0.0.1");
  t.after(() => { server.closeAllConnections(); server.close(); });
  await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return () => exec(process.execPath, ["smoke.ts", url, url], { cwd: import.meta.dirname, timeout: 14_000, windowsHide: true });
}

test("smoke identifies the database probe as read-only", async (t) => {
  const run = await fixture(t);
  const { stdout } = await run();
  assert.match(stdout, /API \/health\/db reads from the database/);
  assert.match(stdout, /All 7 checks pass/);
});

for (const stall of ["headers", "body"] as const) {
  test(`smoke fails a stalled ${stall} probe and finishes the remaining checks`, async (t) => {
    const run = await fixture(t, stall);
    await assert.rejects(run(), (error: unknown) => {
      const result = error as { code: number; killed: boolean; stdout: string };
      assert.equal(result.killed, false);
      assert.equal(result.code, 1);
      assert.match(result.stdout, /1 of 7 checks failed/);
      return true;
    });
  });
}
