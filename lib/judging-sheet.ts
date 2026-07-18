import type { sheets_v4 } from "googleapis";

export const JUDGING_SHEET_NAME = "Judging";
export const JUDGING_HEADER_ROW = 4;
export const JUDGING_DATA_START_ROW = JUDGING_HEADER_ROW + 1;
export const ROUND_ONE_JUDGE_SLOTS = 2;
export const ROUND_ONE_MINIMUM_JUDGES = 2;
export const JUDGING_CATEGORY_COUNT = 3;
export const FINALIST_COUNT = 6;
export const MAXIMUM_SCORE = 10;

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
  "Innovation (0-10)",
  "Execution (0-10)",
  "Demo clarity (0-10)",
  "Judge 2",
  "Innovation (0-10)",
  "Execution (0-10)",
  "Demo clarity (0-10)",
  "Completed judges",
  "Final score",
  "Rank",
  "Stage finalist",
  "GitHub",
] as const;

export const ROUND_ONE_SCORE_COLUMN_INDICES = [15, 16, 17, 19, 20, 21] as const;
export const FORMULA_COLUMN_RANGES = [{ startColumnIndex: 22, endColumnIndex: 26 }] as const;
export type JudgingFormulaColumn = {
  column: string;
  values: string[][];
};

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
    submission.status,
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
      "Stage finalists",
      FINALIST_COUNT,
      "",
      "Score range",
      `0-${MAXIMUM_SCORE}`,
    ],
    [
      "Scoring",
      "Each assigned judge scores Innovation, Execution, and Demo clarity from 0 to 10. Final score appears after both judges complete all three scores.",
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
      finalScore: `=IF(OR($N${row}="withdrawn",$N${row}="hidden",$N${row}="no_show",$N${row}="removed",W${row}<$B$2),"",AVERAGE(P${row}:R${row},T${row}:V${row}))`,
      rank: `=IF(X${row}="","",RANK(X${row},$X$${JUDGING_DATA_START_ROW}:$X,0))`,
      finalist: `=IF(X${row}="",FALSE,COUNTIF($X$${JUDGING_DATA_START_ROW}:$X,">"&X${row})+COUNTIF($X$${JUDGING_DATA_START_ROW}:X${row},X${row})<=$H$2)`,
    };
  });

  return [
    { column: "W", values: formulas.map(({ completedJudges }) => [completedJudges]) },
    { column: "X", values: formulas.map(({ finalScore }) => [finalScore]) },
    { column: "Y", values: formulas.map(({ rank }) => [rank]) },
    { column: "Z", values: formulas.map(({ finalist }) => [finalist]) },
  ];
}
