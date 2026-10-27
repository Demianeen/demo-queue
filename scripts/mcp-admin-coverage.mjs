import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const finalistPath = "components/JudgingAdminPanel.tsx";
const finalistFunctions = ["getFinalistDecision", "saveFinalistDraft", "submitFinalists", "savePlacementDraft", "submitPlacements"];

export const UI_EXCLUSIONS = [
  ...["getStage", "submitDemo", "submitHackathon"].map((name) => ({ file: "app/e/[slug]/ClientPage.tsx", browser: `events.${name}`, reason: "Participant event page, not organization administration." })),
  { file: "app/stage/[slug]/ClientPage.tsx", browser: "events.getStage", reason: "Public stage display. Operator presentation controls have separate tools." },
  ...["getParticipant", "editParticipantContact", "withdrawSubmission"].map((name) => ({ file: "app/s/[slug]/[token]/ClientPage.tsx", browser: `events.${name}`, reason: "Participant capability page. Organization tools must not impersonate participants." })),
  ...["getMyAssignments", "saveReview"].map((name) => ({ file: "app/judge/[slug]/[token]/ClientPage.tsx", browser: `judging.${name}`, reason: "Judge capability page. Organization tools must not submit judge reviews." })),
  { file: "app/metadata.ts", browser: "events.getEventMeta", reason: "Public title metadata used by event routes, including admin navigation. Admin reads expose event metadata already." },
  { file: "app/metadata.ts", browser: "events.getParticipantMeta", reason: "Participant title metadata, not organization administration." },
  ...["memberships", "getRequest", "authorize"].map((name) => ({ file: "components/McpConnectionClient.tsx", browser: `mcpConsent.${name}`, reason: "Human connection consent. A tool must not inspect or approve its own authorization request." })),
  ...["createApiKey", "revokeConnection", "listConnections"].map((name) => ({ file: "components/McpConnectionClient.tsx", browser: `mcpConsent.${name}`, reason: "Human credential management. Connection credentials and their lifecycle stay in the signed-in browser." })),
  ...["addTrack", "updateTrack", "reorderTracks", "removeTrack"].map((name) => ({ file: "components/TracksAdminPanel.tsx", browser: `tracks.${name}`, reason: "Proposed: track editing stays in the admin page for now; MCP track tools can follow." })),
  ...["checkSubmissionEmail", "requestStatusLinkEmail"].map((name) => ({ file: "components/SubmissionEmailField.tsx", browser: `events.${name}`, reason: "Participant submit page email check and status link resend, not organization administration." })),
  { file: "app/e/[slug]/ClientPage.tsx", browser: "events.getSubmittedView", reason: "Participant capability view of their own submission, not organization administration." },
  { file: "app/judge/[slug]/[token]/ClientPage.tsx", browser: "judging.getOtherSubmissions", reason: "Judge capability page. Organization tools already read every submission." },
  ...["linkLumaEvent", "unlinkLumaEvent"].map((name) => ({ file: "components/LumaEventSetting.tsx", browser: `luma.${name}`, reason: "Linking uses the deployment's Luma key and is limited to allowed organisations, so it stays in the admin page." })),
  { file: "app/s/[slug]/[token]/ClientPage.tsx", browser: "events.editTeamMemberSocials", reason: "Participant capability page. Organization tools must not impersonate participants." },
  ...finalistFunctions.map((name) => ({ file: finalistPath, browser: `judging.${name}`, reason: "Dormant finalist and placement controls require SHOW_FINALIST_TOOLS to remain false.", dormant: true })),
];

function sourceFile(file, text) {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function unwrapped(node) {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node))) node = node.expression;
  return node;
}

function literal(node) {
  node = unwrapped(node);
  return node && ts.isStringLiteralLike(node) ? node.text : undefined;
}

function property(object, name) {
  return object.properties.find((entry) => ts.isPropertyAssignment(entry) && (ts.isIdentifier(entry.name) || ts.isStringLiteralLike(entry.name)) && entry.name.text === name)?.initializer;
}

function runtime(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isTypeNode(parent) || ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return false;
  }
  return true;
}

