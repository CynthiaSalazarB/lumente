import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { MOVE_ORDER, Session, type MoveId } from "@build-north/agents";
import { connectSurreal, queryTimeout, surrealConfigFromEnv } from "./db.ts";

// The testers' numbers (#50): every finished test session (the pre-test and the post-test of each
// tester, docs/tester-protocol.md), as rows of docs/grading-sheet.csv, so Cynthia pastes them in and
// grades the maps by hand next to the evaluator's scores (#49). The maps themselves go to a JSON file
// beside the CSV. Testers appear as a pseudonym (a salted hash of their user id), never a name or a
// Clerk id: the list matching pseudonyms to people stays off the repo.

/** The sheet's columns, in its order (docs/grading-sheet.csv). The human columns stay empty here. */
export const SHEET_COLUMNS = [
  "tester",
  "test",
  "concept",
  "predicted (0-8)",
  "evaluator: bigger group",
  "evaluator: what it isn't",
  "evaluator: what it needs",
  "evaluator: its types",
  "evaluator total",
  "human: bigger group",
  "human: what it isn't",
  "human: what it needs",
  "human: its types",
  "human total",
  "moves where human = evaluator (0-4)",
  "questions asked",
  "questions testing",
  "hints",
  "notes",
] as const;

/** The sheet's evaluator columns, in the sheet's move order. */
const SHEET_MOVES: readonly MoveId[] = ["supraordinate", "exclusion", "isoordinate", "infraordinate"];

export type SheetRow = Record<(typeof SHEET_COLUMNS)[number], string>;
export type MapRow = { learner: string; test: string; concept: string; sessionId: string; createdAt: string; rubric: Record<MoveId, number>; mentefacto: Session["mentefacto"] };

/** A short pseudonym for a user id: the first 8 hex characters of sha256(salt + id). */
export const pseudonymOf = (user: string, salt: string): string => createHash("sha256").update(`${salt}${user}`).digest("hex").slice(0, 8);

/** Which test a session is for its tester: the first finished test session is the pre-test, the last the
 * post-test, any in between "test 2", "test 3"... A tester with one test session only has a pre-test. */
function labelsOf(count: number): string[] {
  return Array.from({ length: count }, (_, i) => (i === 0 ? "pre" : i === count - 1 ? "post" : `test ${i + 1}`));
}

/** The rows of the grading sheet and the maps to grade, from every session the query returned: finished
 * test sessions only, grouped by tester in the order their first test session started. */
export function sheetOf(sessions: readonly Session[], salt: string): { rows: SheetRow[]; maps: MapRow[] } {
  const tests = sessions
    .filter((s) => s.mode === "test" && s.result !== null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const byUser = new Map<string, Session[]>();
  for (const s of tests) byUser.set(s.user, [...(byUser.get(s.user) ?? []), s]);

  const rows: SheetRow[] = [];
  const maps: MapRow[] = [];
  let n = 0;
  for (const [user, own] of byUser) {
    n += 1;
    const learner = pseudonymOf(user, salt);
    const labels = labelsOf(own.length);
    own.forEach((s, i) => {
      const result = s.result!;
      const rubric = Object.fromEntries(MOVE_ORDER.map((move) => [move, result.rubric.find((r) => r.move === move)?.points ?? 0])) as Record<MoveId, number>;
      const test = labels[i]!;
      rows.push({
        tester: `L${n}`,
        test,
        concept: s.concept,
        "predicted (0-8)": String(result.predictedScore),
        "evaluator: bigger group": String(rubric.supraordinate),
        "evaluator: what it isn't": String(rubric.exclusion),
        "evaluator: what it needs": String(rubric.isoordinate),
        "evaluator: its types": String(rubric.infraordinate),
        "evaluator total": String(SHEET_MOVES.reduce((sum, move) => sum + rubric[move], 0)),
        "human: bigger group": "",
        "human: what it isn't": "",
        "human: what it needs": "",
        "human: its types": "",
        "human total": "",
        "moves where human = evaluator (0-4)": "",
        "questions asked": String(result.questions.asked),
        "questions testing": String(result.questions.testing),
        hints: String(result.hintsUsed),
        notes: `learner ${learner}; gap ${result.calibrationGap}; session ${s.id}`,
      });
      maps.push({ learner, test, concept: s.concept, sessionId: s.id, createdAt: s.createdAt, rubric, mentefacto: s.mentefacto });
    });
  }
  return { rows, maps };
}

const cell = (value: string) => {
  // CSV quoting alone doesn't stop a spreadsheet from evaluating learner-controlled text.
  const text = /^[\s\u0000-\u001f]*[=+@-]|^[\t\r\n]/.test(value) ? `'${value}` : value;
  return /[",;\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/** The sheet as CSV text, header first, one line per row, in the sheet's column order. */
export function toCsv(rows: readonly SheetRow[]): string {
  const lines = [SHEET_COLUMNS.join(","), ...rows.map((row) => SHEET_COLUMNS.map((column) => cell(row[column])).join(","))];
  return `${lines.join("\n")}\n`;
}

// npm run export:testers -w api -- [out.csv]: reads the database the SURREAL_* variables name, writes
// the sheet to out.csv (default testers.csv) and the maps to <out>.maps.json. LEARNER_ID_SALT, when
// set, salts the pseudonyms, so they can't be matched back to Clerk ids from the public sheet.
async function main(out: string): Promise<number> {
  const config = surrealConfigFromEnv();
  if (!config) {
    console.error("SURREAL_URL is unset: set the SURREAL_* variables for the database to export from");
    return 2;
  }
  const db = connectSurreal(config);
  try {
    const [rows] = await db
      .query('SELECT *, record::id(id) AS id FROM session WHERE mode = "test" AND result != NONE ORDER BY createdAt')
      .json()
      .signal(queryTimeout())
      .collect<[unknown[]]>();
    const sessions = rows.map((row) => Session.parse(row));
    const { rows: sheet, maps } = sheetOf(sessions, process.env.LEARNER_ID_SALT ?? "");
    const mapsPath = out.replace(/\.csv$/i, "") + ".maps.json";
    await writeFile(out, toCsv(sheet), "utf8");
    await writeFile(mapsPath, `${JSON.stringify(maps, null, 2)}\n`, "utf8");
    const testers = new Set(sheet.map((row) => row.tester)).size;
    console.log(`${sheet.length} test ${sheet.length === 1 ? "session" : "sessions"} from ${testers} ${testers === 1 ? "tester" : "testers"} in ${config.namespace}/${config.database}: ${out} (the sheet's rows) and ${mapsPath} (the maps to grade)`);
    return 0;
  } finally {
    await db.close();
  }
}

if (import.meta.main) process.exitCode = await main(process.argv[2]?.trim() || "testers.csv");
