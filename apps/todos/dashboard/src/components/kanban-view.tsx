import * as React from "react";
import {
  PlayIcon,
  CheckCircleIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
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
import type { TaskSummary } from "@/types";

function timeAgo(dateStr: string): string {
  const s = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const priorityColors: Record<string, string> = {
  critical: "border-l-red-500",
  high: "border-l-orange-500",
  medium: "border-l-blue-500",
  low: "border-l-gray-400",
};

interface KanbanViewProps {
  data: TaskSummary[];
  projectMap: Map<string, string>;
  onStart: (id: string) => void;
  onComplete: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (task: TaskSummary) => void;
  onSelect: (task: TaskSummary) => void;
}

const KANBAN_COLUMNS: { key: string; label: string; color: string }[] = [
  { key: "pending", label: "Pending", color: "text-yellow-500" },
  { key: "in_progress", label: "In Progress", color: "text-blue-500" },
  { key: "completed", label: "Completed", color: "text-green-500" },
  { key: "failed", label: "Failed", color: "text-red-500" },
];

function KanbanCard({
  task,
  projectMap,
  onStart,
  onComplete,
  onDelete,
  onEdit,
  onSelect,
}: {
  task: TaskSummary;
  projectMap: Map<string, string>;
  onStart: (id: string) => void;
  onComplete: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (task: TaskSummary) => void;
  onSelect: (task: TaskSummary) => void;
}) {
  const projectName = task.project_id ? projectMap.get(task.project_id) : null;

  return (
    <div
      className={`rounded-lg border border-l-4 ${priorityColors[task.priority] || "border-l-gray-400"} bg-card p-3 cursor-pointer hover:bg-accent/50 transition-colors`}
      onClick={() => onSelect(task)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-tight line-clamp-2">{task.title}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <code className="text-sm text-muted-foreground">
              {task.short_id || task.id.slice(0, 8)}
            </code>
            {projectName && (
              <Badge variant="outline" className="text-sm">{projectName}</Badge>
            )}
          </div>
        </div>
        <div onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-6 shrink-0">
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
      <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
        {task.assigned_to && <span>{task.assigned_to}</span>}
        <span className="ml-auto">{timeAgo(task.updated_at)}</span>
      </div>
    </div>
  );
}

export function KanbanView({
  data,
  projectMap,
  onStart,
  onComplete,
  onDelete,
  onEdit,
  onSelect,
}: KanbanViewProps) {
  const columns = KANBAN_COLUMNS.map((col) => ({
    ...col,
    tasks: data.filter((t) => t.status === col.key),
  }));

  return (
    <div className="grid grid-cols-4 gap-4">
      {columns.map((col) => (
        <div key={col.key} className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className={`text-sm font-semibold ${col.color}`}>{col.label}</h3>
            <span className="text-sm text-muted-foreground">{col.tasks.length}</span>
          </div>
          <div className="space-y-2 min-h-[200px]">
            {col.tasks.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                No tasks
              </div>
            ) : (
              col.tasks.slice(0, 20).map((task) => (
                <KanbanCard
                  key={task.id}
                  task={task}
                  projectMap={projectMap}
                  onStart={onStart}
                  onComplete={onComplete}
                  onDelete={onDelete}
                  onEdit={onEdit}
                  onSelect={onSelect}
                />
              ))
            )}
            {col.tasks.length > 20 && (
              <p className="text-sm text-muted-foreground text-center">
                +{col.tasks.length - 20} more
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
