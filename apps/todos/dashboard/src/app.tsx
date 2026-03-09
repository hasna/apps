import * as React from "react";
import {
  RefreshCwIcon,
  PlusIcon,
  DownloadIcon,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { DashboardPage } from "@/components/dashboard-page";
import { TasksTable } from "@/components/tasks-table";
import { ProjectsPage } from "@/components/projects-page";
import { AgentsPage } from "@/components/agents-page";
import { HelpPage } from "@/components/help-page";
import { CreateTaskDialog } from "@/components/create-task-dialog";
import { EditTaskDialog } from "@/components/edit-task-dialog";
import { Button } from "@/components/ui/button";
import type { TaskSummary, DashboardStats, ProjectSummary } from "@/types";

type Page = "dashboard" | "tasks" | "projects" | "agents" | "help";

export function App() {
  const [page, setPage] = React.useState<Page>("dashboard");
  const [tasks, setTasks] = React.useState<TaskSummary[]>([]);
  const [projects, setProjects] = React.useState<ProjectSummary[]>([]);
  const [stats, setStats] = React.useState<DashboardStats>({
    total_tasks: 0, pending: 0, in_progress: 0, completed: 0,
    failed: 0, cancelled: 0, projects: 0, agents: 0,
  });
  const [loading, setLoading] = React.useState(true);
  const [toast, setToast] = React.useState<{ message: string; type: "success" | "error" } | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editTask, setEditTask] = React.useState<TaskSummary | null>(null);
  const [editOpen, setEditOpen] = React.useState(false);

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  const loadData = React.useCallback(async () => {
    try {
      const [t, s, p] = await Promise.all([
        fetch("/api/tasks").then(r => r.json()),
        fetch("/api/stats").then(r => r.json()),
        fetch("/api/projects").then(r => r.json()),
      ]);
      setTasks(t); setStats(s); setProjects(p);
    } catch { showToast("Failed to load data", "error"); }
    finally { setLoading(false); }
  }, []);

  React.useEffect(() => { loadData(); }, [loadData]);
  React.useEffect(() => {
    const i = setInterval(loadData, 30000);
    return () => clearInterval(i);
  }, [loadData]);

  React.useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "n" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); setCreateOpen(true); }
      if (e.key === "0") setPage("dashboard");
      if (e.key === "1") setPage("tasks");
      if (e.key === "2") setPage("projects");
      if (e.key === "3") setPage("agents");
      if (e.key === "4") setPage("help");
      if (e.key === "r" && !e.ctrlKey && !e.metaKey) loadData();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [loadData]);

  async function handleStart(id: string) {
    const res = await fetch(`/api/tasks/${id}/start`, { method: "POST" });
    const data = await res.json();
    if (data.error) showToast(data.error, "error");
    else { showToast("Task started", "success"); loadData(); }
  }
  async function handleComplete(id: string) {
    const res = await fetch(`/api/tasks/${id}/complete`, { method: "POST" });
    const data = await res.json();
    if (data.error) showToast(data.error, "error");
    else { showToast("Task completed", "success"); loadData(); }
  }
  async function handleDelete(id: string) {
    const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (data.error) showToast(data.error, "error");
    else { showToast("Task deleted", "success"); loadData(); }
  }
  async function handleBulkAction(ids: string[], action: "complete" | "start" | "delete") {
    const res = await fetch("/api/tasks/bulk", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, action }),
    });
    const data = await res.json();
    if (data.error) showToast(data.error, "error");
    else { showToast(`${action}: ${data.succeeded} succeeded, ${data.failed} failed`, "success"); loadData(); }
  }

  const projectMap = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects) map.set(p.id, p.name);
    return map;
  }, [projects]);

  const navItems: { key: Page; label: string }[] = [
    { key: "dashboard", label: "Dashboard" },
    { key: "tasks", label: "Tasks" },
    { key: "projects", label: "Projects" },
    { key: "agents", label: "Agents" },
    { key: "help", label: "Help" },
  ];

  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-6">
            <button className="flex items-center gap-3 hover:opacity-80 transition-opacity" onClick={() => setPage("dashboard")}>
              <img src="/logo.jpg" alt="Hasna" className="h-7 w-auto rounded" />
              <h1 className="text-base font-semibold">Hasna <span className="font-normal text-muted-foreground">Todos</span></h1>
            </button>
            <nav className="flex items-center gap-1">
              {navItems.map((item) => (
                <Button key={item.key} variant={page === item.key ? "secondary" : "ghost"} size="sm" onClick={() => setPage(item.key)}>
                  {item.label}
                </Button>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" className="size-8" onClick={loadData} disabled={loading} title="Reload (r)">
              <RefreshCwIcon className={`size-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-6 py-6">
        {page === "dashboard" && <DashboardPage stats={stats} />}
        {page === "tasks" && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => setCreateOpen(true)} title="Press n">
                <PlusIcon className="size-4" /> New Task
              </Button>
              <Button variant="outline" size="sm" onClick={() => window.open("/api/tasks/export?format=csv", "_blank")}>
                <DownloadIcon className="size-4" /> Export CSV
              </Button>
              <Button variant="outline" size="sm" onClick={() => window.open("/api/tasks/export?format=json", "_blank")}>
                <DownloadIcon className="size-4" /> Export JSON
              </Button>
            </div>
            <TasksTable
              data={tasks} projectMap={projectMap} projects={projects}
              onStart={handleStart} onComplete={handleComplete} onDelete={handleDelete}
              onEdit={(task) => { setEditTask(task); setEditOpen(true); }}
              onBulkAction={handleBulkAction}
            />
          </>
        )}
        {page === "projects" && <ProjectsPage />}
        {page === "agents" && <AgentsPage />}
        {page === "help" && <HelpPage />}
      </main>

      <CreateTaskDialog open={createOpen} onOpenChange={setCreateOpen}
        onCreated={() => { showToast("Task created", "success"); loadData(); }} />
      <EditTaskDialog task={editTask} open={editOpen} onOpenChange={setEditOpen}
        onSaved={() => { showToast("Task updated", "success"); loadData(); }} />

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-lg border px-4 py-3 text-sm shadow-lg ${
          toast.type === "success"
            ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200"
            : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        }`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
