import type { WorkOS } from "@workos-inc/node";
import { z } from "zod";

const authorizationParameters = z.object({
  client_id: z.string().min(1),
  redirect_uri: z.url({ protocol: /^https?$/ }),
  response_type: z.literal("code"),
  state: z.string().min(1),
  code_challenge: z.string().min(1),
  code_challenge_method: z.literal("S256"),
  provider: z.literal("authkit"),
});

type AuthorizationBuilder = WorkOS["userManagement"]["getAuthorizationUrl"];

export function googleSignInUrl(authkitUrl: string, buildAuthorizationUrl: AuthorizationBuilder): string {
  const url = new URL(authkitUrl);
  for (const name of Object.keys(authorizationParameters.shape)) {
    if (url.searchParams.getAll(name).length !== 1) throw new Error("Invalid authorization parameters");
  }
  const parameters = authorizationParameters.parse(Object.fromEntries(url.searchParams));
  if (url.origin === "https://api.workos.com" && url.pathname === "/user_management/authorize" && !url.username && !url.password && !url.hash) {
    url.searchParams.set("provider", "GoogleOAuth");
    url.searchParams.delete("screen_hint");
    return url.toString();
  }

  return buildAuthorizationUrl({
    provider: "GoogleOAuth",
    clientId: parameters.client_id,
    redirectUri: parameters.redirect_uri,
    state: parameters.state,
    codeChallenge: parameters.code_challenge,
    codeChallengeMethod: parameters.code_challenge_method,
  });
}
