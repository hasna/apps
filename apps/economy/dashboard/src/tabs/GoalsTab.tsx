import { useEffect, useState, useRef, useCallback } from "react";
import { getGoals, createGoal, deleteGoalApi } from "../api";
import type { GoalStatus } from "../api";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DataTable, type DataTableColumn, type DataTableAction } from "@/components/data-table";

function ProgressBar({ percent }: { percent: number }) {
  const clamped = Math.min(100, percent);
  const color =
    percent > 100
      ? "bg-red-500"
      : percent >= 70
        ? "bg-yellow-500"
        : "bg-green-500";

  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden min-w-[80px]">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="text-xs font-medium text-muted-foreground min-w-[44px] text-right">
        {percent.toFixed(1)}%
      </span>
    </div>
  );
}

function StatusBadge({ goal }: { goal: GoalStatus }) {
  if (goal.is_over) {
    return (
      <span className="inline-flex items-center rounded-full bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 px-2 py-0.5 text-xs font-semibold uppercase">
        OVER
      </span>
    );
  }
  if (goal.is_at_risk) {
    return (
      <span className="inline-flex items-center rounded-full bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 px-2 py-0.5 text-xs font-semibold uppercase">
        AT RISK
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 px-2 py-0.5 text-xs font-semibold uppercase">
      ON TRACK
    </span>
  );
}

function scopeLabel(goal: GoalStatus): string {
  if (goal.agent && goal.project_path) return `${goal.project_path} / ${goal.agent}`;
  if (goal.agent) return goal.agent;
  if (goal.project_path) return goal.project_path;
  return "Global";
}

const columns: DataTableColumn<GoalStatus>[] = [
  {
    header: "Period",
    accessor: "period",
    sortable: true,
    render: (val) => (
      <span className="inline-flex items-center rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 px-2 py-0.5 text-xs font-medium uppercase">
        {val as string}
      </span>
    ),
  },
  {
    header: "Scope",
    accessor: "project_path",
    sortable: true,
    render: (_, row) => (
      <span className="font-medium">{scopeLabel(row)}</span>
    ),
  },
  {
    header: "Limit",
    accessor: "limit_usd",
    sortable: true,
    render: (val) => <span>${(val as number).toFixed(2)}</span>,
  },
  {
    header: "Spent",
    accessor: "current_spend_usd",
    sortable: true,
    render: (val) => (
      <span className="text-sm text-muted-foreground">${(val as number).toFixed(4)}</span>
    ),
  },
  {
    header: "Progress",
    accessor: "percent_used",
    sortable: true,
    render: (_, row) => <ProgressBar percent={row.percent_used} />,
  },
  {
    header: "Status",
    accessor: "is_on_track",
    sortable: false,
    render: (_, row) => <StatusBadge goal={row} />,
  },
];

function AddGoalDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState("month");
  const [limitUsd, setLimitUsd] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [agent, setAgent] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!limitUsd || isNaN(Number(limitUsd)) || Number(limitUsd) <= 0) {
      setFormError("Enter a valid limit amount");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await createGoal({
        period,
        limit_usd: Number(limitUsd),
        project_path: projectPath || undefined,
        agent: agent || undefined,
      });
      setLimitUsd("");
      setProjectPath("");
      setAgent("");
      setPeriod("month");
      setOpen(false);
      onCreated();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Failed to create goal");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <PlusIcon className="size-4" />
          Add Goal
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Spending Goal</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Period</label>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
              <option value="year">Year</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Limit (USD)</label>
            <Input
              type="number"
              step="0.01"
              min="0.01"
              placeholder="10.00"
              value={limitUsd}
              onChange={(e) => setLimitUsd(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Project Path <span className="text-muted-foreground/60">(optional)</span>
            </label>
            <Input
              type="text"
              placeholder="Leave blank for global goal"
              value={projectPath}
              onChange={(e) => setProjectPath(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Agent <span className="text-muted-foreground/60">(optional)</span>
            </label>
            <select
              value={agent}
              onChange={(e) => setAgent(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">All agents</option>
              <option value="claude">Claude</option>
              <option value="codex">Codex</option>
              <option value="gemini">Gemini</option>
            </select>
          </div>
          {formError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              {formError}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function GoalsTab() {
  const [goals, setGoals] = useState<GoalStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    getGoals()
      .then((r) => setGoals(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    intervalRef.current = setInterval(() => load(), 30000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [load]);

  const handleDelete = async (id: string) => {
    try {
      await deleteGoalApi(id);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const actions: DataTableAction<GoalStatus>[] = [
    {
      label: "Delete",
      icon: <Trash2Icon className="size-4" />,
      onClick: (row) => handleDelete(row.id),
    },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Spending Goals</CardTitle>
            <AddGoalDialog onCreated={load} />
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={goals}
            searchPlaceholder="Search goals..."
            actions={actions}
            getRowId={(row) => row.id}
            loading={loading}
            error={error}
            emptyMessage="No goals configured"
          />
        </CardContent>
      </Card>
    </div>
  );
}
