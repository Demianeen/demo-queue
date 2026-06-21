import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  events: defineTable({
    name: v.string(),
    slug: v.string(),
    meetUrl: v.string(),
    adminToken: v.string(),
    queuePublished: v.boolean(),
    showMeetLinkOnStage: v.optional(v.boolean()),
    lineupTarget: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_slug", ["slug"]),

  submissions: defineTable({
    eventId: v.id("events"),
    participantToken: v.string(),
    name: v.string(),
    demoTitle: v.string(),
    description: v.string(),
    phone: v.string(),
    email: v.optional(v.string()),
    twitter: v.optional(v.string()),
    linkedin: v.optional(v.string()),
    category: v.optional(v.string()),
    screenshotId: v.optional(v.id("_storage")),
    status: v.union(
      v.literal("candidate"),
      v.literal("queued"),
      v.literal("hidden"),
      v.literal("up_next"),
      v.literal("current"),
      v.literal("done"),
      v.literal("no_show"),
      v.literal("withdrawn"),
    ),
    queueOrder: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_event", ["eventId"])
    .index("by_event_status", ["eventId", "status"])
    .index("by_participant_token", ["participantToken"]),

  auditLog: defineTable({
    eventId: v.id("events"),
    action: v.string(),
    actor: v.string(),
    details: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_event", ["eventId"]),
});
