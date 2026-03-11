import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { getPricing, createPricing, deletePricing } from "../api";
import type { Pricing } from "../api";
import { RefreshCwIcon, Trash2Icon, PlusIcon } from "lucide-react";
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

export function PricingTab() {
  const [pricing, setPricing] = useState<Pricing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [model, setModel] = useState("");
  const [inputPer1m, setInputPer1m] = useState("");
  const [outputPer1m, setOutputPer1m] = useState("");
  const [cacheReadPer1m, setCacheReadPer1m] = useState("");
  const [cacheWritePer1m, setCacheWritePer1m] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    getPricing()
      .then((r) => setPricing(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleDelete = async (m: string) => {
    try {
      await deletePricing(m);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
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
      setModel("");
      setInputPer1m("");
      setOutputPer1m("");
      setCacheReadPer1m("");
      setCacheWritePer1m("");
      load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Failed to save pricing");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Model Pricing</CardTitle>
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
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead>Input / 1M</TableHead>
                  <TableHead>Output / 1M</TableHead>
                  <TableHead>Cache Read / 1M</TableHead>
                  <TableHead>Cache Write / 1M</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pricing.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      No pricing data.
                    </TableCell>
                  </TableRow>
                ) : (
                  pricing.map((p) => (
                    <TableRow key={p.model}>
                      <TableCell>
                        <code className="text-xs">{p.model}</code>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        ${p.input_per_1m?.toFixed(4)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        ${p.output_per_1m?.toFixed(4)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {p.cache_read_per_1m != null ? `$${p.cache_read_per_1m.toFixed(4)}` : "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {p.cache_write_per_1m != null
                          ? `$${p.cache_write_per_1m.toFixed(4)}`
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="icon"
                          className="size-7 text-red-500 hover:text-red-600"
                          onClick={() => handleDelete(p.model)}
                        >
                          <Trash2Icon className="size-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <PlusIcon className="size-4" />
            Add / Update Pricing
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Model Name</label>
              <Input
                type="text"
                placeholder="e.g. claude-opus-4-5"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
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
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save Pricing"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
