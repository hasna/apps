import * as React from "react";

interface AgentPresence {
  agent: string;
  status: string;
  last_seen_at: string;
  online: boolean;
  metadata: Record<string, unknown> | null;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const normalized = dateStr.endsWith("Z") ? dateStr : `${dateStr}Z`;
  const then = Date.parse(normalized);
  if (Number.isNaN(then)) return "";
  const diff = Math.max(0, now - then);
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function agentColor(name: string): string {
  const colors = [
    "bg-blue-500", "bg-green-500", "bg-purple-500", "bg-orange-500",
    "bg-pink-500", "bg-teal-500", "bg-indigo-500", "bg-rose-500",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

export function AgentsPage() {
  const [agents, setAgents] = React.useState<AgentPresence[]>([]);

  React.useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/agents");
        const data = (await res.json()) as AgentPresence[];
        // Sort: online first, then by last_seen_at desc
        data.sort((a, b) => {
          if (a.online !== b.online) return a.online ? -1 : 1;
          return b.last_seen_at.localeCompare(a.last_seen_at);
        });
        setAgents(data);
      } catch {
        // ignore
      }
    };
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, []);

  if (agents.length === 0) {
    return (
      <div>
        <h2 className="text-lg font-semibold mb-4">Agents</h2>
        <div className="rounded-xl border p-8 text-center text-muted-foreground">
          No agents registered yet. Agents appear here after sending a heartbeat via{" "}
          <code className="text-xs bg-muted px-1.5 py-0.5 rounded">conversations agents heartbeat</code>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Agents</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {agents.map((agent) => (
          <div
            key={agent.agent}
            className="rounded-xl border bg-card p-5 hover:border-foreground/20 transition-colors"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className={`size-10 rounded-full ${agentColor(agent.agent)} flex items-center justify-center text-white text-lg font-bold shrink-0`}>
                {agent.agent[0].toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm truncate">{agent.agent}</span>
                  <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full font-medium ${
                    agent.online
                      ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
                      : "bg-muted text-muted-foreground"
                  }`}>
                    <span className={`size-1.5 rounded-full ${agent.online ? "bg-green-500" : "bg-muted-foreground/50"}`} />
                    {agent.online ? "online" : "offline"}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Last seen {timeAgo(agent.last_seen_at)}
                </p>
              </div>
            </div>
            {agent.status && agent.status !== "online" && (
              <p className="text-sm text-muted-foreground truncate">{agent.status}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
