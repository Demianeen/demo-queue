import type { sheets_v4 } from "googleapis";
// @ts-expect-error Node's strip-types test runner resolves the source extension directly.
import { JUDGING_CRITERIA, JUDGING_CRITERION_LABELS, JUDGING_SCORE_MAX } from "./judging-rubric.ts";
// @ts-expect-error Node's strip-types test runner resolves the source extension directly.
import { judgeKeyOf, judgeNameKey } from "./judging-assignment.ts";

export const JUDGING_SHEET_NAME = "Judging";
export const JUDGING_HEADER_ROW = 4;
export const JUDGING_DATA_START_ROW = JUDGING_HEADER_ROW + 1;
export const ROUND_ONE_JUDGE_SLOTS = 2;
export const ROUND_ONE_MINIMUM_JUDGES = 2;
export const JUDGING_CATEGORY_COUNT = JUDGING_CRITERIA.length;
export const FINALIST_COUNT = 6;
export const MAXIMUM_SCORE = JUDGING_SCORE_MAX;

export type JudgingSheetSubmission = {
  id: string;
  teamName?: string;
  teamMembers: string[];
  name: string;
  demoTitle: string;
  description: string;
  tracks?: string[];
  videoUrl?: string | null;
  githubUrl?: string;
  /** The assigned judges' names, as the sheet shows them. */
  roundOneAssignedJudges?: string[];
  /** The same judges' keys, in the same order. */
  roundOneAssignedJudgeKeys?: string[];
  email?: string;
  phone: string;
  twitter?: string;
  linkedin?: string;
  status: string;
  createdAt: number;
};

export const JUDGING_HEADERS = [
  "Submission ID",
  "Team",
  "Team members",
  "Project",
  "Description",
  "Category",
  "Video",
  "Presenter",
  "Email",
  "Phone",
  "Twitter/X",
  "LinkedIn",
  "Submitted",
  "Status",
  "Judge 1",
  ...JUDGING_CRITERIA.map((criterion) =>
    `${JUDGING_CRITERION_LABELS[criterion]} (0-${JUDGING_SCORE_MAX})`,
  ),
  "Judge 2",
  ...JUDGING_CRITERIA.map((criterion) =>
    `${JUDGING_CRITERION_LABELS[criterion]} (0-${JUDGING_SCORE_MAX})`,
  ),
  "Completed judges",
  "Final score",
  "Rank",
  "Stage finalist",
  "GitHub",
] as const;

export const ROUND_ONE_SCORE_COLUMN_INDICES = [15, 16, 17, 19, 20, 21] as const;
export const FORMULA_COLUMN_RANGES = [{ startColumnIndex: 22, endColumnIndex: 26 }] as const;
const PRE_STAGE_FINALIST_JUDGING_HEADERS = JUDGING_HEADERS.filter(
  (header) => header !== "Stage finalist",
);
const BLANK_STAGE_FINALIST_JUDGING_HEADERS = JUDGING_HEADERS.map(
  (header) => header === "Stage finalist" ? "" : header,
);
export type JudgingFormulaColumn = {
  column: string;
  values: string[][];
};

export const ALL_SUBMISSIONS_FILTER_VIEW_TITLE = "All submissions (score)";
const JUDGE_FILTER_VIEW_PREFIX = "Judge: ";
export const judgeFilterViewTitle = (judge: string) => `${JUDGE_FILTER_VIEW_PREFIX}${judge}`;

export type SheetJudge = { key: string; name: string };

/**
 * A Judge 1 or Judge 2 cell shows the judge's name and keeps their key in its
 * note, so the cell stays matched to the judge when they are renamed.
 */
export const judgeCellNote = (key: string) => `Judge id: ${key}`;

export function judgeKeyFromNote(note: string | null | undefined) {
  const match = /^Judge id: (.+)$/m.exec(note ?? "");
  return match ? match[1].trim() : null;
}

