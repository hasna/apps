import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Message } from "@/types";

interface MessagesTableProps {
  messages: Message[];
}

function PriorityBadge({ priority }: { priority: string }) {
  switch (priority) {
    case "urgent":
      return (
        <Badge className="bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 border-0">
          urgent
        </Badge>
      );
    case "high":
      return (
        <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 border-0">
          high
        </Badge>
      );
    case "low":
      return (
        <Badge className="bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-400 border-0">
          low
        </Badge>
      );
    default:
      return null;
  }
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr + "Z").getTime();
  const diff = now - then;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function MessagesTable({ messages }: MessagesTableProps) {
  if (messages.length === 0) {
    return (
      <div className="rounded-xl border p-8 text-center text-muted-foreground">
        No messages yet. Send one from the CLI or use the button above.
      </div>
    );
  }

  return (
    <div className="rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">#</TableHead>
            <TableHead>From</TableHead>
            <TableHead>To</TableHead>
            <TableHead>Content</TableHead>
            <TableHead>Priority</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Time</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {messages.map((msg) => (
            <TableRow key={msg.id}>
              <TableCell className="text-muted-foreground">{msg.id}</TableCell>
              <TableCell>
                <span className="font-medium">{msg.from_agent}</span>
              </TableCell>
              <TableCell>
                {msg.channel ? (
                  <Badge className="bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 border-0">
                    #{msg.channel}
                  </Badge>
                ) : (
                  <span>{msg.to_agent}</span>
                )}
              </TableCell>
              <TableCell className="max-w-xs truncate">{msg.content}</TableCell>
              <TableCell>
                <PriorityBadge priority={msg.priority} />
              </TableCell>
              <TableCell>
                {msg.read_at ? (
                  <Badge
                    variant="outline"
                    className="border-green-300 text-green-700 dark:border-green-800 dark:text-green-400"
                  >
                    Read
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="border-orange-300 text-orange-700 dark:border-orange-800 dark:text-orange-400"
                  >
                    Unread
                  </Badge>
                )}
              </TableCell>
              <TableCell className="text-right text-muted-foreground">
                {timeAgo(msg.created_at)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
