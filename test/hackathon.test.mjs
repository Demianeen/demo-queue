import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_HACKATHON_VIDEO_URL_LENGTH,
  normalizeHackathonVideoUrl,
  normalizeGithubRepositoryUrl,
  parseAdditionalTeamMembers,
} from "../lib/hackathon.ts";

test("video links accept normalized HTTPS URLs", () => {
  assert.equal(
    normalizeHackathonVideoUrl("  https://www.youtube.com/watch?v=demo  "),
    "https://www.youtube.com/watch?v=demo",
  );
  assert.equal(
    normalizeHackathonVideoUrl("https://drive.google.com/file/d/demo/view?usp=sharing"),
    "https://drive.google.com/file/d/demo/view?usp=sharing",
  );
});

test("video links reject unsafe or malformed URLs", () => {
  assert.equal(normalizeHackathonVideoUrl("http://example.com/video"), null);
  assert.equal(normalizeHackathonVideoUrl("javascript:alert(1)"), null);
  assert.equal(normalizeHackathonVideoUrl("https://user:pass@example.com/video"), null);
  assert.equal(normalizeHackathonVideoUrl("not a url"), null);
  assert.equal(
    normalizeHackathonVideoUrl(`https://example.com/${"x".repeat(MAX_HACKATHON_VIDEO_URL_LENGTH)}`),
    null,
  );
});

test("team-member parsing normalizes blank lines and whitespace", () => {
  assert.deepEqual(parseAdditionalTeamMembers(" Alex \n\nMorgan\r\n"), ["Alex", "Morgan"]);
});

test("GitHub repository links normalize only repository roots", () => {
  assert.equal(
    normalizeGithubRepositoryUrl("github.com/orbit/launchpad.git"),
    "https://github.com/orbit/launchpad",
  );
  assert.equal(normalizeGithubRepositoryUrl("https://example.com/orbit/launchpad"), null);
  assert.equal(normalizeGithubRepositoryUrl("https://github.com/orbit/launchpad/issues"), null);
});
