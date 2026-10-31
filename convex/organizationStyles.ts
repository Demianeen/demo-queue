import { DEFAULT_EVENT_THEME } from "../lib/event-theme";
import { MAX_CUSTOM_STYLES, MAX_ORGANIZATION_STYLES, MAX_STYLE_BRANDS, VISUAL_STYLE_LABELS, type VisualStyle } from "../lib/visual-style";
import { visualStyleValidator } from "./visualStyle";
import { ConvexError, v, type Infer } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireOrganization } from "./organizationAuth";
import { eventThemeValidator, validateEventTheme } from "./eventTheme";

function organizationStyles(ctx: Pick<QueryCtx, "db">, organizationId: string) {
  return ctx.db.query("organizationStyles").withIndex("by_organization", (q) => q.eq("organizationId", organizationId)).take(MAX_ORGANIZATION_STYLES);
}

export function organizationBrands(ctx: Pick<QueryCtx, "db">, organizationId: string) {
  return ctx.db.query("styleBrands").withIndex("by_organization", (q) => q.eq("organizationId", organizationId)).take(MAX_STYLE_BRANDS);
}

async function requireExpectedOrganization(ctx: Pick<QueryCtx, "auth">, expectedOrganizationId: string) {
  const { organizationId } = await requireOrganization(ctx);
  if (organizationId !== expectedOrganizationId) throw new ConvexError("Your organization changed. Reload styles before saving.");
  return organizationId;
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const { organizationId } = await requireOrganization(ctx);
    const [styles, brands] = await Promise.all([organizationStyles(ctx, organizationId), organizationBrands(ctx, organizationId)]);
    return { organizationId, styles, brands };
  },
});

const saveArgs = { expectedOrganizationId: v.string(), id: v.optional(v.id("organizationStyles")), name: v.string(), theme: eventThemeValidator, isDefault: v.boolean() };
const saveInput = v.object(saveArgs);
export const save = mutation({
  args: saveInput,
  handler: async (ctx, args) => {
    const organizationId = await requireExpectedOrganization(ctx, args.expectedOrganizationId);
    return saveOrganizationStyle(ctx, args, organizationId);
  },
});

export async function saveOrganizationStyle(ctx: MutationCtx, args: Infer<typeof saveInput>, organizationId: string) {
    const name = args.name.trim();
    if (!name || name.length > 80) throw new ConvexError("Enter a style name of 1–80 characters.");
    validateEventTheme(args.theme);
    const existing = args.id ? await ctx.db.get(args.id) : null;
    if (args.id && (!existing || existing.organizationId !== organizationId)) throw new ConvexError("Style not found.");
    if (existing?.preset) throw new ConvexError("Built-in styles cannot be edited. Create a custom style instead.");
    const styles = await organizationStyles(ctx, organizationId);
    if (!existing && styles.filter((style) => !style.preset).length >= MAX_CUSTOM_STYLES) throw new ConvexError("You can save up to 100 styles. Edit an existing style instead.");
    if (args.isDefault) {
      for (const style of styles) if (style.isDefault && style._id !== args.id) await ctx.db.patch(style._id, { isDefault: false });
    }
    const values = { name, theme: args.theme, isDefault: args.isDefault, updatedAt: Date.now() };
    if (existing) { await ctx.db.patch(existing._id, values); return existing._id; }
    return await ctx.db.insert("organizationStyles", { ...values, organizationId });
}

/** A built-in style's row, made the first time it is the default or gets a brand. */
async function presetRow(ctx: MutationCtx, styles: Awaited<ReturnType<typeof organizationStyles>>, organizationId: string, preset: VisualStyle) {
  const existing = styles.find((style) => style.preset === preset);
  if (existing) return existing._id;
  return await ctx.db.insert("organizationStyles", {
    organizationId, name: VISUAL_STYLE_LABELS[preset], preset,
    theme: DEFAULT_EVENT_THEME, isDefault: false, updatedAt: Date.now(),
  });
}

const presetArgs = { expectedOrganizationId: v.string(), preset: visualStyleValidator };
const presetInput = v.object(presetArgs);
export const setPresetDefault = mutation({
  args: presetInput,
  handler: async (ctx, args) => {
    const organizationId = await requireExpectedOrganization(ctx, args.expectedOrganizationId);
    return setOrganizationPresetDefault(ctx, args, organizationId);
  },
});

export async function setOrganizationPresetDefault(ctx: MutationCtx, args: Infer<typeof presetInput>, organizationId: string) {
    const styles = await organizationStyles(ctx, organizationId);
    const id = await presetRow(ctx, styles, organizationId, args.preset);
    for (const style of styles) if (style.isDefault && style._id !== id) await ctx.db.patch(style._id, { isDefault: false });
    await ctx.db.patch(id, { isDefault: true, updatedAt: Date.now() });
    return id;
}

const savedArgs = { expectedOrganizationId: v.string(), id: v.id("organizationStyles") };
const savedInput = v.object(savedArgs);
export const setSavedDefault = mutation({
  args: savedInput,
  handler: async (ctx, args) => {
    const organizationId = await requireExpectedOrganization(ctx, args.expectedOrganizationId);
    return setOrganizationSavedDefault(ctx, args, organizationId);
  },
});

