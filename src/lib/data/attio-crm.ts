export type AttioObjectType = "people" | "companies";

export type AttioCRMRecord = {
  _id: string;
  objectType: AttioObjectType;
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  role?: string;
  linkedin?: string;
  location?: string;
  notes?: string;
  description?: string;
  tier: string;
  relationship?: string;
  relevant?: string;
  tags: string[];
  lastContactDate?: string;
  nextInteractionDate?: string;
  attioUrl?: string;
  sourceAttributes: string[];
};

export type AttioCRMResponse = {
  source: "attio";
  generatedAt: string;
  people: AttioCRMRecord[];
  companies: AttioCRMRecord[];
  records: AttioCRMRecord[];
};

export async function listAttioCRMRecords(limit = 500): Promise<AttioCRMResponse> {
  const response = await fetch(`/api/crm/attio?limit=${limit}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Attio CRM data could not load.");
  }

  return (await response.json()) as AttioCRMResponse;
}
