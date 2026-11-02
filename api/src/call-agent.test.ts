import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { AGENTS, type AgentContext, type AgentName } from "@build-north/agents";
import {
  AgentCallError,
  agentConfigFromEnv,
  createCallAgent,
  sendWith,
  type ClaudeReply,
  type SendToClaude,
} from "./call-agent.ts";
import type { AgentLogEntry } from "./store.ts";

// The Questioner's input for the democracy session, and the question it sends back (CONTRACTS.md section 2)
const context: AgentContext = {
  concept: "democracy",
  material: null,
  move: "supraordinate",
  level: 2,
  mentefacto: { concept: "democracy", supraordinate: null, exclusion: [], isoordinate: [], infraordinate: [] },
  recent: [],
};
const question = { question: "Democracy is one example of a bigger group. What group?", scaffold: null };
// $0.014 on claude-opus-5-5: 1,000 input tokens at $4 a million plus 500 output tokens at $20
const usage = { input_tokens: 1_000, output_tokens: 500, cache_creation_input_tokens: null, cache_read_input_tokens: null };

type Block = { type: string; text?: string };
const answer = (value: unknown): Block[] => [{ type: "text", text: JSON.stringify(value) }];
const reply = (content: Block[], { stop_reason = "end_turn", headers = {} } = {}): ClaudeReply => ({
  message: { content, stop_reason, usage },
  headers: new Headers(headers),
});
const failsWith = (code: AgentCallError["code"], retryable: boolean) => (error: unknown) =>
  error instanceof AgentCallError && error.code === code && error.retryable === retryable;

function setup(send: SendToClaude, budgetUsd = 10) {
  const logged: AgentLogEntry[] = [];
  const callAgentFor = createCallAgent({
    send,
    model: "claude-opus-5-5",
    budgetUsd,
    log: async (entry) => void logged.push(entry),
  });
  return { callAgent: callAgentFor("s1"), logged };
}

test("a call sends the agent's prompt, the message its render writes, and its effort, and logs what came back", async () => {
  const sent: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const { callAgent, logged } = setup(async (params) => {
    sent.push(params);
    // with adaptive thinking, an empty thinking block comes before the JSON
    return reply([{ type: "thinking" }, ...answer(question)]);
  });
  assert.deepEqual(await callAgent("questioner", context), question);
  assert.equal(sent[0]?.model, "claude-opus-5-5");
  assert.equal(sent[0]?.system, AGENTS.questioner.system);
  assert.deepEqual(sent[0]?.messages, [{ role: "user", content: AGENTS.questioner.render(context) }]);
  assert.equal(sent[0]?.output_config?.effort, AGENTS.questioner.effort);
  assert.equal(sent[0]?.output_config?.format?.type, "json_schema");
  assert.equal(logged.length, 1);
  assert.equal(logged[0]?.session, "s1");
  assert.equal(logged[0]?.agent, "questioner");
  assert.equal(logged[0]?.usd, 0.014);
});

test("calls stop at 95% of the budget, with a rate_limited error that a retry can't fix", async (t) => {
  t.mock.method(console, "error", () => {});
  let calls = 0;
  // $0.02 budget: the first call ($0.014) is under its 95%, the second takes it over
  const { callAgent } = setup(async () => {
    calls++;
    return reply(answer(question));
  }, 0.02);
  await callAgent("questioner", context);
  await callAgent("questioner", context);
  await assert.rejects(callAgent("questioner", context), failsWith("rate_limited", false));
  assert.equal(calls, 2);
});

test("while a rate-limit window is 95% used, calls wait for it to refill", async (t) => {
  t.mock.method(console, "error", () => {});
  const window = (reset: number) => ({
    "anthropic-ratelimit-requests-limit": "50",
    "anthropic-ratelimit-requests-remaining": "2",
    "anthropic-ratelimit-requests-reset": new Date(reset).toISOString(),
  });
  let calls = 0;
  const busy = setup(async () => {
    calls++;
    return reply(answer(question), { headers: window(Date.now() + 60_000) });
  });
  await busy.callAgent("questioner", context);
  await assert.rejects(busy.callAgent("questioner", context), failsWith("rate_limited", true));
  assert.equal(calls, 1);

  // the same 96% after the reset time has passed: the window has refilled, so calls go through
  const refilled = setup(async () => reply(answer(question), { headers: window(Date.now() - 1_000) }));
  await refilled.callAgent("questioner", context);
  await refilled.callAgent("questioner", context);
});

test("Claude's errors become agent errors that say whether a retry can help", async (t) => {
  t.mock.method(console, "error", () => {});
  const cases: [Error, AgentCallError["code"], boolean][] = [
    [Anthropic.APIError.generate(429, { type: "error" }, "rate limited", new Headers()), "rate_limited", true],
    [Anthropic.APIError.generate(529, { type: "error" }, "overloaded", new Headers()), "agent_failed", true],
    [new Anthropic.APIConnectionTimeoutError(), "agent_failed", true],
    [Anthropic.APIError.generate(400, { type: "error" }, "bad request", new Headers()), "agent_failed", false],
  ];
  for (const [thrown, code, retryable] of cases) {
    const { callAgent, logged } = setup(async () => {
      throw thrown;
    });
    await assert.rejects(callAgent("questioner", context), failsWith(code, retryable), thrown.message);
    assert.equal(logged.length, retryable ? 2 : 1);
  }
});

