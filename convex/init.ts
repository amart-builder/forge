import { mutation } from "./_generated/server";

export const seed = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("columns").collect();
    if (existing.length > 0) return;

    const now = Date.now();
    await ctx.db.insert("columns", { name: "To Do", position: 0, createdAt: now });
    await ctx.db.insert("columns", { name: "In Progress", position: 1, createdAt: now });
    await ctx.db.insert("columns", { name: "Done", position: 2, createdAt: now });
  },
});
