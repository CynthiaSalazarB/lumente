// #7: the real API (CONTRACTS.md section 1). Every response that carries a Turn is checked against the
// Turn schema, so a server that drifted from the contract fails here, not in a screen.
import { MemoryView, SessionList, Transcript, Turn, type CreateSessionBody } from "@build-north/agents";
import { ClientError, type SessionClient } from "./client.ts";

export type ApiClientOptions = {
  baseUrl: string;
  /** Until Clerk (#22): x-dev-user, which the API only accepts with x-dev-key. Never in a deployed web build. */
  devUser?: string | null;
  devKey?: string | null;
  /** The Clerk session token, sent as Authorization: Bearer (#22). */
  getToken?: () => Promise<string | null>;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

const OFFLINE = "Can't reach the server. Check your connection and try again.";
const SLOW = "The server is taking too long. Try again.";
/** A 5xx, or a 502/503 page from the host while the server restarts: the body is for us, not the learner. */
const BROKEN = "The server hit a problem. Try again in a moment.";
/** A 401: the server's own line names headers and tokens, which mean nothing to a learner. */
const SIGNED_OUT = "The server didn't accept your sign-in. Sign out, then sign in again.";

/** One 90-second deadline covers token lookup, response headers and body. */
const TIMEOUT_MS = 90_000;

export function createApiClient({ baseUrl, devUser, devKey, getToken, fetch: send = fetch, timeoutMs = TIMEOUT_MS }: ApiClientOptions): SessionClient {
  const root = baseUrl.replace(/\/+$/, "");

  /** One call with the learner's credentials; the answer's body is parsed as JSON when there is one. */
  async function call(method: "GET" | "POST" | "DELETE", path: string, body?: unknown, deadlineMs = timeoutMs): Promise<{ res: Response; json: unknown }> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    // AbortController rather than AbortSignal.timeout, which React Native may not have
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    // One deadline covers credentials, headers and body, even if the underlying operation ignores cancellation.
    const slow = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abort.abort();
        reject(new ClientError(SLOW, null, true));
      }, deadlineMs);
    });
    try {
      const token = getToken ? await Promise.race([getToken(), slow]) : null;
      if (token) headers.authorization = `Bearer ${token}`;
      else if (devUser && devKey) {
        headers["x-dev-user"] = devUser;
        headers["x-dev-key"] = devKey;
      }
      let res: Response;
      try {
        res = await Promise.race([send(`${root}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: abort.signal }), slow]);
      } catch {
        // the timer fired, or the network did: both are worth trying again, and the words say which
        throw new ClientError(abort.signal.aborted ? SLOW : OFFLINE, null, true);
      }
      if (res.status === 204) return { res, json: null };
      const read = res.json().catch(() => {
        if (abort.signal.aborted) throw new ClientError(SLOW, null, true);
        return null;
      });
      const json: unknown = await Promise.race([read, slow]);
      return { res, json };
    } finally {
      clearTimeout(timer!);
    }
  }

  /** The server's own message when it sent one (a 429's "wait a minute", a 413's "paste a shorter excerpt"), except
   * where that message is written for us: a 401 and every 5xx get the learner's line. A 429 or a 5xx is worth
   * trying again. */
  const errorOf = (res: Response, json: unknown) => {
    const message = (json as { error?: unknown } | null)?.error;
    const words = res.status >= 500 ? BROKEN : res.status === 401 ? SIGNED_OUT : typeof message === "string" ? message : `The server answered ${res.status}.`;
    return new ClientError(words, res.status, res.status === 429 || res.status >= 500);
  };

  async function post(path: string, body: unknown, deadlineMs = timeoutMs): Promise<Turn> {
    const { res, json } = await call("POST", path, body, deadlineMs);
    // A 409 answers with the session's latest Turn (decision 18 and #73), so the app just redraws it.
    if (res.ok || res.status === 409) {
      const turn = Turn.safeParse(json);
      if (turn.success) return turn.data;
      if (res.ok) throw unexpected(res.status);
    }
    throw errorOf(res, json);
  }

  const unexpected = (status: number) => new ClientError("The server sent something unexpected. Try again.", status, true);

  return {
    offline: false,
    start: (body: CreateSessionBody) => post("/sessions", body),
    send(sessionId, body) {
      return post(`/sessions/${encodeURIComponent(sessionId)}/turns`, body);
    },
    async list() {
      const { res, json } = await call("GET", "/sessions");
      if (!res.ok) throw errorOf(res, json);
      const list = SessionList.safeParse(json);
      if (!list.success) throw unexpected(res.status);
      return list.data.sessions;
    },
    async resume(sessionId: string) {
      const { res, json } = await call("GET", `/sessions/${encodeURIComponent(sessionId)}`);
      if (!res.ok) throw errorOf(res, json);
      const turn = Turn.safeParse(json);
      if (!turn.success) throw unexpected(res.status);
      return turn.data;
    },
    async transcript(sessionId: string) {
      const { res, json } = await call("GET", `/sessions/${encodeURIComponent(sessionId)}/transcript?material=1`);
      if (!res.ok) throw errorOf(res, json);
      const transcript = Transcript.safeParse(json);
      if (!transcript.success) throw unexpected(res.status);
      return transcript.data;
    },
    async deleteData() {
      const { res, json } = await call("DELETE", "/me/data");
      if (!res.ok) throw errorOf(res, json);
    },
    async memory() {
      const { res, json } = await call("GET", "/me/memory");
      if (!res.ok) throw errorOf(res, json);
      const view = MemoryView.safeParse(json);
      if (!view.success) throw unexpected(res.status);
      return view.data;
    },
  };
}
