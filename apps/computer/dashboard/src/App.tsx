import { useState, useEffect } from "react";
import {
  ApiError,
  clearStoredApiKey,
  fetchSessions,
  fetchSession,
  fetchStats,
  getStoredApiKey,
  setStoredApiKey,
  type Session,
  type ActionLog,
  type TimelineItem,
  type SessionDetailResponse,
  type Stats,
} from "./api";

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running: "bg-yellow-500/20 text-yellow-400",
    waiting_on_approval: "bg-orange-500/20 text-orange-300",
    paused: "bg-cyan-500/20 text-cyan-300",
    pending: "bg-blue-500/20 text-blue-300",
    completed: "bg-green-500/20 text-green-400",
    failed: "bg-red-500/20 text-red-400",
    max_steps_exceeded: "bg-purple-500/20 text-purple-300",
    cancelling: "bg-red-500/20 text-red-300",
    cancelled: "bg-gray-500/20 text-gray-400",
    approved: "bg-green-500/20 text-green-400",
    blocked: "bg-red-500/20 text-red-400",
    denied: "bg-red-500/20 text-red-400",
    succeeded: "bg-green-500/20 text-green-400",
    accepted: "bg-blue-500/20 text-blue-300",
  };
  return (
    <span className={`inline-flex max-w-full items-center rounded px-2 py-0.5 text-xs font-medium leading-5 ${colors[status] ?? colors.cancelled}`}>
      {status}
    </span>
  );
}

