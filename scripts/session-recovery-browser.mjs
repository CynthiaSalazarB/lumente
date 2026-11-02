import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { chromium, firefox, webkit } from "playwright";

const [engine = "chromium", widthText = "390", distText = join(tmpdir(), "lumente-browser-recovery"), apiText = "http://127.0.0.1:18130"] = process.argv.slice(2);
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
const postedBodies = [];

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
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  page.setDefaultTimeout(60_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(`${api.origin}/**`, async (route) => {
    const url = new URL(route.request().url());
    let json;
    if (route.request().method() === "POST") {
      failedPosts += 1;
      postedBodies.push(route.request().postDataJSON());
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Fixture failure" }) });
      return;
    }
    if (url.pathname.endsWith("/sessions")) {
      json = { sessions: [{ id: "auditmap", concept: "API", mode: "test", createdAt: "2026-10-28T12:00:00Z", finished: false, score: null, predictedScore: null }] };
    } else if (url.pathname.endsWith("/transcript")) {
      json = { steps: [], material: "Original notes" };
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
  await page.getByRole("button", { name: "Resume", exact: true }).first().waitFor();
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
  assert.equal(await field.isEditable(), false, "an answer with an uncertain server outcome stays locked for retry");
  await page.reload();
  await resume();
  field = page.getByRole("textbox", { name: "Your first explanation", exact: true });
  await waitForValue(field, "A guided answer kept across reload");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByRole("button", { name: "Try again", exact: true }).waitFor();
  await waitForValue(field, "A guided answer kept across reload");
  assert.equal(await field.isEditable(), false, "a failed retry keeps the same body and retry state");
  assert.equal(failedPosts, 2);
  const retryResponse = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/turns") && response.request().method() === "POST" && response.status() === 500);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await retryResponse;
  await page.getByRole("button", { name: "Try again", exact: true }).waitFor();
  await waitForValue(field, "A guided answer kept across reload");
  assert.deepEqual(postedBodies.map((body) => body.text), Array(3).fill("A guided answer kept across reload"));
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
  assert.equal(failedPosts, 3);

  turn = { ...fixture.find(step => step.turn.phase === "move" && step.turn.expects === "text").turn, sessionId: "auditmap" };
  await page.goto(origin);
  await resume();
  field = page.getByRole("textbox").first();
  await field.fill("Answer held after failure");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByRole("button", { name: "Try again", exact: true }).waitFor();
  const help = page.getByRole("button", { name: /Get a hint|More help|Show answer|Get help/i }).first();
  assert.equal(await help.isDisabled(), true, "Help cannot replace a failed text answer");
  assert.equal(await page.getByRole("button", { name: /^Help/ }).count(), 0, "the firefly must not offer Help while text is uncertain");
  await page.screenshot({ path: join(tmpdir(), `lumente-demo-${engine}-${width}.png`), fullPage: true });
  assert.deepEqual(errors, []);
  console.log(`${engine} PASS: map draft, guided draft, manual retry, explicit clearing, Help disabled after failure; no page errors; width=${width}`);
} finally {
  await browser?.close();
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
}
