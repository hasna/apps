import * as React from "react";
import {
  ListTodoIcon, ClockIcon, PlayIcon, CheckCircleIcon,
  XCircleIcon, BanIcon, FolderIcon, BotIcon, TrendingUpIcon, ActivityIcon, HistoryIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DashboardStats } from "@/types";

interface RecentTask {
  id: string; short_id: string | null; title: string; status: string; updated_at: string;
}

interface AuditEntry {
  id: string; task_id: string; action: string; field: string | null;
  old_value: string | null; new_value: string | null; agent_id: string | null; created_at: string;
}

function timeAgo(dateStr: string): string {
  const s = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function statusDot(status: string) {
  const c: Record<string, string> = { pending: "bg-yellow-500", in_progress: "bg-blue-500", completed: "bg-green-500", failed: "bg-red-500", cancelled: "bg-gray-400" };
  return c[status] || "bg-gray-400";
}

export function DashboardPage({ stats }: { stats: DashboardStats }) {
  const [recent, setRecent] = React.useState<RecentTask[]>([]);
  const [audit, setAudit] = React.useState<AuditEntry[]>([]);
  React.useEffect(() => {
    fetch("/api/tasks?limit=8").then(r => r.json()).then(setRecent);
    fetch("/api/activity?limit=10").then(r => r.json()).then(setAudit).catch(() => {});
  }, []);

  const rate = stats.total_tasks > 0 ? Math.round((stats.completed / stats.total_tasks) * 100) : 0;

  const cards = [
    { label: "Total Tasks", value: stats.total_tasks, icon: ListTodoIcon, color: "text-foreground" },
    { label: "Pending", value: stats.pending, icon: ClockIcon, color: "text-yellow-500" },
    { label: "In Progress", value: stats.in_progress, icon: PlayIcon, color: "text-blue-500" },
    { label: "Completed", value: stats.completed, icon: CheckCircleIcon, color: "text-green-500" },
    { label: "Failed", value: stats.failed, icon: XCircleIcon, color: "text-red-500" },
    { label: "Cancelled", value: stats.cancelled, icon: BanIcon, color: "text-muted-foreground" },
    { label: "Projects", value: stats.projects, icon: FolderIcon, color: "text-purple-500" },
    { label: "Agents", value: stats.agents, icon: BotIcon, color: "text-orange-500" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-4">
              <CardTitle className="text-sm font-medium text-muted-foreground">{c.label}</CardTitle>
              <c.icon className={`size-4 ${c.color}`} />
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="text-2xl font-bold">{c.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUpIcon className="size-4 text-green-500" /> Completion Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{rate}%</div>
            <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-green-500 transition-all" style={{ width: `${rate}%` }} />
            </div>
            <p className="text-sm text-muted-foreground mt-2">{stats.completed} of {stats.total_tasks} tasks completed</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <ActivityIcon className="size-4 text-blue-500" /> Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recent tasks.</p>
            ) : (
              <div className="space-y-2">
                {recent.map((t) => (
                  <div key={t.id} className="flex items-center gap-2 text-sm">
                    <span className={`size-2 rounded-full shrink-0 ${statusDot(t.status)}`} />
                    <span className="truncate flex-1">{t.title}</span>
                    <span className="text-muted-foreground shrink-0">{timeAgo(t.updated_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Audit Log */}
      {audit.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <HistoryIcon className="size-4 text-purple-500" /> Audit Log
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {audit.map((a) => (
                <div key={a.id} className="flex items-center gap-2 text-sm">
                  <code className="text-muted-foreground shrink-0">{a.task_id.slice(0, 8)}</code>
                  <span className="font-medium">{a.action}</span>
                  {a.field && <span className="text-muted-foreground">{a.field}</span>}
                  {a.old_value && a.new_value && (
                    <span className="text-muted-foreground">{a.old_value} → {a.new_value}</span>
                  )}
                  {a.agent_id && <span className="text-muted-foreground">by {a.agent_id}</span>}
                  <span className="text-muted-foreground ml-auto shrink-0">{timeAgo(a.created_at)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
