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
  countInputTokensWith,
  createCallAgent,
  sendWith,
  type CountClaudeInputTokens,
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

test("the spend guard requires a finite positive budget", () => {
  for (const value of ["Infinity", "1e999", "NaN", "0", "-1", " "]) {
    assert.throws(() => agentConfigFromEnv({ ANTHROPIC_API_KEY: "test", AGENT_BUDGET_USD: value }), /AGENT_BUDGET_USD/);
  }
  assert.equal(agentConfigFromEnv({ ANTHROPIC_API_KEY: "test", AGENT_BUDGET_USD: "0.25" })?.budgetUsd, 0.25);
});
// $0.014 on claude-opus-5-5: 1,000 input tokens at $4 a million plus 500 output tokens at $20
const usage = { input_tokens: 1_000, output_tokens: 500, cache_creation_input_tokens: null, cache_read_input_tokens: null };

type Block = { type: string; text?: string };
const answer = (value: unknown): Block[] => [{ type: "text", text: JSON.stringify(value) }];
const reply = (content: Block[], { stop_reason = "end_turn", headers = {}, tokens = usage } = {}): ClaudeReply => ({
  message: { content, stop_reason, usage: tokens },
  headers: new Headers(headers),
});
const failsWith = (code: AgentCallError["code"], retryable: boolean) => (error: unknown) =>
  error instanceof AgentCallError && error.code === code && error.retryable === retryable;

function setup(
  send: SendToClaude,
  budgetUsd = 10,
  countInputTokens: CountClaudeInputTokens = async () => 1_000,
  turnContext?: { turn: number; turnAttempt: number },
) {
  const logged: AgentLogEntry[] = [];
  const log = {
    async begin(entry: AgentLogEntry) {
      const id = String(logged.length);
      logged.push(entry);
      return id;
    },
    async finish(id: string, entry: AgentLogEntry) {
      logged[Number(id)] = entry;
    },
  };
  const callAgentFor = createCallAgent({
    send,
    countInputTokens,
    model: "claude-opus-5-5",
    budgetUsd,
    log,
  });
  return { callAgent: callAgentFor("s1", "learner", turnContext?.turn, turnContext?.turnAttempt), logged };
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

test("the agent log ties every paid retry to its durable Turn attempt", async (t) => {
  t.mock.method(console, "error", () => {});
  let sends = 0;
  const { callAgent, logged } = setup(async () => {
    if (++sends === 1) throw new Anthropic.APIConnectionTimeoutError();
    return reply(answer(question));
  }, 10, async () => 1_000, { turn: 4, turnAttempt: 2 });
  assert.deepEqual(await callAgent("questioner", context), question);
  assert.deepEqual(logged.map(({ turn, turnAttempt, attempt, outcome }) => [turn, turnAttempt, attempt, outcome]), [
    [4, 2, 1, "failed"],
    [4, 2, 2, "success"],
  ]);
});

test("does not send a paid request when the attempt cannot be durably logged", async (t) => {
  t.mock.method(console, "error", () => {});
  let sends = 0;
  const callAgent = createCallAgent({
    send: async () => {
      sends++;
      return reply(answer(question));
    },
    countInputTokens: async () => 1_000,
    model: "claude-opus-5-5",
    budgetUsd: 10,
    log: {
      begin: async () => { throw new Error("database unavailable"); },
      finish: async () => {},
    },
  })("s1");

  await assert.rejects(callAgent("questioner", context), failsWith("agent_failed", false));
  assert.equal(sends, 0, "a provider call must not go out without an agent_log reservation");
});

test("a failed log finalization leaves its conservative reservation and keeps the reply usable", async (t) => {
  t.mock.method(console, "error", () => {});
  const logged: AgentLogEntry[] = [];
  const callAgent = createCallAgent({
    send: async () => reply(answer(question)),
    countInputTokens: async () => 1_000,
    model: "claude-opus-5-5",
    budgetUsd: 10,
    log: {
      async begin(entry) { logged.push(entry); return "row-1"; },
      async finish() { throw new Error("database unavailable"); },
    },
  })("s1");

  assert.deepEqual(await callAgent("questioner", context), question);
  assert.equal(logged.length, 1);
  assert.equal(logged[0]?.outcome, "started");
  assert.equal(logged[0]?.costStatus, "reserved");
  assert.ok(logged[0]!.usd > 0.014, "the unsettled row keeps a conservative maximum, not measured usage");
});

test("malformed provider usage keeps its reservation and cannot poison later budget checks", async (t) => {
  t.mock.method(console, "error", () => {});
  const messages: Record<string, unknown>[] = [];
  let providerUsage: unknown = null;
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    if (req.url === "/v1/messages/count_tokens") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ input_tokens: 1_000 }));
      return;
    }
    messages.push(JSON.parse(body) as Record<string, unknown>);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "msg_invalid_usage", type: "message", role: "assistant", model: "claude-opus-5-5",
      content: [{ type: "text", text: JSON.stringify(question) }], stop_reason: "end_turn", stop_sequence: null,
      usage: providerUsage,
    }));
  });
  server.listen(0);
  t.after(() => server.close());
  await once(server, "listening");
  const client = new Anthropic({ apiKey: "test-key", baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, maxRetries: 0 });
  const malformedUsage: unknown[] = [
    null,
    { output_tokens: 500 },
    { input_tokens: 1_000, output_tokens: -1 },
    { input_tokens: 1_000.5, output_tokens: 500 },
    { input_tokens: 1_000, output_tokens: 500, cache_creation_input_tokens: "500" },
    { input_tokens: 1_000, output_tokens: 500, cache_read_input_tokens: 0.5 },
  ];

  for (const usageCase of malformedUsage) {
    providerUsage = usageCase;
    const before = messages.length;
    const { callAgent, logged } = setup(sendWith(client), 0.25, countInputTokensWith(client));
    assert.deepEqual(await callAgent("questioner", context), question);
    assert.equal(logged[0]?.outcome, "success");
    assert.ok(Number.isFinite(logged[0]?.usd), `reservation must stay finite for usage ${JSON.stringify(usageCase)}`);
    assert.equal(logged[0]?.costStatus, "reserved");
    assert.ok((logged[0]?.usd ?? 0) > 0, "unknown usage must retain its pre-call reservation");
    await assert.rejects(callAgent("questioner", context), failsWith("rate_limited", false));
    assert.equal(messages.length, before + 1, "the conservative reservation must keep a second paid request out");
  }
});

