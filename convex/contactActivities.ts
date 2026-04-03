import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const listByContact = query({
  args: { contactId: v.id("contacts") },
  handler: async (ctx, args) => {
    const activities = await ctx.db
      .query("contactActivities")
      .withIndex("by_contact", (q) => q.eq("contactId", args.contactId))
      .collect();

    return activities.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const create = mutation({
  args: {
    contactId: v.id("contacts"),
    activityType: v.string(),
    title: v.string(),
    content: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("contactActivities", {
      contactId: args.contactId,
      activityType: args.activityType as
        | "email_sent"
        | "email_received"
        | "meeting"
        | "note"
        | "call",
      title: args.title,
      content: args.content,
      metadata: "{}",
      createdAt: Date.now(),
    });
  },
});
