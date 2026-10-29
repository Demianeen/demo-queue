import { test } from "node:test";
import assert from "node:assert/strict";
import { UI_EXCLUSIONS, checkCoverage, checkRepository, scanUiSources, scanToolMappings } from "../scripts/mcp-admin-coverage.mjs";

const importedApi = 'import { api } from "@/convex/_generated/api";';
const mapping = (browser) => `defineAdminTool({ name: "${browser.replaceAll(".", "_")}", browser: "${browser}" });`;
const check = (text, toolSource = "", exclusions = []) => checkCoverage({ sources: { "components/Admin.tsx": importedApi + text }, toolSource, exclusions, requireFinalistGuard: false });

test("the actual app has a tool or exact exclusion for every runtime API reference", async () => {
  const report = await checkRepository();
  assert.deepEqual(report.errors, []);
  assert.ok(report.enabled.length > 0);
});

test("a newly added admin hook fails coverage without a mapping", () => {
  const report = check("const publish = useMutation(api.events.publishQueue); const newRead = useQuery(api.events.newAdminRead, {});", mapping("events.publishQueue"));
  assert.match(report.errors.join("\n"), /Unmapped admin function events.newAdminRead/);
});

test("optimistic wrappers, hook aliases, API aliases and static element access retain references", () => {
  const text = `import { api as backend } from "@/convex/_generated/api";
    import { useMutation as mutate } from "convex/react";
    const module = backend.events;
    const fn = module.reorderLineup;
    const wrapped = mutate(fn).withOptimisticUpdate((store) => store.getQuery(backend.events.getAdmin, {}));
    const { publishQueue: publish } = backend.events;
    const key = "moveToPool";
    mutate(publish); mutate(module[key]); mutate(backend["events"].hideSubmission);`;
  const report = scanUiSources({ "components/Admin.tsx": text });
  assert.deepEqual(report.errors, []);
  assert.deepEqual([...new Set(report.references.map((entry) => entry.browser))].sort(), ["events.getAdmin", "events.hideSubmission", "events.moveToPool", "events.publishQueue", "events.reorderLineup"]);
});

test("dynamic property aliases fail closed instead of disappearing from the inventory", () => {
  const report = check("const module = api.events; const operation = module[getOperation()]; useMutation(operation);");
  assert.match(report.errors.join("\n"), /unresolved or unsupported API reference events.\[dynamic\]/);
});

test("namespace imports and nested destructuring resolve generated API aliases", () => {
  const report = scanUiSources({ "components/Admin.tsx": `import * as generated from "@/convex/_generated/api";
    const { api: backend } = generated;
    const { events: { publishQueue: publish } } = backend;
    const module = (backend.events as unknown);
    useMutation(publish); useQuery(generated.api.events.getAdmin, {}); useMutation(module.moveToPool);` });
  assert.deepEqual(report.errors, []);
  assert.deepEqual([...new Set(report.references.map((entry) => entry.browser))].sort(), ["events.getAdmin", "events.moveToPool", "events.publishQueue"]);
});

test("dynamic destructuring and API module escapes fail closed", () => {
  for (const text of ["const { [getOperation()]: operation } = api.events; useMutation(operation);", "const container = { api }; useMutation(container.api.events.publishQueue);", "useAdminOperations(api.events);"]) {
    assert.match(check(text).errors.join("\n"), /unresolved or unsupported API reference/);
  }
});

test("type references and shadowed API names do not count as browser behavior", () => {
  const report = scanUiSources({ "components/Admin.tsx": importedApi + `type Result = FunctionReturnType<typeof api.events.getAdmin>;
    function example(api: { events: { unused: string } }) { return api.events.unused; }
    useQuery(api.events.getAdmin, {});` });
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.references.map((entry) => entry.browser), ["events.getAdmin"]);
});

test("exclusions apply only to their exact path and function, and stale exclusions fail", () => {
  const exclusion = { file: "components/Admin.tsx", browser: "events.publicRead", reason: "Public metadata." };
  assert.deepEqual(check("useQuery(api.events.publicRead, {});", "", [exclusion]).errors, []);
  assert.match(check("useQuery(api.events.newRead, {});", "", [exclusion]).errors.join("\n"), /Stale exclusion/);
  const report = checkCoverage({ sources: { "components/AnotherAdmin.tsx": importedApi + "useQuery(api.events.publicRead, {});" }, toolSource: "", exclusions: [exclusion], requireFinalistGuard: false });
  assert.match(report.errors.join("\n"), /Unmapped admin function events.publicRead/);
});

