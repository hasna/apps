import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch, STATUS_COLORS, PRIORITY_COLORS, TYPE_ICONS } from "../lib.ts";
import type { Ticket } from "../../../src/types/index.ts";

interface TicketList { tickets: Ticket[]; total: number }

export default function TicketsPage() {
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [page, setPage] = useState(1);

  const params = new URLSearchParams({ page: String(page), per_page: "25" });
  if (status) params.set("status", status);
  if (priority) params.set("priority", priority);

  const { data, isLoading } = useQuery<TicketList>({
    queryKey: ["tickets", status, priority, page],
    queryFn: () => apiFetch(`/tickets?${params}`),
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Tickets</h1>
        <a href="/tickets/new" className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700 transition-colors">
          New Ticket
        </a>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4">
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="border border-gray-200 dark:border-gray-700 rounded-md px-3 py-1.5 text-sm bg-white dark:bg-gray-900">
          <option value="">All statuses</option>
          {["open", "in_progress", "in_review", "resolved", "closed"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={priority} onChange={(e) => { setPriority(e.target.value); setPage(1); }} className="border border-gray-200 dark:border-gray-700 rounded-md px-3 py-1.5 text-sm bg-white dark:bg-gray-900">
          <option value="">All priorities</option>
          {["none", "low", "medium", "high", "critical"].map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-500">ID</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Title</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Type</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Priority</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Created</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} className="text-center py-8 text-gray-400">Loading…</td></tr>
            )}
            {data?.tickets.map((t) => (
              <tr key={t.id} className="border-b last:border-0 border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900 cursor-pointer" onClick={() => location.href = `/tickets/${t.short_id}`}>
                <td className="px-4 py-3 font-mono text-xs text-gray-500">{t.short_id}</td>
                <td className="px-4 py-3 font-medium">{t.title}</td>
                <td className="px-4 py-3">{TYPE_ICONS[t.type] ?? "🎫"} {t.type}</td>
                <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[t.status] ?? ""}`}>{t.status}</span></td>
                <td className={`px-4 py-3 capitalize ${PRIORITY_COLORS[t.priority] ?? ""}`}>{t.priority}</td>
                <td className="px-4 py-3 text-gray-400 text-xs">{new Date(t.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
            {!isLoading && data?.tickets.length === 0 && (
              <tr><td colSpan={6} className="text-center py-8 text-gray-400">No tickets found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data && data.total > 25 && (
        <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
          <span>Showing {(page - 1) * 25 + 1}–{Math.min(page * 25, data.total)} of {data.total}</span>
          <div className="flex gap-2">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 border rounded disabled:opacity-40">Previous</button>
            <button disabled={page * 25 >= data.total} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 border rounded disabled:opacity-40">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
