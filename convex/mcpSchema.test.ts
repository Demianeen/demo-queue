import { expect, test, vi } from "vitest";
import { v } from "convex/values";
import { adminToolSchema, CONTEXT_SCHEMA, convexMcpSchema, withContext } from "./mcpSchema";

test("context is advertised as optional and taken out before the tool's own strict validation", async () => {
  const onInvalid = vi.fn(async () => {});
  const schema = withContext(adminToolSchema(v.object({ slug: v.string() })), onInvalid);
  expect(schema["~standard"].jsonSchema.input({ target: "draft-2020-12" })).toMatchObject({ properties: { context: CONTEXT_SCHEMA }, required: ["organizationId", "slug"], additionalProperties: false });
  expect(await schema["~standard"].validate({ organizationId: "org_one", slug: "night", context: "checking the lineup" })).toEqual({ value: { args: { organizationId: "org_one", input: { slug: "night" } }, context: "checking the lineup" } });
  expect(await schema["~standard"].validate({ organizationId: "org_one", slug: "night" })).toEqual({ value: { args: { organizationId: "org_one", input: { slug: "night" } }, context: undefined } });
  expect(onInvalid).not.toHaveBeenCalled();
  for (const input of [{ organizationId: "org_one", slug: "night", context: 3 }, { organizationId: "org_one", slug: "night", context: "x", actor: "forged" }, { organizationId: "org_one", context: "x" }, "not an object"]) {
    expect((await schema["~standard"].validate(input)).issues, JSON.stringify(input)).toBeDefined();
  }
  expect(onInvalid.mock.calls).toEqual([[undefined], ["x"], ["x"], [undefined]]);
});

test("the transport interpreter validates nested Convex shapes and advertises required versus optional fields", async () => {
  const validator = v.object({
    slug: v.string(), count: v.number(), enabled: v.boolean(), missing: v.null(),
    option: v.optional(v.string()),
    selection: v.union(v.object({ kind: v.literal("preset"), value: v.string() }), v.object({ kind: v.literal("saved"), id: v.string() })),
    rows: v.array(v.object({ name: v.string(), active: v.optional(v.boolean()) })),
  });
  const schema = convexMcpSchema(validator);
  const valid = { slug: "night", count: 2, enabled: true, missing: null, selection: { kind: "preset", value: "neutral" }, rows: [{ name: "Sam" }] };
  expect(await schema["~standard"].validate(valid)).toEqual({ value: valid });
  for (const invalid of [
    { ...valid, extra: "secret" }, { ...valid, count: Number.NaN }, { ...valid, count: Infinity },
    { ...valid, rows: [{ name: 1 }] }, { ...valid, rows: [{ name: "Sam", extra: true }] },
    { ...valid, selection: { kind: "other", value: "x" } }, { ...valid, missing: undefined },
  ]) expect((await schema["~standard"].validate(invalid)).issues).toBeDefined();
  const json = schema["~standard"].jsonSchema.input({ target: "draft-2020-12" });
  expect(json).toMatchObject({ type: "object", additionalProperties: false, required: ["slug", "count", "enabled", "missing", "selection", "rows"] });
});

test("organization selection is validated separately and never becomes caller-supplied authority", async () => {
  const schema = adminToolSchema(v.object({ slug: v.string() }));
  expect(await schema["~standard"].validate({ organizationId: "org_one", slug: "night" })).toEqual({ value: { organizationId: "org_one", input: { slug: "night" } } });
  for (const input of [
    { organizationId: "not-an-org", slug: "night" }, { slug: "night" },
    { organizationId: "org_one", slug: "night", actor: "forged" },
    { organizationId: "org_one", input: { slug: "night" } },
  ]) expect((await schema["~standard"].validate(input)).issues).toBeDefined();
  expect(schema["~standard"].jsonSchema.input({ target: "draft-2020-12" })).toMatchObject({ required: ["organizationId", "slug"], additionalProperties: false });
});

test("unsupported validator kinds fail closed instead of advertising an unchecked schema", () => {
  expect(() => convexMcpSchema(v.object({ id: v.id("submissions") }))).toThrow("MCP IDs must be strings normalized by the database operation");
  for (const validator of [v.any(), v.int64(), v.bytes(), v.record(v.string(), v.string())]) {
    expect(() => convexMcpSchema(v.object({ value: validator }))).toThrow("Unsupported MCP validator");
  }
});
