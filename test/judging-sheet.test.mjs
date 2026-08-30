import assert from "node:assert/strict";
import test from "node:test";

import {
  JUDGING_HEADERS,
  buildJudgingFormulaColumns,
  buildJudgingSheetValues,
  buildJudgingSubmissionRow,
  buildSyncedBasicFilter,
  buildFilterViewRequests,
  hasPreStageFinalistJudgingSheetHeaders,
  isCompatibleJudgingSheetHeaders,
} from "../lib/judging-sheet.ts";
import { makeSampleHackathonTeam } from "../lib/sampleData.ts";
import {
  googleApiFailure,
  googleApiReason,
} from "../lib/google-api-error.ts";
import {
  completedQueueLabel,
  isJudgingSheetSyncPending,
  lineupPositionLabel,
  participantLineupStatus,
  shouldShowMeetAvailabilityCopy,
  stageSubmissionPrompt,
} from "../lib/event-state.ts";

test("judging sheet keeps submission data and category scoring on one tab", () => {
  const values = buildJudgingSheetValues({
    eventName: "Launch Hack",
    meetUrl: "https://meet.google.com/example",
    submissions: [
      {
        id: "submission-1",
        teamName: "Orbit",
        teamMembers: ["Alex", "Morgan"],
        name: "Sam",
        demoTitle: "Launchpad",
        description: '=IMPORTXML("https://example.com/private","//data")',
        category: "AI",
        videoUrl: "https://example.com/video",
        githubUrl: "https://github.com/orbit/launchpad",
        roundOneAssignedJudges: ["Alex Morgan", "Sam Lee"],
        email: "sam@example.com",
        phone: "+44 20 7946 0958",
        status: "candidate",
        createdAt: Date.UTC(2026, 6, 14),
      },
    ],
  });

  assert.equal(JUDGING_HEADERS.length, 27);
  assert.equal(values.length, 5);
  assert.deepEqual(values[3], [...JUDGING_HEADERS]);
  assert.equal(values[4].length, JUDGING_HEADERS.length);
  assert.equal(values[4][1], "Orbit");
  assert.equal(values[4][2], "Sam, Alex, Morgan");
  assert.equal(values[4][4], '=IMPORTXML("https://example.com/private","//data")');
  assert.equal(values[4][6], "https://example.com/video");
  assert.equal(values[4][14], "Alex Morgan");
  assert.equal(values[4][18], "Sam Lee");
  assert.equal(values[4][25], "");
  assert.equal(values[4][26], "https://github.com/orbit/launchpad");
  assert.equal(values[4][22], "");

  const formulaColumns = buildJudgingFormulaColumns(1);
  assert.deepEqual(
    formulaColumns.map(({ column }) => column),
    ["W", "X", "Y", "Z"],
  );
  assert.match(formulaColumns[0].values[0][0], /COUNT\(P5:R5\)=3/);
  assert.match(formulaColumns[0].values[0][0], /COUNT\(T5:V5\)=3/);
  assert.match(formulaColumns[1].values[0][0], /COUNT\(P5:R5\)=3/);
  assert.match(formulaColumns[1].values[0][0], /COUNT\(T5:V5\)=3/);
  assert.match(formulaColumns[1].values[0][0], /\$N5="excluded"/);
  assert.match(formulaColumns[2].values[0][0], /\$X\$5:\$X/);
  assert.match(formulaColumns[2].values[0][0], /^=IF\(X5="",""/);
  assert.match(formulaColumns[3].values[0][0], /^=IF\(X5="",FALSE/);
  assert.match(formulaColumns[3].values[0][0], /<=6\)$/);
  assert.equal(formulaColumns.length, 4);
  for (const { values: formulaValues } of formulaColumns) {
    const formula = formulaValues[0][0];
    assert.equal(
      [...formula].filter((character) => character === "(").length,
      [...formula].filter((character) => character === ")").length,
    );
  }
  assert.equal(buildJudgingFormulaColumns(0).length, 0);
});

test("judging sheet source updates stop before judge-entered columns", () => {
  const row = buildJudgingSubmissionRow({
    id: "submission-2",
    teamName: "Comet",
    teamMembers: ["Riley"],
    name: "Taylor",
    demoTitle: "Signal",
    description: "Fast project summary",
    category: "Tools",
    videoUrl: "https://example.com/video-2",
    email: "taylor@example.com",
    phone: "+44 20 7000 0000",
    status: "queued",
    createdAt: Date.UTC(2026, 6, 17),
  });

  assert.equal(row.length, 14);
  assert.equal(row[0], "submission-2");
  assert.equal(row[13], "eligible");
});

test("judging sheet accepts current and pre-stage-finalist production layouts", () => {
  const productionHeaders = [
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
  ];

  assert.equal(isCompatibleJudgingSheetHeaders(productionHeaders), true);
  assert.equal(
    isCompatibleJudgingSheetHeaders(
      productionHeaders.filter((header) => header !== "Stage finalist"),
    ),
    true,
  );
  assert.equal(
    hasPreStageFinalistJudgingSheetHeaders(
      productionHeaders.filter((header) => header !== "Stage finalist"),
    ),
    true,
  );
  assert.equal(hasPreStageFinalistJudgingSheetHeaders(productionHeaders), false);
  assert.equal(isCompatibleJudgingSheetHeaders([...productionHeaders, "Unexpected"]), false);
});

test("judging sheet final score accepts one completed unassigned review", () => {
  const completedJudgesFormula = buildJudgingFormulaColumns(1)[0].values[0][0];
  const finalScoreFormula = buildJudgingFormulaColumns(1)[1].values[0][0];

  assert.doesNotMatch(completedJudgesFormula, /TRIM\(O5\)|TRIM\(S5\)/);
  assert.doesNotMatch(finalScoreFormula, /TRIM\(O5\)|TRIM\(S5\)/);
  assert.match(finalScoreFormula, /,0\)\+IF/);
  assert.match(finalScoreFormula, /\/W5\)$/);
  assert.doesNotMatch(finalScoreFormula, /AVERAGE\(IF/);
});

