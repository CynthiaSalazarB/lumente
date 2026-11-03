import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { chromium, firefox, webkit } from "playwright";

const [engine = "chromium", widthText = "390", distText = "app/dist", apiText = "http://127.0.0.1:18130"] = process.argv.slice(2);
const browsers = { chromium, firefox, webkit };
const width = Number(widthText);
const dist = resolve(distText);
const api = new URL(apiText);

if (!Object.hasOwn(browsers, engine)) throw new Error("engine must be chromium, firefox or webkit");
if (!Number.isInteger(width) || width < 320 || width > 3840) throw new Error("width must be an integer from 320 to 3840");
if (!['127.0.0.1', 'localhost', '[::1]'].includes(api.hostname)) throw new Error("API fixture must use a loopback host");

const fixture = JSON.parse(await readFile("agents/fixtures/session-api.json", "utf8"));
let turn = {
  ...fixture[0].turn,
  sessionId: "auditmap",
  turn: 2,
  phase: "move",
  move: null,
  level: 5,
  expects: "map",
  messages: [{ agent: "app", kind: "question", text: "Build your map" }],
};
let failedPosts = 0;
let transcriptStatus = 200;
let deletes = 0;
const postedBodies = [];
const startKeys = [];
const startTurn = { ...fixture[0].turn, sessionId: "new-start", mentefacto: { ...fixture[0].turn.mentefacto, concept: "Cache" } };
let latestStartTurn = startTurn;
let releaseStarts = null;
let startsGate = null;

const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://local").pathname);
    const requested = pathname === "/" ? "/index.html" : extname(pathname) ? pathname : `${pathname}.html`;
    const file = resolve(dist, `.${requested}`);
    if (!file.startsWith(`${dist}${sep}`)) {
      res.writeHead(403).end();
      return;
    }
    const body = await readFile(file);
    const contentType = {
      ".css": "text/css",
      ".html": "text/html",
      ".ico": "image/x-icon",
      ".js": "text/javascript",
      ".json": "application/json",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".ttf": "font/ttf",
      ".wasm": "application/wasm",
      ".woff2": "font/woff2",
    }[extname(file)] ?? "application/octet-stream";
    res.writeHead(200, { "content-type": contentType }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});

await new Promise((resolveListen, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolveListen);
});

