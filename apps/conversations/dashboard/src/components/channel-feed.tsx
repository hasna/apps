import * as React from "react";
import { ArrowLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/markdown";
import type { Message } from "@/types";

interface ChannelFeedProps {
  channelName: string;
  onBack: () => void;
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

export function ChannelFeed({ channelName, onBack }: ChannelFeedProps) {
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [limit, setLimit] = React.useState(50);

  React.useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`/api/messages?channel=${encodeURIComponent(channelName)}&limit=${limit}`);
        const data = (await res.json()) as Message[];
        // API returns newest first — keep that order for feed (newest on top)
        setMessages(data);
      } catch {
        // ignore
      }
    };
    load();
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [channelName, limit]);

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeftIcon className="size-4" />
        </Button>
        <h2 className="text-lg font-semibold">#{channelName}</h2>
        <span className="text-sm text-muted-foreground">{messages.length} messages</span>
      </div>

      {messages.length === 0 ? (
        <div className="rounded-xl border p-8 text-center text-muted-foreground">
          No messages in this channel yet.
        </div>
      ) : (
        <div className="space-y-3">
          {messages.map((msg) => (
            <article
              key={msg.id}
              className="rounded-lg border bg-card p-4 hover:border-foreground/20 transition-colors"
            >
              <div className="flex items-center gap-2 mb-2">
                <div className={`size-6 rounded-full ${agentColor(msg.from_agent)} flex items-center justify-center text-white text-xs font-bold`}>
                  {msg.from_agent[0].toUpperCase()}
                </div>
                <span className="font-medium text-sm">{msg.from_agent}</span>
                <span className="text-xs text-muted-foreground">·</span>
                <span className="text-xs text-muted-foreground">{timeAgo(msg.created_at)}</span>
                {msg.priority !== "normal" && (
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                    msg.priority === "urgent" ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" :
                    msg.priority === "high" ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" :
                    "bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-400"
                  }`}>
                    {msg.priority}
                  </span>
                )}
              </div>
              <div className="text-sm pl-8">
                <Markdown>{msg.preview}</Markdown>
              </div>
            </article>
          ))}
          {messages.length >= limit && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" size="sm" onClick={() => setLimit((prev) => prev + 50)}>
                Load more
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