export function scanUiSources(sources) {
  const files = new Map(Object.entries(sources).map(([file, text]) => [path.resolve("/mcp-coverage", file), sourceFile(file, text)]));
  const host = ts.createCompilerHost({});
  host.getSourceFile = (file) => files.get(file);
  host.fileExists = (file) => files.has(file);
  host.readFile = (file) => files.get(file)?.text;
  const program = ts.createProgram([...files.keys()], { noResolve: true, noLib: true }, host);
  const checker = program.getTypeChecker();
  const references = [];
  const errors = [];

  function resolve(node, seen = new Set()) {
    node = unwrapped(node);
    if (!node || seen.has(node)) return undefined;
    seen = new Set(seen).add(node);
    if (ts.isPropertyAccessExpression(node)) {
      const base = resolve(node.expression, seen);
      if (base?.namespace) return node.name.text === "api" ? { parts: ["api"], dynamic: false } : undefined;
      return base && { ...base, parts: [...base.parts, node.name.text] };
    }
    if (ts.isElementAccessExpression(node)) {
      const base = resolve(node.expression, seen);
      if (!base) return undefined;
      let name = literal(node.argumentExpression);
      if (name === undefined && ts.isIdentifier(node.argumentExpression)) {
        const declaration = checker.getSymbolAtLocation(node.argumentExpression)?.valueDeclaration;
        if (declaration && ts.isVariableDeclaration(declaration) && declaration.parent.flags & ts.NodeFlags.Const) name = literal(declaration.initializer);
      }
      if (base.namespace) return name === "api" ? { parts: ["api"], dynamic: false } : name === undefined ? { parts: ["api", "[dynamic]"], dynamic: true } : undefined;
      return { parts: [...base.parts, name ?? "[dynamic]"], dynamic: base.dynamic || name === undefined };
    }
    if (!ts.isIdentifier(node)) return undefined;
    const symbol = ts.isShorthandPropertyAssignment(node.parent) ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node);
    for (const declaration of symbol?.declarations ?? []) {
      if (ts.isNamespaceImport(declaration)) {
        const moduleSpecifier = declaration.parent.parent.moduleSpecifier;
        if (ts.isStringLiteralLike(moduleSpecifier) && /(?:^|\/)convex\/_generated\/api$|^\.\.?\/(?:.*\/)?_generated\/api$/.test(moduleSpecifier.text)) return { parts: [], dynamic: false, namespace: true };
      }
      if (ts.isImportSpecifier(declaration) && (declaration.propertyName ?? declaration.name).text === "api") {
        const moduleSpecifier = declaration.parent.parent.parent.moduleSpecifier;
        if (ts.isStringLiteralLike(moduleSpecifier) && /(?:^|\/)convex\/_generated\/api$|^\.\.?\/(?:.*\/)?_generated\/api$/.test(moduleSpecifier.text)) return { parts: ["api"], dynamic: false };
      }
      if (ts.isVariableDeclaration(declaration)) return resolve(declaration.initializer, seen);
      if (ts.isBindingElement(declaration) && ts.isObjectBindingPattern(declaration.parent)) return resolveBinding(declaration, seen);
    }
    return undefined;
  }

  function resolveBinding(binding, seen) {
    const container = binding.parent.parent;
    const base = ts.isVariableDeclaration(container) ? resolve(container.initializer, seen) : ts.isBindingElement(container) ? resolveBinding(container, seen) : undefined;
    const key = binding.propertyName ?? binding.name;
    if (!base) return undefined;
    const name = ts.isIdentifier(key) || ts.isStringLiteralLike(key) ? key.text : ts.isComputedPropertyName(key) ? literal(key.expression) : undefined;
    if (base.namespace && name === "api") return { parts: ["api"], dynamic: false };
    return { parts: [...base.parts, name ?? "[dynamic]"], dynamic: base.dynamic || name === undefined };
  }

  for (const file of files.values()) {
    function visit(node) {
      if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) || ts.isIdentifier(node)) && runtime(node)) {
        const parent = node.parent;
        const expanded = (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === node;
        const declarationName = (ts.isVariableDeclaration(parent) || ts.isBindingElement(parent) || ts.isParameter(parent)) && parent.name === node;
        const propertyName = ts.isPropertyAccessExpression(parent) && parent.name === node;
        const reference = !expanded && !declarationName && !propertyName ? resolve(node) : undefined;
        let wrapper = node;
        while (wrapper.parent && unwrapped(wrapper.parent) === node) wrapper = wrapper.parent;
        const aliasInitializer = ts.isVariableDeclaration(wrapper.parent) && wrapper.parent.initializer === wrapper;
        if (reference && !reference.namespace && (reference.parts.length >= 3 || reference.dynamic || !aliasInitializer)) {
          const position = file.getLineAndCharacterOfPosition(node.getStart(file));
          const entry = { file: path.relative("/mcp-coverage", file.fileName), line: position.line + 1, browser: reference.parts.slice(1).join(".") };
          if (reference.dynamic || reference.parts.length !== 3) errors.push(`${entry.file}:${entry.line}: unresolved or unsupported API reference ${entry.browser}`);
          else references.push(entry);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
  }
  return { references, errors };
}

export function scanToolMappings(text, legacyText = "") {
  const file = sourceFile("convex/mcpTools.ts", text);
  const mappings = [];
  const errors = [];
  const toolNames = [];
  function mapping(node, legacy) {
    if (!node || !ts.isObjectLiteralExpression(node)) { errors.push("Tool mappings must use object literals."); return; }
    const name = literal(property(node, "name"));
    const browser = literal(property(node, "browser"));
    if (!name || !browser || !/^[\w]+\.[\w]+$/.test(browser)) { errors.push("Tool mappings require literal name and module.function browser strings."); return; }
    mappings.push({ name, browser, legacy });
    if (!legacy) toolNames.push(name);
  }
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "defineAdminTool") mapping(node.arguments[0], false);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "LEGACY_ADMIN_TOOL_MAPPINGS") {
      const value = unwrapped(node.initializer);
      if (!value || !ts.isArrayLiteralExpression(value)) errors.push("LEGACY_ADMIN_TOOL_MAPPINGS must be a literal array.");
      else for (const item of value.elements) mapping(item, true);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  const legacyNames = new Set();
  const legacyFile = sourceFile("convex/mcp.ts", legacyText);
  const serverClasses = new Set();
  const createTools = new Set();
  const toolFactories = new Set();
  for (const statement of legacyFile.statements) {
    if (!ts.isImportDeclaration(statement) || literal(statement.moduleSpecifier) !== "@convex-dev/mcp") continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const binding of bindings.elements) {
      const imported = (binding.propertyName ?? binding.name).text;
      if (imported === "McpServer") serverClasses.add(binding.name.text);
      if (imported === "createTool") createTools.add(binding.name.text);
    }
  }
  let changed;
  do {
    changed = false;
    for (const statement of legacyFile.statements) {
      if (!ts.isClassDeclaration(statement) || !statement.name || serverClasses.has(statement.name.text)) continue;
      const extendsServer = statement.heritageClauses?.some((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword && clause.types.some((type) => ts.isIdentifier(type.expression) && serverClasses.has(type.expression.text)));
      if (extendsServer) { serverClasses.add(statement.name.text); changed = true; }
    }
  } while (changed);
  function findFactories(node) {
    const value = ts.isVariableDeclaration(node) ? unwrapped(node.initializer) : undefined;
    if (value && ts.isIdentifier(node.name) && ts.isCallExpression(value) && ts.isIdentifier(value.expression) && createTools.has(value.expression.text)) toolFactories.add(node.name.text);
    ts.forEachChild(node, findFactories);
  }
  findFactories(legacyFile);
  function visitLegacy(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "registerTool") {
      const name = literal(node.arguments[0]);
      if (name) legacyNames.add(name);
      else errors.push("Legacy tool registrations require literal names.");
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && serverClasses.has(node.expression.text)) {
      const options = unwrapped(node.arguments?.[1]);
      const tools = options && ts.isObjectLiteralExpression(options) ? unwrapped(property(options, "tools")) : undefined;
      if (!tools || !ts.isObjectLiteralExpression(tools)) errors.push("Component server tools must use an object literal.");
      else for (const entry of tools.properties) {
        if (ts.isSpreadAssignment(entry)) continue;
        const value = ts.isPropertyAssignment(entry) ? unwrapped(entry.initializer) : undefined;
        const name = entry.name && (ts.isIdentifier(entry.name) ? entry.name.text : literal(ts.isComputedPropertyName(entry.name) ? entry.name.expression : entry.name));
        if (!name || !value || !ts.isCallExpression(value) || !ts.isIdentifier(value.expression) || !toolFactories.has(value.expression.text)) errors.push("Component tool registrations require literal names and a createTool factory call.");
        else legacyNames.add(name);
      }
    }
    ts.forEachChild(node, visitLegacy);
  }
  visitLegacy(legacyFile);
  for (const entry of mappings.filter((entry) => entry.legacy)) if (!legacyNames.has(entry.name)) errors.push(`Legacy mapping ${entry.browser} names unregistered tool ${entry.name}.`);
  for (const name of toolNames) if (toolNames.filter((value) => value === name).length > 1 || legacyNames.has(name)) errors.push(`Duplicate tool registration ${name}.`);
  return { mappings, errors, legacyNames: [...legacyNames] };
}

