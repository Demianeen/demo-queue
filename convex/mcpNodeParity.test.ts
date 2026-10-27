// @vitest-environment node

import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { drive_v3, sheets_v4 } from "googleapis";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import schema from "./schema";
import { JUDGING_HEADERS } from "../lib/judging-sheet";

const provider = vi.hoisted(() => ({
  generateText: vi.fn<(input: { prompt: string }) => Promise<{ output: { orderedIds: string[] } }>>(),
  folderGet: vi.fn<(input: drive_v3.Params$Resource$Files$Get) => Promise<{ data: drive_v3.Schema$File }>>(),
  fileCreate: vi.fn<(input: drive_v3.Params$Resource$Files$Create) => Promise<{ data: drive_v3.Schema$File }>>(),
  fileUpdate: vi.fn<(input: drive_v3.Params$Resource$Files$Update) => Promise<{ data: drive_v3.Schema$File }>>(),
  spreadsheetGet: vi.fn<(input: sheets_v4.Params$Resource$Spreadsheets$Get) => Promise<{ data: sheets_v4.Schema$Spreadsheet }>>(),
  spreadsheetUpdate: vi.fn<(input: sheets_v4.Params$Resource$Spreadsheets$Batchupdate) => Promise<{ data: sheets_v4.Schema$BatchUpdateSpreadsheetResponse }>>(),
  valuesUpdate: vi.fn<(input: sheets_v4.Params$Resource$Spreadsheets$Values$Update) => Promise<{ data: sheets_v4.Schema$UpdateValuesResponse }>>(),
  valuesBatchUpdate: vi.fn<(input: sheets_v4.Params$Resource$Spreadsheets$Values$Batchupdate) => Promise<{ data: sheets_v4.Schema$BatchUpdateValuesResponse }>>(),
  valuesGet: vi.fn<(input: sheets_v4.Params$Resource$Spreadsheets$Values$Get) => Promise<{ data: sheets_v4.Schema$ValueRange }>>(),
}));

vi.mock("ai", async (importOriginal) => ({
  ...await importOriginal<typeof import("ai")>(),
  generateText: provider.generateText,
}));

vi.mock("googleapis", () => ({
  google: {
    auth: { OAuth2: class { setCredentials() {} } },
    drive: () => ({ files: { get: provider.folderGet, create: provider.fileCreate, update: provider.fileUpdate } }),
    sheets: () => ({
      spreadsheets: {
        get: provider.spreadsheetGet,
        batchUpdate: provider.spreadsheetUpdate,
        values: { update: provider.valuesUpdate, batchUpdate: provider.valuesBatchUpdate, get: provider.valuesGet },
      },
    }),
  },
}));

