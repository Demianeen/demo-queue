import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { DEFAULT_EVENT_THEME } from "../lib/event-theme";

const modules = {
  "./_generated/api.js": () => import("./_generated/api.js"),
  "./_generated/server.js": () => import("./_generated/server.js"),
  "./events.ts": () => import("./events"),
  "./organizationStyles.ts": () => import("./organizationStyles"),
};
const input = { expectedOrganizationId: "org_one", name: "Night", slug: "night", eventType: "demo" as const, meetUrl: "https://meet.google.com/example" };
const styleInput = { expectedOrganizationId: "org_one", name: "Custom", theme: { ...DEFAULT_EVENT_THEME, accent: "#334455" }, isDefault: true };
const identity = (org: string) => ({ subject: "user_operator", org_id: org });

test("styles require membership context and reject cross-organization reads, writes and event use", async () => {
  const t = convexTest(schema, modules);
  await expect(t.query(api.organizationStyles.list)).rejects.toThrow("Sign in");
  const one = t.withIdentity(identity("org_one"));
  const two = t.withIdentity(identity("org_two"));
  const id = await one.mutation(api.organizationStyles.save, styleInput);
  expect((await two.query(api.organizationStyles.list)).styles).toEqual([]);
  await expect(two.mutation(api.organizationStyles.save, { ...styleInput, id })).rejects.toThrow("organization changed");
  await expect(two.mutation(api.organizationStyles.save, { ...styleInput, expectedOrganizationId: "org_two", id })).rejects.toThrow("Style not found");
  await expect(two.mutation(api.events.createEvent, { ...input, expectedOrganizationId: "org_two", styleId: id })).rejects.toThrow("Style not found");
});

test("new events snapshot the org default, editing it preserves existing events, and explicit neutral overrides default", async () => {
  const t = convexTest(schema, modules).withIdentity(identity("org_one"));
  const id = await t.mutation(api.organizationStyles.save, styleInput);
  const event = await t.mutation(api.events.createEvent, input);
  await t.mutation(api.organizationStyles.save, { ...styleInput, id, theme: { ...styleInput.theme, accent: "#aa2211" } });
  const saved = await t.run((ctx) => ctx.db.get(event.eventId));
  expect(saved).toMatchObject({ visualStyle: "neutral", theme: styleInput.theme });
  const plain = await t.mutation(api.events.createEvent, { ...input, slug: "plain", visualStyle: "neutral" });
  expect(await t.run((ctx) => ctx.db.get(plain.eventId))).toMatchObject({ theme: DEFAULT_EVENT_THEME });
  const stage = await t.query(api.events.getStage, { slug: "night" });
  expect(stage?.event.theme).toEqual(styleInput.theme);
  expect(stage?.event).not.toHaveProperty("organizationId");
});

test("one default per organization, validated style tokens, legacy events retain Codex", async () => {
  const t = convexTest(schema, modules).withIdentity(identity("org_one"));
  await t.mutation(api.organizationStyles.save, styleInput);
  const second = await t.mutation(api.organizationStyles.save, { ...styleInput, name: "Second" });
  expect((await t.query(api.organizationStyles.list)).styles.filter((s) => s.isDefault).map((s) => s._id)).toEqual([second]);
  await expect(t.mutation(api.organizationStyles.save, { ...styleInput, theme: { ...styleInput.theme, background: "url(https://example.com)" } })).rejects.toThrow("hex colors");
  await expect(t.mutation(api.organizationStyles.save, { ...styleInput, theme: { ...styleInput.theme, radius: -1 } })).rejects.toThrow("radius");
  await t.run((ctx) => ctx.db.insert("events", { name: "Legacy", slug: "legacy-style", adminToken: "old", meetUrl: input.meetUrl, queuePublished: false, createdAt: 1, updatedAt: 1 }));
  expect((await t.query(api.events.getStage, { slug: "legacy-style" }))?.event.visualStyle).toBe("codex");
});

