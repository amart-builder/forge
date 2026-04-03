import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const tasks = await ctx.db.query("tasks").collect();
    return tasks.sort((a, b) => a.position - b.position);
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    columnId: v.id("columns"),
    description: v.optional(v.string()),
    priority: v.optional(
      v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    ),
    dueDate: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const tasksInColumn = await ctx.db
      .query("tasks")
      .withIndex("by_column", (q) => q.eq("columnId", args.columnId))
      .collect();

    const now = Date.now();

    return await ctx.db.insert("tasks", {
      title: args.title,
      columnId: args.columnId,
      description: args.description ?? "",
      priority: args.priority ?? "medium",
      dueDate: args.dueDate,
      tags: args.tags ?? [],
      position: tasksInColumn.length,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("tasks"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    priority: v.optional(
      v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    ),
    dueDate: v.optional(v.union(v.string(), v.null())),
    tags: v.optional(v.array(v.string())),
    columnId: v.optional(v.id("columns")),
    position: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;

    const patch: Record<string, unknown> = { updatedAt: Date.now() };

    if (fields.title !== undefined) patch.title = fields.title;
    if (fields.description !== undefined)
      patch.description = fields.description;
    if (fields.priority !== undefined) patch.priority = fields.priority;
    if (fields.dueDate !== undefined) {
      if (fields.dueDate === null) {
        patch.dueDate = undefined;
      } else {
        patch.dueDate = fields.dueDate;
      }
    }
    if (fields.tags !== undefined) patch.tags = fields.tags;
    if (fields.columnId !== undefined) patch.columnId = fields.columnId;
    if (fields.position !== undefined) patch.position = fields.position;

    await ctx.db.patch(id, patch);
  },
});

export const remove = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});
