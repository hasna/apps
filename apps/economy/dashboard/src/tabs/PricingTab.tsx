import { useEffect, useState, useCallback, useRef } from "react";
import type { FormEvent } from "react";
import { getPricing, createPricing, deletePricing } from "../api";
import type { Pricing } from "../api";
import { PlusIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { DataTable, type DataTableColumn, type DataTableAction } from "@/components/data-table";

const columns: DataTableColumn<Pricing>[] = [
  {
    header: "Model",
    accessor: "model",
    sortable: true,
    render: (val) => <code className="text-xs">{String(val)}</code>,
  },
  {
    header: "Input / 1M",
    accessor: "input_per_1m",
    sortable: true,
    render: (val) => (
      <span className="text-muted-foreground">${((val as number) ?? 0).toFixed(4)}</span>
    ),
  },
  {
    header: "Output / 1M",
    accessor: "output_per_1m",
    sortable: true,
    render: (val) => (
      <span className="text-muted-foreground">${((val as number) ?? 0).toFixed(4)}</span>
    ),
  },
  {
    header: "Cache Read / 1M",
    accessor: "cache_read_per_1m",
    sortable: true,
    render: (val) => (
      <span className="text-muted-foreground">
        {val != null ? `$${(val as number).toFixed(4)}` : "\u2014"}
      </span>
    ),
  },
  {
    header: "Cache Write / 1M",
    accessor: "cache_write_per_1m",
    sortable: true,
    render: (val) => (
      <span className="text-muted-foreground">
        {val != null ? `$${(val as number).toFixed(4)}` : "\u2014"}
      </span>
    ),
  },
];

export function PricingTab() {
  const [pricing, setPricing] = useState<Pricing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const [model, setModel] = useState("");
  const [inputPer1m, setInputPer1m] = useState("");
  const [outputPer1m, setOutputPer1m] = useState("");
  const [cacheReadPer1m, setCacheReadPer1m] = useState("");
  const [cacheWritePer1m, setCacheWritePer1m] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [editingModel, setEditingModel] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    getPricing()
      .then((r) => setPricing(r.data))
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

  const handleDelete = async (m: string) => {
    try {
      await deletePricing(m);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const openAddDialog = () => {
    setModel("");
    setInputPer1m("");
    setOutputPer1m("");
    setCacheReadPer1m("");
    setCacheWritePer1m("");
    setFormError(null);
    setEditingModel(null);
    setDialogOpen(true);
  };

  const openEditDialog = (p: Pricing) => {
    setModel(p.model);
    setInputPer1m(String(p.input_per_1m ?? ""));
    setOutputPer1m(String(p.output_per_1m ?? ""));
    setCacheReadPer1m(p.cache_read_per_1m != null ? String(p.cache_read_per_1m) : "");
    setCacheWritePer1m(p.cache_write_per_1m != null ? String(p.cache_write_per_1m) : "");
    setFormError(null);
    setEditingModel(p.model);
    setDialogOpen(true);
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!model) {
      setFormError("Model name is required");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await createPricing({
        model,
        input_per_1m: Number(inputPer1m) || 0,
        output_per_1m: Number(outputPer1m) || 0,
        cache_read_per_1m: Number(cacheReadPer1m) || 0,
        cache_write_per_1m: Number(cacheWritePer1m) || 0,
      });
      setDialogOpen(false);
      load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Failed to save pricing");
    } finally {
      setSaving(false);
    }
  };

  const actions: DataTableAction<Pricing>[] = [
    {
      label: "Edit",
      icon: <PencilIcon className="size-4" />,
      onClick: (row) => openEditDialog(row),
    },
    {
      label: "Delete",
      icon: <Trash2Icon className="size-4" />,
      onClick: (row) => handleDelete(row.model),
    },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Model Pricing</CardTitle>
            <Button size="sm" onClick={openAddDialog}>
              <PlusIcon className="size-3.5 mr-1" />
              Add Pricing
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={pricing}
            searchPlaceholder="Search models..."
            actions={actions}
            getRowId={(row) => row.model}
            loading={loading}
            error={error}
            emptyMessage="No pricing data."
          />
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingModel ? "Edit Pricing" : "Add Pricing"}</DialogTitle>
            <DialogDescription>
              {editingModel ? `Update pricing for ${editingModel}` : "Configure pricing per 1M tokens for a model."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Model Name</label>
              <Input
                type="text"
                placeholder="e.g. claude-opus-4-5"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                required
                disabled={!!editingModel}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Input / 1M ($)
                </label>
                <Input
                  type="number"
                  step="0.0001"
                  min="0"
                  placeholder="3.00"
                  value={inputPer1m}
                  onChange={(e) => setInputPer1m(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Output / 1M ($)
                </label>
                <Input
                  type="number"
                  step="0.0001"
                  min="0"
                  placeholder="15.00"
                  value={outputPer1m}
                  onChange={(e) => setOutputPer1m(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Cache Read / 1M ($)
                </label>
                <Input
                  type="number"
                  step="0.0001"
                  min="0"
                  placeholder="0.30"
                  value={cacheReadPer1m}
                  onChange={(e) => setCacheReadPer1m(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Cache Write / 1M ($)
                </label>
                <Input
                  type="number"
                  step="0.0001"
                  min="0"
                  placeholder="3.75"
                  value={cacheWritePer1m}
                  onChange={(e) => setCacheWritePer1m(e.target.value)}
                />
              </div>
            </div>
            {formError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                {formError}
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
