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
  type ColumnFiltersState,
} from "@tanstack/react-table";
import {
  ArrowUpDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  SearchIcon,
  PlayIcon,
  CheckCircleIcon,
  XIcon,
  ArrowLeftIcon,
  PencilIcon,
  ClockIcon,
  CalendarIcon,
  Trash2Icon,
  MoreHorizontalIcon,
  LayoutListIcon,
  LayoutGridIcon,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KanbanView } from "@/components/kanban-view";
import type { TaskSummary, ProjectSummary } from "@/types";

// ── Minimal Markdown renderer ──────────────────────────────────────────────

function renderMarkdown(text: string): string {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) =>
    `<pre class="my-2 rounded bg-muted p-3 text-xs font-mono overflow-x-auto"><code>${code.trim()}</code></pre>`
  );
  html = html.replace(/`([^`]+)`/g, '<code class="rounded bg-muted px-1 py-0.5 text-xs font-mono">$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
  html = html.replace(/^### (.+)$/gm, '<h3 class="text-sm font-semibold mt-3 mb-1">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 class="text-base font-semibold mt-4 mb-1">$1</h2>');
  html = html.replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>');
  html = html.replace(/((?:<li[^>]*>.*<\/li>\n?)+)/g, '<ul class="my-1 space-y-0.5 text-sm">$1</ul>');
  html = html.replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal">$1</li>');
  html = html.replace(/\n\n/g, '</p><p class="my-1.5">');
  html = html.replace(/(?<!<\/pre>|<\/li>|<\/ul>|<\/h[23]>)\n(?!<)/g, "<br>");
  return `<p class="my-1.5">${html}</p>`;
}

function Markdown({ content }: { content: string }) {
  return (
    <div
      className="prose prose-sm dark:prose-invert max-w-none text-sm text-foreground leading-relaxed"
      dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
    />
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: TaskSummary["status"] }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    pending: { label: "Pending", variant: "outline" },
    in_progress: { label: "In Progress", variant: "default" },
    completed: { label: "Completed", variant: "secondary" },
    failed: { label: "Failed", variant: "destructive" },
    cancelled: { label: "Cancelled", variant: "outline" },
  };
  const info = map[status] || { label: status, variant: "outline" as const };
  return <Badge variant={info.variant}>{info.label}</Badge>;
}

function PriorityBadge({ priority }: { priority: TaskSummary["priority"] }) {
  const colors: Record<string, string> = {
    critical: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    high: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
    medium: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    low: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[priority] || ""}`}>
      {priority}
    </span>
  );
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

function isOverdue(dueAt: string | null): boolean {
  if (!dueAt) return false;
  return new Date(dueAt).getTime() < Date.now();
}

// ── Task Detail View ────────────────────────────────────────────────────────

