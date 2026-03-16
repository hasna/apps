const BASE = (import.meta.env["VITE_API_URL"] as string | undefined) ?? "http://localhost:19430"

export interface Prompt {
  id: string
  name: string
  slug: string
  title: string
  body: string
  description: string | null
  collection: string
  tags: string[]
  variables: Array<{ name: string; default?: string; required: boolean }>
  is_template: boolean
  source: string
  version: number
  use_count: number
  last_used_at: string | null
  created_at: string
  updated_at: string
}

export interface Collection {
  id: string
  name: string
  description: string | null
  prompt_count: number
  created_at: string
}

export interface PromptVersion {
  id: string
  prompt_id: string
  body: string
  version: number
  changed_by: string | null
  created_at: string
}

export interface Stats {
  total_prompts: number
  total_templates: number
  total_collections: number
  most_used: Array<{ id: string; slug: string; title: string; use_count: number }>
  recently_used: Array<{ id: string; slug: string; title: string; last_used_at: string }>
  by_collection: Array<{ collection: string; count: number }>
  by_source: Array<{ source: string; count: number }>
}

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error: string }
    throw new Error(err.error ?? res.statusText)
  }
  return res.json() as Promise<T>
}

export const api = {
  listPrompts: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : ""
    return request<Prompt[]>(`/api/prompts${qs}`)
  },
  getPrompt: (id: string) => request<Prompt>(`/api/prompts/${id}`),
  createPrompt: (data: Partial<Prompt> & { title: string; body: string }) =>
    request<{ prompt: Prompt; created: boolean }>("/api/prompts", { method: "POST", body: JSON.stringify(data) }),
  updatePrompt: (id: string, data: Partial<Prompt>) =>
    request<Prompt>(`/api/prompts/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deletePrompt: (id: string) =>
    request<{ deleted: boolean }>(`/api/prompts/${id}`, { method: "DELETE" }),
  usePrompt: (id: string) =>
    request<{ body: string; prompt: Prompt }>(`/api/prompts/${id}/use`, { method: "POST" }),
  renderPrompt: (id: string, vars: Record<string, string>) =>
    request<{ rendered: string; missing_vars: string[]; used_defaults: string[] }>(
      `/api/prompts/${id}/render`,
      { method: "POST", body: JSON.stringify({ vars }) }
    ),
  getHistory: (id: string) => request<PromptVersion[]>(`/api/prompts/${id}/history`),
  restoreVersion: (id: string, version: number) =>
    request<{ restored: boolean }>(`/api/prompts/${id}/restore`, {
      method: "POST",
      body: JSON.stringify({ version }),
    }),
  getSimilar: (id: string) => request<Array<{ prompt: Prompt }>>(`/api/prompts/${id}/similar`),
  search: (q: string, params?: Record<string, string>) => {
    const qs = new URLSearchParams({ q, ...params }).toString()
    return request<Array<{ prompt: Prompt; score: number; snippet?: string }>>(`/api/search?${qs}`)
  },
  listCollections: () => request<Collection[]>("/api/collections"),
  getStats: () => request<Stats>("/api/stats"),
  exportPrompts: (collection?: string) => {
    const qs = collection ? `?collection=${collection}` : ""
    return request<{ prompts: Prompt[]; exported_at: string }>(`/api/export${qs}`)
  },
}