function StatsBar({ stats }: { stats: Stats | null }) {
  if (!stats) return null;
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 md:mb-6 md:grid-cols-4 md:gap-4" data-testid="stats-bar">
      {[
        { label: "Sessions", value: stats.total_sessions },
        { label: "Completed", value: stats.completed },
        { label: "Failed", value: stats.failed },
        { label: "Total Steps", value: stats.total_steps },
      ].map((s) => (
        <div key={s.label} className="rounded-lg border border-gray-800 bg-gray-900 p-3 sm:p-4" data-testid={`stats-card-${s.label}`}>
          <div className="text-xl font-bold sm:text-2xl">{s.value}</div>
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
          data-testid={`session-row-${s.id}`}
          onClick={() => onSelect(s.id)}
          className={`w-full rounded-lg border px-3 py-2 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/60 ${
            selected === s.id
              ? "bg-blue-500/10 border-blue-500/40"
              : "bg-gray-900 border-gray-800 hover:border-gray-700"
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <span className="min-w-0 truncate text-sm font-mono text-gray-400">{s.id.slice(0, 8)}</span>
            <StatusBadge status={s.status} />
          </div>
          <div className="text-sm mt-1 truncate">{s.task}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
            <span>{s.provider}</span>
            <span>{s.steps} steps</span>
            <span>{(s.total_duration_ms / 1000).toFixed(1)}s</span>
          </div>
          {s.tags?.length ? (
            <div className="mt-1 flex flex-wrap gap-1">
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
  timeline,
}: {
  session: Session;
  logs: ActionLog[];
  timeline?: SessionDetailResponse["timeline"];
}) {
  const timelineItems = timeline?.items?.length ? timeline.items : logsToTimeline(logs);
  const lastEvent = timeline?.last_event_at ? formatTimestamp(timeline.last_event_at) : "No events";

  return (
    <div data-testid="session-detail">
      <div className="mb-4">
        <div className="flex items-center gap-3 mb-2">
          <h2 className="text-lg font-bold">Session</h2>
          <StatusBadge status={session.status} />
        </div>
        <p className="text-sm text-gray-300">{session.task}</p>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <div>
            <span className="text-gray-500">Provider</span>
            <div className="break-words">{session.provider} / {session.model}</div>
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
        <div className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          <div>
            <span className="text-gray-500">Run</span>
            <div className="break-words">{timeline?.run ? timeline.run.status : "legacy session"}</div>
          </div>
          <div>
            <span className="text-gray-500">Timeline Events</span>
            <div>{timelineItems.length}</div>
          </div>
          <div>
            <span className="text-gray-500">Last Event</span>
            <div>{lastEvent}</div>
          </div>
        </div>
        {session.error && (
          <div className="mt-2 p-2 bg-red-500/10 border border-red-500/30 rounded text-sm text-red-400">
            {session.error}
          </div>
        )}
      </div>

      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-sm font-bold text-gray-400">Live Timeline ({timelineItems.length} events)</h3>
        {timeline?.counts && (
          <div className="hidden flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-500 lg:flex">
            <span>{timeline.counts.model_decision} decisions</span>
            <span>{timeline.counts.action} actions</span>
            <span>{timeline.counts.approval} approvals</span>
            <span>{timeline.counts.artifact} artifacts</span>
          </div>
        )}
      </div>
      <div className="space-y-2">
        <div className="space-y-2" data-testid="timeline">
          {timelineItems.map((item) => (
            <TimelineRow key={item.id} item={item} />
          ))}
          {timelineItems.length === 0 && (
            <div className="flex items-center justify-center h-32 text-gray-600" data-testid="timeline-empty">
              No timeline events yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TimelineRow({ item }: { item: TimelineItem }) {
  const tone = item.status === "failed" || item.status === "blocked" || item.status === "denied"
    ? "bg-red-500/5 border-red-500/20"
    : "bg-gray-900 border-gray-800";
  const summary = item.summary || summarizeTimelineData(item);

  return (
    <div
      className={`p-3 rounded-lg border ${tone}`}
      data-testid={`timeline-item-${item.kind}`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {typeof item.step === "number" && (
              <span className="text-xs font-mono text-gray-500">#{item.step + 1}</span>
            )}
            <span className="text-sm font-medium text-yellow-300">{item.title}</span>
            <span className="text-[11px] uppercase tracking-wide text-gray-500">{item.kind.replace(/_/g, " ")}</span>
            {item.status && <StatusBadge status={item.status} />}
          </div>
          {summary && <p className="text-xs text-gray-400 mt-1 break-words">{summary}</p>}
          <TimelineMeta item={item} />
        </div>
        <span className="shrink-0 text-xs text-gray-500">{formatTimestamp(item.timestamp)}</span>
      </div>
    </div>
  );
}

function TimelineMeta({ item }: { item: TimelineItem }) {
  const fields: string[] = [];
  if (item.capability) fields.push(item.capability);
  if (item.provider || item.model) fields.push([item.provider, item.model].filter(Boolean).join(" / "));
  if (item.tokens) fields.push(`${item.tokens.total.toLocaleString()} tokens`);
  if (typeof item.duration_ms === "number") fields.push(`${item.duration_ms}ms`);
  if (item.artifact_path) fields.push(item.artifact_path);
  if (typeof item.cost_usd === "number" && item.cost_usd > 0) fields.push(`$${item.cost_usd.toFixed(4)}`);
  if (fields.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-500">
      {fields.map((field) => (
        <span key={field} className="max-w-full break-words">{field}</span>
      ))}
    </div>
  );
}

function logsToTimeline(logs: ActionLog[]): TimelineItem[] {
  return logs.flatMap((log) => {
    const tokens = tokenSummary(log.tokens_in, log.tokens_out);
    const action = redactAction(log.action);
    return [
      {
        id: `legacy-model-${log.id}`,
        kind: "model_decision",
        source: "action_logs",
        timestamp: log.created_at,
        title: `Model chose ${log.action.type}`,
        summary: log.reasoning,
        status: log.success ? "accepted" : "failed",
        step: log.step,
        action,
        tokens,
      },
      {
        id: `legacy-action-${log.id}`,
        kind: "action",
        source: "action_logs",
        timestamp: log.created_at,
        title: `Action: ${log.action.type}`,
        summary: log.error || summarizeAction(log.action),
        status: log.success ? "succeeded" : "failed",
        step: log.step,
        action,
        artifact_path: log.screenshot_path,
        duration_ms: log.duration_ms,
        tokens,
      },
    ];
  });
}

function redactAction(action: unknown): unknown {
  if (!action || typeof action !== "object") return action;
  const value = action as Record<string, unknown>;
  if (value.type !== "type") return action;
  return {
    ...value,
    text: "[redacted]",
    text_length: typeof value.text === "string" ? value.text.length : undefined,
  };
}

function tokenSummary(input?: number, output?: number): TimelineItem["tokens"] | undefined {
  const inTokens = input ?? 0;
  const outTokens = output ?? 0;
  if (inTokens === 0 && outTokens === 0) return undefined;
  return { input: inTokens, output: outTokens, total: inTokens + outTokens };
}

function summarizeTimelineData(item: TimelineItem): string | undefined {
  if (item.kind === "action") return summarizeAction(item.action);
  return summarizeData(item.data ?? item.result);
}

function summarizeAction(action: unknown): string | undefined {
  if (!action || typeof action !== "object") return undefined;
  const value = action as Record<string, unknown>;
  if (value.type === "click" && value.point && typeof value.point === "object") {
    const point = value.point as Record<string, unknown>;
    if (typeof point.x === "number" && typeof point.y === "number") return `at ${point.x}, ${point.y}`;
  }
  if (value.type === "type" && typeof value.text === "string") return `typed ${value.text.length} characters`;
  if (value.type === "open_url" && typeof value.url === "string") return value.url;
  return undefined;
}

function summarizeData(data: unknown): string | undefined {
  if (data === undefined || data === null) return undefined;
  if (typeof data === "string") return data;
  if (typeof data === "number" || typeof data === "boolean") return String(data);
  if (typeof data === "object") {
    const record = data as Record<string, unknown>;
    for (const key of ["summary", "reason", "next_step", "path"] as const) {
      if (typeof record[key] === "string") return record[key];
    }
  }
  try {
    return JSON.stringify(data);
  } catch {
    return undefined;
  }
}

function formatTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetailResponse | null>(null);
  const [apiKey, setApiKey] = useState(() => getStoredApiKey());
  const [apiKeyDraft, setApiKeyDraft] = useState(apiKey);
  const [apiError, setApiError] = useState<string | null>(null);

  function describeError(error: unknown): string {
    if (error instanceof ApiError && error.status === 401) {
      return "Authentication required.";
    }
    return error instanceof Error ? error.message : String(error);
  }

  function saveApiKey() {
    const next = apiKeyDraft.trim();
    setStoredApiKey(next);
    setApiKey(next);
  }

  function clearApiKey() {
    clearStoredApiKey();
    setApiKey("");
    setApiKeyDraft("");
  }

  useEffect(() => {
    async function refresh() {
      const [sessionsResult, statsResult] = await Promise.allSettled([fetchSessions(), fetchStats()]);
      const errors: string[] = [];
      if (sessionsResult.status === "fulfilled") {
        setSessions(sessionsResult.value);
      } else {
        setSessions([]);
        errors.push(describeError(sessionsResult.reason));
      }
      if (statsResult.status === "fulfilled") {
        setStats(statsResult.value);
      } else {
        setStats(null);
        errors.push(describeError(statsResult.reason));
      }
      setApiError(errors.length ? Array.from(new Set(errors)).join(" ") : null);
    }
    refresh();
    const interval = setInterval(() => {
      refresh();
    }, 3000);
    return () => clearInterval(interval);
  }, [apiKey]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    async function refresh() {
      try {
        setDetail(await fetchSession(selectedId!));
        setApiError(null);
      } catch (error) {
        setDetail(null);
        setApiError(describeError(error));
      }
    }
    refresh();
    const interval = setInterval(() => {
      refresh();
    }, 1000);
    return () => clearInterval(interval);
  }, [selectedId, apiKey]);

  return (
    <div className="mx-auto min-h-screen max-w-7xl px-4 py-4 sm:px-6 sm:py-6">
      <header className="mb-4 flex flex-col gap-2 sm:mb-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold">Computer Use Dashboard</h1>
          <p className="text-sm text-gray-500">@hasna/computer</p>
        </div>
        <div className="text-xs text-gray-600 sm:text-right">
          Auto-refreshing every 3s
        </div>
      </header>

      <div className="mb-4 grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
        <input
          aria-label="API key"
          type="password"
          value={apiKeyDraft}
          onChange={(event) => setApiKeyDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") saveApiKey(); }}
          placeholder="API key"
          className="min-w-0 rounded border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/40"
        />
        <button
          type="button"
          onClick={saveApiKey}
          className="rounded bg-blue-600 px-3 py-2 text-sm font-medium hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/60"
        >
          Save
        </button>
        <button
          type="button"
          onClick={clearApiKey}
          className="rounded border border-gray-800 px-3 py-2 text-sm hover:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/60"
        >
          Clear
        </button>
      </div>

      {apiError && (
        <div role="alert" className="mb-4 p-3 rounded border border-red-500/30 bg-red-500/10 text-sm text-red-300">
          {apiError}
        </div>
      )}

      <StatsBar stats={stats} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_minmax(0,1fr)] lg:gap-6">
        <div className="min-w-0 lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto">
          <SessionList sessions={sessions} selected={selectedId} onSelect={setSelectedId} />
          {sessions.length === 0 && (
            <p className="text-center text-gray-600 py-8">
              No sessions yet. Run <code className="text-blue-400">computer run "task"</code> to start.
            </p>
          )}
        </div>
        <div className="min-w-0 lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto">
          {detail ? (
            <SessionDetail session={detail.session} logs={detail.action_logs} timeline={detail.timeline} />
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
