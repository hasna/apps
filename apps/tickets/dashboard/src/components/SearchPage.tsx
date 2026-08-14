import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch, STATUS_COLORS, TYPE_ICONS } from "../lib.ts";
import type { Ticket } from "../../../src/types/index.ts";

interface SearchResult { tickets: Ticket[]; total: number }

export default function SearchPage() {
  const [q, setQ] = useState("");
  const [submitted, setSubmitted] = useState("");

  const { data, isLoading } = useQuery<SearchResult>({
    queryKey: ["search", submitted],
    queryFn: () => apiFetch(`/tickets/search?q=${encodeURIComponent(submitted)}`),
    enabled: submitted.length > 0,
  });

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Search</h1>
      <form onSubmit={(e) => { e.preventDefault(); setSubmitted(q); }} className="flex gap-2 mb-6">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search tickets…"
          className="flex-1 border border-gray-200 dark:border-gray-700 rounded-md px-4 py-2 text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700">Search</button>
      </form>

      {isLoading && <div className="text-gray-400 text-sm">Searching…</div>}
      {data && (
        <div>
          <p className="text-sm text-gray-500 mb-3">{data.total} results for "{submitted}"</p>
          <div className="space-y-2">
            {data.tickets.map((t) => (
              <a key={t.id} href={`/tickets/${t.short_id}`} className="flex items-center gap-3 p-3 border border-gray-200 dark:border-gray-800 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors">
                <span>{TYPE_ICONS[t.type] ?? "🎫"}</span>
                <span className="flex-1 font-medium text-sm">{t.title}</span>
                <span className="font-mono text-xs text-gray-400">{t.short_id}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[t.status] ?? ""}`}>{t.status}</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