test("budget admission reserves in-flight cost and limits output tokens near the cap", async (t) => {
  t.mock.method(console, "error", () => {});
  let calls = 0;
  const { callAgent } = setup(async (params) => {
    calls++;
    return reply(answer(question), { tokens: { ...usage, output_tokens: Math.min(usage.output_tokens, params.max_tokens) } });
  }, 0.02);
  await callAgent("questioner", context);
  await callAgent("questioner", context);
  await assert.rejects(callAgent("questioner", context), failsWith("rate_limited", false));
  assert.equal(calls, 2);
});

test("concurrent calls reserve the shared process budget before either request is sent", async (t) => {
  t.mock.method(console, "error", () => {});
  let calls = 0;
  const held = Promise.withResolvers<void>();
  const firstSent = Promise.withResolvers<void>();
  const { callAgent } = setup(async () => {
    calls++;
    firstSent.resolve();
    await held.promise;
    return reply(answer(question));
  }, 0.02);
  const first = callAgent("questioner", context);
  await firstSent.promise;
  await assert.rejects(callAgent("questioner", context), failsWith("rate_limited", false));
  assert.equal(calls, 1);
  held.resolve();
  await first;
});

test("a retry is refused when the first ambiguous attempt's reservation leaves insufficient budget", async (t) => {
  t.mock.method(console, "error", () => {});
  let calls = 0;
  const { callAgent, logged } = setup(async () => {
    calls++;
    throw new Anthropic.APIConnectionTimeoutError();
  }, 0.6);
  await assert.rejects(callAgent("questioner", context), failsWith("rate_limited", false));
  assert.equal(calls, 1);
  assert.deepEqual(logged.map((entry) => [entry.attempt, entry.costStatus]), [[1, "reserved"]]);
  assert.ok(logged[0]!.usd > 0);
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
    [Anthropic.APIError.generate(429, { type: "error" }, "do not retry", new Headers({ "x-should-retry": "false" })), "rate_limited", false],
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
    assert.deepEqual(logged.map((entry) => entry.attempt), retryable ? [1, 2] : [1]);
    assert.equal(new Set(logged.map((entry) => entry.callId)).size, 1);
    assert.equal(logged[0]?.costStatus, thrown instanceof Anthropic.APIError && !(thrown instanceof Anthropic.APIConnectionError) ? "not_charged" : "reserved");
  }
});

