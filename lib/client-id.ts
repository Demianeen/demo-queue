import { randomToken } from "./tokens";

let clientId: string | undefined;

/**
 * One random id per page load, sent with the public submit page's calls so the
 * server can rate limit per browser. Call it in the browser only.
 */
export function browserClientId() {
  clientId ??= randomToken(16);
  return clientId;
}