function TaskDetail({
  task, projectName, onBack, onStart, onComplete, onDelete, onEdit,
}: {
  task: TaskSummary; projectName: string | null;
  onBack: () => void; onStart: (id: string) => void; onComplete: (id: string) => void;
  onDelete: (id: string) => void; onEdit: (task: TaskSummary) => void;
}) {
  const createdAt = new Date(task.created_at).getTime();
  const completedAt = task.completed_at ? new Date(task.completed_at).getTime() : null;
  const totalDuration = (completedAt || Date.now()) - createdAt;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1.5 min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  {task.short_id || task.id.slice(0, 8)}
                </code>
                <StatusBadge status={task.status} />
                <PriorityBadge priority={task.priority} />
                {task.due_at && (
                  <span className={`inline-flex items-center gap-1 text-xs ${isOverdue(task.due_at) && task.status !== "completed" ? "text-red-500 font-medium" : "text-muted-foreground"}`}>
                    <CalendarIcon className="size-3" />
                    Due {new Date(task.due_at).toLocaleDateString()}
                  </span>
                )}
              </div>
              <CardTitle className="text-lg leading-tight">{task.title}</CardTitle>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button variant="outline" size="sm" onClick={() => onEdit(task)}>
                <PencilIcon className="size-3.5" /> Edit
              </Button>
              {task.status === "pending" && (
                <Button variant="outline" size="sm" onClick={() => onStart(task.id)}>
                  <PlayIcon className="size-3.5" /> Start
                </Button>
              )}
              {task.status === "in_progress" && (
                <Button variant="outline" size="sm" onClick={() => onComplete(task.id)}>
                  <CheckCircleIcon className="size-3.5" /> Complete
                </Button>
              )}
              <Button variant="outline" size="sm" className="text-red-500 hover:text-red-600" onClick={() => { onDelete(task.id); onBack(); }}>
                <XIcon className="size-3.5" /> Delete
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {task.description && (
            <div className="rounded-lg border bg-muted/30 p-4">
              <Markdown content={task.description} />
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs">
              <ClockIcon className="size-3 text-muted-foreground" />
              <span className="text-muted-foreground">Total:</span>
              <span className="font-medium">{formatDuration(totalDuration)}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
            <div>
              <span className="text-muted-foreground">Project:</span>{" "}
              <span className="font-medium">{projectName || "None"}</span>
            </div>
            {task.task_list_id && (
              <div>
                <span className="text-muted-foreground">Task List:</span>{" "}
                <span className="font-medium">{task.task_list_id}</span>
              </div>
            )}
            {task.assigned_to && <div><span className="text-muted-foreground">Assigned to:</span> <span className="font-medium">{task.assigned_to}</span></div>}
            {task.agent_id && <div><span className="text-muted-foreground">Agent:</span> <span className="font-medium">{task.agent_id}</span></div>}
            {task.locked_by && <div><span className="text-muted-foreground">Locked by:</span> <span className="font-medium">{task.locked_by}</span></div>}
            <div><span className="text-muted-foreground">Created:</span> <span>{timeAgo(task.created_at)}</span></div>
            <div><span className="text-muted-foreground">Updated:</span> <span>{timeAgo(task.updated_at)}</span></div>
            {task.completed_at && <div><span className="text-muted-foreground">Completed:</span> <span>{timeAgo(task.completed_at)}</span></div>}
            <div><span className="text-muted-foreground">Version:</span> <span>{task.version}</span></div>
          </div>
          {task.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {task.tags.map((tag) => <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>)}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Table columns ───────────────────────────────────────────────────────────

const columns: ColumnDef<TaskSummary>[] = [
  {
    id: "select",
    header: ({ table }) => (
      <input type="checkbox" className="rounded" checked={table.getIsAllPageRowsSelected()}
        onChange={(e) => table.toggleAllPageRowsSelected(e.target.checked)} />
    ),
    cell: ({ row }) => (
      <input type="checkbox" className="rounded" checked={row.getIsSelected()}
        onChange={(e) => { e.stopPropagation(); row.toggleSelected(e.target.checked); }}
        onClick={(e) => e.stopPropagation()} />
    ),
    size: 30, enableSorting: false,
  },
  {
    accessorKey: "short_id", header: "ID",
    cell: ({ row }) => <code className="text-xs text-muted-foreground">{row.original.short_id || row.original.id.slice(0, 8)}</code>,
    size: 100,
  },
  {
    accessorKey: "title",
    header: ({ column }) => (
      <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting()}>
        Title <ArrowUpDownIcon className="size-3" />
      </Button>
    ),
    cell: ({ row }) => (
      <div className="max-w-[400px]">
        <div className="font-medium truncate">{row.original.title}</div>
        {row.original.due_at && isOverdue(row.original.due_at) && row.original.status !== "completed" && (
          <span className="text-[10px] text-red-500 font-medium">Overdue</span>
        )}
      </div>
    ),
  },
  {
    accessorKey: "status", header: "Status",
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
    filterFn: (row, _id, filterValue) => {
      if (!filterValue || filterValue === "all") return true;
      return row.original.status === filterValue;
    },
  },
  {
    accessorKey: "priority",
    header: ({ column }) => (
      <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting()}>
        Priority <ArrowUpDownIcon className="size-3" />
      </Button>
    ),
    cell: ({ row }) => <PriorityBadge priority={row.original.priority} />,
    sortingFn: (rowA, rowB) => {
      const order = { critical: 0, high: 1, medium: 2, low: 3 };
      return (order[rowA.original.priority] ?? 4) - (order[rowB.original.priority] ?? 4);
    },
  },
  {
    accessorKey: "assigned_to", header: "Assigned",
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">{row.original.assigned_to || row.original.agent_id || "\u2014"}</span>
    ),
  },
  {
    accessorKey: "updated_at",
    header: ({ column }) => (
      <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting()}>
        Updated <ArrowUpDownIcon className="size-3" />
      </Button>
    ),
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground whitespace-nowrap">{timeAgo(row.original.updated_at)}</span>
    ),
  },
  {
    id: "actions", header: "",
    cell: ({ row, table }) => {
      const meta = table.options.meta as TableMeta | undefined;
      const task = row.original;
      return (
        <div onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7">
                <MoreHorizontalIcon className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => meta?.onEdit(task)}>
                <PencilIcon className="size-3.5 mr-2" /> Edit
              </DropdownMenuItem>
              {task.status === "pending" && (
                <DropdownMenuItem onClick={() => meta?.onStart(task.id)}>
                  <PlayIcon className="size-3.5 mr-2" /> Start
                </DropdownMenuItem>
              )}
              {task.status === "in_progress" && (
                <DropdownMenuItem onClick={() => meta?.onComplete(task.id)}>
                  <CheckCircleIcon className="size-3.5 mr-2" /> Complete
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-red-500 focus:text-red-500" onClick={() => meta?.onConfirmDelete(task.id)}>
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

interface TableMeta {
  onStart: (id: string) => void;
  onComplete: (id: string) => void;
  onDelete: (id: string) => void;
  onConfirmDelete: (id: string) => void;
  onEdit: (task: TaskSummary) => void;
}

interface TasksTableProps {
  data: TaskSummary[];
  projectMap: Map<string, string>;
  projects: ProjectSummary[];
  onStart: (id: string) => void;
  onComplete: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (task: TaskSummary) => void;
  onBulkAction: (ids: string[], action: "complete" | "start" | "delete") => void;
}

export function TasksTable({ data, projectMap, projects, onStart, onComplete, onDelete, onEdit, onBulkAction }: TasksTableProps) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [viewMode, setViewMode] = React.useState<"table" | "kanban">("table");
  const [selectedTask, setSelectedTask] = React.useState<TaskSummary | null>(null);
  const [deleteConfirm, setDeleteConfirm] = React.useState<string | null>(null);
  const [rowSelection, setRowSelection] = React.useState<Record<string, boolean>>({});
  const [projectFilter, setProjectFilter] = React.useState<string>("all");
  const searchRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "/" && !e.ctrlKey && !e.metaKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA") { e.preventDefault(); searchRef.current?.focus(); }
      }
      if (e.key === "Escape") {
        if (selectedTask) setSelectedTask(null);
        else { setGlobalFilter(""); searchRef.current?.blur(); }
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedTask]);

  React.useEffect(() => {
    if (selectedTask) {
      const updated = data.find((t) => t.id === selectedTask.id);
      if (updated) setSelectedTask(updated);
      else setSelectedTask(null);
    }
  }, [data, selectedTask?.id]);

  const filteredData = React.useMemo(() => {
    if (projectFilter === "all") return data;
    if (projectFilter === "none") return data.filter((t) => !t.project_id);
    return data.filter((t) => t.project_id === projectFilter);
  }, [data, projectFilter]);

  const statusCounts = React.useMemo(() => {
    const counts: Record<string, number> = { all: filteredData.length };
    for (const t of filteredData) counts[t.status] = (counts[t.status] || 0) + 1;
    return counts;
  }, [filteredData]);

  const columnsWithProject = React.useMemo(() => {
    const cols = [...columns];
    cols.splice(4, 0, {
      accessorKey: "project_id", header: "Project",
      cell: ({ row }: { row: { original: TaskSummary } }) => {
        const pid = row.original.project_id;
        if (!pid) return <span className="text-xs text-muted-foreground">{"\u2014"}</span>;
        return <span className="text-xs text-muted-foreground truncate max-w-[120px] block">{projectMap.get(pid) || pid.slice(0, 8)}</span>;
      },
    } as ColumnDef<TaskSummary>);
    return cols;
  }, [projectMap]);

  const table = useReactTable({
    data: filteredData, columns: columnsWithProject,
    state: { sorting, columnFilters, globalFilter, rowSelection },
    onSortingChange: setSorting, onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter, onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(), getPaginationRowModel: getPaginationRowModel(),
    enableRowSelection: true, getRowId: (row) => row.id,
    initialState: { pagination: { pageSize: 15 } },
    meta: { onStart, onComplete, onDelete, onConfirmDelete: confirmDelete, onEdit } as TableMeta,
  });

  const statusFilter = (table.getColumn("status")?.getFilterValue() as string) || "all";
  const selectedIds = Object.keys(rowSelection).filter((k) => rowSelection[k]);
  const hasSelection = selectedIds.length > 0;

  function confirmDelete(id: string) {
    setDeleteConfirm(id);
  }

  function executeDelete() {
    if (deleteConfirm) {
      onDelete(deleteConfirm);
      setDeleteConfirm(null);
      if (selectedTask?.id === deleteConfirm) setSelectedTask(null);
    }
  }

  return (
    <>
      <div className="space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <SearchIcon className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input ref={searchRef} placeholder="Search tasks... (press /)" value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)} className="pl-8 h-9" />
          </div>
          <Select value={projectFilter} onValueChange={setProjectFilter}>
            <SelectTrigger className="w-[160px] h-9">
              <SelectValue placeholder="All Projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Projects</SelectItem>
              <SelectItem value="none">No Project</SelectItem>
              {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(v) => table.getColumn("status")?.setFilterValue(v === "all" ? undefined : v)}>
            <SelectTrigger className="w-[160px] h-9">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              {["all", "pending", "in_progress", "completed", "failed", "cancelled"].map((s) => {
                const count = statusCounts[s] || 0;
                const label = s === "all" ? "All" : s === "in_progress" ? "In Progress" : s.charAt(0).toUpperCase() + s.slice(1);
                return <SelectItem key={s} value={s}>{label} ({count})</SelectItem>;
              })}
            </SelectContent>
          </Select>
          <div className="ml-auto flex items-center border rounded-md">
            <Button variant={viewMode === "table" ? "secondary" : "ghost"} size="icon" className="size-8 rounded-r-none"
              onClick={() => setViewMode("table")} title="Table view">
              <LayoutListIcon className="size-4" />
            </Button>
            <Button variant={viewMode === "kanban" ? "secondary" : "ghost"} size="icon" className="size-8 rounded-l-none"
              onClick={() => setViewMode("kanban")} title="Kanban view">
              <LayoutGridIcon className="size-4" />
            </Button>
          </div>
        </div>

        {/* Kanban View */}
        {viewMode === "kanban" && (
          <KanbanView
            data={table.getFilteredRowModel().rows.map(r => r.original)}
            projectMap={projectMap}
            onStart={onStart}
            onComplete={onComplete}
            onDelete={confirmDelete}
            onEdit={onEdit}
            onSelect={setSelectedTask}
          />
        )}

        {/* Table View */}
        {viewMode === "table" && <div className="rounded-md border">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id}>
                  {hg.headers.map((h) => (
                    <TableHead key={h.id}>{h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}</TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id} className="cursor-pointer" data-state={row.getIsSelected() ? "selected" : undefined}
                    onClick={() => setSelectedTask(row.original)}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={columnsWithProject.length} className="h-24 text-center text-muted-foreground">No tasks found.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>}

        {/* Pagination */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{table.getFilteredRowModel().rows.length} task(s)</p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
              <ChevronLeftIcon className="size-4" />
            </Button>
            <span className="text-sm text-muted-foreground">Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}</span>
            <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
              <ChevronRightIcon className="size-4" />
            </Button>
          </div>
        </div>

        {/* Floating bulk action bar */}
        {hasSelection && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-xl border bg-background px-5 py-3 shadow-xl">
            <span className="text-sm font-medium">{selectedIds.length} selected</span>
            <div className="h-4 w-px bg-border" />
            <Button variant="outline" size="sm" onClick={() => { onBulkAction(selectedIds, "start"); setRowSelection({}); }}>
              <PlayIcon className="size-4" /> Start
            </Button>
            <Button variant="outline" size="sm" onClick={() => { onBulkAction(selectedIds, "complete"); setRowSelection({}); }}>
              <CheckCircleIcon className="size-4" /> Complete
            </Button>
            <Button variant="outline" size="sm" className="text-red-500" onClick={() => { onBulkAction(selectedIds, "delete"); setRowSelection({}); }}>
              <Trash2Icon className="size-4" /> Delete
            </Button>
            <div className="h-4 w-px bg-border" />
            <Button variant="ghost" size="sm" onClick={() => setRowSelection({})}>Clear</Button>
          </div>
        )}
      </div>

      {/* Task Detail Dialog */}
      <Dialog open={!!selectedTask} onOpenChange={(open) => { if (!open) setSelectedTask(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {selectedTask && (
            <TaskDetail task={selectedTask}
              projectName={selectedTask.project_id ? (projectMap.get(selectedTask.project_id) || null) : null}
              onBack={() => setSelectedTask(null)} onStart={onStart} onComplete={onComplete}
              onDelete={(id) => { setSelectedTask(null); confirmDelete(id); }} onEdit={onEdit}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteConfirm} onOpenChange={(open) => { if (!open) setDeleteConfirm(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Task</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Are you sure you want to delete this task? This action cannot be undone.</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={executeDelete}>
              <Trash2Icon className="size-4" /> Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