let browser;
try {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("could not get local web server port");
  const origin = `http://127.0.0.1:${address.port}`;
  browser = await browsers[engine].launch({ headless: true });
  const context = await browser.newContext({ viewport: { width, height: 844 } });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.context().route(`${api.origin}/**`, async (route) => {
    const url = new URL(route.request().url());
    let json;
    if (route.request().method() === "DELETE") {
      deletes += 1;
      await route.fulfill({ status: 204 });
      return;
    }
    if (route.request().method() === "POST") {
      if (url.pathname === "/sessions") {
        const key = route.request().headers()["idempotency-key"];
        assert.match(key ?? "", /^[A-Za-z0-9_-]{1,128}$/);
        const startIndex = startKeys.push(key);
        if (startsGate) await startsGate;
        if (startIndex === 1 || startIndex === 4) {
          await route.abort("failed");
          return;
        }
        await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(startTurn) });
        return;
      }
      failedPosts += 1;
      postedBodies.push(route.request().postDataJSON());
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Fixture failure" }) });
      return;
    }
    if (url.pathname.endsWith("/sessions")) {
      json = { sessions: [{ id: "auditmap", concept: "API", mode: "test", createdAt: "2026-10-28T12:00:00Z", finished: false, score: null, predictedScore: null }] };
    } else if (url.pathname.endsWith("/transcript")) {
      if (transcriptStatus !== 200) {
        await route.fulfill({ status: transcriptStatus, contentType: "application/json", body: JSON.stringify({ error: "Transcript unavailable" }) });
        return;
      }
      json = { steps: [], material: "Original notes" };
    } else if (url.pathname === "/sessions/new-start") {
      json = latestStartTurn;
    } else {
      json = turn;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(json) });
  });

  const resume = async () => {
    await page.getByRole("button", { name: "Resume", exact: true }).first().click();
    await page.waitForURL("**/session");
  };
  const waitForValue = async (field, expected) => {
    for (let attempt = 0; attempt < 20; attempt++) {
      if (await field.inputValue() === expected) return;
      await page.waitForTimeout(25);
    }
    assert.equal(await field.inputValue(), expected);
  };

  await page.goto(origin);
  await page.getByRole("textbox", { name: "A concept to map", exact: true }).fill("Cache");
  await page.getByRole("button", { name: "Start with guidance", exact: true }).click();
  await page.getByText("Can't reach the server. Check your connection and try again.", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("lumente.start.")).length), 1);
  await page.reload();
  await page.getByRole("textbox", { name: "A concept to map", exact: true }).fill("Cache");
  await page.getByRole("button", { name: "Start with guidance", exact: true }).click();
  await page.waitForURL("**/session");
  assert.equal(startKeys.length, 2);
  assert.equal(startKeys[0], startKeys[1], "reload must reuse the lost request's key");
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("lumente.start.")).length), 1);
  const second = await page.context().newPage();
  await Promise.all([page.goto(origin), second.goto(origin)]);
  startsGate = new Promise((resolveStarts) => { releaseStarts = resolveStarts; });
  for (const tab of [page, second]) {
    await tab.getByRole("textbox", { name: "A concept to map", exact: true }).fill("Cache");
    await tab.getByRole("button", { name: "Start with guidance", exact: true }).click();
  }
  for (let attempt = 0; attempt < 100 && startKeys.length < 4; attempt++) await page.waitForTimeout(20);
  assert.equal(startKeys.length, 4);
  assert.equal(startKeys[2], startKeys[3], "two overlapping tabs must reserve the same key");
  releaseStarts();
  startsGate = null;
  await page.waitForURL("**/session");
  await second.getByText("Can't reach the server. Check your connection and try again.", { exact: true }).waitFor();
  await second.reload();
  await second.getByRole("textbox", { name: "A concept to map", exact: true }).fill("Cache");
  await second.getByRole("button", { name: "Start with guidance", exact: true }).click();
  await second.waitForURL("**/session");
  assert.equal(startKeys.length, 5);
  assert.equal(startKeys[4], startKeys[3], "a successful peer must not erase a lost response's retry key");
  latestStartTurn = { ...fixture[1].turn, sessionId: "new-start", mentefacto: { ...fixture[1].turn.mentefacto, concept: "Cache" } };
  await second.goto(origin);
  await second.getByRole("textbox", { name: "A concept to map", exact: true }).fill("Cache");
  await second.getByRole("button", { name: "Start with guidance", exact: true }).click();
  await second.getByRole("textbox", { name: "Your first explanation", exact: true }).waitFor();
  assert.equal(startKeys.length, 6);
  assert.equal(startKeys[5], startKeys[4], "an advanced session reuses its key and restores its latest turn");
  await second.close();
  await page.goto(origin);
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error("storage denied"); }; });
  await page.getByRole("textbox", { name: "A concept to map", exact: true }).fill("Different concept");
  await page.getByRole("button", { name: "Start with guidance", exact: true }).click();
  await page.getByText("Could not save this session request on your device. Try again.", { exact: true }).waitFor();
  assert.equal(startKeys.length, 6, "a failed durable write must prevent POST /sessions");
  await page.goto(origin);
  await page.getByRole("button", { name: "Resume", exact: true }).first().waitFor();
  transcriptStatus = 500;
  await page.getByRole("button", { name: "Resume", exact: true }).first().click();
  await page.getByText("The server hit a problem. Try again in a moment.", { exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/", "a failed transcript must not open an incomplete session");
  transcriptStatus = 404;
  await resume();
  await page.goto(origin);
  transcriptStatus = 200;
  await resume();
  await page.getByRole("button", { name: /Category/ }).first().click();
  let field = page.getByRole("textbox", { name: "Category", exact: true });
  await field.fill("An interface saved while editor stays open");
  await page.waitForTimeout(800);
  await page.reload();
  await resume();
  await page.getByRole("button", { name: /Category/ }).first().click();
  field = page.getByRole("textbox", { name: "Category", exact: true });
  assert.equal(await field.inputValue(), "An interface saved while editor stays open");

  await page.goto(origin);
  await page.evaluate(() => localStorage.clear());
  turn = { ...fixture[1].turn, sessionId: "auditmap" };
  await page.reload();
  await resume();
  field = page.getByRole("textbox", { name: "Your first explanation", exact: true });
  await field.fill("A guided answer kept across reload");
  await page.waitForTimeout(800);
  await page.reload();
  await resume();
  field = page.getByRole("textbox", { name: "Your first explanation", exact: true });
  await waitForValue(field, "A guided answer kept across reload");

  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByRole("button", { name: "Try again", exact: true }).waitFor();
  await waitForValue(field, "A guided answer kept across reload");
  assert.equal(failedPosts, 2, "a 5xx gets one automatic replay with the same answer");
  assert.equal(await field.isEditable(), false, "an answer with an uncertain server outcome stays locked for retry");
  await page.reload();
  await resume();
  field = page.getByRole("textbox", { name: "Your first explanation", exact: true });
  await waitForValue(field, "A guided answer kept across reload");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByRole("button", { name: "Try again", exact: true }).waitFor();
  await waitForValue(field, "A guided answer kept across reload");
  assert.equal(await field.isEditable(), false, "a failed retry keeps the same body and retry state");
  assert.equal(failedPosts, 4, "the replay is capped at one per send, including after reload");
  const retryResponse = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/turns") && response.request().method() === "POST" && response.status() === 500);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await retryResponse;
  await page.getByRole("button", { name: "Try again", exact: true }).waitFor();
  await waitForValue(field, "A guided answer kept across reload");
  assert.equal(failedPosts, 6, "an explicit Try again gets one automatic replay of its own");
  assert.deepEqual(postedBodies.map((body) => body.text), Array(6).fill("A guided answer kept across reload"));
  assert.equal(await field.isEditable(), false);
  await page.reload();
  await resume();
  field = page.getByRole("textbox", { name: "Your first explanation", exact: true });
  await field.fill("replacement");
  await field.fill("");
  await page.waitForTimeout(800);
  await page.reload();
  await resume();
  field = page.getByRole("textbox", { name: "Your first explanation", exact: true });
  assert.equal(await field.inputValue(), "");
  assert.equal(failedPosts, 6);

  await page.goto(origin);
  await page.evaluate(() => {
    localStorage.setItem("lumente.session.auditmap", JSON.stringify({ sessionId: "auditmap", material: "Notes to delete", draft: null }));
    const remove = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (key) {
      if (key.startsWith("lumente.session")) throw new Error("Fixture storage failure");
      return remove.call(this, key);
    };
  });
  const deleteData = async () => {
    await page.getByRole("button", { name: "Account", exact: true }).click();
    await page.getByRole("button", { name: "Your data", exact: true }).click();
    await page.getByRole("button", { name: "Delete my data", exact: true }).click();
    await page.getByRole("button", { name: "Delete my data", exact: true }).click();
  };
  await deleteData();
  await page.getByText("Your server data was deleted, but this device's saved data could not be removed. Try deleting again.", { exact: true }).waitFor();
  assert.notEqual(await page.evaluate(() => localStorage.getItem("lumente.session.auditmap")), null);
  await mkdir("output/playwright", { recursive: true });
  await page.screenshot({ path: `output/playwright/deletion-${engine}-${width}.png`, fullPage: true });
  await page.reload(); // restore working browser storage, then retry the same deletion
  await deleteData();
  await page.getByText("This deletes every session, your levels and progress memory. It can't be undone.", { exact: true }).waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith("lumente.session"))), false);
  assert.equal(deletes, 2);
  assert.deepEqual(errors, []);
  console.log(`${engine} PASS: start-key reload recovery, concurrent tabs, storage refusal, transcript failure/legacy fallback, map/guided drafts, failed-send recovery, clearing, failed deletion/retry; no page errors; width=${width}`);
} finally {
  await browser?.close();
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
}
