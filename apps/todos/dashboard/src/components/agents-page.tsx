import * as React from "react";
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import {
  BotIcon,
  ArrowUpDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  SearchIcon,
  TrendingUpIcon,
  MoreHorizontalIcon,
  Trash2Icon,
  PlusIcon,
  PencilIcon,
  SaveIcon,
  XIcon,
  GitMergeIcon,
  BarChart3Icon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// ── Types ───────────────────────────────────────────────────────────────────

interface Agent {
  id: string;
  name: string;
  description: string | null;
  role: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  last_seen_at: string;
}

interface TaskData {
  id: string;
  title: string;
  status: string;
  assigned_to: string | null;
  agent_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface AgentRow extends Agent {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  completionRate: number;
  avgWorkTime: number | null;
  lastTask: TaskData | null;
}

type StatusFilter = "all" | "active" | "idle";

// ── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

function agentStatus(lastSeenAt: string): { color: string; label: string } {
  const ms = Date.now() - new Date(lastSeenAt).getTime();
  if (ms < 5 * 60 * 1000) return { color: "bg-green-500", label: "Online" };
  if (ms < 60 * 60 * 1000) return { color: "bg-yellow-500", label: "Away" };
  return { color: "bg-gray-400", label: "Offline" };
}

function RoleBadge({ role }: { role: string | null }) {
  const r = role || "agent";
  const colors: Record<string, string> = {
    admin: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
    agent: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    observer: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[r] || colors.agent}`}>
      {r}
    </span>
  );
}

function getAgentTasks(tasks: TaskData[], agent: Agent): TaskData[] {
  return tasks.filter(
    (t) =>
      t.assigned_to === agent.name ||
      t.assigned_to === agent.id ||
      t.agent_id === agent.id ||
      t.agent_id === agent.name
  );
}

function getLastTask(agentTasks: TaskData[]): TaskData | null {
  if (agentTasks.length === 0) return null;
  return agentTasks.reduce((latest, t) => {
    const latestTime = new Date(latest.updated_at || latest.created_at).getTime();
    const tTime = new Date(t.updated_at || t.created_at).getTime();
    return tTime > latestTime ? t : latest;
  });
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[m][n];
}

// ── Create Agent Dialog ─────────────────────────────────────────────────────

function CreateAgentDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}) {
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [role, setRole] = React.useState("agent");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          role,
        }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else {
        setName("");
        setDescription("");
        setRole("agent");
        onOpenChange(false);
        onCreated();
      }
    } catch {
      setError("Failed to register agent");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Agent</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Agent name"
              className="h-9"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Description</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Role</label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="agent">Agent</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="observer">Observer</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || submitting}>
              {submitting ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Agent Detail Dialog ─────────────────────────────────────────────────────

function AgentDetailDialog({
  agent,
  tasks,
  open,
  onOpenChange,
  onUpdated,
}: {
  agent: AgentRow | null;
  tasks: TaskData[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onUpdated: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [editName, setEditName] = React.useState("");
  const [editDescription, setEditDescription] = React.useState("");
  const [editRole, setEditRole] = React.useState("agent");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (agent) {
      setEditName(agent.name);
      setEditDescription(agent.description || "");
      setEditRole(agent.role || "agent");
      setEditing(false);
      setError(null);
    }
  }, [agent]);

  if (!agent) return null;

  const status = agentStatus(agent.last_seen_at);
  const agentTasks = getAgentTasks(tasks, agent);
  const recentTasks = agentTasks
    .sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime())
    .slice(0, 20);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/agents/${agent!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          description: editDescription.trim() || null,
          role: editRole,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setEditing(false);
        onUpdated();
      }
    } catch {
      setError("Failed to update agent");
    } finally {
      setSaving(false);
    }
  }

  const statusColors: Record<string, string> = {
    pending: "text-yellow-500",
    in_progress: "text-blue-500",
    completed: "text-green-500",
    cancelled: "text-red-500",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BotIcon className="size-5 text-orange-500" />
            {editing ? "Edit Agent" : "Agent Details"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Status indicator */}
          <div className="flex items-center gap-2">
            <span className={`size-2 rounded-full ${status.color}`} />
            <span className="text-sm text-muted-foreground">{status.label}</span>
            <span className="text-sm text-muted-foreground">— last seen {timeAgo(agent.last_seen_at)}</span>
          </div>

          {editing ? (
            /* Edit mode */
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Name</label>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Description</label>
                <Input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Role</label>
                <Select value={editRole} onValueChange={setEditRole}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="agent">Agent</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="observer">Observer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSave} disabled={saving || !editName.trim()} className="gap-1.5">
                  <SaveIcon className="size-3.5" />
                  {saving ? "Saving..." : "Save"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setEditing(false); setError(null); }}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            /* View mode */
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Name</span>
                  <p className="font-medium">{agent.name}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">ID</span>
                  <p className="font-mono text-xs">{agent.id}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Role</span>
                  <div className="mt-0.5">
                    <RoleBadge role={agent.role} />
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Description</span>
                  <p>{agent.description || "\u2014"}</p>
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => setEditing(true)} className="gap-1.5">
                <PencilIcon className="size-3.5" /> Edit
              </Button>
            </div>
          )}

          {/* Stats cards */}
          <div className="grid grid-cols-4 gap-2">
            <Card className="py-2">
              <CardContent className="px-3 py-0 text-center">
                <p className="text-lg font-bold">{agent.total}</p>
                <p className="text-xs text-muted-foreground">Total</p>
              </CardContent>
            </Card>
            <Card className="py-2">
              <CardContent className="px-3 py-0 text-center">
                <p className="text-lg font-bold text-yellow-500">{agent.pending}</p>
                <p className="text-xs text-muted-foreground">Pending</p>
              </CardContent>
            </Card>
            <Card className="py-2">
              <CardContent className="px-3 py-0 text-center">
                <p className="text-lg font-bold text-blue-500">{agent.inProgress}</p>
                <p className="text-xs text-muted-foreground">Active</p>
              </CardContent>
            </Card>
            <Card className="py-2">
              <CardContent className="px-3 py-0 text-center">
                <p className="text-lg font-bold text-green-500">{agent.completed}</p>
                <p className="text-xs text-muted-foreground">Done</p>
              </CardContent>
            </Card>
          </div>

          {/* Completion rate + avg work time */}
          <div className="flex items-center gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Completion rate: </span>
              <Badge variant={agent.completionRate >= 80 ? "default" : agent.completionRate >= 50 ? "secondary" : "outline"}>
                {agent.total > 0 ? `${agent.completionRate}%` : "\u2014"}
              </Badge>
            </div>
            <div>
              <span className="text-muted-foreground">Avg work time: </span>
              <span className="font-medium">{agent.avgWorkTime !== null ? formatDuration(agent.avgWorkTime) : "\u2014"}</span>
            </div>
          </div>

          {/* Last active task */}
          {agent.lastTask && (
            <div className="text-sm">
              <span className="text-muted-foreground">Last active task: </span>
              <span className="font-medium">{agent.lastTask.title}</span>
              <span className={`ml-1.5 ${statusColors[agent.lastTask.status] || "text-muted-foreground"}`}>
                ({agent.lastTask.status.replace("_", " ")})
              </span>
            </div>
          )}

          {/* Task list */}
          {recentTasks.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2">Recent Tasks ({recentTasks.length})</p>
              <div className="max-h-[200px] overflow-y-auto rounded border divide-y">
                {recentTasks.map((t) => (
                  <div key={t.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="truncate max-w-[300px]">{t.title}</span>
                    <Badge variant="outline" className={`text-xs shrink-0 ml-2 ${statusColors[t.status] || ""}`}>
                      {t.status.replace("_", " ")}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Merge Duplicates Dialog ─────────────────────────────────────────────────

interface DuplicateGroup {
  agents: Agent[];
  similarity: number;
}

function findDuplicates(agents: Agent[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  const used = new Set<string>();

  for (let i = 0; i < agents.length; i++) {
    if (used.has(agents[i].id)) continue;
    const group: Agent[] = [agents[i]];

    for (let j = i + 1; j < agents.length; j++) {
      if (used.has(agents[j].id)) continue;
      const a = agents[i].name.toLowerCase();
      const b = agents[j].name.toLowerCase();
      const maxLen = Math.max(a.length, b.length);
      if (maxLen === 0) continue;
      const dist = levenshtein(a, b);
      const similarity = 1 - dist / maxLen;
      if (similarity >= 0.6 || a.includes(b) || b.includes(a)) {
        group.push(agents[j]);
        used.add(agents[j].id);
      }
    }

    if (group.length > 1) {
      used.add(agents[i].id);
      const a = group[0].name.toLowerCase();
      const b = group[1].name.toLowerCase();
      const maxLen = Math.max(a.length, b.length);
      const dist = levenshtein(a, b);
      groups.push({ agents: group, similarity: Math.round((1 - dist / maxLen) * 100) });
    }
  }

  return groups;
}

function MergeDuplicatesDialog({
  open,
  onOpenChange,
  agents,
  onMerged,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  agents: Agent[];
  onMerged: () => void;
}) {
  const duplicates = React.useMemo(() => findDuplicates(agents), [agents]);
  const [merging, setMerging] = React.useState<string | null>(null);

  async function handleMerge(group: DuplicateGroup, keepId: string) {
    setMerging(keepId);
    try {
      const deleteIds = group.agents.filter((a) => a.id !== keepId).map((a) => a.id);
      await Promise.all(deleteIds.map((id) => fetch(`/api/agents/${id}`, { method: "DELETE" })));
      onMerged();
    } finally {
      setMerging(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[70vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMergeIcon className="size-5" /> Merge Duplicate Agents
          </DialogTitle>
        </DialogHeader>
        {duplicates.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No duplicate agents found.</p>
        ) : (
          <div className="space-y-4">
            {duplicates.map((group, gi) => (
              <div key={gi} className="rounded border p-3 space-y-2">
                <p className="text-sm font-medium">
                  Similar names ({group.similarity}% match)
                </p>
                <div className="space-y-1.5">
                  {group.agents.map((a) => (
                    <div key={a.id} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <BotIcon className="size-3.5 text-orange-500" />
                        <span>{a.name}</span>
                        <code className="text-xs text-muted-foreground">{a.id}</code>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={merging !== null}
                        onClick={() => handleMerge(group, a.id)}
                      >
                        {merging === a.id ? "Merging..." : "Keep"}
                      </Button>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Click "Keep" to keep that agent and delete the others.
                </p>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Comparison Panel ────────────────────────────────────────────────────────

function ComparisonPanel({ agents, onClear }: { agents: AgentRow[]; onClear: () => void }) {
  if (agents.length < 2) return null;

  return (
    <Card className="mt-4">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3Icon className="size-4" /> Agent Comparison
          </CardTitle>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClear}>
            <XIcon className="size-3 mr-1" /> Close
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Metric</th>
                {agents.map((a) => (
                  <th key={a.id} className="text-center py-2 px-3 font-medium">{a.name}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              <tr>
                <td className="py-1.5 pr-4 text-muted-foreground">Status</td>
                {agents.map((a) => {
                  const s = agentStatus(a.last_seen_at);
                  return (
                    <td key={a.id} className="text-center py-1.5 px-3">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`size-2 rounded-full ${s.color}`} />
                        {s.label}
                      </span>
                    </td>
                  );
                })}
              </tr>
              <tr>
                <td className="py-1.5 pr-4 text-muted-foreground">Role</td>
                {agents.map((a) => (
                  <td key={a.id} className="text-center py-1.5 px-3"><RoleBadge role={a.role} /></td>
                ))}
              </tr>
              <tr>
                <td className="py-1.5 pr-4 text-muted-foreground">Total Tasks</td>
                {agents.map((a) => (
                  <td key={a.id} className="text-center py-1.5 px-3 font-medium">{a.total}</td>
                ))}
              </tr>
              <tr>
                <td className="py-1.5 pr-4 text-muted-foreground">Pending</td>
                {agents.map((a) => (
                  <td key={a.id} className="text-center py-1.5 px-3 text-yellow-500">{a.pending}</td>
                ))}
              </tr>
              <tr>
                <td className="py-1.5 pr-4 text-muted-foreground">In Progress</td>
                {agents.map((a) => (
                  <td key={a.id} className="text-center py-1.5 px-3 text-blue-500">{a.inProgress}</td>
                ))}
              </tr>
              <tr>
                <td className="py-1.5 pr-4 text-muted-foreground">Completed</td>
                {agents.map((a) => (
                  <td key={a.id} className="text-center py-1.5 px-3 text-green-500">{a.completed}</td>
                ))}
              </tr>
              <tr>
                <td className="py-1.5 pr-4 text-muted-foreground">Rate</td>
                {agents.map((a) => (
                  <td key={a.id} className="text-center py-1.5 px-3">
                    <Badge variant={a.completionRate >= 80 ? "default" : a.completionRate >= 50 ? "secondary" : "outline"}>
                      {a.total > 0 ? `${a.completionRate}%` : "\u2014"}
                    </Badge>
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-1.5 pr-4 text-muted-foreground">Avg Time</td>
                {agents.map((a) => (
                  <td key={a.id} className="text-center py-1.5 px-3">
                    {a.avgWorkTime !== null ? formatDuration(a.avgWorkTime) : "\u2014"}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-1.5 pr-4 text-muted-foreground">Last Task</td>
                {agents.map((a) => (
                  <td key={a.id} className="text-center py-1.5 px-3 max-w-[150px] truncate">
                    {a.lastTask?.title || "\u2014"}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Table Columns ───────────────────────────────────────────────────────────

interface AgentTableMeta {
  onDelete: (id: string) => void;
  onOpenDetail: (agent: AgentRow) => void;
}

function makeColumns(): ColumnDef<AgentRow>[] {
  return [
    {
      id: "select",
      header: ({ table }) => (
        <input
          type="checkbox"
          className="rounded"
          checked={table.getIsAllPageRowsSelected()}
          onChange={(e) => table.toggleAllPageRowsSelected(e.target.checked)}
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          className="rounded"
          checked={row.getIsSelected()}
          onChange={(e) => {
            e.stopPropagation();
            row.toggleSelected(e.target.checked);
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ),
      size: 30,
      enableSorting: false,
    },
    {
      accessorKey: "name",
      header: ({ column }) => (
        <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting()}>
          Name <ArrowUpDownIcon className="size-3" />
        </Button>
      ),
      cell: ({ row }) => {
        const status = agentStatus(row.original.last_seen_at);
        return (
          <div className="flex items-center gap-2">
            <span className={`size-2 rounded-full shrink-0 ${status.color}`} title={status.label} />
            <BotIcon className="size-4 text-orange-500 shrink-0" />
            <span className="font-medium text-sm">{row.original.name}</span>
          </div>
        );
      },
    },
    {
      accessorKey: "role",
      header: "Role",
      cell: ({ row }) => <RoleBadge role={row.original.role} />,
      size: 80,
    },
    {
      accessorKey: "id",
      header: "ID",
      cell: ({ row }) => (
        <code className="text-sm text-muted-foreground">{row.original.id}</code>
      ),
    },
    {
      accessorKey: "description",
      header: "Description",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground truncate max-w-[200px] block">
          {row.original.description || "\u2014"}
        </span>
      ),
    },
    {
      accessorKey: "total",
      header: ({ column }) => (
        <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting()}>
          Tasks <ArrowUpDownIcon className="size-3" />
        </Button>
      ),
      cell: ({ row }) => {
        const { total, pending, inProgress, completed } = row.original;
        if (total === 0) return <span className="text-sm text-muted-foreground">0</span>;
        return (
          <div className="flex items-center gap-1.5 text-sm">
            <span className="font-medium">{total}</span>
            <span className="text-muted-foreground">
              (<span className="text-yellow-500">{pending}</span>/
              <span className="text-blue-500">{inProgress}</span>/
              <span className="text-green-500">{completed}</span>)
            </span>
          </div>
        );
      },
    },
    {
      accessorKey: "completionRate",
      header: ({ column }) => (
        <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting()}>
          Rate <ArrowUpDownIcon className="size-3" />
        </Button>
      ),
      cell: ({ row }) => {
        const rate = row.original.completionRate;
        if (row.original.total === 0) return <span className="text-sm text-muted-foreground">{"\u2014"}</span>;
        return (
          <Badge variant={rate >= 80 ? "default" : rate >= 50 ? "secondary" : "outline"} className="text-sm">
            {rate}%
          </Badge>
        );
      },
    },
    {
      id: "lastTask",
      header: "Last Task",
      cell: ({ row }) => {
        const task = row.original.lastTask;
        if (!task) return <span className="text-sm text-muted-foreground">{"\u2014"}</span>;
        return (
          <span className="text-sm truncate max-w-[180px] block" title={task.title}>
            {task.title}
          </span>
        );
      },
    },
    {
      accessorKey: "last_seen_at",
      header: ({ column }) => (
        <Button variant="ghost" size="sm" className="-ml-3" onClick={() => column.toggleSorting()}>
          Last Seen <ArrowUpDownIcon className="size-3" />
        </Button>
      ),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          {timeAgo(row.original.last_seen_at)}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row, table }) => {
        const meta = table.options.meta as AgentTableMeta | undefined;
        return (
          <div onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-7">
                  <MoreHorizontalIcon className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => meta?.onOpenDetail(row.original)}>
                  <PencilIcon className="size-3.5 mr-2" /> View / Edit
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-red-500 focus:text-red-500"
                  onClick={() => meta?.onDelete(row.original.id)}
                >
                  <Trash2Icon className="size-3.5 mr-2" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
      size: 50,
    },
  ];
}

// ── Agents Page ─────────────────────────────────────────────────────────────

export function AgentsPage() {
  const [agents, setAgents] = React.useState<Agent[]>([]);
  const [tasks, setTasks] = React.useState<TaskData[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [sorting, setSorting] = React.useState<SortingState>([{ id: "total", desc: true }]);
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [rowSelection, setRowSelection] = React.useState<Record<string, boolean>>({});
  const [createOpen, setCreateOpen] = React.useState(false);
  const [mergeOpen, setMergeOpen] = React.useState(false);
  const [detailAgent, setDetailAgent] = React.useState<AgentRow | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all");
  const [showComparison, setShowComparison] = React.useState(false);
  const searchRef = React.useRef<HTMLInputElement>(null);

  const columns = React.useMemo(() => makeColumns(), []);

  function loadData() {
    Promise.all([
      fetch("/api/agents").then((r) => r.json()),
      fetch("/api/tasks").then((r) => r.json()),
    ])
      .then(([agentsData, tasksData]) => {
        setAgents(agentsData);
        setTasks(tasksData);
      })
      .finally(() => setLoading(false));
  }

  React.useEffect(() => {
    loadData();
  }, []);

  React.useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "/" && !e.ctrlKey && !e.metaKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA") {
          e.preventDefault();
          searchRef.current?.focus();
        }
      }
      if (e.key === "Escape") {
        setGlobalFilter("");
        searchRef.current?.blur();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const agentRows: AgentRow[] = React.useMemo(() => {
    return agents.map((agent) => {
      const agentTasks = getAgentTasks(tasks, agent);
      const total = agentTasks.length;
      const pending = agentTasks.filter((t) => t.status === "pending").length;
      const inProgress = agentTasks.filter((t) => t.status === "in_progress").length;
      const completed = agentTasks.filter((t) => t.status === "completed").length;
      const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

      const completedTasks = agentTasks.filter((t) => t.status === "completed" && t.completed_at);
      let avgWorkTime: number | null = null;
      if (completedTasks.length > 0) {
        const durations = completedTasks
          .map((t) => {
            const end = new Date(t.completed_at!).getTime();
            const start = new Date(t.created_at).getTime();
            return end - start;
          })
          .filter((d) => d > 0);
        if (durations.length > 0) {
          avgWorkTime = durations.reduce((a, b) => a + b, 0) / durations.length;
        }
      }

      const lastTask = getLastTask(agentTasks);

      return { ...agent, total, pending, inProgress, completed, completionRate, avgWorkTime, lastTask };
    });
  }, [agents, tasks]);

  const filteredRows: AgentRow[] = React.useMemo(() => {
    if (statusFilter === "all") return agentRows;
    if (statusFilter === "active") return agentRows.filter((a) => a.inProgress > 0);
    return agentRows.filter((a) => a.inProgress === 0);
  }, [agentRows, statusFilter]);

  async function handleDelete(id: string) {
    await fetch(`/api/agents/${id}`, { method: "DELETE" });
    setAgents((prev) => prev.filter((a) => a.id !== id));
  }

  async function handleBulkDelete(ids: string[]) {
    await Promise.all(ids.map((id) => fetch(`/api/agents/${id}`, { method: "DELETE" })));
    setAgents((prev) => prev.filter((a) => !ids.includes(a.id)));
    setRowSelection({});
  }

  function handleOpenDetail(agent: AgentRow) {
    setDetailAgent(agent);
    setDetailOpen(true);
  }

  const table = useReactTable({
    data: filteredRows,
    columns,
    state: { sorting, globalFilter, rowSelection },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    enableRowSelection: true,
    getRowId: (row) => row.id,
    initialState: { pagination: { pageSize: 15 } },
    meta: { onDelete: handleDelete, onOpenDetail: handleOpenDetail } as AgentTableMeta,
  });

  const selectedIds = Object.keys(rowSelection).filter((k) => rowSelection[k]);
  const hasSelection = selectedIds.length > 0;
  const selectedAgents = agentRows.filter((a) => selectedIds.includes(a.id));

  if (loading) {
    return <div className="text-center text-muted-foreground py-12">Loading agents...</div>;
  }

  if (agents.length === 0 && !createOpen) {
    return (
      <div className="text-center py-12">
        <BotIcon className="mx-auto size-10 text-muted-foreground/50 mb-3" />
        <p className="text-muted-foreground">No agents registered.</p>
        <p className="text-sm text-muted-foreground mt-1">
          Agents register via <code className="bg-muted px-1.5 py-0.5 rounded text-sm">register_agent</code> MCP tool or CLI.
        </p>
        <Button variant="outline" size="sm" className="mt-4 gap-1.5" onClick={() => setCreateOpen(true)}>
          <PlusIcon className="size-3.5" /> New Agent
        </Button>
        <CreateAgentDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={loadData} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <SearchIcon className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
          <Input
            ref={searchRef}
            placeholder="Search agents... (press /)"
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="h-9 w-[130px]">
            <SelectValue placeholder="Filter" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="idle">Idle</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{filteredRows.length} agent(s)</span>
        <div className="flex-1" />
        <Button variant="outline" size="sm" className="gap-1.5 h-9" onClick={() => setMergeOpen(true)}>
          <GitMergeIcon className="size-3.5" /> Merge
        </Button>
        <Button variant="outline" size="sm" className="gap-1.5 h-9" onClick={() => setCreateOpen(true)}>
          <PlusIcon className="size-3.5" /> New Agent
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() ? "selected" : undefined}
                  className="cursor-pointer"
                  onClick={() => handleOpenDetail(row.original)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  No agents found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{table.getFilteredRowModel().rows.length} agent(s)</p>
        {table.getPageCount() > 1 && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
              <ChevronLeftIcon className="size-3.5" />
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
            </span>
            <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
              <ChevronRightIcon className="size-3.5" />
            </Button>
          </div>
        )}
      </div>

      {/* Comparison panel */}
      {showComparison && selectedAgents.length >= 2 && (
        <ComparisonPanel
          agents={selectedAgents}
          onClear={() => {
            setShowComparison(false);
            setRowSelection({});
          }}
        />
      )}

      {/* Floating bulk action bar */}
      {hasSelection && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-xl border bg-background px-5 py-3 shadow-xl">
          <span className="text-sm font-medium">{selectedIds.length} selected</span>
          <div className="h-4 w-px bg-border" />
          {selectedIds.length >= 2 && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-sm gap-1"
                onClick={() => setShowComparison(true)}
              >
                <BarChart3Icon className="size-3" /> Compare
              </Button>
              <div className="h-4 w-px bg-border" />
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-sm text-red-500"
            onClick={() => handleBulkDelete(selectedIds)}
          >
            <Trash2Icon className="size-3" /> Delete
          </Button>
          <div className="h-4 w-px bg-border" />
          <Button variant="ghost" size="sm" className="h-7 text-sm" onClick={() => { setRowSelection({}); setShowComparison(false); }}>
            Clear
          </Button>
        </div>
      )}

      {/* Dialogs */}
      <CreateAgentDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={loadData} />
      <MergeDuplicatesDialog open={mergeOpen} onOpenChange={setMergeOpen} agents={agents} onMerged={loadData} />
      <AgentDetailDialog
        agent={detailAgent}
        tasks={tasks}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onUpdated={loadData}
      />
    </div>
  );
}
