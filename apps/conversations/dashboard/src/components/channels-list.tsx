import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Channel } from "@/types";

interface ChannelsListProps {
  channels: Channel[];
}

export function ChannelsList({ channels }: ChannelsListProps) {
  if (channels.length === 0) {
    return (
      <div className="rounded-xl border p-8 text-center text-muted-foreground">
        No channels yet. Create one with{" "}
        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
          conversations channel create
        </code>
      </div>
    );
  }

  return (
    <div className="rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Channel</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Created by</TableHead>
            <TableHead className="text-right">Members</TableHead>
            <TableHead className="text-right">Messages</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {channels.map((ch) => (
            <TableRow key={ch.name}>
              <TableCell>
                <Badge className="bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 border-0">
                  #{ch.name}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {ch.description || "—"}
              </TableCell>
              <TableCell className="font-medium">{ch.created_by}</TableCell>
              <TableCell className="text-right">{ch.member_count}</TableCell>
              <TableCell className="text-right">{ch.message_count}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
