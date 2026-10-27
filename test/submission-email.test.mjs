import assert from "node:assert/strict";
import test from "node:test";

import { buildSubmissionEmail, emailSender, escapeHtml } from "../lib/submission-email.ts";

const team = {
  reason: "submitted",
  eventName: "Outpost",
  eventType: "hackathon",
  recipientName: "Sam Lee",
  demoTitle: "Guardrail",
  teamName: "Night Owls",
  people: ["Sam Lee", "Ana Ruiz"],
  tracks: ["Developer tools", "Best use of Daytona"],
  githubUrl: "https://github.com/night-owls/guardrail",
  videoUrl: "https://www.youtube.com/watch?v=abc",
  statusUrl: "https://demo-queue.test/s/outpost/token123",
};

test("the team email has the details, the status link and the team note", () => {
  const email = buildSubmissionEmail(team);
  assert.equal(email.subject, "You submitted Guardrail to Outpost");
  assert.match(email.text, /^Your team is in, Sam/);
  assert.match(email.text, /Open your status page: https:\/\/demo-queue\.test\/s\/outpost\/token123/);
  assert.match(email.text, /Team: Night Owls · Sam Lee, Ana Ruiz/);
  assert.match(email.text, /Tracks: Developer tools · Best use of Daytona/);
  assert.match(email.text, /GitHub: github\.com\/night-owls\/guardrail/);
  assert.match(email.text, /Demo video: youtube\.com\/watch\?v=abc/);
  assert.match(email.text, /Everyone on the team gets this email/);
  assert.match(email.html, /href="https:\/\/demo-queue\.test\/s\/outpost\/token123"/);
});

test("a demo email and a resend use their own copy", () => {
  const demo = buildSubmissionEmail({ ...team, eventType: "demo", teamName: undefined, githubUrl: undefined, videoUrl: undefined, tracks: [] });
  assert.match(demo.text, /^Your demo is in, Sam/);
  assert.match(demo.text, /Demo: Guardrail/);
  assert.match(demo.text, /Tracks: None/);
  assert.doesNotMatch(demo.text, /Team:|Everyone on the team/);

  const resend = buildSubmissionEmail({ ...team, reason: "resend" });
  assert.equal(resend.subject, "Your status link for Guardrail at Outpost");
  assert.match(resend.text, /^Here is your status link/);
  assert.doesNotMatch(resend.text, /Everyone on the team gets this email/);
});

test("what people typed is escaped and kept on one line", () => {
  const email = buildSubmissionEmail({
    ...team,
    demoTitle: "<script>alert(1)</script>\r\nBcc: x@evil.test",
    teamName: '"><img src=x>',
    githubUrl: "javascript:alert(1)",
  });
  assert.doesNotMatch(email.subject, /[\r\n]/);
  assert.doesNotMatch(email.html, /<script>|<img src=x>/);
  assert.match(email.html, /&lt;script&gt;/);
  assert.doesNotMatch(email.html, /href="javascript:/);
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
});

test("the sender names the event and uses only the configured address", () => {
  assert.equal(emailSender("Outpost", "hello@demo-queue.test"), '"Outpost via Demo Queue" <hello@demo-queue.test>');
  assert.equal(emailSender("Outpost", "Someone <hello@demo-queue.test>"), '"Outpost via Demo Queue" <hello@demo-queue.test>');
  assert.equal(emailSender('Evil" <x@y.z>,\r\nBcc: a@b.c', "hello@demo-queue.test"), '"Evil xy.z Bcc ab.c via Demo Queue" <hello@demo-queue.test>');
  assert.equal(emailSender("", "hello@demo-queue.test"), '"Demo Queue" <hello@demo-queue.test>');
});