export async function setOrganizationSavedDefault(ctx: MutationCtx, args: Infer<typeof savedInput>, organizationId: string) {
    const selected = await ctx.db.get(args.id);
    if (!selected || selected.organizationId !== organizationId) throw new ConvexError("Style not found.");
    const styles = await organizationStyles(ctx, organizationId);
    for (const style of styles) if (style.isDefault && style._id !== selected._id) await ctx.db.patch(style._id, { isDefault: false });
    await ctx.db.patch(selected._id, { isDefault: true, updatedAt: Date.now() });
    return selected._id;
}

/**
 * No default: New event then asks for a style. Organizations that run a
 * different look per sponsor use this. Existing events keep their style.
 */
export const clearDefault = mutation({
  args: { expectedOrganizationId: v.string() },
  handler: async (ctx, args) => clearOrganizationDefault(ctx, await requireExpectedOrganization(ctx, args.expectedOrganizationId)),
});

export async function clearOrganizationDefault(ctx: MutationCtx, organizationId: string) {
  for (const style of await organizationStyles(ctx, organizationId)) {
    if (style.isDefault) await ctx.db.patch(style._id, { isDefault: false, updatedAt: Date.now() });
  }
  return null;
}

/** A style by what it is: a built-in preset by name, or a saved style by id. */
export const styleRefValidator = v.union(
  v.object({ kind: v.literal("preset"), preset: visualStyleValidator }),
  v.object({ kind: v.literal("saved"), id: v.id("organizationStyles") }),
);

function brandName(value: string) {
  const name = value.trim();
  if (!name || name.length > 60) throw new ConvexError("Enter a brand name of 1–60 characters.");
  return name;
}

async function requireBrand(ctx: Pick<QueryCtx, "db">, id: Id<"styleBrands">, organizationId: string) {
  const brand = await ctx.db.get(id);
  if (!brand || brand.organizationId !== organizationId) throw new ConvexError("Brand not found.");
  return brand;
}

function rejectTakenName(brands: { _id: Id<"styleBrands">; name: string }[], name: string, except?: Id<"styleBrands">) {
  if (brands.some((brand) => brand._id !== except && brand.name.toLowerCase() === name.toLowerCase())) {
    throw new ConvexError("A brand with that name already exists.");
  }
}

const createBrandInput = v.object({ expectedOrganizationId: v.string(), name: v.string(), style: v.optional(styleRefValidator) });
/** A new brand, and optionally the style it was made from is put in it straight away. */
export const createBrand = mutation({
  args: createBrandInput,
  handler: async (ctx, args) => createStyleBrand(ctx, args, await requireExpectedOrganization(ctx, args.expectedOrganizationId)),
});

export async function createStyleBrand(ctx: MutationCtx, args: Infer<typeof createBrandInput>, organizationId: string) {
  const name = brandName(args.name);
  const brands = await organizationBrands(ctx, organizationId);
  if (brands.length >= MAX_STYLE_BRANDS) throw new ConvexError(`You can have up to ${MAX_STYLE_BRANDS} brands. Rename an existing brand instead.`);
  rejectTakenName(brands, name);
  const id = await ctx.db.insert("styleBrands", { organizationId, name, updatedAt: Date.now() });
  if (args.style) await setOrganizationStyleBrand(ctx, { style: args.style, brandId: id }, organizationId);
  return id;
}

const renameBrandInput = v.object({ expectedOrganizationId: v.string(), id: v.id("styleBrands"), name: v.string() });
export const renameBrand = mutation({
  args: renameBrandInput,
  handler: async (ctx, args) => renameStyleBrand(ctx, args, await requireExpectedOrganization(ctx, args.expectedOrganizationId)),
});

export async function renameStyleBrand(ctx: MutationCtx, args: Infer<typeof renameBrandInput>, organizationId: string) {
  const brand = await requireBrand(ctx, args.id, organizationId);
  const name = brandName(args.name);
  rejectTakenName(await organizationBrands(ctx, organizationId), name, brand._id);
  await ctx.db.patch(brand._id, { name, updatedAt: Date.now() });
  return brand._id;
}

const setStyleBrandInput = v.object({ expectedOrganizationId: v.string(), style: styleRefValidator, brandId: v.optional(v.id("styleBrands")) });
/** Puts a style in a brand, or in no brand when `brandId` is left out. Built-in styles too. */
export const setStyleBrand = mutation({
  args: setStyleBrandInput,
  handler: async (ctx, args) => setOrganizationStyleBrand(ctx, args, await requireExpectedOrganization(ctx, args.expectedOrganizationId)),
});

export async function setOrganizationStyleBrand(ctx: MutationCtx, args: Omit<Infer<typeof setStyleBrandInput>, "expectedOrganizationId">, organizationId: string) {
  if (args.brandId) await requireBrand(ctx, args.brandId, organizationId);
  let id: Id<"organizationStyles">;
  if (args.style.kind === "saved") {
    const style = await ctx.db.get(args.style.id);
    if (!style || style.organizationId !== organizationId) throw new ConvexError("Style not found.");
    id = style._id;
  } else {
    id = await presetRow(ctx, await organizationStyles(ctx, organizationId), organizationId, args.style.preset);
  }
  await ctx.db.patch(id, { brandId: args.brandId, updatedAt: Date.now() });
  return id;
}