const modules = {
  "./_generated/api.js": () => import("./_generated/api.js"),
  "./_generated/server.js": () => import("./_generated/server.js"),
  "./events.ts": () => import("./events"),
  "./judging.ts": () => import("./judging"),
  "./mcpAdmin.ts": () => import("./mcpAdmin"),
  "./ai.ts": () => import("./ai"),
  "./googleSheets.ts": () => import("./googleSheets"),
};
const principal = { organizationId: "org_parity", actor: "https://identity.example|operator" };
const slug = "node-parity";
const ownSheetUrl = "https://docs.google.com/spreadsheets/d/new-sheet/edit";
const winnerUrl = "https://docs.google.com/spreadsheets/d/winner/edit";
type Entry = "browser" | "mcp";

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  for (const name of ["OPENAI_API_KEY", "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_OAUTH_REFRESH_TOKEN"]) {
    vi.stubEnv(name, "test-provider-credential");
  }
  vi.stubEnv("GOOGLE_DRIVE_FOLDER_ID", "configured-folder");
  provider.generateText.mockResolvedValue({ output: { orderedIds: [] } });
  provider.folderGet.mockResolvedValue({ data: { mimeType: "application/vnd.google-apps.folder", capabilities: { canAddChildren: true }, trashed: false } });
  provider.fileCreate.mockResolvedValue({ data: { id: "new-sheet" } });
  provider.fileUpdate.mockResolvedValue({ data: {} });
  provider.spreadsheetGet.mockResolvedValue({ data: { sheets: [{ properties: { sheetId: 0, title: "Sheet1" } }] } });
  provider.spreadsheetUpdate.mockImplementation(async ({ requestBody }) => ({
    data: requestBody?.requests?.some((request) => request.addSheet)
      ? { replies: [{ addSheet: { properties: { sheetId: 17 } } }] }
      : {},
  }));
  provider.valuesUpdate.mockResolvedValue({ data: {} });
  provider.valuesBatchUpdate.mockResolvedValue({ data: {} });
  provider.valuesGet.mockImplementation(async ({ range }) => ({ data: { values: range?.includes("A4:") ? [[...JUDGING_HEADERS]] : [] } }));
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function fixture(entry: Entry, statuses: Doc<"submissions">["status"][] = []) {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({ subject: "operator", issuer: "https://identity.example", org_id: principal.organizationId });
  const { eventId, ids } = await t.run(async (ctx) => {
    const eventId = await ctx.db.insert("events", {
      name: "Parity hackathon", slug, eventType: "hackathon", workosOrganizationId: principal.organizationId,
      meetUrl: "https://meet.example/parity", adminToken: "private-admin-capability", lineupTarget: 2,
      queuePublished: false, createdAt: 1, updatedAt: 1,
    });
    const ids = [];
    for (const [index, status] of statuses.entries()) {
      const id = await ctx.db.insert("submissions", {
        eventId, participantToken: `private-participant-${index}`, name: `Presenter ${index}`,
        demoTitle: `Demo ${index}`, description: `Private description ${index}`, phone: `private-phone-${index}`,
        email: `private-${index}@example.com`, twitter: `private-twitter-${index}`, linkedin: `private-linkedin-${index}`,
        category: "Tools", status, queueOrder: status === "queued" ? 1 : undefined,
        createdAt: index + 1, updatedAt: 1,
      });
      await ctx.db.insert("teamMembers", { eventId, submissionId: id, name: `Member ${index}`, email: `member-${index}@example.com`, whatsappPhone: `private-member-phone-${index}`, createdAt: 1 });
      ids.push(id);
    }
    return { eventId, ids };
  });
  return {
    t, owner, eventId, ids,
    shuffle: (prompt = "Choose useful tools") => entry === "browser"
      ? owner.action(api.ai.aiShuffle, { slug, prompt })
      : t.action(internal.ai.aiShuffleMcp, { principal, input: { slug, prompt } }),
    createSheet: () => entry === "browser"
      ? owner.action(api.googleSheets.createJudgingSheet, { slug })
      : t.action(internal.googleSheets.createJudgingSheetMcp, { principal, input: { slug } }),
  };
}

test.each<Entry>(["browser", "mcp"])("%s shuffle returns zero for an empty pool without asking the model", async (entry) => {
  const { shuffle } = await fixture(entry);
  expect(await shuffle()).toEqual({ count: 0 });
  expect(provider.generateText).not.toHaveBeenCalled();
});

