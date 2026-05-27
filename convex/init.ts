import { mutation } from "./_generated/server";

export const seed = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("columns").collect();
    const now = Date.now();
    const columns = [
      { name: "Not Started", aliases: ["Not Started", "To Do"], position: 0 },
      {
        name: "Needs to happen today",
        aliases: ["Needs to happen today", "Must happen today", "Today"],
        position: 10,
      },
      {
        name: "In Flight / Waiting",
        aliases: ["In Flight / Waiting", "In Progress"],
        position: 20,
      },
      { name: "Done", aliases: ["Done", "Completed"], position: 30 },
    ];

    for (const column of columns) {
      const exists = existing.some((existingColumn) =>
        column.aliases.includes(existingColumn.name),
      );
      if (!exists) {
        await ctx.db.insert("columns", {
          name: column.name,
          position: column.position,
          createdAt: now,
        });
      }
    }
  },
});
