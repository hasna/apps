import { useEffect, useState } from "react";
import { getModels } from "../api";
import type { ModelStat } from "../api";
import { RefreshCwIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function formatUsd(val: number) {
  return `$${(val ?? 0).toFixed(4)}`;
}

function AgentBadge({ agent }: { agent: string }) {
  const colors: Record<string, string> = {
    claude: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    codex: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[agent] ?? "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"}`}
    >
      {agent}
    </span>
  );
}

export function ModelsTab() {
  const [models, setModels] = useState<ModelStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getModels()
      .then((r) => {
        const sorted = [...r.data].sort((a, b) => b.cost_usd - a.cost_usd);
        setModels(sorted);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  if (loading)
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCwIcon className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  if (error)
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
        {error}
      </div>
    );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Model Breakdown</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Model</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>Requests</TableHead>
              <TableHead>Tokens</TableHead>
              <TableHead>Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {models.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  No model data.
                </TableCell>
              </TableRow>
            ) : (
              models.map((m, i) => (
                <TableRow key={`${m.model}-${m.agent}-${i}`}>
                  <TableCell>
                    <code className="text-xs">{m.model}</code>
                  </TableCell>
                  <TableCell>
                    <AgentBadge agent={m.agent} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {(m.requests ?? 0).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {(m.total_tokens ?? 0).toLocaleString()}
                  </TableCell>
                  <TableCell className="font-semibold">{formatUsd(m.cost_usd)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
