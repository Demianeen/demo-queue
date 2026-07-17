import assert from "node:assert/strict";
import test from "node:test";

import {
  JUDGING_HEADERS,
  buildJudgingFormulaColumns,
  buildJudgingSheetValues,
} from "../lib/judging-sheet.ts";
import {
  MAX_HACKATHON_VIDEO_BYTES,
  isSupportedVideo,
  parseAdditionalTeamMembers,
} from "../lib/hackathon.ts";

test("judging sheet keeps submission data and both rounds on one tab", () => {
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
        email: "sam@example.com",
        phone: "+44 20 7946 0958",
        status: "candidate",
        createdAt: Date.UTC(2026, 6, 14),
      },
    ],
  });

  assert.equal(JUDGING_HEADERS.length, 42);
  assert.equal(values.length, 5);
  assert.deepEqual(values[3], [...JUDGING_HEADERS]);
  assert.equal(values[4].length, JUDGING_HEADERS.length);
  assert.equal(values[4][1], "Orbit");
  assert.equal(values[4][2], "Sam, Alex, Morgan");
  assert.equal(values[4][4], '=IMPORTXML("https://example.com/private","//data")');
  assert.equal(values[4][6], "https://example.com/video");
  assert.equal(values[4][26], "");

  const formulaColumns = buildJudgingFormulaColumns(1);
  assert.deepEqual(
    formulaColumns.map(({ column }) => column),
    ["AA", "AB", "AC", "AD", "AN", "AO", "AP"],
  );
  assert.match(formulaColumns[0].values[0][0], /COUNTUNIQUE\(FILTER/);
  assert.match(formulaColumns[0].values[0][0], /TRIM\(\{O5,R5,U5,X5\}\)<>""/);
  assert.match(formulaColumns[1].values[0][0], /AVERAGE\(QUERY/);
  assert.match(formulaColumns[3].values[0][0], /COUNTIF/);
  assert.match(formulaColumns[5].values[0][0], /AD5<>TRUE/);
  assert.equal(buildJudgingFormulaColumns(0).length, 0);

});

test("hackathon helpers enforce the video and team input contract", () => {
  assert.equal(MAX_HACKATHON_VIDEO_BYTES, 250 * 1024 * 1024);
  assert.equal(isSupportedVideo({ name: "demo.mp4", type: "" }), true);
  assert.equal(isSupportedVideo({ name: "notes.txt", type: "text/plain" }), false);
  assert.deepEqual(parseAdditionalTeamMembers(" Alex \n\nMorgan\r\n"), ["Alex", "Morgan"]);
});
