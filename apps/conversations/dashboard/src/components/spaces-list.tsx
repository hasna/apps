import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Space } from "@/types";

interface SpacesListProps {
  spaces: Space[];
  onSelectSpace?: (name: string) => void;
}

export function SpacesList({ spaces, onSelectSpace }: SpacesListProps) {
  if (spaces.length === 0) {
    return (
      <div className="rounded-xl border p-8 text-center text-muted-foreground">
        No spaces yet. Create one with{" "}
        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
          conversations space create
        </code>
      </div>
    );
  }

  return (
    <div className="rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Space</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Parent</TableHead>
            <TableHead>Created by</TableHead>
            <TableHead className="text-right">Members</TableHead>
            <TableHead className="text-right">Messages</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {spaces.map((sp) => (
            <TableRow key={sp.name} className="cursor-pointer" onClick={() => onSelectSpace?.(sp.name)}>
              <TableCell>
                <Badge className="bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 border-0">
                  #{sp.name}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {sp.description || "—"}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {sp.parent_id ? (
                  <Badge variant="outline" className="text-xs">
                    {sp.parent_id}
                  </Badge>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell className="font-medium">{sp.created_by}</TableCell>
              <TableCell className="text-right">{sp.member_count}</TableCell>
              <TableCell className="text-right">{sp.message_count}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
