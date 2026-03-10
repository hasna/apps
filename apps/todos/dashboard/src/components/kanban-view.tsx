import * as React from "react";
import {
  PlayIcon,
  CheckCircleIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  ArrowUpDownIcon,
  GripVerticalIcon,
  LayoutListIcon,
  ListIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import type { TaskSummary } from "@/types";

// ── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const s = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const priorityColors: Record<string, { border: string; dot: string; label: string }> = {
  critical: { border: "border-l-red-500", dot: "bg-red-500", label: "Critical" },
  high: { border: "border-l-orange-500", dot: "bg-orange-500", label: "High" },
  medium: { border: "border-l-blue-500", dot: "bg-blue-500", label: "Medium" },
  low: { border: "border-l-gray-400", dot: "bg-gray-400", label: "Low" },
};

const COLUMN_COLORS: Record<string, { text: string; bg: string }> = {
  pending: { text: "text-yellow-500", bg: "bg-yellow-500" },
  in_progress: { text: "text-blue-500", bg: "bg-blue-500" },
  completed: { text: "text-green-500", bg: "bg-green-500" },
  failed: { text: "text-red-500", bg: "bg-red-500" },
  cancelled: { text: "text-gray-400", bg: "bg-gray-400" },
};

const AVATAR_COLORS = [
  "bg-blue-500", "bg-green-500", "bg-purple-500", "bg-orange-500",
  "bg-pink-500", "bg-teal-500", "bg-indigo-500", "bg-red-500",
];

function avatarColor(name: string): string {
  let hash = 0;
  for (const c of name) hash = ((hash << 5) - hash + c.charCodeAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]!;
}

function AgentAvatar({ name }: { name: string }) {
  return (
    <span className={`inline-flex size-5 items-center justify-center rounded-full text-[10px] font-bold text-white ${avatarColor(name)}`}
      title={name}>
      {name[0]!.toUpperCase()}
    </span>
  );
}

type SortField = "priority" | "updated" | "created";

function sortTasks(tasks: TaskSummary[], field: SortField): TaskSummary[] {
  const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return [...tasks].sort((a, b) => {
    if (field === "priority") return (priorityOrder[a.priority] ?? 4) - (priorityOrder[b.priority] ?? 4);
    if (field === "updated") return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    if (field === "created") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    return 0;
  });
}

// ── Card ────────────────────────────────────────────────────────────────────

interface KanbanCardProps {
  task: TaskSummary;
  projectMap: Map<string, string>;
  compact: boolean;
  onStart: (id: string) => void;
  onComplete: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (task: TaskSummary) => void;
  onSelect: (task: TaskSummary) => void;
  onDragStart: (e: React.DragEvent, task: TaskSummary) => void;
}

function KanbanCard({
  task, projectMap, compact, onStart, onComplete, onDelete, onEdit, onSelect, onDragStart,
}: KanbanCardProps) {
  const [hovered, setHovered] = React.useState(false);
  const projectName = task.project_id ? projectMap.get(task.project_id) : null;
  const p = priorityColors[task.priority] || priorityColors.medium!;
  const assignee = task.assigned_to || task.agent_id;

  if (compact) {
    return (
      <div
        draggable
        onDragStart={(e) => onDragStart(e, task)}
        onClick={() => onSelect(task)}
        className={`flex items-center gap-2 rounded-md border border-l-4 ${p.border} px-2 py-1.5 cursor-pointer hover:bg-accent/50 transition-colors`}
      >
        <span className={`size-2 rounded-full shrink-0 ${p.dot}`} />
        <span className="text-sm truncate flex-1">{task.title}</span>
        {assignee && <AgentAvatar name={assignee} />}
        <span className="text-sm text-muted-foreground shrink-0">{timeAgo(task.updated_at)}</span>
      </div>
    );
  }

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, task)}
      onClick={() => onSelect(task)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`rounded-lg border border-l-4 ${p.border} bg-card p-3 cursor-pointer hover:bg-accent/50 transition-colors relative`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-1">
            <span className={`size-2 rounded-full shrink-0 ${p.dot}`} title={p.label} />
            <code className="text-sm text-muted-foreground">{task.short_id || task.id.slice(0, 8)}</code>
          </div>
          <p className="text-sm font-medium leading-tight line-clamp-2">{task.title}</p>

          {/* Hover preview of description */}
          {hovered && task.description && (
            <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{task.description}</p>
          )}
        </div>
        <div onClick={(e) => e.stopPropagation()} className="shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-6">
                <MoreHorizontalIcon className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(task)}>
                <PencilIcon className="size-3.5 mr-2" /> Edit
              </DropdownMenuItem>
              {task.status === "pending" && (
                <DropdownMenuItem onClick={() => onStart(task.id)}>
                  <PlayIcon className="size-3.5 mr-2" /> Start
                </DropdownMenuItem>
              )}
              {task.status === "in_progress" && (
                <DropdownMenuItem onClick={() => onComplete(task.id)}>
                  <CheckCircleIcon className="size-3.5 mr-2" /> Complete
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-red-500 focus:text-red-500" onClick={() => onDelete(task.id)}>
                <Trash2Icon className="size-3.5 mr-2" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Bottom row: project, assignee, inline actions, time */}
      <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
        {projectName && (
          <Badge variant="outline" className="text-sm px-1.5 py-0">{projectName}</Badge>
        )}
        <div className="flex-1" />

        {/* Inline quick actions */}
        <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-0.5">
          {task.status === "pending" && (
            <Button variant="ghost" size="icon" className="size-5" title="Start" onClick={() => onStart(task.id)}>
              <PlayIcon className="size-3 text-blue-500" />
            </Button>
          )}
          {task.status === "in_progress" && (
            <Button variant="ghost" size="icon" className="size-5" title="Complete" onClick={() => onComplete(task.id)}>
              <CheckCircleIcon className="size-3 text-green-500" />
            </Button>
          )}
        </div>

        {assignee && <AgentAvatar name={assignee} />}
        <span>{timeAgo(task.updated_at)}</span>
      </div>
    </div>
  );
}

