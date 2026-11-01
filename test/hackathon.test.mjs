import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_HACKATHON_VIDEO_URL_LENGTH,
  normalizeHackathonVideoUrl,
  normalizeGithubRepositoryUrl,
} from "../lib/hackathon.ts";
import {
  formatInternationalPhone,
  formatWhatsAppAsYouType,
  formatWhatsAppPhone,
  normalizeInternationalPhone,
  parseTeamContact,
  teamContactSchema,
  whatsAppCountryName,
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
  assert.equal(formatInternationalPhone("+447442106036"), "+44 7442 106036");
  assert.equal(formatInternationalPhone(" 0014155552671"), "+1 415 555 2671");
  // Not a full international number: left as typed for validation to explain.
  assert.equal(formatInternationalPhone("07442 106036"), "07442 106036");
  assert.equal(formatInternationalPhone("+44 12"), "+44 12");
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

test("a WhatsApp number needs its country code but no +; a number starting with 0 is never given a country", () => {
  const whatsapp = (whatsappPhone) => teamContactSchema.safeParse({ name: "Sam Lee", email: "sam@example.com", whatsappPhone });
  assert.equal(whatsapp("447442106036").data?.whatsappPhone, "+447442106036");
  assert.equal(whatsapp("44 7442 106036").data?.whatsappPhone, "+447442106036");
  assert.equal(whatsapp("1 (415) 555-2671").data?.whatsappPhone, "+14155552671");
  for (const bad of ["020 7946 0958", "07442 106036", "7442", "+44 12", "call me", "", "0"]) {
    assert.equal(whatsapp(bad).success, false, bad);
  }
  assert.equal(whatsapp("07442 106036").error.issues[0].message, "Enter a valid WhatsApp number with its country code, such as +44 7700 900123.");
});

test("a WhatsApp number is spaced as it is typed, and its country is named once it is valid", () => {
  // Typed at the end of the field, one character at a time.
  const typed = (text) => [...text].reduce((value, character) => formatWhatsAppAsYouType(value + character), "");
  assert.equal(typed("447442106036"), "+44 7442 106036");
  assert.equal(typed("+447442106036"), "+44 7442 106036");
  assert.equal(typed("0014155552671"), "+1 415 555 2671");
  // No country code: left as typed.
  assert.equal(typed("07442106036"), "07442106036");
  assert.equal(formatWhatsAppAsYouType(""), "");
  assert.equal(formatWhatsAppAsYouType("call"), "call");
  // On leaving the field: the international form when valid, otherwise as typed.
  assert.equal(formatWhatsAppPhone("447442106036"), "+44 7442 106036");
  assert.equal(formatWhatsAppPhone("07442 106036"), "07442 106036");
  assert.equal(whatsAppCountryName("07442 106036"), null);
  assert.equal(formatWhatsAppPhone("+44 12"), "+44 12");
  assert.equal(whatsAppCountryName("447442106036"), "United Kingdom");
  assert.equal(whatsAppCountryName("+1 415 555 2671"), "United States");
  assert.equal(whatsAppCountryName("+44 12"), null);
});

test("GitHub repository links normalize only repository roots", () => {
  assert.equal(
    normalizeGithubRepositoryUrl("github.com/orbit/launchpad.git"),
    "https://github.com/orbit/launchpad",
  );
  assert.equal(normalizeGithubRepositoryUrl("https://example.com/orbit/launchpad"), null);
  assert.equal(normalizeGithubRepositoryUrl("https://github.com/orbit/launchpad/issues"), null);
});

test("team contacts keep optional socials and reject bad ones", () => {
  const parsed = teamContactSchema.parse({
    name: "Sam Lee",
    email: "sam@example.com",
    whatsappPhone: "+44 20 7946 0958",
    twitter: " @samlee ",
    linkedin: "",
    githubProfile: "github.com/samlee",
  });
  assert.equal(parsed.twitter, "@samlee");
  assert.equal(parsed.linkedin, undefined);
  assert.equal(parsed.githubProfile, "github.com/samlee");
  const bad = teamContactSchema.safeParse({
    name: "Sam Lee",
    email: "sam@example.com",
    whatsappPhone: "+44 20 7946 0958",
    githubProfile: "https://gitlab.com/samlee",
  });
  assert.equal(bad.success, false);
  assert.equal(bad.error.issues[0].path[0], "githubProfile");
});
