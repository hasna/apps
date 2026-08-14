import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, TYPE_ICONS } from "../lib.ts";
import type { Project } from "../../../src/types/index.ts";

interface SimilarTicket { id: string; short_id: string; title: string; status: string; score: number }

export default function NewTicketForm({ onSuccess }: { onSuccess?: (shortId: string) => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState("bug");
  const [priority, setPriority] = useState("none");
  const [severity, setSeverity] = useState("");
  const [projectId, setProjectId] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedTitle, setDebouncedTitle] = useState("");

  const { data: projects } = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: () => apiFetch("/projects"),
  });

  const { data: similar } = useQuery<SimilarTicket[]>({
    queryKey: ["similar", debouncedTitle, projectId],
    queryFn: () => apiFetch(`/tickets/similar?title=${encodeURIComponent(debouncedTitle)}${projectId ? `&project_id=${projectId}` : ""}`),
    enabled: debouncedTitle.length > 5,
  });

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedTitle(title), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [title]);

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiFetch<{ short_id: string }>("/tickets", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (ticket) => {
      void qc.invalidateQueries({ queryKey: ["tickets"] });
      onSuccess?.(ticket.short_id);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !projectId) return;
    create.mutate({ project_id: projectId, title: title.trim(), description: description || undefined, type, priority, severity: severity || undefined, source: "web" });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-xl">
      <div>
        <label className="block text-sm font-medium mb-1">Project *</label>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} required className="w-full border border-gray-200 dark:border-gray-700 rounded-md px-3 py-2 text-sm bg-white dark:bg-gray-900">
          <option value="">Select project…</option>
          {projects?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Title *</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={255}
          placeholder="Short, descriptive title"
          className="w-full border border-gray-200 dark:border-gray-700 rounded-md px-3 py-2 text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {/* Duplicate detection panel */}
        {similar && similar.length > 0 && (
          <div className="mt-2 p-3 bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded-md">
            <p className="text-xs font-medium text-yellow-700 dark:text-yellow-300 mb-2">Similar tickets found — is this a duplicate?</p>
            <div className="space-y-1">
              {similar.slice(0, 3).map((s) => (
                <a key={s.id} href={`/tickets/${s.short_id}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-xs hover:underline text-yellow-800 dark:text-yellow-200">
                  <span className="font-mono text-gray-500">{s.short_id}</span>
                  <span className="flex-1 truncate">{s.title}</span>
                  <span className="text-gray-400">{s.status}</span>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">Type</label>
          <select value={type} onChange={(e) => setType(e.target.value)} className="w-full border border-gray-200 dark:border-gray-700 rounded-md px-3 py-2 text-sm bg-white dark:bg-gray-900">
            {["bug", "feature", "question", "incident", "improvement", "task"].map((t) => (
              <option key={t} value={t}>{TYPE_ICONS[t]} {t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Priority</label>
          <select value={priority} onChange={(e) => setPriority(e.target.value)} className="w-full border border-gray-200 dark:border-gray-700 rounded-md px-3 py-2 text-sm bg-white dark:bg-gray-900">
            {["none", "low", "medium", "high", "critical"].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Severity</label>
        <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="w-full border border-gray-200 dark:border-gray-700 rounded-md px-3 py-2 text-sm bg-white dark:bg-gray-900">
          <option value="">None</option>
          {["minor", "moderate", "major", "critical", "blocker"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={5}
          placeholder="Describe the issue in detail (markdown supported)"
          className="w-full border border-gray-200 dark:border-gray-700 rounded-md px-3 py-2 text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
        />
      </div>

      <button
        type="submit"
        disabled={create.isPending || !title.trim() || !projectId}
        className="bg-blue-600 text-white px-6 py-2 rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
      >
        {create.isPending ? "Creating…" : "Create Ticket"}
      </button>

      {create.isError && (
        <p className="text-sm text-red-500">{create.error instanceof Error ? create.error.message : "Failed to create ticket"}</p>
      )}
    </form>
  );
}