// ── Column ──────────────────────────────────────────────────────────────────

interface KanbanColumnProps {
  status: string;
  label: string;
  tasks: TaskSummary[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  sortField: SortField;
  onSortChange: (field: SortField) => void;
  showLimit: number;
  onShowMore: () => void;
  compact: boolean;
  projectMap: Map<string, string>;
  onStart: (id: string) => void;
  onComplete: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (task: TaskSummary) => void;
  onSelect: (task: TaskSummary) => void;
  onDragStart: (e: React.DragEvent, task: TaskSummary) => void;
  onDrop: (status: string) => void;
  onDragOver: (e: React.DragEvent) => void;
}

function KanbanColumn({
  status, label, tasks, collapsed, onToggleCollapse, sortField, onSortChange,
  showLimit, onShowMore, compact, projectMap,
  onStart, onComplete, onDelete, onEdit, onSelect, onDragStart, onDrop, onDragOver,
}: KanbanColumnProps) {
  const colors = COLUMN_COLORS[status] || COLUMN_COLORS.pending!;
  const sorted = sortTasks(tasks, sortField);
  const visible = sorted.slice(0, showLimit);
  const remaining = sorted.length - visible.length;

  return (
    <div
      className="flex flex-col"
      onDragOver={onDragOver}
      onDrop={() => onDrop(status)}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 mb-3">
        <Button variant="ghost" size="icon" className="size-5" onClick={onToggleCollapse}>
          {collapsed ? <ChevronRightIcon className="size-3.5" /> : <ChevronDownIcon className="size-3.5" />}
        </Button>
        <span className={`size-2.5 rounded-full ${colors.bg}`} />
        <h3 className={`text-sm font-semibold ${colors.text}`}>{label}</h3>
        <Badge variant="secondary" className="text-sm px-1.5 py-0 ml-auto">{tasks.length}</Badge>
        {!collapsed && (
          <div onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-5">
                  <ArrowUpDownIcon className="size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onSortChange("priority")}>
                  {sortField === "priority" && "• "}Priority
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onSortChange("updated")}>
                  {sortField === "updated" && "• "}Updated
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onSortChange("created")}>
                  {sortField === "created" && "• "}Created
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {/* Cards */}
      {!collapsed && (
        <div className="space-y-2 min-h-[100px]">
          {visible.length === 0 ? (
            <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              No tasks
            </div>
          ) : (
            visible.map((task) => (
              <KanbanCard
                key={task.id}
                task={task}
                projectMap={projectMap}
                compact={compact}
                onStart={onStart}
                onComplete={onComplete}
                onDelete={onDelete}
                onEdit={onEdit}
                onSelect={onSelect}
                onDragStart={onDragStart}
              />
            ))
          )}
          {remaining > 0 && (
            <Button variant="ghost" size="sm" className="w-full text-sm text-muted-foreground" onClick={onShowMore}>
              Show {Math.min(remaining, 20)} more ({remaining} remaining)
            </Button>
          )}
        </div>
      )}

      {collapsed && (
        <div className="text-sm text-muted-foreground text-center py-2 border border-dashed rounded-lg">
          {tasks.length} task(s)
        </div>
      )}
    </div>
  );
}

// ── Main Kanban View ────────────────────────────────────────────────────────

interface KanbanViewProps {
  data: TaskSummary[];
  projectMap: Map<string, string>;
  onStart: (id: string) => void;
  onComplete: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (task: TaskSummary) => void;
  onSelect: (task: TaskSummary) => void;
  onStatusChange?: (taskId: string, newStatus: string) => void;
}

const ALL_COLUMNS = [
  { key: "pending", label: "Pending" },
  { key: "in_progress", label: "In Progress" },
  { key: "completed", label: "Completed" },
  { key: "failed", label: "Failed" },
  { key: "cancelled", label: "Cancelled" },
];

export function KanbanView({
  data, projectMap, onStart, onComplete, onDelete, onEdit, onSelect, onStatusChange,
}: KanbanViewProps) {
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({ completed: true, cancelled: true });
  const [sortFields, setSortFields] = React.useState<Record<string, SortField>>({});
  const [showLimits, setShowLimits] = React.useState<Record<string, number>>({});
  const [compact, setCompact] = React.useState(false);
  const [showCancelled, setShowCancelled] = React.useState(false);
  const [priorityFilter, setPriorityFilter] = React.useState("all");
  const [groupByProject, setGroupByProject] = React.useState(false);
  const [draggedTask, setDraggedTask] = React.useState<TaskSummary | null>(null);
  const [dragOverColumn, setDragOverColumn] = React.useState<string | null>(null);

  const DEFAULT_LIMIT = 15;

  // Filter by priority
  const filteredData = React.useMemo(() => {
    if (priorityFilter === "all") return data;
    return data.filter((t) => t.priority === priorityFilter);
  }, [data, priorityFilter]);

  const visibleColumns = showCancelled ? ALL_COLUMNS : ALL_COLUMNS.filter((c) => c.key !== "cancelled");

  function handleDragStart(e: React.DragEvent, task: TaskSummary) {
    setDraggedTask(task);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", task.id);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function handleDrop(targetStatus: string) {
    if (!draggedTask || draggedTask.status === targetStatus) {
      setDraggedTask(null);
      setDragOverColumn(null);
      return;
    }

    // Use status change callback if provided, otherwise use start/complete
    if (onStatusChange) {
      onStatusChange(draggedTask.id, targetStatus);
    } else {
      // Use available actions
      if (targetStatus === "in_progress" && draggedTask.status === "pending") {
        onStart(draggedTask.id);
      } else if (targetStatus === "completed" && draggedTask.status === "in_progress") {
        onComplete(draggedTask.id);
      }
    }

    setDraggedTask(null);
    setDragOverColumn(null);
  }

  function toggleCollapse(status: string) {
    setCollapsed((prev) => ({ ...prev, [status]: !prev[status] }));
  }

  function setSortField(status: string, field: SortField) {
    setSortFields((prev) => ({ ...prev, [status]: field }));
  }

  function showMore(status: string) {
    setShowLimits((prev) => ({ ...prev, [status]: (prev[status] || DEFAULT_LIMIT) + 20 }));
  }

  // ── Group by project ──
  if (groupByProject) {
    const projectIds = [...new Set(filteredData.map((t) => t.project_id || "__none__"))];
    const groups = projectIds.map((pid) => ({
      id: pid,
      name: pid === "__none__" ? "No Project" : (projectMap.get(pid) || pid.slice(0, 8)),
      tasks: filteredData.filter((t) => (t.project_id || "__none__") === pid),
    }));
    groups.sort((a, b) => b.tasks.length - a.tasks.length);

    return (
      <div className="space-y-6">
        <KanbanToolbar
          compact={compact} onCompactChange={setCompact}
          showCancelled={showCancelled} onShowCancelledChange={setShowCancelled}
          priorityFilter={priorityFilter} onPriorityFilterChange={setPriorityFilter}
          groupByProject={groupByProject} onGroupByProjectChange={setGroupByProject}
        />
        {groups.map((group) => (
          <div key={group.id}>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <span className="size-3 rounded bg-muted" />
              {group.name}
              <Badge variant="secondary" className="text-sm">{group.tasks.length}</Badge>
            </h3>
            <div className={`grid gap-4 ${visibleColumns.length <= 4 ? "grid-cols-4" : "grid-cols-5"}`}>
              {visibleColumns.map((col) => {
                const colKey = `${group.id}_${col.key}`;
                return (
                  <KanbanColumn
                    key={colKey}
                    status={col.key}
                    label={col.label}
                    tasks={group.tasks.filter((t) => t.status === col.key)}
                    collapsed={!!collapsed[colKey]}
                    onToggleCollapse={() => setCollapsed((p) => ({ ...p, [colKey]: !p[colKey] }))}
                    sortField={sortFields[colKey] || "priority"}
                    onSortChange={(f) => setSortField(colKey, f)}
                    showLimit={showLimits[colKey] || DEFAULT_LIMIT}
                    onShowMore={() => showMore(colKey)}
                    compact={compact}
                    projectMap={projectMap}
                    onStart={onStart} onComplete={onComplete} onDelete={onDelete}
                    onEdit={onEdit} onSelect={onSelect}
                    onDragStart={handleDragStart} onDrop={handleDrop} onDragOver={handleDragOver}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ── Standard view ──
  return (
    <div className="space-y-4">
      <KanbanToolbar
        compact={compact} onCompactChange={setCompact}
        showCancelled={showCancelled} onShowCancelledChange={setShowCancelled}
        priorityFilter={priorityFilter} onPriorityFilterChange={setPriorityFilter}
        groupByProject={groupByProject} onGroupByProjectChange={setGroupByProject}
      />
      <div className={`grid gap-4 ${visibleColumns.length <= 4 ? "grid-cols-4" : "grid-cols-5"}`}>
        {visibleColumns.map((col) => (
          <KanbanColumn
            key={col.key}
            status={col.key}
            label={col.label}
            tasks={filteredData.filter((t) => t.status === col.key)}
            collapsed={!!collapsed[col.key]}
            onToggleCollapse={() => toggleCollapse(col.key)}
            sortField={sortFields[col.key] || "priority"}
            onSortChange={(f) => setSortField(col.key, f)}
            showLimit={showLimits[col.key] || DEFAULT_LIMIT}
            onShowMore={() => showMore(col.key)}
            compact={compact}
            projectMap={projectMap}
            onStart={onStart} onComplete={onComplete} onDelete={onDelete}
            onEdit={onEdit} onSelect={onSelect}
            onDragStart={handleDragStart} onDrop={handleDrop} onDragOver={handleDragOver}
          />
        ))}
      </div>
    </div>
  );
}

// ── Toolbar ─────────────────────────────────────────────────────────────────

function KanbanToolbar({
  compact, onCompactChange,
  showCancelled, onShowCancelledChange,
  priorityFilter, onPriorityFilterChange,
  groupByProject, onGroupByProjectChange,
}: {
  compact: boolean; onCompactChange: (v: boolean) => void;
  showCancelled: boolean; onShowCancelledChange: (v: boolean) => void;
  priorityFilter: string; onPriorityFilterChange: (v: string) => void;
  groupByProject: boolean; onGroupByProjectChange: (v: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={priorityFilter} onValueChange={onPriorityFilterChange}>
        <SelectTrigger className="w-[130px] h-8">
          <SelectValue placeholder="Priority" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Priorities</SelectItem>
          <SelectItem value="critical">Critical</SelectItem>
          <SelectItem value="high">High</SelectItem>
          <SelectItem value="medium">Medium</SelectItem>
          <SelectItem value="low">Low</SelectItem>
        </SelectContent>
      </Select>

      <Button variant={groupByProject ? "secondary" : "outline"} size="sm" className="h-8 text-sm"
        onClick={() => onGroupByProjectChange(!groupByProject)}>
        Group by Project
      </Button>

      <Button variant={showCancelled ? "secondary" : "outline"} size="sm" className="h-8 text-sm"
        onClick={() => onShowCancelledChange(!showCancelled)}>
        Cancelled
      </Button>

      <div className="ml-auto flex items-center border rounded-md">
        <Button variant={!compact ? "secondary" : "ghost"} size="icon" className="size-7 rounded-r-none"
          onClick={() => onCompactChange(false)} title="Detailed cards">
          <LayoutListIcon className="size-3.5" />
        </Button>
        <Button variant={compact ? "secondary" : "ghost"} size="icon" className="size-7 rounded-l-none"
          onClick={() => onCompactChange(true)} title="Compact cards">
          <ListIcon className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