test("a refusal fails for good; a reply cut off or off the schema can be retried; each is logged", async (t) => {
  t.mock.method(console, "error", () => {});
  const refused = setup(async () => reply([], { stop_reason: "refusal" }));
  await assert.rejects(refused.callAgent("questioner", context), failsWith("agent_failed", false));
  const cutOff = setup(async () => reply([{ type: "text", text: '{"question": "Democr' }], { stop_reason: "max_tokens" }));
  await assert.rejects(cutOff.callAgent("questioner", context), failsWith("agent_failed", true));
  const offSchema = setup(async () => reply(answer({ question: 5, scaffold: null })));
  await assert.rejects(offSchema.callAgent("questioner", context), failsWith("agent_failed", true));
  assert.equal(refused.logged.length + cutOff.logged.length + offSchema.logged.length, 3);
});

test("a reply that failed still counts against the budget, since it was billed", async (t) => {
  t.mock.method(console, "error", () => {});
  // $0.01 budget: one billed $0.014 reply, even one that broke the schema, spends it
  const { callAgent } = setup(async () => reply(answer({ question: 5, scaffold: null })), 0.01);
  await assert.rejects(callAgent("questioner", context), failsWith("agent_failed", true));
  await assert.rejects(callAgent("questioner", context), failsWith("rate_limited", false));
});

test("an agent that isn't in the registry yet, or an input that breaks its schema, fails before calling Claude", async (t) => {
  t.mock.method(console, "error", () => {});
  let calls = 0;
  const { callAgent } = setup(async () => {
    calls++;
    return reply(answer(question));
  });
  // Challenger belongs to Check the AI, not this version (CONTRACTS.md section 2)
  await assert.rejects(callAgent("challenger" as AgentName, {}), /no challenger agent/);
  await assert.rejects(callAgent("questioner", { ...context, level: 9 }), failsWith("agent_failed", false));
  assert.equal(calls, 0);
});

test("through the real SDK: the request carries the schema, and the rate-limit headers are read", async (t) => {
  t.mock.method(console, "error", () => {});
  const bodies: Record<string, unknown>[] = [];
  let status = 200;
  // A stand-in for Anthropic's /v1/messages, so the SDK's own request and response handling runs
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    bodies.push(JSON.parse(body));
    res.writeHead(status, {
      "content-type": "application/json",
      "anthropic-ratelimit-requests-limit": "50",
      "anthropic-ratelimit-requests-remaining": "2",
      "anthropic-ratelimit-requests-reset": new Date(Date.now() + 60_000).toISOString(),
    });
    res.end(
      status === 200
        ? JSON.stringify({
            id: "msg_1",
            type: "message",
            role: "assistant",
            model: "claude-opus-5-5",
            content: [{ type: "text", text: JSON.stringify(question), citations: null }],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage,
          })
        : JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "slow down" } }),
    );
  });
  server.listen(0);
  t.after(() => server.close());
  await once(server, "listening");
  const client = new Anthropic({ apiKey: "test-key", baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, maxRetries: 0 });

  const { callAgent } = setup(sendWith(client));
  assert.deepEqual(await callAgent("questioner", context), question);
  const sent = bodies[0] as { model: string; system: string; output_config: { effort: string; format: { type: string; schema: unknown } } };
  assert.equal(sent.model, "claude-opus-5-5");
  assert.equal(sent.system, AGENTS.questioner.system);
  assert.equal(sent.output_config.effort, AGENTS.questioner.effort);
  assert.equal(sent.output_config.format.type, "json_schema");
  // that reply left the requests window 96% used, so the next call waits without reaching the server
  await assert.rejects(callAgent("questioner", context), failsWith("rate_limited", true));
  assert.equal(bodies.length, 1);

  status = 429;
  const fresh = setup(sendWith(client));
  await assert.rejects(fresh.callAgent("questioner", context), failsWith("rate_limited", true));
});

test("every agent's output schema converts to a structured-output format", () => {
  for (const agent of Object.values(AGENTS)) assert.doesNotThrow(() => zodOutputFormat(agent.output), agent.name);
});

