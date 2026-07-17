import assert from "node:assert/strict";
import test from "node:test";

import {
  JUDGING_DATA_START_ROW,
  JUDGING_HEADERS,
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
        description: "A launch workflow",
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
  assert.equal(values[4][6], "https://example.com/video");
  assert.equal(values[4][26], `=COUNT(P${JUDGING_DATA_START_ROW},S${JUDGING_DATA_START_ROW},V${JUDGING_DATA_START_ROW},Y${JUDGING_DATA_START_ROW})`);
  assert.match(String(values[4][27]), /AVERAGE/);
  assert.match(String(values[4][40]), /AVERAGE/);
});

test("hackathon helpers enforce the video and team input contract", () => {
  assert.equal(MAX_HACKATHON_VIDEO_BYTES, 250 * 1024 * 1024);
  assert.equal(isSupportedVideo({ name: "demo.mp4", type: "" }), true);
  assert.equal(isSupportedVideo({ name: "notes.txt", type: "text/plain" }), false);
  assert.deepEqual(parseAdditionalTeamMembers(" Alex \n\nMorgan\r\n"), ["Alex", "Morgan"]);
});
