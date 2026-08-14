import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { PlugIcon, DownloadIcon, ShieldCheckIcon, ShieldAlertIcon } from "lucide-react";
import type { ConnectorWithAuth } from "@/types";

interface StatsCardsProps {
  connectors: ConnectorWithAuth[];
}

export function StatsCards({ connectors }: StatsCardsProps) {
  const total = connectors.length;
  const installed = connectors.filter((c) => c.installed).length;
  const configured = connectors.filter((c) => c.auth?.configured).length;
  const needsAuth = installed - configured;

  return (
    <div className="grid gap-4 md:grid-cols-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <PlugIcon className="size-4" />
            Available
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{total}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <DownloadIcon className="size-4" />
            Installed
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{installed}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <ShieldCheckIcon className="size-4" />
            Configured
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-green-600 dark:text-green-400">
            {configured}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <ShieldAlertIcon className="size-4" />
            Needs Auth
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-orange-600 dark:text-orange-400">
            {needsAuth > 0 ? needsAuth : 0}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
