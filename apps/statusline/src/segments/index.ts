import { hostname } from "node:os";
import type { Segment, StatusContext } from "../providers/types.js";
import { compactAge, compactDuration, compactNum, money } from "../format.js";
import { gitBranch, gitProjectName, lastCommitEpoch, trackedLineCount } from "../git.js";
import { contextUsage } from "../context-window.js";
import { sessionAccount, sessionAccountEmail } from "../accounts.js";

/**
 * Format a model id like "claude-fable-5[1m]" or "claude-3-5-sonnet-20241022"
 * into a friendly name ("fable 5", "sonnet 3.5") plus an optional context tag.
 */
function friendlyModel(id: string): { name: string; tag: string | null } {
  let tag: string | null = null;
  let mid = id;
  const tagMatch = mid.match(/\[([^\]]+)\]$/);
  if (tagMatch) {
    tag = `[${tagMatch[1]}]`;
    mid = mid.slice(0, mid.length - tagMatch[0].length);
  }
  mid = mid.replace(/^claude-/, "").replace(/-\d{8}$/, "");
  const tokens = mid.split("-").filter(Boolean);
  const words = tokens.filter((t) => !/^\d+$/.test(t));
  const nums = tokens.filter((t) => /^\d+$/.test(t));
  const name = [words.join(" "), nums.join(".")].filter(Boolean).join(" ");
  return { name: name || mid, tag };
}

const dir = (ctx: StatusContext) => ctx.cwd || process.cwd();

/** Model name for display: the host's own label, else a tidied-up id. */
function modelName(ctx: StatusContext): string | null {
  if (ctx.model?.displayName) return ctx.model.displayName;
  return ctx.model?.id ? friendlyModel(ctx.model.id).name : null;
}

/** Gauge value for colour escalation; an unreported window never escalates. */
function limitPercent(pct: number | undefined): number {
  return typeof pct === "number" ? pct : 0;
}

