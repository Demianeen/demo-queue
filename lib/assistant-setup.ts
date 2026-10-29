/** How to connect each supported assistant to the Demo Queue MCP server. */

export const SERVER_NAME = "demo-queue";
export const SAMPLE_PROMPT = "List my Demo Queue organizations and events. Do not change anything.";

export type AssistantId = "claude-code" | "codex" | "claude-app" | "cursor";
export type SetupStep =
  | { kind: "command"; text: string; command: string }
  | { kind: "text"; text: string; command?: string }
  | { kind: "link"; text: string; href: string; label: string }
  | { kind: "prompt"; text: string };
export type AssistantSetup = { id: AssistantId; label: string; steps: SetupStep[]; note?: string };

export const ASSISTANTS: { id: AssistantId; label: string }[] = [
  { id: "claude-code", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "claude-app", label: "Claude app" },
  { id: "cursor", label: "Cursor" },
];

/** Cursor's documented install link: the server config as base64 JSON, then URL-encoded. */
export function cursorInstallLink(mcpUrl: string) {
  const config = btoa(JSON.stringify({ url: mcpUrl }));
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(SERVER_NAME)}&config=${encodeURIComponent(config)}`;
}

export function cursorConfig(mcpUrl: string) {
  return JSON.stringify({ mcpServers: { [SERVER_NAME]: { url: mcpUrl } } }, null, 2);
}

const signIn = "Sign in with Google, then choose the organizations it can use and whether it can change events.";

export function assistantSetup(id: AssistantId, mcpUrl: string): AssistantSetup {
  switch (id) {
    case "claude-code": return { id, label: "Claude Code", steps: [
      { kind: "command", text: "Run this once in a terminal. It works in every project.", command: `claude mcp add --transport http --scope user ${SERVER_NAME} ${mcpUrl}` },
      { kind: "text", text: `In Claude Code, type /mcp, pick ${SERVER_NAME} and choose Authenticate. ${signIn}` },
      { kind: "prompt", text: "Try a request that changes nothing:" },
    ] };
    case "codex": return { id, label: "Codex", steps: [
      { kind: "command", text: "Add Demo Queue to Codex. Run this once in a terminal.", command: `codex mcp add ${SERVER_NAME} --url ${mcpUrl}` },
      { kind: "text", text: `A browser opens. ${signIn} If no browser opens, run:`, command: `codex mcp login ${SERVER_NAME}` },
      { kind: "prompt", text: "Start a new chat and try a request that changes nothing:" },
    ], note: "Codex already open? Quit and reopen it so it loads the new tools." };
    case "claude-app": return { id, label: "Claude app", steps: [
      { kind: "command", text: "In Claude, open Customize, then Connectors, and choose Add custom connector. Name it Demo Queue and paste this URL.", command: mcpUrl },
      { kind: "text", text: `Choose Connect next to Demo Queue. ${signIn}` },
      { kind: "prompt", text: "In a new chat, turn on Demo Queue and try a request that changes nothing:" },
    ], note: "On Team and Enterprise plans an owner adds the connector once, then each person connects." };
    case "cursor": return { id, label: "Cursor", steps: [
      { kind: "link", text: "Open the install link and confirm in Cursor.", href: cursorInstallLink(mcpUrl), label: "Add to Cursor" },
      { kind: "text", text: `Or add this to ~/.cursor/mcp.json yourself. When Cursor asks, log in: ${signIn}`, command: cursorConfig(mcpUrl) },
      { kind: "prompt", text: "In a new Agent chat, try a request that changes nothing:" },
    ] };
  }
}
