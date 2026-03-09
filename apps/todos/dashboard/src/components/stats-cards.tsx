import {
  ListTodoIcon,
  ClockIcon,
  PlayIcon,
  CheckCircleIcon,
  XCircleIcon,
  FolderIcon,
  BotIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DashboardStats } from "@/types";

export function StatsCards({ stats }: { stats: DashboardStats }) {
  const cards = [
    { label: "Total Tasks", value: stats.total_tasks, icon: ListTodoIcon, color: "text-foreground" },
    { label: "Pending", value: stats.pending, icon: ClockIcon, color: "text-yellow-500" },
    { label: "In Progress", value: stats.in_progress, icon: PlayIcon, color: "text-blue-500" },
    { label: "Completed", value: stats.completed, icon: CheckCircleIcon, color: "text-green-500" },
    { label: "Failed", value: stats.failed, icon: XCircleIcon, color: "text-red-500" },
    { label: "Projects", value: stats.projects, icon: FolderIcon, color: "text-purple-500" },
    { label: "Agents", value: stats.agents, icon: BotIcon, color: "text-orange-500" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.label}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              {card.label}
            </CardTitle>
            <card.icon className={`size-3.5 ${card.color}`} />
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold">{card.value}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
