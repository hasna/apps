import * as React from "react";
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import {
  BotIcon,
  ArrowUpDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  SearchIcon,
  TrendingUpIcon,
  MoreHorizontalIcon,
  Trash2Icon,
  PlusIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Agent {
  id: string;
  name: string;
  description: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  last_seen_at: string;
}

interface TaskData {
  id: string;
  status: string;
  assigned_to: string | null;
  agent_id: string | null;
  created_at: string;
  completed_at: string | null;
}

interface AgentRow extends Agent {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  completionRate: number;
  avgWorkTime: number | null;
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

// ── Create Agent Dialog ─────────────────────────────────────────────────────

function CreateAgentDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => void }) {
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || undefined }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else { setName(""); setDescription(""); onOpenChange(false); onCreated(); }
    } catch { setError("Failed to register agent"); }
    finally { setSubmitting(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Agent</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Agent name" className="h-9" autoFocus />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Description</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional description" className="h-9" />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!name.trim() || submitting}>
              {submitting ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Table Columns ───────────────────────────────────────────────────────────

interface AgentTableMeta {
  onDelete: (id: string) => void;
}

function makeColumns(): ColumnDef<AgentRow>[] {
  return [
    {
      id: "select",
      header: ({ table }) => (
        <input
          type="checkbox"
          className="rounded"
          checked={table.getIsAllPageRowsSelected()}
          onChange={(e) => table.toggleAllPageRowsSelected(e.target.checked)}
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          className="rounded"
          checked={row.getIsSelected()}
          onChange={(e) => { e.stopPropagation(); row.toggleSelected(e.target.checked); }}
          onClick={(e) => e.stopPropagation()}
        />
      ),
      size: 30,
      enableSorting: false,
    },
    {
      accessorKey: "name",
      header: ({ column }) => (
        <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting()}>
          Name <ArrowUpDownIcon className="size-3" />
        </Button>
      ),
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <BotIcon className="size-4 text-orange-500 shrink-0" />
          <span className="font-medium text-sm">{row.original.name}</span>
        </div>
      ),
    },
    {
      accessorKey: "id",
      header: "ID",
      cell: ({ row }) => <code className="text-sm text-muted-foreground">{row.original.id}</code>,
    },
    {
      accessorKey: "description",
      header: "Description",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground truncate max-w-[250px] block">
          {row.original.description || "\u2014"}
        </span>
      ),
    },
    {
      accessorKey: "total",
      header: ({ column }) => (
        <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting()}>
          Tasks <ArrowUpDownIcon className="size-3" />
        </Button>
      ),
      cell: ({ row }) => {
        const { total, pending, inProgress, completed } = row.original;
        if (total === 0) return <span className="text-sm text-muted-foreground">0</span>;
        return (
          <div className="flex items-center gap-1.5 text-sm">
            <span className="font-medium">{total}</span>
            <span className="text-muted-foreground">
              (<span className="text-yellow-500">{pending}</span>
              /<span className="text-blue-500">{inProgress}</span>
              /<span className="text-green-500">{completed}</span>)
            </span>
          </div>
        );
      },
    },
    {
      accessorKey: "completionRate",
      header: ({ column }) => (
        <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting()}>
          Rate <ArrowUpDownIcon className="size-3" />
        </Button>
      ),
      cell: ({ row }) => {
        const rate = row.original.completionRate;
        if (row.original.total === 0) return <span className="text-sm text-muted-foreground">{"\u2014"}</span>;
        return (
          <Badge variant={rate >= 80 ? "default" : rate >= 50 ? "secondary" : "outline"} className="text-sm">
            {rate}%
          </Badge>
        );
      },
    },
    {
      accessorKey: "avgWorkTime",
      header: ({ column }) => (
        <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting()}>
          Avg Time <ArrowUpDownIcon className="size-3" />
        </Button>
      ),
      cell: ({ row }) => {
        const avg = row.original.avgWorkTime;
        if (avg === null) return <span className="text-sm text-muted-foreground">{"\u2014"}</span>;
        return (
          <span className="text-sm flex items-center gap-1">
            <TrendingUpIcon className="size-3 text-muted-foreground" />
            {formatDuration(avg)}
          </span>
        );
      },
      sortingFn: (rowA, rowB) => (rowA.original.avgWorkTime || 0) - (rowB.original.avgWorkTime || 0),
    },
    {
      accessorKey: "last_seen_at",
      header: ({ column }) => (
        <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting()}>
          Last Seen <ArrowUpDownIcon className="size-3" />
        </Button>
      ),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground whitespace-nowrap">{timeAgo(row.original.last_seen_at)}</span>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row, table }) => {
        const meta = table.options.meta as AgentTableMeta | undefined;
        return (
          <div onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-7">
                  <MoreHorizontalIcon className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuSeparator className="hidden" />
                <DropdownMenuItem
                  className="text-red-500 focus:text-red-500"
                  onClick={() => meta?.onDelete(row.original.id)}
                >
                  <Trash2Icon className="size-3.5 mr-2" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
      size: 50,
    },
  ];
}

// ── Agents Page ─────────────────────────────────────────────────────────────

