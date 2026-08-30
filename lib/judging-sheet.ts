import type { sheets_v4 } from "googleapis";
// @ts-expect-error Node's strip-types test runner resolves the source extension directly.
import { JUDGING_CRITERIA, JUDGING_CRITERION_LABELS, JUDGING_SCORE_MAX } from "./judging-rubric.ts";

export const JUDGING_SHEET_NAME = "Judging";
export const JUDGING_HEADER_ROW = 4;
export const JUDGING_DATA_START_ROW = JUDGING_HEADER_ROW + 1;
export const ROUND_ONE_JUDGE_SLOTS = 2;
export const ROUND_ONE_MINIMUM_JUDGES = 2;
export const JUDGING_CATEGORY_COUNT = JUDGING_CRITERIA.length;
export const MAXIMUM_SCORE = JUDGING_SCORE_MAX;

export type JudgingSheetSubmission = {
  id: string;
  teamName?: string;
  teamMembers: string[];
  name: string;
  demoTitle: string;
  description: string;
  category?: string;
  videoUrl?: string | null;
  githubUrl?: string;
  roundOneAssignedJudges?: string[];
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
  "GitHub",
] as const;

export const ROUND_ONE_SCORE_COLUMN_INDICES = [15, 16, 17, 19, 20, 21] as const;
export const FORMULA_COLUMN_RANGES = [{ startColumnIndex: 22, endColumnIndex: 25 }] as const;
export type JudgingFormulaColumn = {
  column: string;
  values: string[][];
};

export const ALL_SUBMISSIONS_FILTER_VIEW_TITLE = "All submissions (score)";
export const judgeFilterViewTitle = (judge: string) => `Judge: ${judge}`;

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
  return views.map((view) => {
    const existing = existingViews.find((candidate) => candidate.title === view.title);
    return existing?.filterViewId !== undefined
      ? { updateFilterView: { filterView: { ...view, filterViewId: existing.filterViewId, range: { sheetId, startRowIndex: JUDGING_HEADER_ROW - 1, endRowIndex, startColumnIndex: 0, endColumnIndex: JUDGING_HEADERS.length } }, fields: "title,range,filterSpecs,sortSpecs" } }
      : { addFilterView: { filter: { ...view, range: { sheetId, startRowIndex: JUDGING_HEADER_ROW - 1, endRowIndex, startColumnIndex: 0, endColumnIndex: JUDGING_HEADERS.length } } } };
  });
}

export function buildJudgingSubmissionRow(submission: JudgingSheetSubmission) {
  const members = [submission.name, ...submission.teamMembers].join(", ");
  return [
    submission.id,
    submission.teamName ?? "",
    members,
    submission.demoTitle,
    submission.description,
    submission.category ?? "",
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
      completedJudges: `=IF(AND(LEN(TRIM(O${row}))>0,COUNT(P${row}:R${row})=3),1,0)+IF(AND(LEN(TRIM(S${row}))>0,COUNT(T${row}:V${row})=3),1,0)`,
      finalScore: `=IF(OR($N${row}="excluded",W${row}=0),"",(IF(AND(LEN(TRIM(O${row}))>0,COUNT(P${row}:R${row})=3),AVERAGE(P${row}:R${row}),0)+IF(AND(LEN(TRIM(S${row}))>0,COUNT(T${row}:V${row})=3),AVERAGE(T${row}:V${row}),0))/W${row})`,
      rank: `=IF(X${row}="","",RANK(X${row},$X$${JUDGING_DATA_START_ROW}:$X,0))`,
    };
  });

  return [
    { column: "W", values: formulas.map(({ completedJudges }) => [completedJudges]) },
    { column: "X", values: formulas.map(({ finalScore }) => [finalScore]) },
    { column: "Y", values: formulas.map(({ rank }) => [rank]) },
  ];
}
