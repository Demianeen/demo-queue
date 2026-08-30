import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_HACKATHON_VIDEO_URL_LENGTH,
  normalizeHackathonVideoUrl,
  normalizeGithubRepositoryUrl,
} from "../lib/hackathon.ts";
import {
  normalizeInternationalPhone,
  parseTeamContact,
  teamContactSchema,
} from "../lib/team-contacts.ts";

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

test("team contacts normalize valid international WhatsApp numbers", () => {
  assert.equal(normalizeInternationalPhone(" +44 20 7946 0958 "), "+442079460958");
  assert.deepEqual(
    parseTeamContact({
      name: " Sam Lee ",
      email: "sam@example.com",
      whatsappPhone: "+44 20 7946 0958",
    }),
    {
      name: "Sam Lee",
      email: "sam@example.com",
      whatsappPhone: "+442079460958",
    },
  );
});

test("team contacts require a valid email", () => {
  assert.equal(
    teamContactSchema.safeParse({
      name: "Sam Lee",
      email: "not-an-email",
      whatsappPhone: "+44 20 7946 0958",
    }).success,
    false,
  );
});

test("team contacts require an explicit phone country code", () => {
  assert.equal(
    teamContactSchema.safeParse({
      name: "Sam Lee",
      email: "sam@example.com",
      whatsappPhone: "020 7946 0958",
    }).success,
    false,
  );
});

test("GitHub repository links normalize only repository roots", () => {
  assert.equal(
    normalizeGithubRepositoryUrl("github.com/orbit/launchpad.git"),
    "https://github.com/orbit/launchpad",
  );
  assert.equal(normalizeGithubRepositoryUrl("https://example.com/orbit/launchpad"), null);
  assert.equal(normalizeGithubRepositoryUrl("https://github.com/orbit/launchpad/issues"), null);
});
