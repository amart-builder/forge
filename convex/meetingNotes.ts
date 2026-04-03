import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const listByContact = query({
  args: { contactId: v.id("contacts") },
  handler: async (ctx, args) => {
    const notes = await ctx.db
      .query("meetingNotes")
      .withIndex("by_contact", (q) => q.eq("contactId", args.contactId))
      .collect();

    return notes.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const create = mutation({
  args: {
    contactId: v.id("contacts"),
    date: v.optional(v.string()),
    attendees: v.optional(v.array(v.string())),
    summary: v.optional(v.string()),
    actionItems: v.optional(v.array(v.string())),
    sourceEmailId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("meetingNotes", {
      contactId: args.contactId,
      date: args.date,
      attendees: args.attendees ?? [],
      summary: args.summary,
      actionItems: args.actionItems ?? [],
      sourceEmailId: args.sourceEmailId,
      createdAt: Date.now(),
    });
  },
});