test("built-in defaults share the custom default slot and new events retain the selected preset", async () => {
  const t = convexTest(schema, modules).withIdentity(identity("org_one"));
  const customId = await t.mutation(api.organizationStyles.save, styleInput);
  for (const preset of ["codex", "outpost", "astra", "devday", "neutral"] as const) {
    const id = await t.mutation(api.organizationStyles.setPresetDefault, { expectedOrganizationId: "org_one", preset });
    const state = await t.query(api.organizationStyles.list);
    expect(state.styles.filter((style) => style.isDefault).map((style) => style._id)).toEqual([id]);
    const created = await t.mutation(api.events.createEvent, { ...input, slug: `default-${preset}` });
    const explicit = await t.mutation(api.events.createEvent, { ...input, slug: `selected-${preset}`, styleId: id, visualStyle: "neutral" });
    expect(await t.run((ctx) => ctx.db.get(created.eventId))).toMatchObject({ visualStyle: preset });
    expect(await t.run((ctx) => ctx.db.get(explicit.eventId))).toMatchObject({ visualStyle: preset });
    await expect(t.mutation(api.organizationStyles.save, { ...styleInput, id })).rejects.toThrow("Built-in styles cannot be edited");
  }
  await t.mutation(api.organizationStyles.setPresetDefault, { expectedOrganizationId: "org_one", preset: "outpost" });
  expect((await t.query(api.organizationStyles.list)).styles.filter((style) => style.preset === "outpost")).toHaveLength(1);
  await t.mutation(api.organizationStyles.save, { ...styleInput, id: customId });
  expect((await t.query(api.organizationStyles.list)).styles.filter((style) => style.isDefault).map((style) => style._id)).toEqual([customId]);
  expect((await t.query(api.events.getStage, { slug: "default-outpost" }))?.event.visualStyle).toBe("outpost");
});

test("preset defaults require authentication and reject a stale organization without changing any default", async () => {
  const t = convexTest(schema, modules);
  const args = { expectedOrganizationId: "org_one", preset: "outpost" as const };
  await expect(t.mutation(api.organizationStyles.setPresetDefault, args)).rejects.toThrow("Sign in");
  const other = t.withIdentity(identity("org_two"));
  await expect(other.mutation(api.organizationStyles.setPresetDefault, args)).rejects.toThrow("organization changed");
  expect((await other.query(api.organizationStyles.list)).styles).toEqual([]);
});

test("selecting a saved default preserves its current design and rejects foreign or stale sessions", async () => {
  const t = convexTest(schema, modules);
  const one = t.withIdentity(identity("org_one"));
  const id = await one.mutation(api.organizationStyles.save, styleInput);
  await one.mutation(api.organizationStyles.setPresetDefault, { expectedOrganizationId: "org_one", preset: "outpost" });
  const latestTheme = { ...styleInput.theme, accent: "#112233" };
  await one.mutation(api.organizationStyles.save, { ...styleInput, id, name: "Latest name", theme: latestTheme, isDefault: false });
  const args = { expectedOrganizationId: "org_one", id };
  await expect(t.mutation(api.organizationStyles.setSavedDefault, args)).rejects.toThrow("Sign in");
  const two = t.withIdentity(identity("org_two"));
  await expect(two.mutation(api.organizationStyles.setSavedDefault, args)).rejects.toThrow("organization changed");
  await expect(two.mutation(api.organizationStyles.setSavedDefault, { ...args, expectedOrganizationId: "org_two" })).rejects.toThrow("Style not found");
  expect((await one.query(api.organizationStyles.list)).styles.find((style) => style.isDefault)?.preset).toBe("outpost");
  await one.mutation(api.organizationStyles.setSavedDefault, args);
  const styles = (await one.query(api.organizationStyles.list)).styles;
  expect(styles.filter((style) => style.isDefault).map((style) => style._id)).toEqual([id]);
  expect(styles.find((style) => style._id === id)).toMatchObject({ name: "Latest name", theme: latestTheme });
  const event = await one.mutation(api.events.createEvent, input);
  expect(await t.run((ctx) => ctx.db.get(event.eventId))).toMatchObject({ theme: latestTheme });
});

test("no default clears every default row, keeps events, and a new event with no choice falls back to Base", async () => {
  const t = convexTest(schema, modules).withIdentity(identity("org_one"));
  const outpost = await t.mutation(api.organizationStyles.setPresetDefault, { expectedOrganizationId: "org_one", preset: "outpost" });
  const before = await t.mutation(api.events.createEvent, { ...input, slug: "before" });
  await expect(t.mutation(api.organizationStyles.clearDefault, { expectedOrganizationId: "org_two" })).rejects.toThrow("organization changed");
  await t.mutation(api.organizationStyles.clearDefault, { expectedOrganizationId: "org_one" });
  const { styles } = await t.query(api.organizationStyles.list);
  expect(styles.filter((style) => style.isDefault)).toEqual([]);
  // The built-in row stays, so its brand is kept.
  expect(styles.map((style) => style._id)).toEqual([outpost]);
  expect(await t.run((ctx) => ctx.db.get(before.eventId))).toMatchObject({ visualStyle: "outpost" });
  const after = await t.mutation(api.events.createEvent, { ...input, slug: "after" });
  expect(await t.run((ctx) => ctx.db.get(after.eventId))).toMatchObject({ visualStyle: "neutral", theme: DEFAULT_EVENT_THEME });
  const picked = await t.mutation(api.events.createEvent, { ...input, slug: "picked", visualStyle: "astra" });
  expect(await t.run((ctx) => ctx.db.get(picked.eventId))).toMatchObject({ visualStyle: "astra" });
});

