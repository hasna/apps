import { useQuery } from "@tanstack/react-query";
import { apiFetch, STATUS_COLORS, TYPE_ICONS } from "../lib.ts";
import type { Ticket } from "../../../src/types/index.ts";

interface TicketList { tickets: Ticket[]; total: number }

export default function OverviewPage() {
  const { data: recent } = useQuery<TicketList>({
    queryKey: ["tickets", "recent"],
    queryFn: () => apiFetch("/tickets?per_page=10&sort=created_at&order=desc"),
  });

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Overview</h1>

      <section className="mb-8">
        <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Recent Tickets</h2>
        <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
          {recent?.tickets.map((t) => (
            <a key={t.id} href={`/tickets/${t.short_id}`} className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0 border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors">
              <span className="text-lg">{TYPE_ICONS[t.type] ?? "🎫"}</span>
              <span className="flex-1 text-sm font-medium truncate">{t.title}</span>
              <span className="text-xs text-gray-500 font-mono">{t.short_id}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[t.status] ?? ""}`}>{t.status}</span>
            </a>
          )) ?? (
            <div className="px-4 py-8 text-center text-gray-400 text-sm">No tickets yet. <a href="/tickets" className="text-blue-500 underline">Create one</a>.</div>
          )}
        </div>
      </section>
    </div>
  );
}
