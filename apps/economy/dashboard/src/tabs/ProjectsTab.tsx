import { useEffect, useState } from "react";
import { getProjects } from "../api";
import type { ProjectStat } from "../api";
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

function truncate(s: string, n: number) {
  if (!s) return "";
  return s.length > n ? "…" + s.slice(-n) : s;
}

function formatUsd(val: number) {
  return `$${(val ?? 0).toFixed(4)}`;
}

function formatDate(d: string) {
  if (!d) return "";
  return new Date(d).toLocaleDateString();
}

export function ProjectsTab() {
  const [projects, setProjects] = useState<ProjectStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getProjects()
      .then((r) => {
        const sorted = [...r.data].sort((a, b) => b.cost_usd - a.cost_usd);
        setProjects(sorted);
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
        <CardTitle className="text-sm">Projects</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Project Name</TableHead>
              <TableHead>Path</TableHead>
              <TableHead>Sessions</TableHead>
              <TableHead>Cost</TableHead>
              <TableHead>Last Active</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  No projects found.
                </TableCell>
              </TableRow>
            ) : (
              projects.map((p, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{p.project_name || "—"}</TableCell>
                  <TableCell
                    className="max-w-[280px]"
                    title={p.project_path}
                  >
                    <code className="text-xs text-muted-foreground">
                      {truncate(p.project_path, 40)}
                    </code>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{p.sessions}</TableCell>
                  <TableCell className="font-semibold">{formatUsd(p.cost_usd)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDate(p.last_active)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
