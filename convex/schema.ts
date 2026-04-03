import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

export default defineSchema({
  ...authTables,

  columns: defineTable({
    name: v.string(),
    position: v.float64(),
    createdAt: v.float64(),
  }),

  tasks: defineTable({
    columnId: v.id("columns"),
    title: v.string(),
    description: v.string(),
    priority: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
    ),
    dueDate: v.optional(v.string()),
    tags: v.array(v.string()),
    position: v.float64(),
    createdAt: v.float64(),
    updatedAt: v.float64(),
  }).index("by_column", ["columnId"]),

  emailItems: defineTable({
    threadId: v.optional(v.string()),
    messageId: v.optional(v.string()),
    senderName: v.optional(v.string()),
    senderEmail: v.optional(v.string()),
    subject: v.optional(v.string()),
    summary: v.optional(v.string()),
    context: v.optional(v.string()),
    recommendedAction: v.union(
      v.literal("reply"),
      v.literal("archive"),
      v.literal("follow_up"),
      v.literal("delegate"),
      v.literal("flag"),
      v.literal("review"),
    ),
    draftResponse: v.optional(v.string()),
    priority: v.float64(),
    status: v.union(
      v.literal("pending"),
      v.literal("actioned"),
      v.literal("dismissed"),
    ),
    actionedAt: v.optional(v.float64()),
    createdAt: v.float64(),
  }).index("by_status", ["status"]),

  emailActions: defineTable({
    emailItemId: v.id("emailItems"),
    actionType: v.string(),
    description: v.optional(v.string()),
    createdAt: v.float64(),
  }).index("by_email", ["emailItemId"]),

  contacts: defineTable({
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    company: v.optional(v.string()),
    role: v.optional(v.string()),
    linkedin: v.optional(v.string()),
    location: v.optional(v.string()),
    tier: v.string(),
    tags: v.array(v.string()),
    howWeMet: v.optional(v.string()),
    notes: v.string(),
    lastContactDate: v.optional(v.string()),
    createdAt: v.float64(),
    updatedAt: v.float64(),
  })
    .index("by_name", ["name"])
    .index("by_tier", ["tier"]),

  contactActivities: defineTable({
    contactId: v.id("contacts"),
    activityType: v.union(
      v.literal("email_sent"),
      v.literal("email_received"),
      v.literal("meeting"),
      v.literal("note"),
      v.literal("call"),
    ),
    title: v.optional(v.string()),
    content: v.optional(v.string()),
    metadata: v.optional(v.string()),
    createdAt: v.float64(),
  }).index("by_contact", ["contactId"]),

  meetingNotes: defineTable({
    contactId: v.id("contacts"),
    date: v.optional(v.string()),
    attendees: v.array(v.string()),
    summary: v.optional(v.string()),
    actionItems: v.array(v.string()),
    sourceEmailId: v.optional(v.string()),
    createdAt: v.float64(),
  }).index("by_contact", ["contactId"]),

  appState: defineTable({
    key: v.string(),
    value: v.optional(v.string()),
    updatedAt: v.float64(),
  }).index("by_key", ["key"]),
});
