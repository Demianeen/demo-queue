import assert from "node:assert/strict";
import test from "node:test";

import {
  formatConvexEnvCommands,
  parseOAuthClientConfig,
  shellQuote,
} from "../scripts/google-oauth-setup.mjs";

test("OAuth setup accepts only Desktop app client credentials", () => {
  assert.deepEqual(
    parseOAuthClientConfig({
      installed: { client_id: "client-id", client_secret: "client-secret" },
    }),
    { clientId: "client-id", clientSecret: "client-secret" },
  );
  assert.throws(
    () => parseOAuthClientConfig({ type: "service_account", private_key: "secret" }),
    /Desktop app/,
  );
});

test("OAuth setup prints shell-safe Convex environment commands", () => {
  assert.equal(shellQuote("value'with-quote"), `'value'\\''with-quote'`);
  assert.deepEqual(
    formatConvexEnvCommands({
      clientId: "client-id",
      clientSecret: "client-secret",
      refreshToken: "refresh-token",
      folderId: "folder-id",
    }),
    [
      "pnpm exec convex env set GOOGLE_OAUTH_CLIENT_ID 'client-id'",
      "pnpm exec convex env set GOOGLE_OAUTH_CLIENT_SECRET 'client-secret'",
      "pnpm exec convex env set GOOGLE_OAUTH_REFRESH_TOKEN 'refresh-token'",
      "pnpm exec convex env set GOOGLE_DRIVE_FOLDER_ID 'folder-id'",
    ],
  );
});
