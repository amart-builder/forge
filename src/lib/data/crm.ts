import { forgeRest } from "../supabase/rest";
import type { Company, Contact, ContactActivity } from "./types";

export async function listContacts(): Promise<Contact[]> {
  return forgeRest<Contact[]>("contacts", {
    query: { select: "*", order: "name.asc" },
  });
}

export async function listCompanies(): Promise<Company[]> {
  return forgeRest<Company[]>("companies", {
    query: { select: "*", order: "name.asc" },
  });
}

export async function getContact(id: string): Promise<Contact | null> {
  const rows = await forgeRest<Contact[]>("contacts", {
    query: { select: "*", id: `eq.${id}`, limit: 1 },
  });
  return rows[0] ?? null;
}

export async function getCompany(id: string): Promise<Company | null> {
  const rows = await forgeRest<Company[]>("companies", {
    query: { select: "*", id: `eq.${id}`, limit: 1 },
  });
  return rows[0] ?? null;
}

export async function createContact(input: {
  name: string;
  email?: string;
  company_id?: string;
  phone?: string;
  role?: string;
  tier?: string;
  tags?: string[];
}): Promise<Contact> {
  const rows = await forgeRest<Contact[]>("contacts", {
    method: "POST",
    body: {
      name: input.name,
      email: input.email ?? null,
      company_id: input.company_id ?? null,
      phone: input.phone ?? null,
      role: input.role ?? null,
      tier: input.tier ?? "C",
      tags: input.tags ?? [],
    },
  });
  return rows[0];
}

export async function createCompany(input: {
  name: string;
  domain?: string;
  website?: string;
  industry?: string;
  location?: string;
  tags?: string[];
}): Promise<Company> {
  const rows = await forgeRest<Company[]>("companies", {
    method: "POST",
    body: {
      name: input.name,
      domain: input.domain ?? null,
      website: input.website ?? null,
      industry: input.industry ?? null,
      location: input.location ?? null,
      tags: input.tags ?? [],
    },
  });
  return rows[0];
}

export async function updateContact(
  id: string,
  patch: Partial<Contact>,
): Promise<Contact> {
  const rows = await forgeRest<Contact[]>("contacts", {
    method: "PATCH",
    query: { id: `eq.${id}` },
    body: patch,
  });
  return rows[0];
}

export async function updateCompany(
  id: string,
  patch: Partial<Company>,
): Promise<Company> {
  const rows = await forgeRest<Company[]>("companies", {
    method: "PATCH",
    query: { id: `eq.${id}` },
    body: patch,
  });
  return rows[0];
}

export async function deleteContact(id: string): Promise<void> {
  await forgeRest<undefined>("contacts", {
    method: "DELETE",
    query: { id: `eq.${id}` },
  });
}

export async function deleteCompany(id: string): Promise<void> {
  await forgeRest<undefined>("companies", {
    method: "DELETE",
    query: { id: `eq.${id}` },
  });
}

export async function listContactActivities(contactId: string): Promise<ContactActivity[]> {
  return forgeRest<ContactActivity[]>("contact_activities", {
    query: {
      select: "*",
      contact_id: `eq.${contactId}`,
      order: "created_at.desc",
    },
  });
}

export async function createContactActivity(input: {
  contact_id: string;
  activity_type: string;
  title: string;
  content?: string;
}): Promise<ContactActivity> {
  const rows = await forgeRest<ContactActivity[]>("contact_activities", {
    method: "POST",
    body: {
      contact_id: input.contact_id,
      activity_type: input.activity_type,
      title: input.title,
      content: input.content ?? null,
      direction: "internal",
    },
  });
  return rows[0];
}