export function AgentsPage() {
  const [agents, setAgents] = React.useState<Agent[]>([]);
  const [tasks, setTasks] = React.useState<TaskData[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [sorting, setSorting] = React.useState<SortingState>([{ id: "total", desc: true }]);
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [rowSelection, setRowSelection] = React.useState<Record<string, boolean>>({});
  const [createOpen, setCreateOpen] = React.useState(false);
  const searchRef = React.useRef<HTMLInputElement>(null);

  const columns = React.useMemo(() => makeColumns(), []);

  function loadData() {
    Promise.all([
      fetch("/api/agents").then((r) => r.json()),
      fetch("/api/tasks").then((r) => r.json()),
    ])
      .then(([agentsData, tasksData]) => {
        setAgents(agentsData);
        setTasks(tasksData);
      })
      .finally(() => setLoading(false));
  }

  React.useEffect(() => {
    loadData();
  }, []);

  React.useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "/" && !e.ctrlKey && !e.metaKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA") { e.preventDefault(); searchRef.current?.focus(); }
      }
      if (e.key === "Escape") {
        setGlobalFilter("");
        searchRef.current?.blur();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const agentRows: AgentRow[] = React.useMemo(() => {
    return agents.map((agent) => {
      const agentTasks = tasks.filter(
        (t) => t.assigned_to === agent.name || t.assigned_to === agent.id || t.agent_id === agent.id || t.agent_id === agent.name
      );
      const total = agentTasks.length;
      const pending = agentTasks.filter((t) => t.status === "pending").length;
      const inProgress = agentTasks.filter((t) => t.status === "in_progress").length;
      const completed = agentTasks.filter((t) => t.status === "completed").length;
      const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

      const completedTasks = agentTasks.filter((t) => t.status === "completed" && t.completed_at);
      let avgWorkTime: number | null = null;
      if (completedTasks.length > 0) {
        const durations = completedTasks.map((t) => {
          const end = new Date(t.completed_at!).getTime();
          const start = new Date(t.created_at).getTime();
          return end - start;
        }).filter((d) => d > 0);
        if (durations.length > 0) {
          avgWorkTime = durations.reduce((a, b) => a + b, 0) / durations.length;
        }
      }

      return { ...agent, total, pending, inProgress, completed, completionRate, avgWorkTime };
    });
  }, [agents, tasks]);

  async function handleDelete(id: string) {
    await fetch(`/api/agents/${id}`, { method: "DELETE" });
    setAgents((prev) => prev.filter((a) => a.id !== id));
  }

  async function handleBulkDelete(ids: string[]) {
    await Promise.all(ids.map((id) => fetch(`/api/agents/${id}`, { method: "DELETE" })));
    setAgents((prev) => prev.filter((a) => !ids.includes(a.id)));
    setRowSelection({});
  }

  const table = useReactTable({
    data: agentRows,
    columns,
    state: { sorting, globalFilter, rowSelection },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    enableRowSelection: true,
    getRowId: (row) => row.id,
    initialState: { pagination: { pageSize: 15 } },
    meta: { onDelete: handleDelete } as AgentTableMeta,
  });

  const selectedIds = Object.keys(rowSelection).filter((k) => rowSelection[k]);
  const hasSelection = selectedIds.length > 0;

  if (loading) {
    return <div className="text-center text-muted-foreground py-12">Loading agents...</div>;
  }

  if (agents.length === 0 && !createOpen) {
    return (
      <div className="text-center py-12">
        <BotIcon className="mx-auto size-10 text-muted-foreground/50 mb-3" />
        <p className="text-muted-foreground">No agents registered.</p>
        <p className="text-sm text-muted-foreground mt-1">
          Agents register via <code className="bg-muted px-1.5 py-0.5 rounded text-sm">register_agent</code> MCP tool or CLI.
        </p>
        <Button variant="outline" size="sm" className="mt-4 gap-1.5" onClick={() => setCreateOpen(true)}>
          <PlusIcon className="size-3.5" /> New Agent
        </Button>
        <CreateAgentDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={loadData} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <SearchIcon className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
          <Input
            ref={searchRef}
            placeholder="Search agents... (press /)"
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
        <span className="text-sm text-muted-foreground">{agents.length} agent(s)</span>
        <div className="flex-1" />
        <Button variant="outline" size="sm" className="gap-1.5 h-9" onClick={() => setCreateOpen(true)}>
          <PlusIcon className="size-3.5" /> New Agent
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() ? "selected" : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  No agents found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{table.getFilteredRowModel().rows.length} agent(s)</p>
        {table.getPageCount() > 1 && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
              <ChevronLeftIcon className="size-3.5" />
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
            </span>
            <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
              <ChevronRightIcon className="size-3.5" />
            </Button>
          </div>
        )}
      </div>

      {/* Floating bulk action bar */}
      {hasSelection && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-xl border bg-background px-5 py-3 shadow-xl">
          <span className="text-sm font-medium">{selectedIds.length} selected</span>
          <div className="h-4 w-px bg-border" />
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-sm text-red-500"
            onClick={() => handleBulkDelete(selectedIds)}
          >
            <Trash2Icon className="size-3" /> Delete
          </Button>
          <div className="h-4 w-px bg-border" />
          <Button variant="ghost" size="sm" className="h-7 text-sm" onClick={() => setRowSelection({})}>
            Clear
          </Button>
        </div>
      )}

      {/* Create Dialog */}
      <CreateAgentDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={loadData} />
    </div>
  );
}
