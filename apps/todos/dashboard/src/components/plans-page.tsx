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
  FileTextIcon,
  ArrowUpDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  SearchIcon,
  MoreHorizontalIcon,
  Trash2Icon,
  PlusIcon,
  PencilIcon,
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
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// ── Types ───────────────────────────────────────────────────────────────────

interface Plan {
  id: string;
  project_id: string | null;
  task_list_id: string | null;
  agent_id: string | null;
  name: string;
  description: string | null;
  status: "active" | "completed" | "archived";
  created_at: string;
  updated_at: string;
}

interface PlanTask {
  id: string;
  short_id: string | null;
  title: string;
  status: string;
  priority: string;
  assigned_to: string | null;
  updated_at: string;
}

interface PlanWithTasks extends Plan {
  tasks: PlanTask[];
}

interface ProjectOption {
  id: string;
  name: string;
}

interface AgentOption {
  id: string;
  name: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const seconds = Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / 1000
  );
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

function statusBadgeVariant(
  status: string
): "default" | "secondary" | "outline" {
  if (status === "active") return "default";
  if (status === "completed") return "secondary";
  return "outline";
}

function renderMarkdown(text: string): string {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  html = html.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_m, _lang, code) =>
      `<pre class="my-2 rounded bg-muted p-3 text-xs font-mono overflow-x-auto"><code>${code.trim()}</code></pre>`
  );
  html = html.replace(
    /`([^`]+)`/g,
    '<code class="rounded bg-muted px-1 py-0.5 text-xs font-mono">$1</code>'
  );
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(
    /(?<!\*)\*([^*]+)\*(?!\*)/g,
    "<em>$1</em>"
  );
  html = html.replace(
    /^### (.+)$/gm,
    '<h3 class="text-sm font-semibold mt-3 mb-1">$1</h3>'
  );
  html = html.replace(
    /^## (.+)$/gm,
    '<h2 class="text-base font-semibold mt-4 mb-1">$1</h2>'
  );
  html = html.replace(
    /^- (.+)$/gm,
    '<li class="ml-4 list-disc">$1</li>'
  );
  html = html.replace(
    /((?:<li[^>]*>.*<\/li>\n?)+)/g,
    '<ul class="my-1 space-y-0.5 text-sm">$1</ul>'
  );
  html = html.replace(
    /^\d+\. (.+)$/gm,
    '<li class="ml-4 list-decimal">$1</li>'
  );
  html = html.replace(/\n\n/g, '</p><p class="my-1.5">');
  html = html.replace(
    /(?<!<\/pre>|<\/li>|<\/ul>|<\/h[23]>)\n(?!<)/g,
    "<br>"
  );
  return `<p class="my-1.5">${html}</p>`;
}

// ── Create / Edit Plan Dialog ───────────────────────────────────────────────

function PlanFormDialog({
  open,
  onOpenChange,
  onSaved,
  projects,
  agents,
  editPlan,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
  projects: ProjectOption[];
  agents: AgentOption[];
  editPlan?: Plan | null;
}) {
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [status, setStatus] = React.useState<string>("active");
  const [projectId, setProjectId] = React.useState<string>("none");
  const [agentId, setAgentId] = React.useState<string>("none");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const isEdit = !!editPlan;

  React.useEffect(() => {
    if (editPlan) {
      setName(editPlan.name);
      setDescription(editPlan.description || "");
      setStatus(editPlan.status);
      setProjectId(editPlan.project_id || "none");
      setAgentId(editPlan.agent_id || "none");
    } else {
      setName("");
      setDescription("");
      setStatus("active");
      setProjectId("none");
      setAgentId("none");
    }
    setError(null);
  }, [editPlan, open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        status,
      };
      if (description.trim()) body.description = description.trim();
      if (projectId !== "none") body.project_id = projectId;
      if (agentId !== "none") body.agent_id = agentId;

      const url = isEdit ? `/api/plans/${editPlan.id}` : "/api/plans";
      const method = isEdit ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        onOpenChange(false);
        onSaved();
      }
    } catch {
      setError(isEdit ? "Failed to update plan" : "Failed to create plan");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Plan" : "New Plan"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Plan name"
              className="h-9"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Plan description (supports markdown)"
              rows={8}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-y font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Supports markdown: **bold**, *italic*, `code`, ```code blocks```,
              lists, headings
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Status</label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Project</label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="No project" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No project</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Owner (Agent)</label>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="No owner" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No owner</SelectItem>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || submitting}>
              {submitting
                ? isEdit
                  ? "Saving..."
                  : "Creating..."
                : isEdit
                  ? "Save"
                  : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Plan Detail Dialog ──────────────────────────────────────────────────────

function PlanDetailDialog({
  plan,
  open,
  onOpenChange,
  projects,
  agents,
}: {
  plan: Plan | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projects: ProjectOption[];
  agents: AgentOption[];
}) {
  const [planDetail, setPlanDetail] = React.useState<PlanWithTasks | null>(
    null
  );
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!plan || !open) {
      setPlanDetail(null);
      return;
    }
    setLoading(true);
    fetch(`/api/plans/${plan.id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data && data.id) {
          setPlanDetail(data);
        } else {
          // API may return plan without tasks array — normalize
          setPlanDetail({ ...plan, tasks: data.tasks || [] });
        }
      })
      .catch(() => setPlanDetail({ ...plan, tasks: [] }))
      .finally(() => setLoading(false));
  }, [plan, open]);

  const projectName = React.useMemo(() => {
    if (!plan?.project_id) return null;
    return projects.find((p) => p.id === plan.project_id)?.name || plan.project_id.slice(0, 8);
  }, [plan, projects]);

  const agentName = React.useMemo(() => {
    if (!plan?.agent_id) return null;
    return agents.find((a) => a.id === plan.agent_id)?.name || plan.agent_id.slice(0, 8);
  }, [plan, agents]);

  if (!plan) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileTextIcon className="size-5 text-blue-500" />
            {plan.name}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Status & metadata */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={statusBadgeVariant(plan.status)}>
              {plan.status}
            </Badge>
            {projectName && (
              <Badge variant="outline">{projectName}</Badge>
            )}
            {agentName && (
              <Badge variant="outline" className="text-xs">
                Owner: {agentName}
              </Badge>
            )}
          </div>

          {/* Description */}
          {plan.description && (
            <Card className="shadow-none">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Description</CardTitle>
              </CardHeader>
              <CardContent>
                <div
                  className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed"
                  dangerouslySetInnerHTML={{
                    __html: renderMarkdown(plan.description),
                  }}
                />
              </CardContent>
            </Card>
          )}

          {/* Metadata */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Task List</span>
              <p className="font-medium">
                {plan.task_list_id || "\u2014"}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Created</span>
              <p className="font-medium">
                {new Date(plan.created_at).toLocaleString()}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Updated</span>
              <p className="font-medium">
                {new Date(plan.updated_at).toLocaleString()}
              </p>
            </div>
          </div>

          {/* Tasks */}
          <div>
            <h3 className="text-sm font-medium mb-2">
              Tasks ({planDetail?.tasks?.length ?? 0})
            </h3>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading tasks...</p>
            ) : !planDetail?.tasks?.length ? (
              <p className="text-sm text-muted-foreground">
                No tasks in this plan.
              </p>
            ) : (
              <div className="space-y-1 max-h-[300px] overflow-y-auto">
                {planDetail.tasks.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
                  >
                    <span
                      className={`size-2 rounded-full shrink-0 ${statusColor(t.status).replace("text-", "bg-")}`}
                    />
                    <code className="text-sm text-muted-foreground shrink-0">
                      {t.short_id || t.id.slice(0, 8)}
                    </code>
                    <span className="truncate flex-1">{t.title}</span>
                    <Badge variant="outline" className="text-xs shrink-0">
                      {t.priority}
                    </Badge>
                    <span className="text-sm text-muted-foreground shrink-0">
                      {t.assigned_to || "\u2014"}
                    </span>
                    <span className="text-sm text-muted-foreground shrink-0">
                      {timeAgo(t.updated_at)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Table Columns ───────────────────────────────────────────────────────────

interface PlanTableMeta {
  onDelete: (id: string) => void;
  onEdit: (plan: Plan) => void;
  projects: ProjectOption[];
  agents: AgentOption[];
}

function makeColumns(): ColumnDef<Plan>[] {
  return [
    {
      id: "select",
      header: ({ table }) => (
        <input
          type="checkbox"
          className="rounded"
          checked={table.getIsAllPageRowsSelected()}
          onChange={(e) =>
            table.toggleAllPageRowsSelected(e.target.checked)
          }
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          className="rounded"
          checked={row.getIsSelected()}
          onChange={(e) => {
            e.stopPropagation();
            row.toggleSelected(e.target.checked);
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ),
      size: 30,
      enableSorting: false,
    },
    {
      accessorKey: "name",
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3"
          onClick={() => column.toggleSorting()}
        >
          Name <ArrowUpDownIcon className="size-3" />
        </Button>
      ),
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <FileTextIcon className="size-4 text-blue-500 shrink-0" />
          <span className="font-medium text-sm">{row.original.name}</span>
        </div>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <Badge variant={statusBadgeVariant(row.original.status)}>
          {row.original.status}
        </Badge>
      ),
      filterFn: (row, _id, filterValue) => {
        if (!filterValue || filterValue === "all") return true;
        return row.original.status === filterValue;
      },
    },
    {
      accessorKey: "agent_id",
      header: "Owner",
      cell: ({ row, table }) => {
        const meta = table.options.meta as PlanTableMeta | undefined;
        const agentId = row.original.agent_id;
        if (!agentId) return <span className="text-sm text-muted-foreground">{"\u2014"}</span>;
        const agent = meta?.agents?.find((a) => a.id === agentId);
        return (
          <span className="text-sm">{agent?.name || agentId.slice(0, 8)}</span>
        );
      },
    },
    {
      accessorKey: "project_id",
      header: "Project",
      cell: ({ row, table }) => {
        const meta = table.options.meta as PlanTableMeta | undefined;
        const projectId = row.original.project_id;
        if (!projectId) return <span className="text-sm text-muted-foreground">{"\u2014"}</span>;
        const project = meta?.projects?.find((p) => p.id === projectId);
        return (
          <span className="text-sm">
            {project?.name || projectId.slice(0, 8)}
          </span>
        );
      },
    },
    {
      accessorKey: "description",
      header: "Description",
      cell: ({ row }) => {
        const desc = row.original.description;
        if (!desc) return <span className="text-sm text-muted-foreground">{"\u2014"}</span>;
        const truncated = desc.length > 80 ? desc.slice(0, 80) + "..." : desc;
        return (
          <span className="text-sm text-muted-foreground truncate max-w-[250px] block">
            {truncated}
          </span>
        );
      },
    },
    {
      accessorKey: "created_at",
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3"
          onClick={() => column.toggleSorting()}
        >
          Created <ArrowUpDownIcon className="size-3" />
        </Button>
      ),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          {timeAgo(row.original.created_at)}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row, table }) => {
        const meta = table.options.meta as PlanTableMeta | undefined;
        return (
          <div onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-7">
                  <MoreHorizontalIcon className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => meta?.onEdit(row.original)}
                >
                  <PencilIcon className="size-3.5 mr-2" /> Edit
                </DropdownMenuItem>
                <DropdownMenuSeparator />
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

// ── Plans Page ──────────────────────────────────────────────────────────────

export function PlansPage() {
  const [plans, setPlans] = React.useState<Plan[]>([]);
  const [projects, setProjects] = React.useState<ProjectOption[]>([]);
  const [agents, setAgents] = React.useState<AgentOption[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<string>("all");
  const [rowSelection, setRowSelection] = React.useState<
    Record<string, boolean>
  >({});
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editPlan, setEditPlan] = React.useState<Plan | null>(null);
  const [detailPlan, setDetailPlan] = React.useState<Plan | null>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);

  const columns = React.useMemo(() => makeColumns(), []);

  function loadPlans() {
    fetch("/api/plans")
      .then((r) => r.json())
      .then(setPlans)
      .finally(() => setLoading(false));
  }

  function loadProjects() {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data: ProjectOption[]) => setProjects(data));
  }

  function loadAgents() {
    fetch("/api/agents")
      .then((r) => r.json())
      .then((data: AgentOption[]) => setAgents(data));
  }

  React.useEffect(() => {
    loadPlans();
    loadProjects();
    loadAgents();
  }, []);

  React.useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "/" && !e.ctrlKey && !e.metaKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA") {
          e.preventDefault();
          searchRef.current?.focus();
        }
      }
      if (e.key === "Escape") {
        if (detailPlan) setDetailPlan(null);
        else {
          setGlobalFilter("");
          searchRef.current?.blur();
        }
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [detailPlan]);

  async function handleDelete(id: string) {
    await fetch(`/api/plans/${id}`, { method: "DELETE" });
    setPlans((prev) => prev.filter((p) => p.id !== id));
  }

  async function handleBulkDelete(ids: string[]) {
    await Promise.all(
      ids.map((id) => fetch(`/api/plans/${id}`, { method: "DELETE" }))
    );
    setPlans((prev) => prev.filter((p) => !ids.includes(p.id)));
    setRowSelection({});
  }

  const table = useReactTable({
    data: plans,
    columns,
    state: {
      sorting,
      globalFilter,
      rowSelection,
      columnFilters:
        statusFilter !== "all"
          ? [{ id: "status", value: statusFilter }]
          : [],
    },
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
    meta: {
      onDelete: handleDelete,
      onEdit: (plan: Plan) => setEditPlan(plan),
      projects,
      agents,
    } as PlanTableMeta,
  });

  const selectedIds = Object.keys(rowSelection).filter(
    (k) => rowSelection[k]
  );
  const hasSelection = selectedIds.length > 0;

  if (loading) {
    return (
      <div className="text-center text-muted-foreground py-12">
        Loading plans...
      </div>
    );
  }

  if (plans.length === 0 && !createOpen) {
    return (
      <div className="text-center py-12">
        <FileTextIcon className="mx-auto size-10 text-muted-foreground/50 mb-3" />
        <p className="text-muted-foreground">No plans yet.</p>
        <p className="text-sm text-muted-foreground mt-1">
          Plans help you organize groups of tasks into execution phases.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4 gap-1.5"
          onClick={() => setCreateOpen(true)}
        >
          <PlusIcon className="size-3.5" /> New Plan
        </Button>
        <PlanFormDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onSaved={loadPlans}
          projects={projects}
          agents={agents}
        />
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
            placeholder="Search plans... (press /)"
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          {table.getFilteredRowModel().rows.length} plan(s)
        </span>
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 h-9"
          onClick={() => setCreateOpen(true)}
        >
          <PlusIcon className="size-3.5" /> New Plan
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
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
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
                  data-state={
                    row.getIsSelected() ? "selected" : undefined
                  }
                  onClick={() => setDetailPlan(row.original)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  No plans found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {table.getFilteredRowModel().rows.length} plan(s)
        </p>
        {table.getPageCount() > 1 && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <ChevronLeftIcon className="size-3.5" />
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {table.getState().pagination.pageIndex + 1} of{" "}
              {table.getPageCount()}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              <ChevronRightIcon className="size-3.5" />
            </Button>
          </div>
        )}
      </div>

      {/* Floating bulk action bar */}
      {hasSelection && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-xl border bg-background px-5 py-3 shadow-xl">
          <span className="text-sm font-medium">
            {selectedIds.length} selected
          </span>
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
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-sm"
            onClick={() => setRowSelection({})}
          >
            Clear
          </Button>
        </div>
      )}

      {/* Create Dialog */}
      <PlanFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={loadPlans}
        projects={projects}
        agents={agents}
      />

      {/* Edit Dialog */}
      <PlanFormDialog
        open={!!editPlan}
        onOpenChange={(o) => {
          if (!o) setEditPlan(null);
        }}
        onSaved={loadPlans}
        projects={projects}
        agents={agents}
        editPlan={editPlan}
      />

      {/* Detail Dialog */}
      <PlanDetailDialog
        plan={detailPlan}
        open={!!detailPlan}
        onOpenChange={(o) => {
          if (!o) setDetailPlan(null);
        }}
        projects={projects}
        agents={agents}
      />
    </div>
  );
}