test("refusal and invalid structured replies are logged with measured usage", async (t) => {
  t.mock.method(console, "error", () => {});
  const refused = setup(async () => reply([], { stop_reason: "refusal" }));
  await assert.rejects(refused.callAgent("questioner", context), failsWith("agent_failed", false));
  const cutOff = setup(async () => reply([{ type: "text", text: '{"question": "Democr' }], { stop_reason: "max_tokens" }));
  await assert.rejects(cutOff.callAgent("questioner", context), failsWith("agent_failed", true));
  const offSchema = setup(async () => reply(answer({ question: 5, scaffold: null })));
  await assert.rejects(offSchema.callAgent("questioner", context), failsWith("agent_failed", true));
  assert.equal(refused.logged.length + cutOff.logged.length + offSchema.logged.length, 3);
  assert.deepEqual([refused.logged[0]?.costStatus, cutOff.logged[0]?.costStatus, offSchema.logged[0]?.costStatus], ["measured", "measured", "measured"]);
});

test("a reply that failed still counts against the budget, since it was billed", async (t) => {
  t.mock.method(console, "error", () => {});
  // $0.01 budget: one billed $0.014 reply, even one that broke the schema, spends it
  const { callAgent } = setup(async (params) => reply(answer({ question: 5, scaffold: null }), {
    tokens: { ...usage, output_tokens: Math.min(usage.output_tokens, params.max_tokens) },
  }), 0.01);
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

test("through the real SDK: input tokens are counted, the request carries the schema, and rate-limit headers are read", async (t) => {
  t.mock.method(console, "error", () => {});
  const bodies: Record<string, unknown>[] = [];
  const countBodies: Record<string, unknown>[] = [];
  let status = 200;
  // A stand-in for Anthropic's Messages and token-count endpoints, so the SDK request handling runs.
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (req.url === "/v1/messages/count_tokens") {
      countBodies.push(parsed);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ input_tokens: 1_000 }));
      return;
    }
    bodies.push(parsed);
    const retryAfter = status === 429 ? { "retry-after": "0.001" } : {};
    res.writeHead(status, {
      "content-type": "application/json",
      ...retryAfter,
      "anthropic-ratelimit-requests-limit": "50",
      "anthropic-ratelimit-requests-remaining": status === 429 ? "50" : "2",
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

  const { callAgent } = setup(sendWith(client), 10, countInputTokensWith(client));
  assert.deepEqual(await callAgent("questioner", context), question);
  const sent = bodies[0] as { model: string; system: string; output_config: { effort: string; format: { type: string; schema: unknown } } };
  assert.equal(sent.model, "claude-opus-5-5");
  assert.equal(sent.system, AGENTS.questioner.system);
  assert.equal(sent.output_config.effort, AGENTS.questioner.effort);
  assert.equal(sent.output_config.format.type, "json_schema");
  assert.equal(countBodies.length, 1);
  assert.equal(countBodies[0]?.system, AGENTS.questioner.system);
  // that reply left the requests window 96% used, so the next call waits without reaching the server
  await assert.rejects(callAgent("questioner", context), failsWith("rate_limited", true));
  assert.equal(bodies.length, 1);

  status = 429;
  const fresh = setup(sendWith(client), 10, countInputTokensWith(client));
  await assert.rejects(fresh.callAgent("questioner", context), failsWith("rate_limited", true));
  assert.equal(bodies.length, 3, "a single explicit retry should produce two visible Messages requests");
});

test("every agent's output schema converts to a structured-output format", () => {
  for (const agent of Object.values(AGENTS)) assert.doesNotThrow(() => zodOutputFormat(agent.output), agent.name);
});

test("Claude calls are off without a key, and a key needs a budget and a model with a price", () => {
  assert.equal(agentConfigFromEnv({}), null);
  const key = { ANTHROPIC_API_KEY: "test-key", AGENT_BUDGET_USD: "30" };
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
