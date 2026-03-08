import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Project } from "@/types";

interface ProjectsListProps {
  projects: Project[];
}

export function ProjectsList({ projects }: ProjectsListProps) {
  if (projects.length === 0) {
    return (
      <div className="rounded-xl border p-8 text-center text-muted-foreground">
        No projects yet. Create one with{" "}
        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
          conversations project create
        </code>
      </div>
    );
  }

  return (
    <div className="rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Project</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Created by</TableHead>
            <TableHead className="text-right">Spaces</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {projects.map((p) => (
            <TableRow key={p.id}>
              <TableCell className="font-medium">{p.name}</TableCell>
              <TableCell className="text-muted-foreground">
                {p.description || "—"}
              </TableCell>
              <TableCell>
                {p.status === "archived" ? (
                  <Badge variant="outline" className="border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400">
                    archived
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-green-300 text-green-700 dark:border-green-800 dark:text-green-400">
                    active
                  </Badge>
                )}
              </TableCell>
              <TableCell>{p.created_by}</TableCell>
              <TableCell className="text-right">{p.space_count}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
