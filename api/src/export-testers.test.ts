import assert from "node:assert/strict";
import { test } from "node:test";
import type { Session } from "@build-north/agents";
import { pseudonymOf, SHEET_COLUMNS, sheetOf, toCsv } from "./export-testers.ts";
import { initialSession } from "./store.ts";

let made = 0;

test("CSV keeps formula-like concepts as text, including leading whitespace", () => {
  for (const [concept, expected] of [["=1+1", "'=1+1"], ["+1+1", "'+1+1"], ["-1+1", "'-1+1"], ["@SUM(1)", "'@SUM(1)"], ["\t=1+1", "'\t=1+1"], ["\r=1+1", '"\'\r=1+1"'], ["  =1+1", "'  =1+1"]] as const) {
    const { rows } = sheetOf([finished("u", concept, "2026-10-28T12:00:00Z")], "");
    assert.ok(toCsv(rows).includes(`L1,pre,${expected},6,`));
  }
});

/** A finished test session, as the store returns it (ids as SurrealDB makes them: no user in them). */
function finished(user: string, concept: string, createdAt: string, over: { score?: number; predicted?: number; rubric?: number[]; hints?: number; asked?: number; testing?: number; mode?: "learn" | "test" } = {}): Session {
  const rubric = over.rubric ?? [2, 1, 0, 2];
  const score = over.score ?? rubric.reduce((a, b) => a + b, 0);
  const predicted = over.predicted ?? 6;
  made += 1;
  return {
    ...initialSession(user, { concept, material: null, mode: over.mode ?? "test" }),
    id: `ses${made}`,
    createdAt,
    phase: "result",
    mentefacto: { concept, supraordinate: { value: "a thing", note: null }, exclusion: [{ value: "another", note: "it differs" }], isoordinate: [], infraordinate: [{ value: "a kind", note: null }] },
    result: {
      predictedScore: predicted,
      score,
      maxScore: 8,
      calibrationGap: predicted - score,
      hintsUsed: over.hints ?? 0,
      rubric: [
        { move: "supraordinate", points: rubric[0]! as 0 | 1 | 2 },
        { move: "exclusion", points: rubric[1]! as 0 | 1 | 2 },
        { move: "isoordinate", points: rubric[2]! as 0 | 1 | 2 },
        { move: "infraordinate", points: rubric[3]! as 0 | 1 | 2 },
      ],
      masteryChanges: [],
      questions: { asked: over.asked ?? 0, testing: over.testing ?? 0 },
      coach: { message: "Next: the types.", nextFocus: "infraordinate" },
    },
  };
}

test("one row per finished test session: the first is the pre-test, the last the post-test, grouped by tester", () => {
  const sessions = [
    finished("user_b", "rate limiting", "2026-10-23T14:05:00Z", { rubric: [1, 1, 1, 1], predicted: 5, asked: 3, testing: 2 }),
    finished("user_a", "database index", "2026-10-23T14:00:00Z", { rubric: [2, 1, 0, 2], predicted: 6, hints: 1 }),
    finished("user_a", "hashing", "2026-10-23T14:20:00Z", { mode: "learn" }),
    finished("user_a", "rate limiting", "2026-10-23T14:40:00Z", { rubric: [2, 2, 1, 2], predicted: 7, asked: 4, testing: 3 }),
    { ...finished("user_b", "database index", "2026-10-23T14:45:00Z"), result: null },
  ];
  const { rows, maps } = sheetOf(sessions, "salt");
  assert.deepEqual(
    rows.map((r) => [r.tester, r.test, r.concept, r["predicted (0-8)"], r["evaluator total"], r["questions asked"], r["questions testing"], r.hints]),
    [
      ["L1", "pre", "database index", "6", "5", "0", "0", "1"],
      ["L1", "post", "rate limiting", "7", "7", "4", "3", "0"],
      ["L2", "pre", "rate limiting", "5", "4", "3", "2", "0"],
    ],
  );
  // the evaluator's four scores in the sheet's order, the human columns empty, the notes carry the gap and the ids
  assert.deepEqual([rows[0]!["evaluator: bigger group"], rows[0]!["evaluator: what it isn't"], rows[0]!["evaluator: what it needs"], rows[0]!["evaluator: its types"]], ["2", "1", "0", "2"]);
  assert.equal(rows[0]!["human total"], "");
  assert.equal(rows[0]!.notes, `learner ${pseudonymOf("user_a", "salt")}; gap 1; session ${sessions[1]!.id}`);
  // the maps go with the same labels, and never the user id
  assert.deepEqual(maps.map((m) => [m.learner, m.test, m.concept]), [[pseudonymOf("user_a", "salt"), "pre", "database index"], [pseudonymOf("user_a", "salt"), "post", "rate limiting"], [pseudonymOf("user_b", "salt"), "pre", "rate limiting"]]);
  assert.equal(JSON.stringify(maps).includes("user_a"), false);
  assert.deepEqual(maps[0]!.rubric, { supraordinate: 2, exclusion: 1, isoordinate: 0, infraordinate: 2 });
});

test("a tester with three test sessions gets pre, test 2, post", () => {
  const sessions = ["T14:00", "T15:00", "T16:00"].map((t) => finished("u", "cache", `2026-10-23${t}:00Z`));
  assert.deepEqual(sheetOf(sessions, "").rows.map((r) => r.test), ["pre", "test 2", "post"]);
});

test("the pseudonym is 8 hex characters, stable, and changes with the salt", () => {
  assert.match(pseudonymOf("user_123", "s"), /^[0-9a-f]{8}$/);
  assert.equal(pseudonymOf("user_123", "s"), pseudonymOf("user_123", "s"));
  assert.notEqual(pseudonymOf("user_123", "s"), pseudonymOf("user_123", "t"));
});

test("the CSV has the grading sheet's header and quotes cells with commas or quotes", () => {
  const [row] = sheetOf([finished("u", 'rate, "limiting"', "2026-10-23T14:00:00Z")], "").rows;
  const csv = toCsv([row!]);
  const [header, line] = csv.split("\n");
  assert.equal(header, SHEET_COLUMNS.join(","));
  assert.ok(line!.startsWith('L1,pre,"rate, ""limiting""",6,'));
  assert.equal(csv.endsWith("\n"), true);
});


test("CSV quotes semicolons", () => {
  const [row] = sheetOf([finished("u", "a;b", "2026-10-23T14:00:00Z")], "").rows;
  assert.ok(toCsv([row!]).includes('"a;b"'));
});
