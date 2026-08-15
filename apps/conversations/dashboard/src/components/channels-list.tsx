import { HashIcon, MessageSquareIcon, UsersIcon } from "lucide-react";
import type { Channel } from "@/types";

interface ChannelsListProps {
  channels: Channel[];
  onSelectChannel: (name: string) => void;
  unreadCounts?: Record<string, number>;
}

export function ChannelsList({ channels, onSelectChannel, unreadCounts }: ChannelsListProps) {
  if (channels.length === 0) {
    return (
      <div className="rounded-xl border p-8 text-center text-muted-foreground">
        No channels yet. Create one with{" "}
        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">conversations channel create</code>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Channels</h2>
      <div className="rounded-xl border divide-y">
        {channels.map((channel) => {
          const unread = unreadCounts?.[channel.name] ?? 0;
          return (
            <button
              key={channel.name}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors"
              onClick={() => onSelectChannel(channel.name)}
            >
              <HashIcon className="size-4 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm truncate">{channel.name}</span>
                  {unread > 0 && (
                    <span className="inline-flex min-w-[1.25rem] h-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-bold text-white">
                      {unread}
                    </span>
                  )}
                </div>
                {(channel.topic || channel.description) && (
                  <p className="text-xs text-muted-foreground truncate">
                    {channel.topic || channel.description}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <MessageSquareIcon className="size-3" />
                  {channel.message_count}
                </span>
                <span className="flex items-center gap-1">
                  <UsersIcon className="size-3" />
                  {channel.member_count}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
