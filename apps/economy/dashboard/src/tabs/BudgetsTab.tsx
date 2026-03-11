import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { getBudgets, createBudget, deleteBudget } from "../api";
import type { Budget } from "../api";
import { RefreshCwIcon, Trash2Icon, PlusIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
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

export function BudgetsTab() {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [projectPath, setProjectPath] = useState("");
  const [period, setPeriod] = useState("month");
  const [limitUsd, setLimitUsd] = useState("");
  const [alertAt, setAlertAt] = useState("80");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    getBudgets()
      .then((r) => setBudgets(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleDelete = async (id: number) => {
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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Active Budgets</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCwIcon className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="p-4 m-4 rounded-lg border border-red-200 bg-red-50 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              {error}
            </div>
          ) : budgets.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              No budgets configured
            </div>
          ) : (
            <div className="divide-y">
              {budgets.map((b) => (
                <div key={b.id} className="flex items-center gap-4 px-6 py-4">
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-3">
                      <span className="font-medium">{b.project_path || "Global"}</span>
                      <span className="inline-flex items-center rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 px-2 py-0.5 text-xs font-medium uppercase">
                        {b.period}
                      </span>
                    </div>
                    <ProgressBar percent={b.percent_used} isOver={b.is_over_alert} />
                    <p className="text-xs text-muted-foreground">
                      ${b.current_spend_usd.toFixed(4)} / ${b.limit_usd.toFixed(2)} limit
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-8 text-red-500 hover:text-red-600 shrink-0"
                    onClick={() => handleDelete(b.id)}
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
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
                  onChange={(e) => setPeriod(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="day">Day</option>
                  <option value="week">Week</option>
                  <option value="month">Month</option>
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
