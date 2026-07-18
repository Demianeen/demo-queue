export const JUDGING_SHEET_NAME = "Judging";
export const JUDGING_HEADER_ROW = 4;
export const JUDGING_DATA_START_ROW = JUDGING_HEADER_ROW + 1;
export const ROUND_ONE_JUDGE_SLOTS = 4;
export const ROUND_TWO_JUDGE_SLOTS = 3;
export const ROUND_ONE_MINIMUM_JUDGES = 2;
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
  "R1 judge 1",
  "R1 score 1",
  "R1 notes 1",
  "R1 judge 2",
  "R1 score 2",
  "R1 notes 2",
  "R1 judge 3",
  "R1 score 3",
  "R1 notes 3",
  "R1 judge 4",
  "R1 score 4",
  "R1 notes 4",
  "R1 judge count",
  "R1 final score",
  "R1 rank",
  "Finalist",
  "R2 judge 1",
  "R2 score 1",
  "R2 notes 1",
  "R2 judge 2",
  "R2 score 2",
  "R2 notes 2",
  "R2 judge 3",
  "R2 score 3",
  "R2 notes 3",
  "R2 judge count",
  "Final score",
  "Final rank",
] as const;

export const ROUND_ONE_SCORE_COLUMN_INDICES = [15, 18, 21, 24] as const;
export const ROUND_TWO_SCORE_COLUMN_INDICES = [31, 34, 37] as const;
export const FORMULA_COLUMN_RANGES = [
  { startColumnIndex: 26, endColumnIndex: 30 },
  { startColumnIndex: 39, endColumnIndex: 42 },
] as const;
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
      "Minimum Round 1 judges",
      ROUND_ONE_MINIMUM_JUDGES,
      "",
      "Finalists",
      FINALIST_COUNT,
      "",
      "Maximum score",
      MAXIMUM_SCORE,
    ],
    [
      "Round 1",
      "Enter a judge name and score in the same slot. Finalist-cutoff ties use current row order.",
      "",
      "Round 2",
      "Only finalist rows receive a final score and rank.",
    ],
    [...JUDGING_HEADERS],
  ];

  submissions.forEach((submission) => {
    values.push([
      ...buildJudgingSubmissionRow(submission),
      ...Array.from({ length: JUDGING_HEADERS.length - 14 }, () => ""),
    ]);
  });

  return values;
}

export function buildJudgingFormulaColumns(submissionCount: number): JudgingFormulaColumn[] {
  if (submissionCount === 0) return [];

  const formulas = Array.from({ length: submissionCount }, (_, index) => {
    const row = JUDGING_DATA_START_ROW + index;
    return {
      roundOneJudgeCount: `=IF(SUMPRODUCT(--(LEN(TRIM({O${row},R${row},U${row},X${row}}))>0),--ISNUMBER({P${row},S${row},V${row},Y${row}}))=0,0,COUNTUNIQUE(FILTER(LOWER(TRIM({O${row},R${row},U${row},X${row}})),TRIM({O${row},R${row},U${row},X${row}})<>"",ISNUMBER({P${row},S${row},V${row},Y${row}}))))`,
      roundOneScore: `=IF(OR($N${row}="withdrawn",$N${row}="hidden",$N${row}="no_show",$N${row}="removed",AA${row}<$B$2),"",AVERAGE(QUERY({TRANSPOSE(ARRAYFORMULA(LOWER(TRIM({O${row},R${row},U${row},X${row}})))),TRANSPOSE({P${row},S${row},V${row},Y${row}})},"select avg(Col2) where Col1 is not null and Col2 is not null group by Col1 label avg(Col2) ''",0)))`,
      roundOneRank: `=IF(AB${row}="","",RANK(AB${row},$AB$${JUDGING_DATA_START_ROW}:$AB,0))`,
      finalist: `=IF(AB${row}="",FALSE,COUNTIF($AB$${JUDGING_DATA_START_ROW}:$AB,">"&AB${row})+COUNTIF($AB$${JUDGING_DATA_START_ROW}:AB${row},AB${row})<=$E$2)`,
      roundTwoJudgeCount: `=IF(AD${row}<>TRUE,0,IF(SUMPRODUCT(--(LEN(TRIM({AE${row},AH${row},AK${row}}))>0),--ISNUMBER({AF${row},AI${row},AL${row}}))=0,0,COUNTUNIQUE(FILTER(LOWER(TRIM({AE${row},AH${row},AK${row}})),TRIM({AE${row},AH${row},AK${row}})<>"",ISNUMBER({AF${row},AI${row},AL${row}})))))`,
      finalScore: `=IF(OR(AD${row}<>TRUE,AN${row}=0),"",AVERAGE(QUERY({TRANSPOSE(ARRAYFORMULA(LOWER(TRIM({AE${row},AH${row},AK${row}})))),TRANSPOSE({AF${row},AI${row},AL${row}})},"select avg(Col2) where Col1 is not null and Col2 is not null group by Col1 label avg(Col2) ''",0)))`,
      finalRank: `=IF(AO${row}="","",RANK(AO${row},$AO$${JUDGING_DATA_START_ROW}:$AO,0))`,
    };
  });

  return [
    { column: "AA", values: formulas.map(({ roundOneJudgeCount }) => [roundOneJudgeCount]) },
    { column: "AB", values: formulas.map(({ roundOneScore }) => [roundOneScore]) },
    { column: "AC", values: formulas.map(({ roundOneRank }) => [roundOneRank]) },
    { column: "AD", values: formulas.map(({ finalist }) => [finalist]) },
    { column: "AN", values: formulas.map(({ roundTwoJudgeCount }) => [roundTwoJudgeCount]) },
    { column: "AO", values: formulas.map(({ finalScore }) => [finalScore]) },
    { column: "AP", values: formulas.map(({ finalRank }) => [finalRank]) },
  ];
}
import type { sheets_v4 } from "googleapis";
