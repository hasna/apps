import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { PencilIcon, PiggyBankIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { createSubscription, deleteSubscription, getSavings, getSubscriptions } from "../api";
import type { Agent, SavingsSummary, Subscription } from "../api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

const agentOptions: Array<{ value: Agent; label: string }> = [
  { value: "claude", label: "Claude" },
  { value: "takumi", label: "Takumi" },
  { value: "codex", label: "Codex" },
  { value: "gemini", label: "Gemini" },
  { value: "opencode", label: "OpenCode" },
  { value: "cursor", label: "Cursor" },
  { value: "pi", label: "Pi" },
  { value: "hermes", label: "Hermes" },
];

type FormState = {
  id: string;
  provider: string;
  plan: string;
  agent: Agent | "all";
  monthly_fee_usd: string;
  included_usage_usd: string;
  billing_cycle_start: string;
  reset_policy: string;
  active: boolean;
};

const emptyForm: FormState = {
  id: "",
  provider: "",
  plan: "",
  agent: "all",
  monthly_fee_usd: "",
  included_usage_usd: "",
  billing_cycle_start: "",
  reset_policy: "monthly",
  active: true,
};

function formatUsd(val: number) {
  return "$" + (val ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function subscriptionLabel(subscription: Subscription) {
  return `${subscription.provider} / ${subscription.plan}`;
}

export function SavingsTab() {
  const [data, setData] = useState<SavingsSummary | null>(null);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([getSavings("month"), getSubscriptions()])
      .then(([savings, planRows]) => {
        setData(savings.data);
        setSubscriptions(planRows.data);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load savings"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    queueMicrotask(load);
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  const byAgent = Object.entries(data?.by_agent ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const sortedSubscriptions = [...subscriptions].sort((a, b) => subscriptionLabel(a).localeCompare(subscriptionLabel(b)));
  const activeSubscriptions = subscriptions.filter((subscription) => subscription.active !== 0);
  const activeMonthlyFee = activeSubscriptions.reduce((sum, subscription) => sum + (subscription.monthly_fee_usd ?? 0), 0);
  const activeIncludedUsage = activeSubscriptions.reduce((sum, subscription) => sum + (subscription.included_usage_usd ?? 0), 0);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const resetForm = () => {
    setForm(emptyForm);
    setFormError(null);
  };

  const editSubscription = (subscription: Subscription) => {
    setForm({
      id: subscription.id,
      provider: subscription.provider,
      plan: subscription.plan,
      agent: subscription.agent ?? "all",
      monthly_fee_usd: String(subscription.monthly_fee_usd ?? 0),
      included_usage_usd: String(subscription.included_usage_usd ?? 0),
      billing_cycle_start: subscription.billing_cycle_start ?? "",
      reset_policy: subscription.reset_policy || "monthly",
      active: subscription.active !== 0,
    });
    setFormError(null);
  };

  const removeSubscription = async (id: string) => {
    try {
      await deleteSubscription(id);
      if (form.id === id) resetForm();
      load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const saveSubscription = async (event: FormEvent) => {
    event.preventDefault();
    const fee = Number(form.monthly_fee_usd || 0);
    const included = Number(form.included_usage_usd || 0);
    if (!form.provider.trim()) {
      setFormError("Provider is required");
      return;
    }
    if (!form.plan.trim()) {
      setFormError("Plan is required");
      return;
    }
    if (!Number.isFinite(fee) || fee < 0) {
      setFormError("Monthly fee must be non-negative");
      return;
    }
    if (!Number.isFinite(included) || included < 0) {
      setFormError("Included usage must be non-negative");
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      await createSubscription({
        id: form.id || undefined,
        provider: form.provider.trim(),
        plan: form.plan.trim(),
        agent: form.agent === "all" ? null : form.agent,
        monthly_fee_usd: fee,
        included_usage_usd: included,
        billing_cycle_start: form.billing_cycle_start || null,
        reset_policy: form.reset_policy || "monthly",
        active: form.active,
      });
      resetForm();
      load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Failed to save subscription");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <PiggyBankIcon className="size-4 text-green-500" />
            Subscription vs API Savings — This Month
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              {error}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "API Equivalent", value: data?.api_equivalent_usd },
              { label: "Subscription Fee", value: data?.subscription_fee_usd },
              { label: "On-demand", value: data?.on_demand_usd },
              { label: "Saved", value: data?.saved_usd },
            ].map((item) => (
              <div key={item.label} className="rounded-md border p-4">
                <div className="text-xs font-medium uppercase text-muted-foreground">{item.label}</div>
                <div className="mt-1 text-xl font-semibold">
                  {loading ? "..." : formatUsd(item.value ?? 0)}
                </div>
              </div>
            ))}
          </div>
          {byAgent.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead className="text-right">API Equiv.</TableHead>
                  <TableHead className="text-right">Included</TableHead>
                  <TableHead className="text-right">Fee</TableHead>
                  <TableHead className="text-right">Saved</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byAgent.map(([agent, row]) => (
                  <TableRow key={agent}>
                    <TableCell className="font-medium capitalize">{agent}</TableCell>
                    <TableCell className="text-right">{formatUsd(row.api_equivalent_usd ?? 0)}</TableCell>
                    <TableCell className="text-right">{formatUsd(row.included_consumed_usd ?? 0)}</TableCell>
                    <TableCell className="text-right">{formatUsd(row.subscription_fee_usd ?? 0)}</TableCell>
                    <TableCell className="text-right text-green-600 dark:text-green-400">
                      {formatUsd(row.saved_usd ?? 0)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <PlusIcon className="size-4" />
            Subscription Plans
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-md border p-4">
              <div className="text-xs font-medium uppercase text-muted-foreground">Active Plans</div>
              <div className="mt-1 text-xl font-semibold">{loading ? "..." : activeSubscriptions.length}</div>
            </div>
            <div className="rounded-md border p-4">
              <div className="text-xs font-medium uppercase text-muted-foreground">Monthly Fee</div>
              <div className="mt-1 text-xl font-semibold">{loading ? "..." : formatUsd(activeMonthlyFee)}</div>
            </div>
            <div className="rounded-md border p-4">
              <div className="text-xs font-medium uppercase text-muted-foreground">Included Cap</div>
              <div className="mt-1 text-xl font-semibold">{loading ? "..." : formatUsd(activeIncludedUsage)}</div>
            </div>
          </div>

          {sortedSubscriptions.length === 0 && !loading ? (
            <p className="text-sm text-muted-foreground">No subscription plans configured.</p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Plan</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead className="text-right">Fee</TableHead>
                    <TableHead className="text-right">Included</TableHead>
                    <TableHead>Reset</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedSubscriptions.map((subscription) => (
                    <TableRow key={subscription.id}>
                      <TableCell>
                        <div className="font-medium">{subscriptionLabel(subscription)}</div>
                        <div className="text-xs text-muted-foreground">{subscription.id}</div>
                      </TableCell>
                      <TableCell className="capitalize">{subscription.agent ?? "All"}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatUsd(subscription.monthly_fee_usd ?? 0)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatUsd(subscription.included_usage_usd ?? 0)}</TableCell>
                      <TableCell className="text-muted-foreground">{subscription.reset_policy || "monthly"}</TableCell>
                      <TableCell>{subscription.active === 0 ? "Inactive" : "Active"}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            title="Edit subscription"
                            onClick={() => editSubscription(subscription)}
                          >
                            <PencilIcon className="size-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            title="Delete subscription"
                            onClick={() => removeSubscription(subscription.id)}
                          >
                            <Trash2Icon className="size-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <form onSubmit={saveSubscription} className="space-y-4 rounded-md border p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium">{form.id ? "Edit Subscription" : "Add Subscription"}</div>
              {form.id && (
                <Button type="button" variant="outline" size="sm" onClick={resetForm}>
                  Clear
                </Button>
              )}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Provider</label>
                <Input
                  value={form.provider}
                  onChange={(event) => setField("provider", event.target.value)}
                  placeholder="anthropic"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Plan</label>
                <Input
                  value={form.plan}
                  onChange={(event) => setField("plan", event.target.value)}
                  placeholder="claude max"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Agent</label>
                <select
                  value={form.agent}
                  onChange={(event) => setField("agent", event.target.value as Agent | "all")}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="all">All agents</option>
                  {agentOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Reset Policy</label>
                <select
                  value={form.reset_policy}
                  onChange={(event) => setField("reset_policy", event.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="monthly">Monthly</option>
                  <option value="weekly">Weekly</option>
                  <option value="daily">Daily</option>
                  <option value="manual">Manual</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Monthly Fee (USD)</label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.monthly_fee_usd}
                  onChange={(event) => setField("monthly_fee_usd", event.target.value)}
                  placeholder="20.00"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Included Usage (USD)</label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.included_usage_usd}
                  onChange={(event) => setField("included_usage_usd", event.target.value)}
                  placeholder="20.00"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Billing Cycle Start</label>
                <Input
                  type="date"
                  value={form.billing_cycle_start}
                  onChange={(event) => setField("billing_cycle_start", event.target.value)}
                />
              </div>
              <label className="flex items-center gap-2 pt-6 text-sm">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(event) => setField("active", event.target.checked)}
                  className="size-4"
                />
                Active
              </label>
            </div>
            {formError && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                {formError}
              </div>
            )}
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : form.id ? "Update Subscription" : "Add Subscription"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
