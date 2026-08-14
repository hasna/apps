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
  FolderIcon,
  ArrowLeftIcon,
  ArrowUpDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  SearchIcon,
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Project {
  id: string;
  name: string;
  path: string;
  description: string | null;
  task_list_id: string | null;
  task_prefix: string | null;
  task_counter: number;
  created_at: string;
  updated_at: string;
}

interface TaskData {
  id: string;
  short_id: string | null;
  title: string;
  status: string;
  priority: string;
  assigned_to: string | null;
  updated_at: string;
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

function statusColor(status: string): string {
  const map: Record<string, string> = {
    pending: "text-yellow-500",
    in_progress: "text-blue-500",
    completed: "text-green-500",
    failed: "text-red-500",
    cancelled: "text-muted-foreground",
  };
  return map[status] || "text-foreground";
}

// ── Create Project Dialog ───────────────────────────────────────────────────

function CreateProjectDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => void }) {
  const [name, setName] = React.useState("");
  const [path, setPath] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !path.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), path: path.trim(), description: description.trim() || undefined }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else { setName(""); setPath(""); setDescription(""); onOpenChange(false); onCreated(); }
    } catch { setError("Failed to create project"); }
    finally { setSubmitting(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Project</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name" className="h-9" autoFocus />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Path</label>
            <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/path/to/project" className="h-9" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Description</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional description" className="h-9" />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!name.trim() || !path.trim() || submitting}>
              {submitting ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Project Detail ──────────────────────────────────────────────────────────

function ProjectDetail({ project, onBack }: { project: Project; onBack: () => void }) {
  const [tasks, setTasks] = React.useState<TaskData[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    fetch(`/api/tasks?project_id=${project.id}`)
      .then((r) => r.json())
      .then(setTasks)
      .finally(() => setLoading(false));
  }, [project.id]);

  const statusCounts: Record<string, number> = {};
  for (const t of tasks) {
    statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
  }

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5 -ml-2">
        <ArrowLeftIcon className="size-3.5" /> Back to projects
      </Button>

      <Card className="shadow-none">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <FolderIcon className="size-5 text-purple-500" />
                {project.name}
              </CardTitle>
              <code className="text-sm text-muted-foreground mt-1 block">{project.path}</code>
            </div>
            {project.task_prefix && <Badge variant="outline">{project.task_prefix}</Badge>}
          </div>
          {project.description && <p className="text-sm text-muted-foreground mt-2">{project.description}</p>}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-5 gap-2 text-center">
            {["pending", "in_progress", "completed", "failed", "cancelled"].map((s) => (
              <div key={s} className="rounded-lg border p-2">
                <div className={`text-xl font-bold ${statusColor(s)}`}>{statusCounts[s] || 0}</div>
                <div className="text-sm text-muted-foreground capitalize">{s === "in_progress" ? "Active" : s}</div>
              </div>
            ))}
          </div>

          <div>
            <h3 className="text-sm font-medium mb-2">Tasks ({tasks.length})</h3>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tasks in this project.</p>
            ) : (
              <div className="space-y-1 max-h-[400px] overflow-y-auto">
                {tasks.map((t) => (
                  <div key={t.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50">
                    <span className={`size-2 rounded-full shrink-0 ${statusColor(t.status).replace("text-", "bg-")}`} />
                    <code className="text-sm text-muted-foreground shrink-0">{t.short_id || t.id.slice(0, 8)}</code>
                    <span className="truncate flex-1">{t.title}</span>
                    <span className="text-sm text-muted-foreground shrink-0">{t.assigned_to || "\u2014"}</span>
                    <span className="text-sm text-muted-foreground shrink-0">{timeAgo(t.updated_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Table Columns ───────────────────────────────────────────────────────────

interface ProjectTableMeta {
  onDelete: (id: string) => void;
}

function makeColumns(): ColumnDef<Project>[] {
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
          <FolderIcon className="size-4 text-purple-500 shrink-0" />
          <span className="font-medium text-sm">{row.original.name}</span>
        </div>
      ),
    },
    {
      accessorKey: "path",
      header: "Path",
      cell: ({ row }) => (
        <code className="text-sm text-muted-foreground truncate max-w-[300px] block">{row.original.path}</code>
      ),
    },
    {
      accessorKey: "task_prefix",
      header: "Prefix",
      cell: ({ row }) =>
        row.original.task_prefix ? (
          <Badge variant="outline" className="text-sm">{row.original.task_prefix}</Badge>
        ) : (
          <span className="text-sm text-muted-foreground">{"\u2014"}</span>
        ),
    },
    {
      accessorKey: "task_counter",
      header: ({ column }) => (
        <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting()}>
          Tasks <ArrowUpDownIcon className="size-3" />
        </Button>
      ),
      cell: ({ row }) => <span className="text-sm">{row.original.task_counter}</span>,
    },
    {
      accessorKey: "task_list_id",
      header: "Task List",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground truncate max-w-[150px] block">
          {row.original.task_list_id || "\u2014"}
        </span>
      ),
    },
    {
      accessorKey: "created_at",
      header: ({ column }) => (
        <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting()}>
          Created <ArrowUpDownIcon className="size-3" />
        </Button>
      ),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground whitespace-nowrap">{timeAgo(row.original.created_at)}</span>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row, table }) => {
        const meta = table.options.meta as ProjectTableMeta | undefined;
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

// ── Projects Page ───────────────────────────────────────────────────────────

export function ProjectsPage() {
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [selectedProject, setSelectedProject] = React.useState<Project | null>(null);
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [rowSelection, setRowSelection] = React.useState<Record<string, boolean>>({});
  const [createOpen, setCreateOpen] = React.useState(false);
  const searchRef = React.useRef<HTMLInputElement>(null);

  const columns = React.useMemo(() => makeColumns(), []);

  function loadProjects() {
    fetch("/api/projects")
      .then((r) => r.json())
      .then(setProjects)
      .finally(() => setLoading(false));
  }

  React.useEffect(() => {
    loadProjects();
  }, []);

  React.useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "/" && !e.ctrlKey && !e.metaKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA") { e.preventDefault(); searchRef.current?.focus(); }
      }
      if (e.key === "Escape") {
        if (selectedProject) setSelectedProject(null);
        else { setGlobalFilter(""); searchRef.current?.blur(); }
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedProject]);

  async function handleDelete(id: string) {
    await fetch(`/api/projects/${id}`, { method: "DELETE" });
    setProjects((prev) => prev.filter((p) => p.id !== id));
  }

  async function handleBulkDelete(ids: string[]) {
    await Promise.all(ids.map((id) => fetch(`/api/projects/${id}`, { method: "DELETE" })));
    setProjects((prev) => prev.filter((p) => !ids.includes(p.id)));
    setRowSelection({});
  }

  const table = useReactTable({
    data: projects,
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
    meta: { onDelete: handleDelete } as ProjectTableMeta,
  });

  const selectedIds = Object.keys(rowSelection).filter((k) => rowSelection[k]);
  const hasSelection = selectedIds.length > 0;

  if (loading) {
    return <div className="text-center text-muted-foreground py-12">Loading projects...</div>;
  }

  if (selectedProject) {
    return <ProjectDetail project={selectedProject} onBack={() => setSelectedProject(null)} />;
  }

  if (projects.length === 0 && !createOpen) {
    return (
      <div className="text-center py-12">
        <FolderIcon className="mx-auto size-10 text-muted-foreground/50 mb-3" />
        <p className="text-muted-foreground">No projects registered.</p>
        <p className="text-sm text-muted-foreground mt-1">
          Projects are auto-created when you run <code className="bg-muted px-1.5 py-0.5 rounded text-sm">todos add</code> from a git repo.
        </p>
        <Button variant="outline" size="sm" className="mt-4 gap-1.5" onClick={() => setCreateOpen(true)}>
          <PlusIcon className="size-3.5" /> New Project
        </Button>
        <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={loadProjects} />
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
            placeholder="Search projects... (press /)"
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
        <span className="text-sm text-muted-foreground">{projects.length} project(s)</span>
        <div className="flex-1" />
        <Button variant="outline" size="sm" className="gap-1.5 h-9" onClick={() => setCreateOpen(true)}>
          <PlusIcon className="size-3.5" /> New Project
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
                  className="cursor-pointer"
                  data-state={row.getIsSelected() ? "selected" : undefined}
                  onClick={() => setSelectedProject(row.original)}
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
                  No projects found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{table.getFilteredRowModel().rows.length} project(s)</p>
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
      <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={loadProjects} />
    </div>
  );
}
