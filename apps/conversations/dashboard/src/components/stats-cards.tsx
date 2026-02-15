import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { MessageSquareIcon, MessagesSquareIcon, HashIcon, MailOpenIcon } from "lucide-react";
import type { DashboardStatus } from "@/types";

interface StatsCardsProps {
  status: DashboardStatus | null;
}

export function StatsCards({ status }: StatsCardsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <MessageSquareIcon className="size-4" />
            Messages
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{status?.total_messages ?? "—"}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <MessagesSquareIcon className="size-4" />
            Sessions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{status?.total_sessions ?? "—"}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <HashIcon className="size-4" />
            Channels
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{status?.total_channels ?? "—"}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <MailOpenIcon className="size-4" />
            Unread
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-orange-600 dark:text-orange-400">
            {status?.unread_messages ?? "—"}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
