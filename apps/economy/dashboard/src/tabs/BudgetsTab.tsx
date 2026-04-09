import { useEffect, useState, useRef, useCallback } from "react";
import type { FormEvent } from "react";
import { getBudgets, createBudget, deleteBudget } from "../api";
import type { Budget } from "../api";
import { PlusIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable, type DataTableColumn, type DataTableAction } from "@/components/data-table";

function ProgressBar({ percent, isOver }: { percent: number; isOver: boolean }) {
  const clamped = Math.min(100, percent);
  const color =
    isOver || percent > 90
      ? "bg-red-500"
      : percent > 60
        ? "bg-yellow-500"
        : "bg-green-500";
  const textColor =
    isOver || percent > 90
      ? "text-red-600 dark:text-red-400"
      : percent > 60
        ? "text-yellow-600 dark:text-yellow-400"
        : "text-green-600 dark:text-green-400";

  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden min-w-[80px]">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className={`text-xs font-semibold min-w-[44px] text-right ${textColor}`}>
        {percent.toFixed(1)}%
      </span>
    </div>
  );
}

const columns: DataTableColumn<Budget>[] = [
  {
    header: "Project",
    accessor: "project_path",
    sortable: true,
    render: (val) => <span className="font-medium">{(val as string) || "Global"}</span>,
  },
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
    header: "Usage",
    accessor: "percent_used",
    sortable: true,
    render: (_, row) => <ProgressBar percent={row.percent_used} isOver={row.is_over_alert} />,
  },
  {
    header: "Spend",
    accessor: "current_spend_usd",
    sortable: true,
    render: (_, row) => (
      <span className="text-sm text-muted-foreground">
        ${row.current_spend_usd.toFixed(4)} / ${row.limit_usd.toFixed(2)}
      </span>
    ),
  },
];

export function BudgetsTab() {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [projectPath, setProjectPath] = useState("");
  const [period, setPeriod] = useState<Budget["period"]>("monthly");
  const [limitUsd, setLimitUsd] = useState("");
  const [alertAt, setAlertAt] = useState("80");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    getBudgets()
      .then((r) => setBudgets(r.data))
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
      await deleteBudget(id);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (!limitUsd || isNaN(Number(limitUsd))) {
      setFormError("Enter a valid limit amount");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await createBudget({
        project_path: projectPath || undefined,
        period,
        limit_usd: Number(limitUsd),
        alert_at_percent: Number(alertAt),
      });
      setProjectPath("");
      setLimitUsd("");
      load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Failed to create budget");
    } finally {
      setSaving(false);
    }
  };

  const actions: DataTableAction<Budget>[] = [
    {
      label: "Edit",
      icon: <PencilIcon className="size-4" />,
      onClick: (row) => {
        setProjectPath(row.project_path || "");
        setPeriod(row.period);
        setLimitUsd(String(row.limit_usd));
      },
    },
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
          <CardTitle className="text-sm">Active Budgets</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={budgets}
            searchPlaceholder="Search budgets..."
            actions={actions}
            getRowId={(row) => String(row.id)}
            loading={loading}
            error={error}
            emptyMessage="No budgets configured"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <PlusIcon className="size-4" />
            Add Budget
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5 lg:col-span-2">
                <label className="text-xs font-medium text-muted-foreground">
                  Project Path (optional)
                </label>
                <Input
                  type="text"
                  placeholder="Leave blank for global budget"
                  value={projectPath}
                  onChange={(e) => setProjectPath(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Period</label>
                <select
                  value={period}
                  onChange={(e) => setPeriod(e.target.value as Budget["period"])}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Limit (USD)</label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="10.00"
                  value={limitUsd}
                  onChange={(e) => setLimitUsd(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="max-w-xs space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Alert at %</label>
              <Input
                type="number"
                step="1"
                min="1"
                max="100"
                value={alertAt}
                onChange={(e) => setAlertAt(e.target.value)}
              />
            </div>
            {formError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                {formError}
              </div>
            )}
            <Button type="submit" disabled={saving}>
              {saving ? "Adding..." : "Add Budget"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