test.each<Entry>(["browser", "mcp"])("%s shuffle filters unknown, duplicate and hidden IDs and caps the actual lineup", async (entry) => {
  const { t, owner, ids, shuffle } = await fixture(entry, ["queued", "candidate", "candidate", "hidden"]);
  provider.generateText.mockResolvedValue({ output: { orderedIds: ["unknown-id", ids[2], ids[2], ids[3], ids[0], ids[1]] } });
  expect(await shuffle("Lead with tools")).toEqual({ count: 2 });
  const admin = await owner.query(api.events.getAdmin, { slug });
  expect(admin.lineup.map((submission) => ({ id: submission.id, order: submission.queueOrder }))).toEqual([{ id: ids[2], order: 1 }, { id: ids[0], order: 2 }]);
  expect(admin.pool.map((submission) => submission.id)).toEqual([ids[1]]);
  expect(admin.hidden.map((submission) => submission.id)).toEqual([ids[3]]);
  const prompt = provider.generateText.mock.calls[0][0].prompt;
  expect(prompt).toContain("Choose exactly 2 presenters");
  expect(prompt).toContain("Lead with tools");
  expect(JSON.parse(prompt.split("People (JSON): ")[1])).toEqual([0, 1, 2].map((index) => ({ id: ids[index], name: `Presenter ${index}`, demoTitle: `Demo ${index}`, category: "Tools" })));
  for (const secret of ["private-", "member-", "participantToken", "teamMemberContacts", "description", "email", "phone", "twitter", "linkedin"]) expect(prompt).not.toContain(secret);
  expect((await t.run((ctx) => ctx.db.query("auditLog").collect())).map((row) => row.action)).toEqual(["lineup_ai_ordered"]);
});

test.each<Entry>(["browser", "mcp"])("%s shuffle rejects an ownership change before the final write", async (entry) => {
  const { t, eventId, ids, shuffle } = await fixture(entry, ["candidate"]);
  provider.generateText.mockImplementation(async () => {
    await t.run((ctx) => ctx.db.patch(eventId, { workosOrganizationId: "org_new_owner" }));
    return { output: { orderedIds: ids } };
  });
  await expect(shuffle()).rejects.toThrow("Unauthorized");
  expect(await t.run((ctx) => ctx.db.get(ids[0]))).toMatchObject({ status: "candidate" });
  expect(await t.run((ctx) => ctx.db.query("auditLog").collect())).toEqual([]);
});

test.each<Entry>(["browser", "mcp"])("%s sheet creation reuses the existing link without a Google request", async (entry) => {
  const { t, eventId, createSheet } = await fixture(entry);
  await t.run((ctx) => ctx.db.patch(eventId, { judgingSheetId: "winner", judgingSheetUrl: winnerUrl }));
  expect(await createSheet()).toEqual({ spreadsheetUrl: winnerUrl, created: false });
  expect(provider.folderGet).not.toHaveBeenCalled();
  expect(provider.fileCreate).not.toHaveBeenCalled();
});

test.each<Entry>(["browser", "mcp"])("%s sheet creation rejects a Drive folder without add permission", async (entry) => {
  const { t, eventId, createSheet } = await fixture(entry);
  provider.folderGet.mockResolvedValue({ data: { mimeType: "application/vnd.google-apps.folder", capabilities: { canAddChildren: false } } });
  await expect(createSheet()).rejects.toThrow("needs permission to add files");
  expect(await t.run((ctx) => ctx.db.get(eventId))).not.toHaveProperty("judgingSheetId");
  expect(provider.fileCreate).not.toHaveBeenCalled();
  expect(provider.fileUpdate).not.toHaveBeenCalled();
});

