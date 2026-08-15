import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, PRIORITY_COLORS, TYPE_ICONS } from "../lib.ts";
import type { Ticket } from "../../../src/types/index.ts";

const COLUMNS: { status: string; label: string }[] = [
  { status: "open", label: "Open" },
  { status: "in_progress", label: "In Progress" },
  { status: "in_review", label: "In Review" },
  { status: "resolved", label: "Resolved" },
  { status: "closed", label: "Closed" },
];

interface TicketList { tickets: Ticket[]; total: number }

function TicketCard({ ticket, onDragStart }: { ticket: Ticket; onDragStart: (id: string) => void }) {
  return (
    <a
      href={`/tickets/${ticket.short_id}`}
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; onDragStart(ticket.id); }}
      className="block p-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm hover:shadow-md transition-shadow cursor-pointer group"
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <span className="text-xs font-mono text-gray-400">{ticket.short_id}</span>
        <span className="text-xs">{TYPE_ICONS[ticket.type] ?? "🎫"}</span>
      </div>
      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 line-clamp-2 mb-2">{ticket.title}</p>
      <div className="flex items-center gap-1.5">
        <span className={`text-xs font-medium capitalize ${PRIORITY_COLORS[ticket.priority] ?? ""}`}>
          {ticket.priority !== "none" ? ticket.priority : ""}
        </span>
        {ticket.labels.slice(0, 2).map((l) => (
          <span key={l} className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-1.5 py-0.5 rounded">
            {l}
          </span>
        ))}
        {ticket.sla_breached && (
          <span className="ml-auto text-xs text-red-500 font-medium">⚠ SLA</span>
        )}
      </div>
    </a>
  );
}

function KanbanColumn({
  status, label, tickets, total, onDrop,
}: {
  status: string; label: string; tickets: Ticket[]; total: number;
  onDrop: (ticketId: string, newStatus: string) => void;
}) {
  const [isDragOver, setIsDragOver] = useState(false);

  return (
    <div
      className={`flex flex-col min-h-96 w-56 shrink-0 rounded-lg border transition-colors ${
        isDragOver
          ? "border-blue-400 bg-blue-50 dark:bg-blue-950"
          : "border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900"
      }`}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        const id = e.dataTransfer.getData("ticketId");
        if (id) onDrop(id, status);
      }}
    >
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-200 dark:border-gray-800">
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{label}</span>
        <span className="text-xs text-gray-400 bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded-full">{total}</span>
      </div>
      <div className="flex flex-col gap-2 p-2 overflow-y-auto">
        {tickets.map((t) => (
          <TicketCard
            key={t.id}
            ticket={t}
            onDragStart={(id) => {
              // Store ticketId in dataTransfer for drop handler
              setTimeout(() => {
                const el = document.querySelector(`[data-ticket-id="${id}"]`);
                if (el) (el as HTMLElement).style.opacity = "0.5";
              }, 0);
            }}
          />
        ))}
        {tickets.length === 0 && (
          <div className="flex items-center justify-center py-8 text-xs text-gray-400">
            Drop tickets here
          </div>
        )}
      </div>
    </div>
  );
}

export default function KanbanBoard({ projectId }: { projectId?: string }) {
  const qc = useQueryClient();
  const [_draggingId, setDraggingId] = useState<string | null>(null);

  const queries = COLUMNS.map((col) => ({
    ...col,
    query: useQuery<TicketList>({
      queryKey: ["tickets", "kanban", col.status, projectId],
      queryFn: () => {
        const params = new URLSearchParams({ status: col.status, per_page: "50" });
        if (projectId) params.set("project_id", projectId);
        return apiFetch(`/tickets?${params}`);
      },
    }),
  }));

  const move = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiFetch<Ticket>(`/tickets/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tickets", "kanban"] });
    },
  });

  function handleDrop(ticketId: string, newStatus: string) {
    if (move.isPending) return;
    move.mutate({ id: ticketId, status: newStatus });
    setDraggingId(null);
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-4 px-1">
      {queries.map(({ status, label, query }) => (
        <KanbanColumn
          key={status}
          status={status}
          label={label}
          tickets={query.data?.tickets ?? []}
          total={query.data?.total ?? 0}
          onDrop={handleDrop}
        />
      ))}
    </div>
  );
}
