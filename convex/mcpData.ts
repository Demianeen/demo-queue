import { organizationPrincipalValidator } from "./organizationAuth";
import { requireApproval } from "./mcpConnectionPolicy";
import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { createEventArgs, createOrganizationEvent } from "./events";
import { findEventBySlug } from "./eventSlugs";
import { clearOrganizationDefault, organizationBrands, saveOrganizationStyle, setOrganizationPresetDefault, setOrganizationSavedDefault } from "./organizationStyles";
import { eventThemeValidator } from "./eventTheme";
import { visualStyleValidator } from "./visualStyle";
import { MAX_ORGANIZATION_STYLES, VISUAL_STYLES, VISUAL_STYLE_LABELS, normalizeVisualStyle } from "../lib/visual-style";
import { DEFAULT_EVENT_THEME } from "../lib/event-theme";

function eventDto(event: Doc<"events">) {
  return {
    id: event._id, organizationId: event.workosOrganizationId, name: event.name,
    slug: event.slug, eventType: event.eventType ?? "demo", visualStyle: normalizeVisualStyle(event.visualStyle),
    theme: event.theme ?? null, createdAt: event.createdAt, queuePublished: event.queuePublished,
    submissionsClosed: event.submissionsClosedAt !== undefined,
  };
}

function styleDto(style: Doc<"organizationStyles">) {
  return { id: style._id, name: style.name, theme: style.theme, preset: style.preset ?? null, isDefault: style.isDefault, brandId: style.brandId ?? null, createdAt: style._creationTime };
}

export const listEvents = internalQuery({
  args: { principal: v.optional(organizationPrincipalValidator), organizationId: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { principal, organizationId, paginationOpts }) => {
    if (principal?.mcp) await requireApproval(ctx, principal.mcp.approvalId, organizationId, "events:read");
    // Real events only; practice events have their own list (list_practice_events).
    const result = await ctx.db.query("events").withIndex("by_workosOrganizationId_and_practice", (q) => q.eq("workosOrganizationId", organizationId).eq("practice", undefined)).order("desc").paginate(paginationOpts);
    return { page: result.page.map(eventDto), isDone: result.isDone, continueCursor: result.continueCursor };
  },
});

export const getEvent = internalQuery({
  args: { principal: v.optional(organizationPrincipalValidator), organizationId: v.string(), slug: v.string() },
  handler: async (ctx, { principal, organizationId, slug }) => {
    if (principal?.mcp) await requireApproval(ctx, principal.mcp.approvalId, organizationId, "events:read");
    const event = await findEventBySlug(ctx, slug);
    return event?.workosOrganizationId === organizationId ? eventDto(event) : null;
  },
});

export const createEvent = internalMutation({
  args: { principal: v.optional(organizationPrincipalValidator), ...createEventArgs, styleId: v.optional(v.string()), actor: v.string() },
  handler: async (ctx, args) => {
    if (args.principal?.mcp) await requireApproval(ctx, args.principal.mcp.approvalId, args.expectedOrganizationId, "events:manage");
    const styleId = args.styleId ? ctx.db.normalizeId("organizationStyles", args.styleId) : undefined;
    if (styleId === null) throw new ConvexError("Style not found.");
    const { eventId } = await createOrganizationEvent(ctx, { ...args, styleId }, { organizationId: args.expectedOrganizationId, actor: args.actor, mcp: args.principal?.mcp });
    const event = await ctx.db.get(eventId);
    if (!event) throw new Error("operation_failed");
    return eventDto(event);
  },
});

export const listStyles = internalQuery({
  args: { principal: v.optional(organizationPrincipalValidator), organizationId: v.string() },
  handler: async (ctx, { principal, organizationId }) => {
    if (principal?.mcp) await requireApproval(ctx, principal.mcp.approvalId, organizationId, "events:read");
    const styles = await ctx.db.query("organizationStyles").withIndex("by_organization", (q) => q.eq("organizationId", organizationId)).take(MAX_ORGANIZATION_STYLES);
    const brands = await organizationBrands(ctx, organizationId);
    // With no default row there is no default: create_event then falls back to Base.
    const presetRow = (preset: string) => styles.find((style) => style.preset === preset);
    return {
      organizationId,
      presets: VISUAL_STYLES.map((preset) => ({ preset, name: VISUAL_STYLE_LABELS[preset], theme: preset === "neutral" ? DEFAULT_EVENT_THEME : null, isDefault: presetRow(preset)?.isDefault ?? false, brandId: presetRow(preset)?.brandId ?? null })),
      styles: styles.filter((style) => !style.preset).map(styleDto),
      brands: brands.map((brand) => ({ id: brand._id, name: brand.name, createdAt: brand._creationTime })),
    };
  },
});

export const createStyle = internalMutation({
  args: { principal: v.optional(organizationPrincipalValidator), organizationId: v.string(), name: v.string(), theme: eventThemeValidator },
  handler: async (ctx, args) => {
    if (args.principal?.mcp) await requireApproval(ctx, args.principal.mcp.approvalId, args.organizationId, "events:manage");
    const id = await saveOrganizationStyle(ctx, { expectedOrganizationId: args.organizationId, name: args.name, theme: args.theme, isDefault: false }, args.organizationId);
    const style = await ctx.db.get(id);
    if (!style) throw new Error("operation_failed");
    return styleDto(style);
  },
});

export const setDefaultStyle = internalMutation({
  args: { principal: v.optional(organizationPrincipalValidator), organizationId: v.string(), selection: v.union(v.object({ kind: v.literal("preset"), preset: visualStyleValidator }), v.object({ kind: v.literal("saved"), id: v.string() }), v.object({ kind: v.literal("none") })) },
  handler: async (ctx, { principal, organizationId, selection }) => {
    if (principal?.mcp) await requireApproval(ctx, principal.mcp.approvalId, organizationId, "events:manage");
    if (selection.kind === "none") {
      await clearOrganizationDefault(ctx, organizationId);
      return { organizationId, styleId: null };
    }
    if (selection.kind === "preset") {
      const id = await setOrganizationPresetDefault(ctx, { expectedOrganizationId: organizationId, preset: selection.preset }, organizationId);
      return { organizationId, styleId: id };
    }
    const savedId = ctx.db.normalizeId("organizationStyles", selection.id);
    if (!savedId) throw new ConvexError("Style not found.");
    const id = await setOrganizationSavedDefault(ctx, { expectedOrganizationId: organizationId, id: savedId }, organizationId);
    return { organizationId, styleId: id };
  },
});
