import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts", "!./convex.config.ts"]);

function setup() {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  return t;
}
const member = (org: string) => ({ subject: "user_member", issuer: "https://api.workos.com/user_management/client_test", org_id: org });

test("the Members page's invitations count against the signed-in organization's limit", async () => {
  const t = setup();
  const one = t.withIdentity(member("org_one"));
  await one.mutation(api.members.reserveInvitations, { count: 20 });
  await expect(one.mutation(api.members.reserveInvitations, { count: 1 })).rejects.toThrow("Too many invitations sent recently. Try again later.");
  // The organization comes from the token, so another organization is separate.
  await t.withIdentity(member("org_two")).mutation(api.members.reserveInvitations, { count: 1 });
});

test("reserving invitations needs a signed-in organization member and a sensible count", async () => {
  const t = setup();
  await expect(t.mutation(api.members.reserveInvitations, { count: 1 })).rejects.toThrow("Sign in to manage events.");
  await expect(t.withIdentity({ subject: "user_member", issuer: "https://api.workos.com/user_management/client_test" }).mutation(api.members.reserveInvitations, { count: 1 })).rejects.toThrow("Choose an organization");
  for (const count of [0, 21, 1.5]) await expect(t.withIdentity(member("org_one")).mutation(api.members.reserveInvitations, { count })).rejects.toThrow("Invite up to 20 people at a time.");
});
