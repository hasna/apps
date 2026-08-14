import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ServerIcon, CheckCircle2Icon, XCircleIcon, WrenchIcon } from "lucide-react";
import type { McpServerEntry } from "@/types";

interface StatsCardsProps {
  servers: McpServerEntry[];
}

export function StatsCards({ servers }: StatsCardsProps) {
  const total = servers.length;
  const enabled = servers.filter((s) => s.enabled).length;
  const disabled = total - enabled;
  const totalTools = servers.reduce((sum, s) => sum + s.toolCount, 0);

  return (
    <div className="grid gap-4 md:grid-cols-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <ServerIcon className="size-4" />
            Servers
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{total}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <CheckCircle2Icon className="size-4" />
            Enabled
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-green-600 dark:text-green-400">
            {enabled}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <XCircleIcon className="size-4" />
            Disabled
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-orange-600 dark:text-orange-400">
            {disabled > 0 ? disabled : 0}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <WrenchIcon className="size-4" />
            Tools
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{totalTools}</div>
        </CardContent>
      </Card>
    </div>
  );
}
