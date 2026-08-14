import { useState, useEffect } from "react";
import { fetchSessions, fetchSession, fetchStats, type Session, type ActionLog, type Stats } from "./api";

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running: "bg-yellow-500/20 text-yellow-400",
    completed: "bg-green-500/20 text-green-400",
    failed: "bg-red-500/20 text-red-400",
    cancelled: "bg-gray-500/20 text-gray-400",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[status] ?? colors.cancelled}`}>
      {status}
    </span>
  );
}

function StatsBar({ stats }: { stats: Stats | null }) {
  if (!stats) return null;
  return (
    <div className="grid grid-cols-4 gap-4 mb-6">
      {[
        { label: "Sessions", value: stats.total_sessions },
        { label: "Completed", value: stats.completed },
        { label: "Failed", value: stats.failed },
        { label: "Total Steps", value: stats.total_steps },
      ].map((s) => (
        <div key={s.label} className="bg-gray-900 rounded-lg p-4 border border-gray-800">
          <div className="text-2xl font-bold">{s.value}</div>
          <div className="text-xs text-gray-400">{s.label}</div>
        </div>
      ))}
    </div>
  );
}

function SessionList({
  sessions,
  selected,
  onSelect,
}: {
  sessions: Session[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="space-y-1">
      {sessions.map((s) => (
        <button
          key={s.id}
          onClick={() => onSelect(s.id)}
          className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
            selected === s.id
              ? "bg-blue-500/10 border-blue-500/40"
              : "bg-gray-900 border-gray-800 hover:border-gray-700"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-mono text-gray-400">{s.id.slice(0, 8)}</span>
            <StatusBadge status={s.status} />
          </div>
          <div className="text-sm mt-1 truncate">{s.task}</div>
          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
            <span>{s.provider}</span>
            <span>{s.steps} steps</span>
            <span>{(s.total_duration_ms / 1000).toFixed(1)}s</span>
          </div>
          {s.tags?.length ? (
            <div className="flex gap-1 mt-1">
              {s.tags.map((t) => (
                <span key={t} className="px-1.5 py-0.5 bg-purple-500/20 text-purple-400 rounded text-xs">
                  {t}
                </span>
              ))}
            </div>
          ) : null}
        </button>
      ))}
    </div>
  );
}

function SessionDetail({
  session,
  logs,
}: {
  session: Session;
  logs: ActionLog[];
}) {
  return (
    <div>
      <div className="mb-4">
        <div className="flex items-center gap-3 mb-2">
          <h2 className="text-lg font-bold">Session</h2>
          <StatusBadge status={session.status} />
        </div>
        <p className="text-sm text-gray-300">{session.task}</p>
        <div className="grid grid-cols-4 gap-3 mt-3 text-sm">
          <div>
            <span className="text-gray-500">Provider</span>
            <div>{session.provider} / {session.model}</div>
          </div>
          <div>
            <span className="text-gray-500">Steps</span>
            <div>{session.steps}</div>
          </div>
          <div>
            <span className="text-gray-500">Tokens</span>
            <div>{(session.total_tokens_in + session.total_tokens_out).toLocaleString()}</div>
          </div>
          <div>
            <span className="text-gray-500">Duration</span>
            <div>{(session.total_duration_ms / 1000).toFixed(1)}s</div>
          </div>
        </div>
        {session.error && (
          <div className="mt-2 p-2 bg-red-500/10 border border-red-500/30 rounded text-sm text-red-400">
            {session.error}
          </div>
        )}
      </div>

      <h3 className="text-sm font-bold mb-2 text-gray-400">Action Log ({logs.length} steps)</h3>
      <div className="space-y-2">
        {logs.map((log) => (
          <div
            key={log.id}
            className={`p-3 rounded-lg border ${
              log.success ? "bg-gray-900 border-gray-800" : "bg-red-500/5 border-red-500/20"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-gray-500">#{log.step + 1}</span>
                <span className={`text-sm font-medium ${log.success ? "text-yellow-400" : "text-red-400"}`}>
                  {log.action.type}
                </span>
                {log.action.type === "click" && log.action.point && (
                  <span className="text-xs text-gray-500">
                    ({log.action.point.x}, {log.action.point.y})
                  </span>
                )}
                {log.action.type === "type" && (
                  <span className="text-xs text-gray-500 truncate max-w-[200px]">
                    "{log.action.text}"
                  </span>
                )}
              </div>
              <span className="text-xs text-gray-500">{log.duration_ms}ms</span>
            </div>
            {log.reasoning && (
              <p className="text-xs text-gray-400 mt-1 line-clamp-2">{log.reasoning}</p>
            )}
            {log.error && (
              <p className="text-xs text-red-400 mt-1">{log.error}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ session: Session; action_logs: ActionLog[] } | null>(null);

  useEffect(() => {
    fetchSessions().then(setSessions).catch(() => {});
    fetchStats().then(setStats).catch(() => {});
    const interval = setInterval(() => {
      fetchSessions().then(setSessions).catch(() => {});
      fetchStats().then(setStats).catch(() => {});
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    fetchSession(selectedId).then(setDetail).catch(() => {});
    const interval = setInterval(() => {
      fetchSession(selectedId).then(setDetail).catch(() => {});
    }, 1000);
    return () => clearInterval(interval);
  }, [selectedId]);

  return (
    <div className="min-h-screen p-6 max-w-7xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">Computer Use Dashboard</h1>
          <p className="text-sm text-gray-500">@hasna/computer</p>
        </div>
        <div className="text-xs text-gray-600">
          Auto-refreshing every 3s
        </div>
      </header>

      <StatsBar stats={stats} />

      <div className="grid grid-cols-[360px_1fr] gap-6">
        <div className="max-h-[calc(100vh-220px)] overflow-y-auto">
          <SessionList sessions={sessions} selected={selectedId} onSelect={setSelectedId} />
          {sessions.length === 0 && (
            <p className="text-center text-gray-600 py-8">
              No sessions yet. Run <code className="text-blue-400">computer run "task"</code> to start.
            </p>
          )}
        </div>
        <div className="max-h-[calc(100vh-220px)] overflow-y-auto">
          {detail ? (
            <SessionDetail session={detail.session} logs={detail.action_logs} />
          ) : (
            <div className="flex items-center justify-center h-64 text-gray-600">
              Select a session to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