/**
 * What to do with one judge cell, given the judge the app has in that slot.
 * The cell is matched by the key in its note. A cell without one (written
 * before notes, or typed by hand) is matched by its text: on an event set up
 * before judges had ids, a judge's key is their name then; else whoever has
 * that name now. A cell for another judge is left alone and reported as
 * drift; a cell for the same judge is rewritten with their current name.
 */
export function planJudgeCell(cell: { text: string; note?: string | null }, assigned: SheetJudge | undefined, judges: SheetJudge[]) {
  const text = cell.text.trim();
  if (!assigned) return { drift: false, write: null, shown: text };
  if (!text) return { drift: false, write: assigned, shown: assigned.name };
  const noted = judgeKeyFromNote(cell.note);
  const byText = judgeKeyOf(text);
  const key = noted ??
    (judges.some((judge) => judge.key === byText) ? byText : judges.find((judge) => judgeNameKey(judge.name) === judgeNameKey(text))?.key ?? byText);
  if (key !== assigned.key) return { drift: true, write: null, shown: text };
  const current = text === assigned.name && noted === assigned.key;
  return { drift: false, write: current ? null : assigned, shown: assigned.name };
}

export function isCompatibleJudgingSheetHeaders(headers: unknown[]) {
  return matchesJudgingSheetHeaders(headers, JUDGING_HEADERS) ||
    matchesJudgingSheetHeaders(headers, PRE_STAGE_FINALIST_JUDGING_HEADERS) ||
    matchesJudgingSheetHeaders(headers, BLANK_STAGE_FINALIST_JUDGING_HEADERS);
}

export function hasPreStageFinalistJudgingSheetHeaders(headers: unknown[]) {
  return matchesJudgingSheetHeaders(headers, PRE_STAGE_FINALIST_JUDGING_HEADERS);
}

export function hasBlankStageFinalistJudgingSheetHeaders(headers: unknown[]) {
  return matchesJudgingSheetHeaders(headers, BLANK_STAGE_FINALIST_JUDGING_HEADERS);
}

function matchesJudgingSheetHeaders(headers: unknown[], expectedHeaders: readonly string[]) {
  return headers.length === expectedHeaders.length &&
    expectedHeaders.every((header, index) => headers[index] === header);
}

export function buildFilterViewRequests(
  sheetId: number,
  endRowIndex: number,
  judges: string[],
  existingViews: sheets_v4.Schema$FilterView[] = [],
) {
  const views = [
    ...[...new Set(judges.map((judge) => judge.trim()).filter(Boolean))].map((judge) => ({
      title: judgeFilterViewTitle(judge),
      filterSpecs: [{
        columnIndex: 14,
        filterCriteria: {
          condition: {
            type: "CUSTOM_FORMULA",
            values: [{ userEnteredValue: `=OR($O${JUDGING_DATA_START_ROW}="${judge.replaceAll('"', '""')}",$S${JUDGING_DATA_START_ROW}="${judge.replaceAll('"', '""')}")` }],
          },
        },
      }],
    })),
    {
      title: ALL_SUBMISSIONS_FILTER_VIEW_TITLE,
      sortSpecs: [{ dimensionIndex: 23, sortOrder: "DESCENDING" }],
    },
  ];
  // A judge view whose judge is no longer in the sheet, or was renamed, goes.
  const titles = new Set(views.map((view) => view.title));
  const stale = existingViews
    .filter((view) => view.filterViewId !== undefined && view.filterViewId !== null && view.title?.startsWith(JUDGE_FILTER_VIEW_PREFIX) && !titles.has(view.title))
    .map((view) => ({ deleteFilterView: { filterId: view.filterViewId! } }));
  return [...stale, ...views.flatMap((view) => {
    const existing = existingViews.find((candidate) => candidate.title === view.title);
    const addRequest = {
      addFilterView: {
        filter: {
          ...view,
          range: {
            sheetId,
            startRowIndex: JUDGING_HEADER_ROW - 1,
            endRowIndex,
            startColumnIndex: 0,
            endColumnIndex: JUDGING_HEADERS.length,
          },
        },
      },
    };
    return existing?.filterViewId !== undefined
      ? [
          { deleteFilterView: { filterId: existing.filterViewId } },
          addRequest,
        ]
      : [addRequest];
  })];
}

