import assert from "node:assert/strict";
import test from "node:test";
import { ASSISTANTS, assistantSetup, cursorConfig, cursorInstallLink, SAMPLE_PROMPT, SERVER_NAME } from "../lib/assistant-setup.ts";
import { guideProgress, teamSummary } from "../lib/getting-started.ts";

const url = "https://hack.outpostcrew.co/mcp";

test("progress counts done steps out of five", () => {
  assert.deepEqual(guideProgress([true, false, true, false, false]), { done: 2, total: 5, percent: 40 });
  assert.deepEqual(guideProgress([true, true, true, true, true]), { done: 5, total: 5, percent: 100 });
  assert.deepEqual(guideProgress([]), { done: 0, total: 0, percent: 0 });
});

test("the team step reads as invitations when any were sent, otherwise as members", () => {
  assert.equal(teamSummary({ members: 1, invited: 0, accepted: 0 }), "1 member");
  assert.equal(teamSummary({ members: 3, invited: 0, accepted: 0 }), "3 members");
  assert.equal(teamSummary({ members: 2, invited: 1, accepted: 1 }), "1 invitation sent, 1 accepted");
  assert.equal(teamSummary({ members: 2, invited: 3, accepted: 0 }), "3 invitations sent, 0 accepted");
});

test("the Cursor install link carries the server as base64 JSON, as Cursor documents", () => {
  const link = new URL(cursorInstallLink(url));
  assert.equal(link.protocol, "cursor:");
  assert.equal(link.searchParams.get("name"), SERVER_NAME);
  assert.deepEqual(JSON.parse(atob(link.searchParams.get("config"))), { url });
  assert.deepEqual(JSON.parse(cursorConfig(url)), { mcpServers: { [SERVER_NAME]: { url } } });
});

test("every assistant gets steps that use the address and end with the read-only prompt", () => {
  assert.deepEqual(ASSISTANTS.map((assistant) => assistant.id), ["claude-code", "codex", "claude-app", "cursor"]);
  for (const { id } of ASSISTANTS) {
    const setup = assistantSetup(id, url);
    assert.ok(JSON.stringify(setup.steps).includes(id === "cursor" ? encodeURIComponent(btoa(JSON.stringify({ url }))) : url), id);
    assert.equal(setup.steps.at(-1).kind, "prompt", id);
  }
  assert.equal(assistantSetup("claude-code", url).steps[0].command, `claude mcp add --transport http --scope user demo-queue ${url}`);
  assert.equal(assistantSetup("codex", url).steps[0].command, `codex mcp add demo-queue --url ${url}`);
  assert.match(SAMPLE_PROMPT, /Do not change anything\.$/);
});