export const segments: Segment[] = [
  {
    id: "machine",
    description: "Machine hostname (short)",
    defaultEnabled: true,
    render: () => hostname().split(".")[0] || null,
  },
  {
    id: "project",
    description: "Project name with current Git branch",
    defaultEnabled: true,
    render(ctx) {
      const name = gitProjectName(dir(ctx)) || dir(ctx).split("/").pop() || null;
      if (!name) return null;
      const branch = gitBranch(dir(ctx));
      return branch ? `${name} (${branch})` : name;
    },
  },
  {
    id: "project-name",
    description: "Project name (omitted when unavailable)",
    defaultEnabled: false,
    render: (ctx) => gitProjectName(dir(ctx)) || dir(ctx).split("/").pop() || null,
  },
  {
    id: "git-branch",
    description: "Current Git branch (omitted when unavailable)",
    defaultEnabled: false,
    render: (ctx) => gitBranch(dir(ctx)),
  },
  {
    id: "commit-age",
    description: "Time since last commit (compact)",
    defaultEnabled: true,
    render(ctx) {
      const ts = lastCommitEpoch(dir(ctx));
      if (!ts) return null;
      return compactAge(Date.now() / 1000 - ts);
    },
  },
  {
    id: "loc",
    description: "Lines of code tracked by Git (compact)",
    defaultEnabled: true,
    render(ctx) {
      const n = trackedLineCount(dir(ctx));
      return n ? compactNum(n) : null;
    },
  },
  {
    id: "current-dir",
    description: "Current working directory (basename)",
    defaultEnabled: false,
    render: (ctx) => dir(ctx).split("/").pop() || null,
  },
  {
    id: "model",
    description: "Current model name",
    defaultEnabled: false,
    render(ctx) {
      if (!ctx.model?.id) return null;
      return friendlyModel(ctx.model.id).name;
    },
  },
  {
    id: "model-context",
    description: "Model name with context-size tag (e.g. [1m])",
    defaultEnabled: true,
    render(ctx) {
      if (!ctx.model?.id) return null;
      const { name, tag } = friendlyModel(ctx.model.id);
      return tag ? `${name} ${tag}` : name;
    },
  },
  {
    id: "model-with-reasoning",
    description: "Model name with its reasoning effort (or thinking, when on)",
    defaultEnabled: false,
    color: "cyan",
    render(ctx) {
      const name = modelName(ctx);
      if (!name) return null;
      if (ctx.effort) return `${name} (${ctx.effort})`;
      if (ctx.thinking) return `${name} (thinking)`;
      return name;
    },
  },
  {
    id: "auth-profile",
    description: "Account profile this session runs as (omitted when unmanaged)",
    defaultEnabled: false,
    color: "magenta",
    async render(ctx) {
      // Resolved from this process's own config dir, never from a global
      // "active profile" pointer — concurrent sessions must not agree.
      const account = await sessionAccount(process.env, ctx.provider);
      return account.profile ?? (await sessionAccountEmail(process.env, ctx.provider));
    },
  },
  {
    id: "auth-email",
    description: "Account email this session is logged in as (omitted when unknown)",
    defaultEnabled: false,
    color: "magenta",
    render: (ctx) => sessionAccountEmail(process.env, ctx.provider),
  },
  {
    id: "five-hour-limit",
    description: "Percentage of the 5-hour rate limit used (omitted when unreported)",
    defaultEnabled: false,
    color: (ctx) => (limitPercent(ctx.rateLimits?.fiveHour?.usedPercentage) >= 80 ? "red" : "yellow"),
    render(ctx) {
      const pct = ctx.rateLimits?.fiveHour?.usedPercentage;
      return typeof pct === "number" ? `5h:${Math.round(pct)}%` : null;
    },
  },
  {
    id: "seven-day-limit",
    description: "Percentage of the 7-day rate limit used (omitted when unreported)",
    defaultEnabled: false,
    color: (ctx) => (limitPercent(ctx.rateLimits?.sevenDay?.usedPercentage) >= 80 ? "red" : "yellow"),
    render(ctx) {
      const pct = ctx.rateLimits?.sevenDay?.usedPercentage;
      return typeof pct === "number" ? `7d:${Math.round(pct)}%` : null;
    },
  },
  {
    id: "thread-title",
    description: "Thread title set with /rename (omitted until named)",
    defaultEnabled: false,
    color: "blue",
    render: (ctx) => ctx.sessionName || null,
  },
  {
    id: "context-used",
    description: "Percentage of context window used (omitted when unknown)",
    defaultEnabled: false,
    render(ctx) {
      const u = contextUsage(ctx);
      if (!u) return null;
      return `${Math.min(100, Math.round((u.used / u.window) * 100))}%`;
    },
  },
  {
    id: "context-remaining",
    description: "Percentage of context window remaining (omitted when unknown)",
    defaultEnabled: true,
    render(ctx) {
      const u = contextUsage(ctx);
      if (!u) return null;
      return `${Math.max(0, 100 - Math.round((u.used / u.window) * 100))}% left`;
    },
  },
  {
    id: "used-tokens",
    description: "Total tokens in the context window (omitted when unknown)",
    defaultEnabled: false,
    render(ctx) {
      const u = contextUsage(ctx);
      if (!u) return null;
      return `${compactNum(u.used + u.output)} tok`;
    },
  },
  {
    id: "cost",
    description: "Session cost in USD (omitted when zero)",
    defaultEnabled: true,
    render(ctx) {
      const c = ctx.cost?.totalCostUsd;
      return c ? money(c) : null;
    },
  },
  {
    id: "duration",
    description: "Session wall-clock duration",
    defaultEnabled: false,
    render(ctx) {
      const ms = ctx.cost?.totalDurationMs;
      return ms ? compactDuration(ms) : null;
    },
  },
  {
    id: "lines-changed",
    description: "Lines added/removed this session (omitted when zero)",
    defaultEnabled: false,
    render(ctx) {
      const a = ctx.cost?.totalLinesAdded || 0;
      const r = ctx.cost?.totalLinesRemoved || 0;
      if (!a && !r) return null;
      return `+${a}/-${r}`;
    },
  },
  {
    id: "output-style",
    description: "Active output style (omitted when default)",
    defaultEnabled: false,
    render(ctx) {
      const s = ctx.outputStyle;
      return s && s !== "default" ? s : null;
    },
  },
  {
    id: "agent-version",
    description: "Host agent version (e.g. Claude Code version)",
    defaultEnabled: false,
    render: (ctx) => (ctx.version ? `v${ctx.version}` : null),
  },
  {
    id: "session-id",
    description: "Session identifier (short)",
    defaultEnabled: false,
    render: (ctx) => (ctx.sessionId ? ctx.sessionId.split("-")[0] : null),
  },
];

export function getSegment(id: string): Segment | undefined {
  return segments.find((s) => s.id === id);
}