export function checkCoverage({ sources, toolSource, legacySource = "", exclusions = UI_EXCLUSIONS, requireFinalistGuard = true }) {
  const ui = scanUiSources(sources);
  const tools = scanToolMappings(toolSource, legacySource);
  const errors = [...ui.errors, ...tools.errors];
  const key = (entry) => `${entry.file}:${entry.browser}`;
  const used = new Set(ui.references.map(key));
  for (const exclusion of exclusions) {
    if (!exclusion.reason?.trim()) errors.push(`Exclusion ${key(exclusion)} requires a reason.`);
    if (!used.has(key(exclusion))) errors.push(`Stale exclusion ${key(exclusion)}.`);
  }
  if (requireFinalistGuard) {
    const file = sourceFile(finalistPath, sources[finalistPath] ?? "");
    let guards = 0;
    function visit(node) {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "SHOW_FINALIST_TOOLS") {
        guards++;
        if (node.initializer?.kind !== ts.SyntaxKind.FalseKeyword || !(node.parent.flags & ts.NodeFlags.Const)) errors.push("SHOW_FINALIST_TOOLS must be a literal const false before dormant controls can be excluded.");
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
    if (guards !== 1) errors.push("Expected exactly one SHOW_FINALIST_TOOLS=false guard in JudgingAdminPanel.");
  }
  const excluded = new Set(exclusions.map(key));
  const enabled = ui.references.filter((entry) => !excluded.has(key(entry)));
  const enabledFunctions = new Set(enabled.map((entry) => entry.browser));
  const mapped = new Set(tools.mappings.map((entry) => entry.browser));
  for (const entry of enabled) if (!mapped.has(entry.browser)) errors.push(`Unmapped admin function ${entry.browser} at ${entry.file}:${entry.line}.`);
  for (const entry of tools.mappings) if (!enabledFunctions.has(entry.browser)) errors.push(`Tool ${entry.name} maps ${entry.browser}, which has no enabled organization-admin UI caller.`);
  return { references: ui.references, enabled, exclusions, mappings: tools.mappings, errors: [...new Set(errors)] };
}

async function collectSources(root, directory) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  const found = await Promise.all(entries.map(async (entry) => {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return collectSources(root, relative);
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [[relative, await readFile(path.join(root, relative), "utf8")]] : [];
  }));
  return found.flat();
}

export async function checkRepository(root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")) {
  const [app, components, toolSource, legacySource] = await Promise.all([
    collectSources(root, "app"), collectSources(root, "components"),
    readFile(path.join(root, "convex/mcpTools.ts"), "utf8"), readFile(path.join(root, "convex/mcp.ts"), "utf8"),
  ]);
  return checkCoverage({ sources: Object.fromEntries([...app, ...components]), toolSource, legacySource });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = await checkRepository();
    if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`Admin coverage: ${new Set(report.enabled.map((entry) => entry.browser)).size} enabled browser functions, ${report.enabled.length} references, ${report.mappings.length} mappings, ${report.exclusions.length} exact exclusions.`);
      for (const error of report.errors) console.error(error);
    }
    if (report.errors.length) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Coverage check failed.");
    process.exitCode = 1;
  }
}