test("brands group built-in and saved styles by id, rename keeps their styles, and stay in their organization", async () => {
  const t = convexTest(schema, modules);
  const one = t.withIdentity(identity("org_one"));
  const two = t.withIdentity(identity("org_two"));
  const custom = await one.mutation(api.organizationStyles.save, { ...styleInput, isDefault: false });
  const sponsor = await one.mutation(api.organizationStyles.createBrand, { expectedOrganizationId: "org_one", name: " OpenAI ", style: { kind: "preset", preset: "codex" } });
  await expect(one.mutation(api.organizationStyles.createBrand, { expectedOrganizationId: "org_one", name: "openai" })).rejects.toThrow("already exists");
  await expect(one.mutation(api.organizationStyles.createBrand, { expectedOrganizationId: "org_one", name: "  " })).rejects.toThrow("1–60");
  const ours = await one.mutation(api.organizationStyles.createBrand, { expectedOrganizationId: "org_one", name: "Outpost" });
  await one.mutation(api.organizationStyles.setStyleBrand, { expectedOrganizationId: "org_one", style: { kind: "saved", id: custom }, brandId: ours });
  await one.mutation(api.organizationStyles.setStyleBrand, { expectedOrganizationId: "org_one", style: { kind: "preset", preset: "outpost" }, brandId: ours });
  let state = await one.query(api.organizationStyles.list);
  expect(state.brands.map((brand) => brand.name)).toEqual(["OpenAI", "Outpost"]);
  // A built-in gets a non-default row that carries its brand.
  expect(state.styles.find((style) => style.preset === "codex")).toMatchObject({ brandId: sponsor, isDefault: false, name: "Codex" });
  expect(state.styles.find((style) => style.preset === "outpost")).toMatchObject({ brandId: ours, isDefault: false });
  expect(state.styles.find((style) => style._id === custom)).toMatchObject({ brandId: ours });
  // Making it the default reuses that row.
  await one.mutation(api.organizationStyles.setPresetDefault, { expectedOrganizationId: "org_one", preset: "codex" });
  state = await one.query(api.organizationStyles.list);
  expect(state.styles.filter((style) => style.preset === "codex")).toHaveLength(1);
  expect(state.styles.find((style) => style.preset === "codex")).toMatchObject({ brandId: sponsor, isDefault: true });

  await one.mutation(api.organizationStyles.renameBrand, { expectedOrganizationId: "org_one", id: sponsor, name: "OpenAI DevDay" });
  await expect(one.mutation(api.organizationStyles.renameBrand, { expectedOrganizationId: "org_one", id: sponsor, name: "outpost" })).rejects.toThrow("already exists");
  state = await one.query(api.organizationStyles.list);
  expect(state.brands.find((brand) => brand._id === sponsor)?.name).toBe("OpenAI DevDay");
  expect(state.styles.find((style) => style.preset === "codex")?.brandId).toBe(sponsor);

  await one.mutation(api.organizationStyles.setStyleBrand, { expectedOrganizationId: "org_one", style: { kind: "saved", id: custom } });
  expect((await one.query(api.organizationStyles.list)).styles.find((style) => style._id === custom)).not.toHaveProperty("brandId");

  expect((await two.query(api.organizationStyles.list)).brands).toEqual([]);
  await expect(two.mutation(api.organizationStyles.renameBrand, { expectedOrganizationId: "org_two", id: sponsor, name: "Mine" })).rejects.toThrow("Brand not found");
  await expect(two.mutation(api.organizationStyles.setStyleBrand, { expectedOrganizationId: "org_two", style: { kind: "preset", preset: "astra" }, brandId: sponsor })).rejects.toThrow("Brand not found");
  await expect(two.mutation(api.organizationStyles.setStyleBrand, { expectedOrganizationId: "org_two", style: { kind: "saved", id: custom } })).rejects.toThrow("Style not found");
  await expect(two.mutation(api.organizationStyles.createBrand, { expectedOrganizationId: "org_one", name: "Sneaky" })).rejects.toThrow("organization changed");
  expect((await two.query(api.organizationStyles.list)).styles).toEqual([]);
});

test("an organization has at most 50 brands", async () => {
  const t = convexTest(schema, modules).withIdentity(identity("org_one"));
  await t.run(async (ctx) => { for (let i = 0; i < 50; i++) await ctx.db.insert("styleBrands", { organizationId: "org_one", name: `Brand ${i}`, updatedAt: 1 }); });
  await expect(t.mutation(api.organizationStyles.createBrand, { expectedOrganizationId: "org_one", name: "One more" })).rejects.toThrow("up to 50 brands");
});