export function buildJudgingSubmissionRow(submission: JudgingSheetSubmission) {
  const members = [submission.name, ...submission.teamMembers].join(", ");
  return [
    submission.id,
    submission.teamName ?? "",
    members,
    submission.demoTitle,
    submission.description,
    (submission.tracks ?? []).join(" · "),
    submission.videoUrl ?? "",
    submission.name,
    submission.email ?? "",
    submission.phone,
    submission.twitter ?? "",
    submission.linkedin ?? "",
    new Date(submission.createdAt).toISOString(),
    ["hidden", "withdrawn", "no_show"].includes(submission.status)
      ? "excluded"
      : "eligible",
  ];
}

export function buildSyncedBasicFilter(
  existingFilter: sheets_v4.Schema$BasicFilter | undefined,
  range: sheets_v4.Schema$GridRange,
): sheets_v4.Schema$BasicFilter | null {
  if (existingFilter?.tableId) return null;

  return {
    ...existingFilter,
    range: {
      ...existingFilter?.range,
      ...range,
    },
  };
}

export function buildJudgingSheetValues({
  eventName,
  meetUrl,
  submissions,
}: {
  eventName: string;
  meetUrl: string;
  submissions: JudgingSheetSubmission[];
}) {
  const values: (string | number | boolean)[][] = [
    ["Event", eventName, "", "Meet", meetUrl, "", "Exported", new Date().toISOString()],
    [
      "Judges per submission",
      ROUND_ONE_MINIMUM_JUDGES,
      "",
      "Categories per judge",
      JUDGING_CATEGORY_COUNT,
      "",
      "Review status",
      "Eligible submissions",
      "",
      "Score range",
      `0-${MAXIMUM_SCORE}`,
    ],
    [
      "Scoring",
      "Each assigned judge scores Innovation, Execution, and Demo clarity from 0 to 10. Final score appears after at least one judge completes all three scores.",
    ],
    [...JUDGING_HEADERS],
  ];

  submissions.forEach((submission) => {
    const managedCells = Array.from({ length: JUDGING_HEADERS.length - 14 }, () => "");
    managedCells[0] = submission.roundOneAssignedJudges?.[0] ?? "";
    managedCells[4] = submission.roundOneAssignedJudges?.[1] ?? "";
    managedCells[managedCells.length - 1] = submission.githubUrl ?? "";
    values.push([
      ...buildJudgingSubmissionRow(submission),
      ...managedCells,
    ]);
  });

  return values;
}

export function buildJudgingFormulaColumns(submissionCount: number): JudgingFormulaColumn[] {
  if (submissionCount === 0) return [];

  const formulas = Array.from({ length: submissionCount }, (_, index) => {
    const row = JUDGING_DATA_START_ROW + index;
    return {
      completedJudges: `=IF(COUNT(P${row}:R${row})=3,1,0)+IF(COUNT(T${row}:V${row})=3,1,0)`,
      finalScore: `=IF(OR($N${row}="excluded",W${row}=0),"",(IF(COUNT(P${row}:R${row})=3,AVERAGE(P${row}:R${row}),0)+IF(COUNT(T${row}:V${row})=3,AVERAGE(T${row}:V${row}),0))/W${row})`,
      rank: `=IF(X${row}="","",RANK(X${row},$X$${JUDGING_DATA_START_ROW}:$X,0))`,
      finalist: `=IF(X${row}="",FALSE,COUNTIF($X$${JUDGING_DATA_START_ROW}:$X,">"&X${row})+COUNTIF($X$${JUDGING_DATA_START_ROW}:X${row},X${row})<=${FINALIST_COUNT})`,
    };
  });

  return [
    { column: "W", values: formulas.map(({ completedJudges }) => [completedJudges]) },
    { column: "X", values: formulas.map(({ finalScore }) => [finalScore]) },
    { column: "Y", values: formulas.map(({ rank }) => [rank]) },
    { column: "Z", values: formulas.map(({ finalist }) => [finalist]) },
  ];
}
