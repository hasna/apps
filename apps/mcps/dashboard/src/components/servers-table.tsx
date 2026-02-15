import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
} from "@tanstack/react-table";
import {
  ArrowUpDownIcon,
  ChevronDownIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  CopyIcon,
  CheckIcon,
  TrashIcon,
  PowerIcon,
  PowerOffIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { McpServerEntry } from "@/types";

function TransportBadge({ transport }: { transport: string }) {
  switch (transport) {
    case "stdio":
      return (
        <Badge className="bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 border-0">
          stdio
        </Badge>
      );
    case "sse":
      return (
        <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 border-0">
          SSE
        </Badge>
      );
    default:
      return (
        <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border-0">
          HTTP
        </Badge>
      );
  }
}

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = React.useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="flex items-center gap-1">
      <code className="rounded border bg-muted px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground">
        {command}
      </code>
      <Button
        variant="ghost"
        size="icon"
        className="size-6 shrink-0"
        onClick={handleCopy}
      >
        {copied ? (
          <CheckIcon className="size-3 text-green-500" />
        ) : (
          <CopyIcon className="size-3" />
        )}
      </Button>
    </div>
  );
}

interface ServersTableProps {
  data: McpServerEntry[];
  onToggle: (id: string, enabled: boolean) => void;
  onRemove: (id: string) => void;
}

export function ServersTable({
  data,
  onToggle,
  onRemove,
}: ServersTableProps) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] =
    React.useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState({});

  const columns: ColumnDef<McpServerEntry>[] = React.useMemo(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
            className="-ml-3"
          >
            Server
            <ArrowUpDownIcon />
          </Button>
        ),
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.name}</div>
            <div className="text-xs text-muted-foreground">
              {row.original.id}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "description",
        header: "Description",
        cell: ({ row }) => (
          <span className="text-muted-foreground max-w-[300px] truncate block">
            {row.original.description || "—"}
          </span>
        ),
      },
      {
        id: "transport",
        accessorFn: (row) => row.transport,
        header: "Transport",
        cell: ({ row }) => (
          <TransportBadge transport={row.original.transport} />
        ),
      },
      {
        id: "status",
        accessorFn: (row) => (row.enabled ? "enabled" : "disabled"),
        header: "Status",
        cell: ({ row }) => {
          if (row.original.enabled) {
            return (
              <Badge
                variant="outline"
                className="border-green-300 text-green-700 dark:border-green-800 dark:text-green-400"
              >
                Enabled
              </Badge>
            );
          }
          return (
            <Badge
              variant="outline"
              className="border-orange-300 text-orange-700 dark:border-orange-800 dark:text-orange-400"
            >
              Disabled
            </Badge>
          );
        },
      },
      {
        id: "tools",
        accessorFn: (row) => row.toolCount,
        header: "Tools",
        cell: ({ row }) => {
          const count = row.original.toolCount;
          if (count > 0) {
            return (
              <span className="flex items-center gap-1.5 text-green-600 dark:text-green-400 text-sm">
                <CheckCircle2Icon className="size-3.5" />
                {count}
              </span>
            );
          }
          return (
            <span className="flex items-center gap-1.5 text-muted-foreground text-sm">
              <CircleDashedIcon className="size-3.5" />
              0
            </span>
          );
        },
      },
      {
        id: "source",
        accessorFn: (row) => row.source,
        header: "Source",
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">
            {row.original.source}
          </span>
        ),
      },
      {
        id: "command",
        header: "Command",
        cell: ({ row }) => (
          <CopyCommand
            command={`${row.original.command} ${row.original.args.join(" ")}`}
          />
        ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => {
          const s = row.original;
          return (
            <div className="flex justify-end gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onToggle(s.id, !s.enabled)}
              >
                {s.enabled ? (
                  <>
                    <PowerOffIcon className="size-3.5" />
                    Disable
                  </>
                ) : (
                  <>
                    <PowerIcon className="size-3.5" />
                    Enable
                  </>
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onRemove(s.id)}
                className="text-destructive hover:text-destructive"
              >
                <TrashIcon className="size-3.5" />
              </Button>
            </div>
          );
        },
      },
    ],
    [onToggle, onRemove]
  );

  const table = useReactTable({
    data,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    initialState: {
      pagination: { pageSize: 10 },
    },
    state: {
      sorting,
      columnFilters,
      columnVisibility,
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input
          placeholder="Filter servers..."
          value={
            (table.getColumn("name")?.getFilterValue() as string) ?? ""
          }
          onChange={(e) =>
            table.getColumn("name")?.setFilterValue(e.target.value)
          }
          className="max-w-sm"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="ml-auto">
              Columns <ChevronDownIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {table
              .getAllColumns()
              .filter((column) => column.getCanHide())
              .map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  className="capitalize"
                  checked={column.getIsVisible()}
                  onCheckedChange={(value) =>
                    column.toggleVisibility(!!value)
                  }
                >
                  {column.id}
                </DropdownMenuCheckboxItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={
                    !row.original.enabled ? "opacity-60" : undefined
                  }
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No servers found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between">
        <div className="text-muted-foreground text-sm">
          Page {table.getState().pagination.pageIndex + 1} of{" "}
          {table.getPageCount()} ({table.getFilteredRowModel().rows.length}{" "}
          server{table.getFilteredRowModel().rows.length !== 1 ? "s" : ""})
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
