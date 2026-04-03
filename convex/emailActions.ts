import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("emailActions").order("desc").collect();
  },
});

export const create = mutation({
  args: {
    emailItemId: v.id("emailItems"),
    actionType: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("emailActions", {
      emailItemId: args.emailItemId,
      actionType: args.actionType,
      description: args.description,
      createdAt: Date.now(),
    });
  },
});