test("dormant exclusions require the literal false guard and cannot gain a tool", () => {
  for (const guard of ["true", "getFlag()", "false"]) {
    const browser = "judging.getFinalistDecision";
    const report = checkCoverage({ sources: { "components/JudgingAdminPanel.tsx": importedApi + `const SHOW_FINALIST_TOOLS = ${guard}; useQuery(api.judging.getFinalistDecision, SHOW_FINALIST_TOOLS ? {} : "skip");` }, toolSource: guard === "false" ? mapping(browser) : "", exclusions: [{ file: "components/JudgingAdminPanel.tsx", browser, reason: "Dormant." }] });
    assert.match(report.errors.join("\n"), guard === "false" ? /no enabled organization-admin UI caller/ : /must be a literal const false/);
  }
});

test("legacy mappings must name actual registrations and new tools need literal associations", () => {
  const report = scanToolMappings('const LEGACY_ADMIN_TOOL_MAPPINGS = [{ name: "list_events", browser: "events.listOrganizationEvents" }]; defineAdminTool({ name: "new", browser: operation });', 'server.registerTool("create_event", {}, () => {});');
  assert.match(report.errors.join("\n"), /unregistered tool list_events/);
  assert.match(report.errors.join("\n"), /require literal name/);
});

test("component server tool properties register actual names and deleted tools fail coverage", () => {
  const catalog = 'const LEGACY_ADMIN_TOOL_MAPPINGS = [{ name: "fixture_read", browser: "events.fixtureRead" }, { name: "fixture_write", browser: "events.fixtureWrite" }];';
  const component = (readTool) => `import { McpServer as Server, createTool as makeTool } from "@convex-dev/mcp";
    const componentTool = makeTool<ApprovalId>();
    class ApprovalServer extends Server<ApprovalId> {}
    const unrelated = { tools: { fixture_read: componentTool({}) } };
    const server = new ApprovalServer(component, { tools: {
      ${readTool}
      "fixture_write": componentTool({ handler: () => ({}) }),
      ...Object.fromEntries(ADMIN_TOOLS.map((tool) => [tool.name, tool.component])),
    } });`;
  const registered = scanToolMappings(catalog, component("fixture_read: componentTool({ handler: () => ({}) }),"));
  assert.deepEqual(registered.errors, []);
  assert.deepEqual(registered.legacyNames.sort(), ["fixture_read", "fixture_write"]);
  const missing = scanToolMappings(catalog, component(""));
  assert.match(missing.errors.join("\n"), /unregistered tool fixture_read/);
});

test("component registrations reject dynamic names and unrecognized factories", () => {
  const report = scanToolMappings("", `import { McpServer, createTool } from "@convex-dev/mcp";
    const tool = createTool();
    new McpServer(component, { tools: { [getName()]: tool({}), fake: anotherFactory({}) } });`);
  assert.equal(report.errors.length, 2);
  assert.deepEqual(report.legacyNames, []);
});

test("human connection consent exclusions cannot hide new callers or become tools", () => {
  const exclusions = UI_EXCLUSIONS.filter((entry) => entry.file === "components/McpConnectionClient.tsx");
  const calls = exclusions.map((entry) => `useAction(api.${entry.browser});`).join("\n");
  const sources = { "components/McpConnectionClient.tsx": importedApi + calls };
  assert.equal(exclusions.length, 6);
  assert.deepEqual(checkCoverage({ sources, toolSource: "", exclusions, requireFinalistGuard: false }).errors, []);
  const report = checkCoverage({ sources: { ...sources, "components/Admin.tsx": importedApi + "useAction(api.mcpConsent.authorize); useAction(api.mcpConsent.newOperation);" }, toolSource: mapping("mcpConsent.authorize"), exclusions, requireFinalistGuard: false });
  assert.match(report.errors.join("\n"), /Unmapped admin function mcpConsent.newOperation/);
  const exposed = checkCoverage({ sources, toolSource: mapping("mcpConsent.authorize"), exclusions, requireFinalistGuard: false });
  assert.match(exposed.errors.join("\n"), /mcpConsent.authorize.*no enabled organization-admin UI caller/);
  const relocated = checkCoverage({ sources: { ...sources, "components/Admin.tsx": importedApi + "useAction(api.mcpConsent.authorize);" }, toolSource: "", exclusions, requireFinalistGuard: false });
  assert.match(relocated.errors.join("\n"), /Unmapped admin function mcpConsent.authorize at components\/Admin.tsx/);
});

test("unused backend functions cannot gain tools by adding a catalog entry", () => {
  const report = check("useQuery(api.events.getAdmin, {});", mapping("events.getAdmin") + mapping("events.backfill"));
  assert.match(report.errors.join("\n"), /events.backfill.*no enabled organization-admin UI caller/);
});
