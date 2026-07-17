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

export function buildJudgingSheetValues({
  eventName,
  meetUrl,
  submissions,
}: {
  eventName: string;
  meetUrl: string;
  submissions: JudgingSheetSubmission[];
}) {
  const finalDataRow = Math.max(
    JUDGING_DATA_START_ROW,
    JUDGING_DATA_START_ROW + submissions.length - 1,
  );
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
    [],
    [...JUDGING_HEADERS],
  ];

  submissions.forEach((submission, index) => {
    const row = JUDGING_DATA_START_ROW + index;
    const members = [submission.name, ...submission.teamMembers].join(", ");
    values.push([
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
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      `=COUNT(P${row},S${row},V${row},Y${row})`,
      `=IF(AA${row}<$B$2,"",AVERAGE(P${row},S${row},V${row},Y${row}))`,
      `=IF(AB${row}="","",RANK(AB${row},$AB$${JUDGING_DATA_START_ROW}:$AB$${finalDataRow},0))`,
      `=IF(AC${row}="","",AC${row}<=$E$2)`,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      `=COUNT(AF${row},AI${row},AL${row})`,
      `=IF(AN${row}=0,"",AVERAGE(AF${row},AI${row},AL${row}))`,
      `=IF(AO${row}="","",RANK(AO${row},$AO$${JUDGING_DATA_START_ROW}:$AO$${finalDataRow},0))`,
    ]);
  });

  return values;
}
