import * as React from "react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  KeyIcon,
  RefreshCwIcon,
  DownloadIcon,
  TrashIcon,
  LinkIcon,
  ActivityIcon,
} from "lucide-react";

interface ActivityEntry {
  action: string;
  connector: string;
  timestamp: number;
  detail?: string;
}

const ACTION_CONFIG: Record<
  string,
  { label: string; icon: React.ReactNode; color: string }
> = {
  key_saved: {
    label: "API key saved",
    icon: <KeyIcon className="size-3.5" />,
    color: "text-blue-500",
  },
  token_refreshed: {
    label: "Token refreshed",
    icon: <RefreshCwIcon className="size-3.5" />,
    color: "text-green-500",
  },
  installed: {
    label: "Installed",
    icon: <DownloadIcon className="size-3.5" />,
    color: "text-emerald-500",
  },
  uninstalled: {
    label: "Uninstalled",
    icon: <TrashIcon className="size-3.5" />,
    color: "text-red-500",
  },
  oauth_connected: {
    label: "OAuth connected",
    icon: <LinkIcon className="size-3.5" />,
    color: "text-purple-500",
  },
};

function getRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function ActivityLog({ activities }: { activities: ActivityEntry[] }) {
  const [expanded, setExpanded] = React.useState(false);

  if (activities.length === 0) return null;

  return (
    <div className="rounded-lg border">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium text-left hover:bg-muted/50 transition-colors"
      >
        {expanded ? (
          <ChevronDownIcon className="size-4 text-muted-foreground" />
        ) : (
          <ChevronRightIcon className="size-4 text-muted-foreground" />
        )}
        <ActivityIcon className="size-4 text-muted-foreground" />
        <span>Recent Activity</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {activities.length} {activities.length === 1 ? "event" : "events"}
        </span>
      </button>
      {expanded && (
        <div className="border-t divide-y">
          {activities.map((entry, i) => {
            const config = ACTION_CONFIG[entry.action] || {
              label: entry.action,
              icon: <ActivityIcon className="size-3.5" />,
              color: "text-muted-foreground",
            };
            return (
              <div
                key={`${entry.timestamp}-${i}`}
                className="flex items-center gap-3 px-4 py-2.5 text-sm"
              >
                <span className={config.color}>{config.icon}</span>
                <span className="font-medium">{config.label}</span>
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-muted-foreground">
                  {entry.connector}
                </code>
                {entry.detail && (
                  <span className="text-xs text-muted-foreground hidden sm:inline">
                    {entry.detail}
                  </span>
                )}
                <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap">
                  {getRelativeTime(entry.timestamp)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
