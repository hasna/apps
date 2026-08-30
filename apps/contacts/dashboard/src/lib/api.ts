import type {
  ContactWithDetails,
  CompanyWithDetails,
  Tag,
  Stats,
} from "@/types";

const BASE = "http://localhost:19428/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ─── Stats ─────────────────────────────────────────────────────────────────

export function fetchStats(): Promise<Stats> {
  return request<Stats>("/stats");
}

// ─── Contacts ──────────────────────────────────────────────────────────────

export function fetchContacts(params?: {
  q?: string;
  tag_id?: string;
  company_id?: string;
  limit?: number;
  offset?: number;
}): Promise<{ contacts: ContactWithDetails[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.q) qs.set("q", params.q);
  if (params?.tag_id) qs.set("tag_id", params.tag_id);
  if (params?.company_id) qs.set("company_id", params.company_id);
  if (params?.limit != null) qs.set("limit", String(params.limit));
  if (params?.offset != null) qs.set("offset", String(params.offset));

  const query = qs.toString();
  const path = query ? `/contacts?${query}` : "/contacts";

  if (params?.q) {
    // Search returns an array directly
    return request<ContactWithDetails[]>(`/contacts?q=${encodeURIComponent(params.q)}`).then(
      (contacts) => ({ contacts, total: contacts.length })
    );
  }
  return request<{ contacts: ContactWithDetails[]; total: number }>(path);
}

export function fetchContact(id: string): Promise<ContactWithDetails> {
  return request<ContactWithDetails>(`/contacts/${id}`);
}

export function createContact(data: Record<string, unknown>): Promise<ContactWithDetails> {
  return request<ContactWithDetails>("/contacts", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateContact(id: string, data: Record<string, unknown>): Promise<ContactWithDetails> {
  return request<ContactWithDetails>(`/contacts/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteContact(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/contacts/${id}`, { method: "DELETE" });
}

// ─── Companies ─────────────────────────────────────────────────────────────

export function fetchCompanies(params?: {
  tag_id?: string;
  industry?: string;
  limit?: number;
  offset?: number;
}): Promise<{ companies: CompanyWithDetails[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.tag_id) qs.set("tag_id", params.tag_id);
  if (params?.industry) qs.set("industry", params.industry);
  if (params?.limit != null) qs.set("limit", String(params.limit));
  if (params?.offset != null) qs.set("offset", String(params.offset));
  const query = qs.toString();
  return request<{ companies: CompanyWithDetails[]; total: number }>(
    query ? `/companies?${query}` : "/companies"
  );
}

export function fetchCompany(id: string): Promise<CompanyWithDetails> {
  return request<CompanyWithDetails>(`/companies/${id}`);
}

export function createCompany(data: Record<string, unknown>): Promise<CompanyWithDetails> {
  return request<CompanyWithDetails>("/companies", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateCompany(id: string, data: Record<string, unknown>): Promise<CompanyWithDetails> {
  return request<CompanyWithDetails>(`/companies/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteCompany(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/companies/${id}`, { method: "DELETE" });
}

// ─── Tags ──────────────────────────────────────────────────────────────────

export function fetchTags(): Promise<Tag[]> {
  return request<Tag[]>("/tags");
}

export function createTag(data: { name: string; color?: string; description?: string }): Promise<Tag> {
  return request<Tag>("/tags", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function deleteTag(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/tags/${id}`, { method: "DELETE" });
}

// ─── Import / Export ───────────────────────────────────────────────────────

export function importContacts(
  format: "json" | "csv" | "vcf",
  data: string
): Promise<{ imported: number; errors: number; error_details: string[] }> {
  return request("/import", {
    method: "POST",
    body: JSON.stringify({ format, data }),
  });
}

export function exportUrl(format: "json" | "csv" | "vcf"): string {
  return `${BASE}/export?format=${format}`;
}