test("failed judging sheet sync can be retried", () => {
  assert.equal(
    isJudgingSheetSyncPending({
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/example/edit",
      requestedRevision: 2,
      syncedRevision: 1,
      error: "Google authorization is no longer valid.",
    }),
    false,
  );
  assert.equal(
    isJudgingSheetSyncPending({
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/example/edit",
      requestedRevision: 2,
      syncedRevision: 1,
    }),
    true,
  );
});

test("Google API errors distinguish invalid requests from expired authorization", () => {
  const invalidRequest = {
    response: {
      status: 400,
      data: { error: { status: "INVALID_ARGUMENT" } },
    },
  };
  assert.equal(googleApiReason(invalidRequest), "INVALID_ARGUMENT");
  assert.equal(
    googleApiFailure(invalidRequest),
    "Google rejected the judging sheet update (INVALID_ARGUMENT).",
  );
  assert.doesNotMatch(googleApiFailure(invalidRequest), /authorization/i);

  assert.match(
    googleApiFailure({ response: { status: 400, data: { error: "invalid_grant" } } }),
    /authorization/i,
  );
  assert.match(googleApiFailure({ response: { status: 401 } }), /authorization/i);
});

test("judging sheet sync preserves judge filter and sort configuration", () => {
  const existingFilter = {
    criteria: { "27": { hiddenValues: [""] } },
    filterSpecs: [{ columnIndex: 27, filterCriteria: { hiddenValues: [""] } }],
    sortSpecs: [{ dimensionIndex: 27, sortOrder: "DESCENDING" }],
    range: { sheetId: 7, startRowIndex: 3, endRowIndex: 12 },
  };

  const syncedFilter = buildSyncedBasicFilter(existingFilter, {
    sheetId: 7,
    startRowIndex: 3,
    endRowIndex: 30,
    startColumnIndex: 0,
    endColumnIndex: 27,
  });

  assert.deepEqual(syncedFilter?.criteria, existingFilter.criteria);
  assert.deepEqual(syncedFilter?.filterSpecs, existingFilter.filterSpecs);
  assert.deepEqual(syncedFilter?.sortSpecs, existingFilter.sortSpecs);
  assert.equal(syncedFilter?.range?.endRowIndex, 30);
  assert.equal(
    buildSyncedBasicFilter({ tableId: "judging-table" }, { sheetId: 7 }),
    null,
  );
});

test("judging sheet creates stable judge and score filter views", () => {
  const requests = buildFilterViewRequests(7, 30, ["Alex Morgan", "Alex Morgan", "Sam \"S\" Lee"]);
  assert.equal(requests.length, 3);
  assert.equal(requests[0].addFilterView.filter.title, "Judge: Alex Morgan");
  assert.match(
    requests[0].addFilterView.filter.filterSpecs[0].filterCriteria.condition.values[0].userEnteredValue,
    /OR\(\$O5="Alex Morgan",\$S5="Alex Morgan"\)/,
  );
  assert.equal(requests[2].addFilterView.filter.title, "All submissions (score)");
  assert.equal(requests[2].addFilterView.filter.sortSpecs[0].dimensionIndex, 23);
  assert.equal(requests[2].addFilterView.filter.sortSpecs[0].sortOrder, "DESCENDING");
  const repeat = buildFilterViewRequests(7, 31, ["Alex Morgan"], [
    { filterViewId: 11, title: "Judge: Alex Morgan" },
    { filterViewId: 12, title: "All submissions (score)" },
  ]);
  assert.equal(repeat[0].updateFilterView.filterView.filterViewId, 11);
  assert.equal(repeat[1].updateFilterView.filterView.filterViewId, 12);
});

test("hackathon sample data includes a team and valid project fields", () => {
  const sample = makeSampleHackathonTeam();

  assert.ok(sample.teamName.length > 0 && sample.teamName.length <= 80);
  assert.ok(sample.teamMembers.length >= 1 && sample.teamMembers.length <= 3);
  assert.equal(new Set(sample.teamMembers).size, sample.teamMembers.length);
  assert.equal(sample.teamMembers.includes(sample.name), false);
  assert.ok(sample.demoTitle.length <= 64);
  assert.ok(sample.description.length <= 240);
  assert.match(sample.email, /@example\.com$/);
});

test("event UI state stays non-live until publishing and finishes cleanly", () => {
  assert.equal(lineupPositionLabel(0, "hackathon", false), "#1");
  assert.equal(lineupPositionLabel(1, "hackathon", false), "#2");
  assert.equal(lineupPositionLabel(0, "hackathon", true), "Now presenting");
  assert.equal(lineupPositionLabel(1, "demo", true), "Up next");

  assert.equal(participantLineupStatus("queued", 0, false), "queued");
  assert.equal(participantLineupStatus("queued", 0, true), "current");
  assert.equal(participantLineupStatus("queued", 1, true), "up_next");
  assert.equal(participantLineupStatus("candidate", -1, true), "candidate");

  assert.equal(completedQueueLabel("hackathon"), "Presentations complete");
  assert.equal(completedQueueLabel("demo"), "Queue complete");
  assert.equal(stageSubmissionPrompt("hackathon"), "Submit your project");
  assert.equal(stageSubmissionPrompt("demo"), "Submit your demo");
  assert.equal(shouldShowMeetAvailabilityCopy("queued"), true);
  assert.equal(shouldShowMeetAvailabilityCopy("done"), false);
});
