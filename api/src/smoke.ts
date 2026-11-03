// The smoke test before the freeze (#45) and the warm-up before the testers (#37): what a public URL
// has to answer, with no credentials. A full session needs a signed-in learner, so that part stays
// a person's walk through the web build; this covers everything around it and exits 1 on any failure.
// npm run smoke -w api -- [api url] [web url]

const API = process.argv[2]?.replace(/\/+$/, "") || "https://build-north-api.onrender.com";
const WEB = process.argv[3]?.replace(/\/+$/, "") || "https://lumente.expo.app";

type Check = { name: string; ok: boolean; detail: string };

// The signal stays attached while the body is read, not just until response headers arrive.
const request = (url: string, init?: RequestInit) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });

const timed = async (run: () => Promise<Response>): Promise<{ res: Response; ms: number }> => {
  const started = performance.now();
  const res = await run();
  return { res, ms: Math.round(performance.now() - started) };
};

async function check(name: string, run: () => Promise<{ ok: boolean; detail: string }>): Promise<Check> {
  try {
    return { name, ...(await run()) };
  } catch (error) {
    return { name, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

const checks: Check[] = [
  await check("API /health", async () => {
    const { res, ms } = await timed(() => request(`${API}/health`));
    const body = (await res.json().catch(() => null)) as { ok?: boolean; commit?: string | null; memory?: string } | null;
    return { ok: res.status === 200 && body?.ok === true, detail: `${res.status} in ${ms} ms, commit ${body?.commit ?? "unknown"}, memory ${body?.memory ?? "unknown"}` };
  }),
  await check("API /health/db reads from the database", async () => {
    const { res, ms } = await timed(() => request(`${API}/health/db`));
    const body = (await res.json().catch(() => null)) as { ok?: boolean; ms?: number } | null;
    return { ok: res.status === 200 && body?.ok === true, detail: `${res.status} in ${ms} ms, database ${body?.ms ?? "?"} ms` };
  }),
  await check("API refuses a call with no token", async () => {
    const { res } = await timed(() => request(`${API}/me/mastery`));
    return { ok: res.status === 401, detail: `${res.status}` };
  }),
  await check("API refuses the dev headers", async () => {
    const { res } = await timed(() => request(`${API}/me/mastery`, { headers: { "x-dev-user": "smoke", "x-dev-key": "smoke" } }));
    return { ok: res.status === 401, detail: `${res.status}` };
  }),
  await check("API allows the web build's origin (CORS preflight)", async () => {
    const { res } = await timed(() =>
      request(`${API}/sessions`, { method: "OPTIONS", headers: { origin: WEB, "access-control-request-method": "POST", "access-control-request-headers": "authorization, content-type" } }),
    );
    const allowed = res.headers.get("access-control-allow-origin");
    return { ok: allowed === WEB || allowed === "*", detail: `${res.status}, allow-origin ${allowed ?? "none"}` };
  }),
  await check("Web build answers", async () => {
    const { res, ms } = await timed(() => request(`${WEB}/`));
    const html = await res.text();
    const titled = /<title>Lumente/.test(html);
    return { ok: res.status === 200 && titled, detail: `${res.status} in ${ms} ms${titled ? "" : ", no Lumente title"}` };
  }),
  await check("Web build points at this API", async () => {
    const html = await (await request(`${WEB}/`)).text();
    const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]!);
    const host = new URL(API).host;
    for (const src of scripts) {
      const js = await (await request(new URL(src, WEB).href)).text();
      if (js.includes(host)) return { ok: true, detail: `${host} in ${src.split("/").pop()}` };
    }
    return { ok: false, detail: `${host} is in none of ${scripts.length} scripts (demo mode, or exported without the production environment)` };
  }),
];

const width = Math.max(...checks.map((c) => c.name.length));
for (const c of checks) console.log(`${c.ok ? "ok  " : "FAIL"} ${c.name.padEnd(width)}  ${c.detail}`);
const failed = checks.filter((c) => !c.ok).length;
console.log(failed === 0 ? `\nAll ${checks.length} checks pass: ${API} and ${WEB}` : `\n${failed} of ${checks.length} checks failed`);
process.exitCode = failed === 0 ? 0 : 1;
