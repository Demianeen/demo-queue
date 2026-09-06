import { DEFAULT_EVENT_THEME } from "../lib/event-theme";
import { MAX_CUSTOM_STYLES, MAX_ORGANIZATION_STYLES, VISUAL_STYLE_LABELS } from "../lib/visual-style";
import { visualStyleValidator } from "./visualStyle";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireOrganization } from "./organizationAuth";
import { eventThemeValidator, validateEventTheme } from "./eventTheme";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const { organizationId } = await requireOrganization(ctx);
    const styles = await ctx.db.query("organizationStyles").withIndex("by_organization", (q) => q.eq("organizationId", organizationId)).take(MAX_ORGANIZATION_STYLES);
    return { organizationId, styles };
  },
});

export const save = mutation({
  args: { expectedOrganizationId: v.string(), id: v.optional(v.id("organizationStyles")), name: v.string(), theme: eventThemeValidator, isDefault: v.boolean() },
  handler: async (ctx, args) => {
    const { organizationId } = await requireOrganization(ctx);
    if (organizationId !== args.expectedOrganizationId) throw new ConvexError("Your organization changed. Reload styles before saving.");
    const name = args.name.trim();
    if (!name || name.length > 80) throw new ConvexError("Enter a style name of 1–80 characters.");
    validateEventTheme(args.theme);
    const existing = args.id ? await ctx.db.get(args.id) : null;
    if (args.id && (!existing || existing.organizationId !== organizationId)) throw new ConvexError("Style not found.");
    if (existing?.preset) throw new ConvexError("Built-in styles cannot be edited. Create a custom style instead.");
    const styles = await ctx.db.query("organizationStyles").withIndex("by_organization", (q) => q.eq("organizationId", organizationId)).take(MAX_ORGANIZATION_STYLES);
    if (!existing && styles.filter((style) => !style.preset).length >= MAX_CUSTOM_STYLES) throw new ConvexError("You can save up to 100 styles. Edit an existing style instead.");
    if (args.isDefault) {
      for (const style of styles) if (style.isDefault && style._id !== args.id) await ctx.db.patch(style._id, { isDefault: false });
    }
    const values = { name, theme: args.theme, isDefault: args.isDefault, updatedAt: Date.now() };
    if (existing) { await ctx.db.patch(existing._id, values); return existing._id; }
    return await ctx.db.insert("organizationStyles", { ...values, organizationId });
  },
});


export const setPresetDefault = mutation({
  args: { expectedOrganizationId: v.string(), preset: visualStyleValidator },
  handler: async (ctx, args) => {
    const { organizationId } = await requireOrganization(ctx);
    if (organizationId !== args.expectedOrganizationId) throw new ConvexError("Your organization changed. Reload styles before saving.");
    const styles = await ctx.db.query("organizationStyles").withIndex("by_organization", (q) => q.eq("organizationId", organizationId)).take(MAX_ORGANIZATION_STYLES);
    const existing = styles.find((style) => style.preset === args.preset);
    for (const style of styles) if (style.isDefault && style._id !== existing?._id) await ctx.db.patch(style._id, { isDefault: false });
    if (existing) {
      await ctx.db.patch(existing._id, { isDefault: true, updatedAt: Date.now() });
      return existing._id;
    }
    return await ctx.db.insert("organizationStyles", {
      organizationId, name: VISUAL_STYLE_LABELS[args.preset], preset: args.preset,
      theme: DEFAULT_EVENT_THEME, isDefault: true, updatedAt: Date.now(),
    });
  },
});

export const setSavedDefault = mutation({
  args: { expectedOrganizationId: v.string(), id: v.id("organizationStyles") },
  handler: async (ctx, args) => {
    const { organizationId } = await requireOrganization(ctx);
    if (organizationId !== args.expectedOrganizationId) throw new ConvexError("Your organization changed. Reload styles before saving.");
    const selected = await ctx.db.get(args.id);
    if (!selected || selected.organizationId !== organizationId) throw new ConvexError("Style not found.");
    const styles = await ctx.db.query("organizationStyles").withIndex("by_organization", (q) => q.eq("organizationId", organizationId)).take(MAX_ORGANIZATION_STYLES);
    for (const style of styles) if (style.isDefault && style._id !== selected._id) await ctx.db.patch(style._id, { isDefault: false });
    await ctx.db.patch(selected._id, { isDefault: true, updatedAt: Date.now() });
    return selected._id;
  },
});
