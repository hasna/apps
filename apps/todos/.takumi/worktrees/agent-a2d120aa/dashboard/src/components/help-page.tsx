import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KeyboardIcon, TerminalIcon, BookOpenIcon, ServerIcon, ArrowRightIcon } from "lucide-react";

export function HelpPage() {
  return (
    <div className="space-y-6">
      {/* How it works breadcrumb */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">How it works</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Step n="1" label="Install" desc="bun install -g @hasna/todos" />
            <ArrowRightIcon className="size-4 text-muted-foreground shrink-0" />
            <Step n="2" label="Add tasks" desc="todos add 'Fix login bug'" />
            <ArrowRightIcon className="size-4 text-muted-foreground shrink-0" />
            <Step n="3" label="Connect AI" desc="Add todos-mcp to your agent" />
            <ArrowRightIcon className="size-4 text-muted-foreground shrink-0" />
            <Step n="4" label="Track" desc="todos serve or todos interactive" />
          </div>
        </CardContent>
      </Card>

      {/* Keyboard Shortcuts */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2"><KeyboardIcon className="size-4" /> Keyboard Shortcuts</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
            <Shortcut keys="/" label="Focus search" />
            <Shortcut keys="n" label="New task" />
            <Shortcut keys="r" label="Reload data" />
            <Shortcut keys="0" label="Dashboard" />
            <Shortcut keys="1" label="Tasks" />
            <Shortcut keys="2" label="Projects" />
            <Shortcut keys="3" label="Agents" />
            <Shortcut keys="4" label="Help" />
            <Shortcut keys="Esc" label="Back / clear" />
          </div>
        </CardContent>
      </Card>

      {/* CLI */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2"><TerminalIcon className="size-4" /> CLI Commands</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <Cmd cmd="todos add 'Task'" desc="Create a new task" />
            <Cmd cmd="todos list" desc="List all tasks" />
            <Cmd cmd="todos list --status pending" desc="Filter by status" />
            <Cmd cmd="todos show <id>" desc="Show task details" />
            <Cmd cmd="todos start <id>" desc="Start a task" />
            <Cmd cmd="todos done <id>" desc="Complete a task" />
            <Cmd cmd="todos search 'query'" desc="Full-text search" />
            <Cmd cmd="todos serve" desc="Start web dashboard" />
            <Cmd cmd="todos interactive" desc="Interactive TUI" />
            <Cmd cmd="todos sync --task-list <id>" desc="Sync with Claude Code" />
          </div>
        </CardContent>
      </Card>

      {/* MCP */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2"><ServerIcon className="size-4" /> MCP Server</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3">Add to your Claude Code or AI agent config:</p>
          <pre className="rounded-lg bg-muted p-3 text-sm font-mono overflow-x-auto">
{`{
  "mcpServers": {
    "todos": {
      "command": "todos-mcp",
      "args": []
    }
  }
}`}
          </pre>
          <p className="text-sm text-muted-foreground mt-3">29 tools available: create_task, list_tasks, get_task, update_task, delete_task, start_task, complete_task, lock_task, unlock_task, add_dependency, remove_dependency, add_comment, create_project, list_projects, create_plan, list_plans, get_plan, update_plan, delete_plan, register_agent, list_agents, get_agent, create_task_list, list_task_lists, get_task_list, update_task_list, delete_task_list, search_tasks, sync.</p>
        </CardContent>
      </Card>

      {/* Links */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2"><BookOpenIcon className="size-4" /> Resources</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <a href="https://github.com/hasna/todos" target="_blank" rel="noopener noreferrer" className="block text-primary hover:underline">GitHub Repository</a>
            <a href="https://github.com/hasna/todos#readme" target="_blank" rel="noopener noreferrer" className="block text-primary hover:underline">Documentation</a>
            <a href="https://github.com/hasna/todos/issues" target="_blank" rel="noopener noreferrer" className="block text-primary hover:underline">Report Issues</a>
            <a href="https://www.npmjs.com/package/@hasna/todos" target="_blank" rel="noopener noreferrer" className="block text-primary hover:underline">npm Package</a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Step({ n, label, desc }: { n: string; label: string; desc: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
      <span className="flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold">{n}</span>
      <div>
        <div className="font-medium">{label}</div>
        <code className="text-muted-foreground font-mono text-sm">{desc}</code>
      </div>
    </div>
  );
}

function Shortcut({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <kbd className="rounded border bg-muted px-1.5 py-0.5 text-sm font-mono">{keys}</kbd>
    </div>
  );
}

function Cmd({ cmd, desc }: { cmd: string; desc: string }) {
  return (
    <div className="flex items-start gap-3">
      <code className="rounded bg-muted px-2 py-0.5 text-sm font-mono shrink-0">{cmd}</code>
      <span className="text-muted-foreground">{desc}</span>
    </div>
  );
}
