import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { google } from "googleapis";

const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const FOLDER_MARKER_KEY = "demoQueuePurpose";
const FOLDER_MARKER_VALUE = "judgingSheets";
const DEFAULT_FOLDER_NAME = "Demo Queue judging sheets";
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

export function parseOAuthClientConfig(input) {
  const document = typeof input === "string" ? JSON.parse(input) : input;
  const installed = document?.installed;
  if (!installed?.client_id || !installed?.client_secret) {
    throw new Error(
      "Use a Google OAuth client JSON created as Desktop app, not a service-account key.",
    );
  }
  return {
    clientId: installed.client_id,
    clientSecret: installed.client_secret,
  };
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function formatConvexEnvCommands({ clientId, clientSecret, refreshToken, folderId }) {
  return [
    ["GOOGLE_OAUTH_CLIENT_ID", clientId],
    ["GOOGLE_OAUTH_CLIENT_SECRET", clientSecret],
    ["GOOGLE_OAUTH_REFRESH_TOKEN", refreshToken],
    ["GOOGLE_DRIVE_FOLDER_ID", folderId],
  ].map(([name, value]) => `pnpm exec convex env set ${name} ${shellQuote(value)}`);
}

export function parseSetupArgs(argv) {
  const [credentialsPath, requestedFolderName] = argv.filter((argument) => argument !== "--");
  return { credentialsPath, requestedFolderName };
}

async function authorize({ clientId, clientSecret }) {
  return await new Promise((resolve, reject) => {
    const state = randomBytes(24).toString("hex");
    let timeout;
    const server = createServer(async (request, response) => {
      try {
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("OAuth callback is unavailable.");
        const callbackUrl = `http://127.0.0.1:${address.port}/oauth2callback`;
        const requestUrl = new URL(request.url ?? "/", callbackUrl);
        if (requestUrl.pathname !== "/oauth2callback") {
          response.writeHead(404).end("Not found");
          return;
        }
        if (requestUrl.searchParams.get("state") !== state) {
          throw new Error("OAuth state did not match. Start the setup helper again.");
        }
        const oauthError = requestUrl.searchParams.get("error");
        if (oauthError) throw new Error(`Google authorization failed: ${oauthError}`);
        const code = requestUrl.searchParams.get("code");
        if (!code) throw new Error("Google did not return an authorization code.");

        const auth = new google.auth.OAuth2(clientId, clientSecret, callbackUrl);
        const { tokens } = await auth.getToken(code);
        if (!tokens.refresh_token) {
          throw new Error("Google did not return a refresh token. Revoke the app grant and try again.");
        }
        auth.setCredentials(tokens);
        response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Demo Queue Google authorization completed. You can close this tab.");
        clearTimeout(timeout);
        server.close();
        resolve({ auth, refreshToken: tokens.refresh_token });
      } catch (error) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Demo Queue Google authorization failed. Return to the terminal for details.");
        clearTimeout(timeout);
        server.close();
        reject(error);
      }
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not start the local OAuth callback."));
        return;
      }
      const callbackUrl = `http://127.0.0.1:${address.port}/oauth2callback`;
      const auth = new google.auth.OAuth2(clientId, clientSecret, callbackUrl);
      const authorizationUrl = auth.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: [DRIVE_FILE_SCOPE],
        state,
      });
      console.log("\nOpen this URL in your browser and approve access:\n");
      console.log(authorizationUrl);
      console.log("\nWaiting for the Google callback...\n");
    });

    timeout = setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for Google authorization."));
    }, CALLBACK_TIMEOUT_MS);
  });
}

async function findOrCreateFolder(auth, folderName) {
  const drive = google.drive({ version: "v3", auth });
  const existing = await drive.files.list({
    q: `mimeType='${FOLDER_MIME_TYPE}' and trashed=false and appProperties has { key='${FOLDER_MARKER_KEY}' and value='${FOLDER_MARKER_VALUE}' }`,
    spaces: "drive",
    pageSize: 10,
    fields: "files(id,name)",
  });
  const folder = existing.data.files?.[0];
  if (folder?.id) return { folderId: folder.id, folderName: folder.name ?? folderName, created: false };

  const created = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: FOLDER_MIME_TYPE,
      appProperties: { [FOLDER_MARKER_KEY]: FOLDER_MARKER_VALUE },
    },
    fields: "id,name",
  });
  if (!created.data.id) throw new Error("Google did not return the new Drive folder ID.");
  return {
    folderId: created.data.id,
    folderName: created.data.name ?? folderName,
    created: true,
  };
}

async function main() {
  const { credentialsPath, requestedFolderName } = parseSetupArgs(process.argv.slice(2));
  if (!credentialsPath) {
    throw new Error(
      "Usage: pnpm google:oauth-setup -- /absolute/path/to/oauth-client.json [folder-name]",
    );
  }

  const credentials = parseOAuthClientConfig(await readFile(credentialsPath, "utf8"));
  const { auth, refreshToken } = await authorize(credentials);
  const folder = await findOrCreateFolder(auth, requestedFolderName || DEFAULT_FOLDER_NAME);

  console.log(`${folder.created ? "Created" : "Reused"} Drive folder: ${folder.folderName}`);
  console.log("\nRun the following commands yourself for each intended Convex deployment:\n");
  for (const command of formatConvexEnvCommands({
    ...credentials,
    refreshToken,
    folderId: folder.folderId,
  })) {
    console.log(command);
  }
  console.log(
    "\nDo not paste this output into chat or commit it. The helper does not run Convex commands for you.",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Google OAuth setup failed.");
    process.exitCode = 1;
  });
}