test.each<Entry>(["browser", "mcp"])("%s sheet creation formats, links and schedules the real judging sync", async (entry) => {
  const { t, owner, eventId, ids, createSheet } = await fixture(entry, ["candidate", "hidden"]);
  expect(await createSheet()).toEqual({ spreadsheetUrl: ownSheetUrl, created: true });
  expect(provider.fileCreate.mock.calls[0][0]).toEqual({ requestBody: { name: "Parity hackathon judging", mimeType: "application/vnd.google-apps.spreadsheet", parents: ["configured-folder"] }, fields: "id" });
  const writtenValues = provider.valuesUpdate.mock.calls[0][0].requestBody?.values;
  expect(writtenValues?.slice(4).map((row) => [row[0], row[3], row[13]])).toEqual([[ids[0], "Demo 0", "eligible"], [ids[1], "Demo 1", "excluded"]]);
  const formatting = provider.spreadsheetUpdate.mock.calls.flatMap(([input]) => input.requestBody?.requests ?? []);
  expect(formatting).toContainEqual({ deleteSheet: { sheetId: 0 } });
  expect(formatting).toContainEqual({ updateSheetProperties: { properties: { sheetId: 17, title: "Judging", gridProperties: { frozenRowCount: 4, frozenColumnCount: 4 } }, fields: "title,gridProperties.frozenRowCount,gridProperties.frozenColumnCount" } });
  expect(formatting).toContainEqual(expect.objectContaining({ setDataValidation: expect.objectContaining({ rule: expect.objectContaining({ condition: { type: "NUMBER_BETWEEN", values: [{ userEnteredValue: "0" }, { userEnteredValue: "10" }] } }) }) }));
  const formulaRequest = provider.valuesBatchUpdate.mock.calls[0][0];
  expect(formulaRequest.requestBody?.valueInputOption).toBe("USER_ENTERED");
  expect(formulaRequest.requestBody?.data?.[0].values?.[0]?.[0]).toContain("=");
  expect((await owner.query(api.events.getAdmin, { slug })).event).toMatchObject({ judgingSheetId: "new-sheet", judgingSheetUrl: ownSheetUrl, judgingSheetSyncRevision: 1, judgingSheetSyncedRevision: 0 });
  expect(await t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).map((job) => ({ name: job.name, args: job.args, state: job.state })))).toEqual([{ name: "googleSheets:syncJudgingSheet", args: [{ eventId, revision: 1 }], state: { kind: "pending" } }]);
  provider.spreadsheetGet.mockResolvedValue({ data: { sheets: [{ properties: { sheetId: 17, title: "Judging", gridProperties: { rowCount: 100 } } }] } });
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  expect(await t.run((ctx) => ctx.db.get(eventId))).toMatchObject({ judgingSheetId: "new-sheet", judgingSheetSyncRevision: 1, judgingSheetSyncedRevision: 1, judgingSheetSyncedAt: expect.any(Number) });
  expect(provider.fileUpdate).not.toHaveBeenCalled();
});

test.each<Entry>(["browser", "mcp"])("%s competing sheet creation keeps the winner and trashes only its new losing file", async (entry) => {
  const { t, eventId, createSheet } = await fixture(entry);
  provider.fileCreate.mockImplementation(async () => {
    await t.mutation(internal.mcpAdmin.saveJudgingSheet, { principal, input: { slug, spreadsheetId: "winner", spreadsheetUrl: winnerUrl } });
    return { data: { id: "new-sheet" } };
  });
  expect(await createSheet()).toEqual({ spreadsheetUrl: winnerUrl, created: false });
  expect(await t.run((ctx) => ctx.db.get(eventId))).toMatchObject({ judgingSheetId: "winner", judgingSheetUrl: winnerUrl, judgingSheetSyncRevision: 1 });
  expect(provider.fileUpdate.mock.calls.map(([input]) => input)).toEqual([{ fileId: "new-sheet", requestBody: { trashed: true } }]);
  expect((await t.run((ctx) => ctx.db.query("auditLog").collect())).map((row) => ({ action: row.action, details: row.details }))).toEqual([{ action: "judging_sheet_created", details: "winner" }]);
});

test.each<Entry>(["browser", "mcp"])("%s sheet ownership failure cleans up its new file and leaves the event unlinked", async (entry) => {
  const { t, eventId, createSheet } = await fixture(entry);
  provider.fileCreate.mockImplementation(async () => {
    await t.run((ctx) => ctx.db.patch(eventId, { workosOrganizationId: "org_new_owner" }));
    return { data: { id: "new-sheet" } };
  });
  await expect(createSheet()).rejects.toThrow("Unauthorized");
  const event = await t.run((ctx) => ctx.db.get(eventId));
  expect(event).toMatchObject({ workosOrganizationId: "org_new_owner" });
  expect(event).not.toHaveProperty("judgingSheetId");
  expect(provider.fileUpdate.mock.calls.map(([input]) => input)).toEqual([{ fileId: "new-sheet", requestBody: { trashed: true } }]);
  expect(await t.run((ctx) => ctx.db.query("auditLog").collect())).toEqual([]);
});
