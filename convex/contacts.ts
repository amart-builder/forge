import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {
    search: v.optional(v.string()),
    tier: v.optional(v.string()),
    sort: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let contacts = await ctx.db.query("contacts").collect();

    if (args.search) {
      const term = args.search.toLowerCase();
      contacts = contacts.filter((c) => {
        const name = c.name.toLowerCase();
        const email = (c.email ?? "").toLowerCase();
        const company = (c.company ?? "").toLowerCase();
        return name.includes(term) || email.includes(term) || company.includes(term);
      });
    }

    if (args.tier) {
      contacts = contacts.filter((c) => c.tier === args.tier);
    }

    const sortField = args.sort ?? "name";

    if (sortField === "name") {
      contacts.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortField === "last_contact_date") {
      contacts.sort((a, b) => {
        if (!a.lastContactDate && !b.lastContactDate) return 0;
        if (!a.lastContactDate) return 1;
        if (!b.lastContactDate) return -1;
        return b.lastContactDate.localeCompare(a.lastContactDate);
      });
    } else if (sortField === "company") {
      contacts.sort((a, b) =>
        (a.company ?? "").localeCompare(b.company ?? ""),
      );
    }

    return contacts;
  },
});

export const get = query({
  args: { id: v.id("contacts") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    company: v.optional(v.string()),
    role: v.optional(v.string()),
    linkedin: v.optional(v.string()),
    location: v.optional(v.string()),
    tier: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    howWeMet: v.optional(v.string()),
    notes: v.optional(v.string()),
    lastContactDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("contacts", {
      name: args.name,
      email: args.email,
      phone: args.phone,
      company: args.company,
      role: args.role,
      linkedin: args.linkedin,
      location: args.location,
      tier: args.tier ?? "C",
      tags: args.tags ?? [],
      howWeMet: args.howWeMet,
      notes: args.notes ?? "",
      lastContactDate: args.lastContactDate,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("contacts"),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    company: v.optional(v.string()),
    role: v.optional(v.string()),
    linkedin: v.optional(v.string()),
    location: v.optional(v.string()),
    tier: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    howWeMet: v.optional(v.string()),
    notes: v.optional(v.string()),
    lastContactDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    const patch: Record<string, unknown> = { updatedAt: Date.now() };

    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) {
        patch[key] = value;
      }
    }

    await ctx.db.patch(id, patch);
  },
});

export const remove = mutation({
  args: { id: v.id("contacts") },
  handler: async (ctx, args) => {
    const activities = await ctx.db
      .query("contactActivities")
      .withIndex("by_contact", (q) => q.eq("contactId", args.id))
      .collect();

    for (const activity of activities) {
      await ctx.db.delete(activity._id);
    }

    const notes = await ctx.db
      .query("meetingNotes")
      .withIndex("by_contact", (q) => q.eq("contactId", args.id))
      .collect();

    for (const note of notes) {
      await ctx.db.delete(note._id);
    }

    await ctx.db.delete(args.id);
  },
});

export const importCSV = mutation({
  args: {
    contacts: v.array(
      v.object({
        name: v.string(),
        email: v.optional(v.string()),
        phone: v.optional(v.string()),
        company: v.optional(v.string()),
        role: v.optional(v.string()),
        location: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    for (const contact of args.contacts) {
      await ctx.db.insert("contacts", {
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        company: contact.company,
        role: contact.role,
        location: contact.location,
        tier: "C",
        tags: [],
        notes: "",
        createdAt: now,
        updatedAt: now,
      });
    }

    return { imported: args.contacts.length };
  },
});