test("Claude calls are off without a key, and a key needs a budget and a model with a price", () => {
  assert.equal(agentConfigFromEnv({}), null);
  const key = { ANTHROPIC_API_KEY: "test-key", AGENT_BUDGET_USD: "30" };
  for (const budget of ["Infinity", "NaN", "-1", "0"]) assert.throws(() => agentConfigFromEnv({ ...key, AGENT_BUDGET_USD: budget }), /finite positive/);
  assert.deepEqual(agentConfigFromEnv(key), { model: "claude-opus-5-5", budgetUsd: 30 });
  assert.equal(agentConfigFromEnv({ ...key, AGENT_MODEL: "claude-sonnet-5-5" })?.model, "claude-sonnet-5-5");
  assert.throws(() => agentConfigFromEnv({ ANTHROPIC_API_KEY: "test-key" }), /AGENT_BUDGET_USD/);
  assert.throws(() => agentConfigFromEnv({ ...key, AGENT_MODEL: "claude-opus-4-1" }), /AGENT_MODEL/);
});

test("the coach and the hint giver keep only cites they were given, and a coach cannot invent a prior session without memory", async (t) => {
  t.mock.method(console, "error", () => {});
  const fact = { id: "attr_gap", text: "Last time on democracy you guessed 7 and proved 4.", concept: "democracy", since: "2026-10-22T18:45:12Z", writtenBy: "coach" as const, sessionId: "s0" };
  const result = { predictedScore: 6, score: 5, maxScore: 8, calibrationGap: 1, hintsUsed: 0, rubric: [], masteryChanges: [], questions: { asked: 0, testing: 0 } };
  const coachInput = { concept: "democracy", mentefacto: context.mentefacto, result };
  const { callAgent, logged } = setup(async () => reply(answer({ message: "Closer than last time.", nextFocus: null, cites: ["attr_gap", "attr_made_up", "attr_gap"] })));
  const warned: unknown[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => void warned.push(args[0]);
  try {
    assert.deepEqual(await callAgent("coach", { ...coachInput, memory: { facts: [fact] } }), { message: "Closer than last time.", nextFocus: null, cites: ["attr_gap"] });
    await assert.rejects(callAgent("coach", coachInput), (error: unknown) =>
      error instanceof AgentCallError && error.code === "agent_failed" && /referred to history/.test(error.message),
    );
  } finally {
    console.warn = original;
  }
  assert.deepEqual(logged.map((row) => row.dropped), [["attr_made_up"], ["attr_gap", "attr_made_up", "attr_gap"]]);
  assert.deepEqual((logged[0]?.output as { cites: string[] }).cites, ["attr_gap"]);
  assert.match(String(warned[0]), /The coach cited 1 fact id\(s\) it wasn't given \(session s1\): attr_made_up/);
  // a questioner's output is never checked, and its row has no dropped
  const { callAgent: asker, logged: asked } = setup(async () => reply(answer(question)));
  assert.deepEqual(await asker("questioner", context), question);
  assert.equal("dropped" in asked[0]!, false);
});


test("a transport retry logs both attempts without reserving unknown cost", async (t) => {
  t.mock.method(console, "error", () => {});
  let sends = 0;
  const { callAgent, logged } = setup(async params => {
    assert.equal(params.max_tokens, 16_000);
    if (++sends <= 2) throw new Anthropic.APIConnectionTimeoutError();
    return reply(answer(question));
  }, 0.02);
  await assert.rejects(callAgent("questioner", context));
  assert.deepEqual(await callAgent("questioner", context), question);
  assert.deepEqual(logged.map(x => [x.attempt, x.outcome, x.costStatus, x.usd]), [[1, "failed", "unknown", 0], [2, "failed", "unknown", 0], [1, "success", "measured", 0.014]]);
});

test("logging failure cannot prevent a provider send or discard its reply", async (t) => {
  t.mock.method(console, "error", () => {});
  let sends = 0;
  const call = createCallAgent({ model: "claude-opus-5-5", budgetUsd: 10, send: async () => { sends++; return reply(answer(question)); }, log: async () => { throw new Error("database down"); } })("s");
  assert.deepEqual(await call("questioner", context), question);
  assert.equal(sends, 1);
});

test("malformed usage stays finite and does not poison the measured budget", async (t) => {
  t.mock.method(console, "error", () => {});
  let sends = 0;
  const { callAgent, logged } = setup(async () => {
    const result = reply(answer(question));
    if (++sends === 1) result.message.usage = { ...usage, input_tokens: NaN };
    return result;
  }, 0.01);
  await callAgent("questioner", context);
  await callAgent("questioner", context);
  await assert.rejects(callAgent("questioner", context), failsWith("rate_limited", false));
  assert.equal(logged[0]?.costStatus, "unknown");
  assert.ok(logged.every(x => Number.isFinite(x.usd)));
});

test("retry-after is capped at 60 seconds", async (t) => {
  t.mock.method(console, "error", () => {});
  const delays: number[] = [];
  const timer = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", ((callback: (...args: unknown[]) => void, ms?: number) => { delays.push(ms ?? 0); return timer(callback, 0); }) as typeof setTimeout);
  let sends = 0;
  const { callAgent } = setup(async () => {
    if (++sends === 1) throw Anthropic.APIError.generate(529, {}, "busy", new Headers({ "retry-after": "99999" }));
    return reply(answer(question));
  });
  await callAgent("questioner", context);
  assert.deepEqual(delays, [60_000]);
});
