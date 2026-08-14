import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { apiFetch, STATUS_COLORS, PRIORITY_COLORS, TYPE_ICONS } from "../lib.ts";
import type { Ticket, Comment, Activity } from "../../../src/types/index.ts";

export default function TicketDetailPage() {
  const { shortId } = useParams({ strict: false }) as { shortId: string };

  const { data: ticket, isLoading } = useQuery<Ticket>({
    queryKey: ["ticket", shortId],
    queryFn: () => apiFetch(`/tickets/${shortId}`),
  });

  const { data: comments } = useQuery<Comment[]>({
    queryKey: ["comments", shortId],
    queryFn: () => apiFetch(`/tickets/${shortId}/comments`),
    enabled: !!ticket,
  });

  const { data: activityData } = useQuery<{ activity: Activity[] }>({
    queryKey: ["activity", shortId],
    queryFn: () => apiFetch(`/tickets/${shortId}/activity`),
    enabled: !!ticket,
  });

  if (isLoading) return <div className="p-6 text-gray-400">Loading…</div>;
  if (!ticket) return <div className="p-6 text-red-500">Ticket not found</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-4">
        <a href="/tickets" className="text-sm text-gray-400 hover:text-gray-600">← Tickets</a>
      </div>

      <div className="flex items-start gap-4 mb-6">
        <span className="text-2xl">{TYPE_ICONS[ticket.type] ?? "🎫"}</span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{ticket.title}</h1>
          <div className="flex items-center gap-3 mt-2 text-sm">
            <span className="font-mono text-gray-500">{ticket.short_id}</span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[ticket.status] ?? ""}`}>{ticket.status}</span>
            <span className={`capitalize ${PRIORITY_COLORS[ticket.priority] ?? ""}`}>{ticket.priority} priority</span>
            <span className="text-gray-400">{new Date(ticket.created_at).toLocaleString()}</span>
          </div>
        </div>
      </div>

      {ticket.description && (
        <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg text-sm whitespace-pre-wrap">
          {ticket.description}
        </div>
      )}

      {/* Comments */}
      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-3">Comments ({comments?.length ?? 0})</h2>
        <div className="space-y-3">
          {comments?.map((c) => (
            <div key={c.id} className={`p-4 rounded-lg border text-sm ${c.is_internal ? "border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950" : "border-gray-200 dark:border-gray-800"}`}>
              {c.is_internal && <span className="text-xs text-yellow-600 font-medium mb-1 block">Internal note</span>}
              <p className="whitespace-pre-wrap">{c.content}</p>
              <span className="text-xs text-gray-400 mt-2 block">{new Date(c.created_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Activity */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Activity</h2>
        <div className="space-y-2">
          {activityData?.activity.map((a) => (
            <div key={a.id} className="flex items-center gap-2 text-xs text-gray-500 py-1 border-b border-gray-100 dark:border-gray-800 last:border-0">
              <span className="font-medium text-gray-700 dark:text-gray-300">{a.action}</span>
              {a.from_value && <><span>from</span><code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">{a.from_value}</code></>}
              {a.to_value && <><span>→</span><code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">{a.to_value}</code></>}
              <span className="ml-auto">{new Date(a.created_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
