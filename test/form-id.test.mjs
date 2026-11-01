import assert from "node:assert/strict";
import test from "node:test";

import { formId } from "../lib/form-id.ts";

test("the browser and Convex derive the same form id from one client id", async () => {
  assert.equal(await formId("abcdef0123456789abcdef0123456789"), await formId("abcdef0123456789abcdef0123456789"));
  assert.match(await formId("abcdef0123456789abcdef0123456789"), /^[0-9a-f]{16}$/);
});

test("the form id does not give the rate-limit client id away", async () => {
  const clientId = "abcdef0123456789abcdef0123456789";
  assert.ok(!clientId.includes(await formId(clientId)));
  assert.notEqual(await formId(clientId), await formId("0123456789abcdef0123456789abcdef"));
});
