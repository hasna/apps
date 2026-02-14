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
  RefreshCwIcon,
  KeyIcon,
  ExternalLinkIcon,
  SettingsIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  CopyIcon,
  CheckIcon,
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
import type { ConnectorWithAuth } from "@/types";

function timeAgo(ts: number): string {
  const diff = ts - Date.now();
  const abs = Math.abs(diff);
  const suffix = diff < 0 ? " ago" : "";
  if (abs < 60000) return Math.round(abs / 1000) + "s" + suffix;
  if (abs < 3600000) return Math.round(abs / 60000) + "m" + suffix;
  if (abs < 86400000) return Math.round(abs / 3600000) + "h" + suffix;
  return Math.round(abs / 86400000) + "d" + suffix;
}

function AuthTypeBadge({ type }: { type: string }) {
  switch (type) {
    case "oauth":
      return (
        <Badge className="bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 border-0">
          OAuth
        </Badge>
      );
    case "bearer":
      return (
        <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 border-0">
          Bearer
        </Badge>
      );
    default:
      return (
        <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border-0">
          API Key
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

interface ConnectorsTableProps {
  data: ConnectorWithAuth[];
  onConfigure: (connector: ConnectorWithAuth) => void;
  onRefresh: (name: string) => void;
  onOAuthStart: (name: string) => void;
}

export function ConnectorsTable({
  data,
  onConfigure,
  onRefresh,
  onOAuthStart,
}: ConnectorsTableProps) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] =
    React.useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState({});

  const columns: ColumnDef<ConnectorWithAuth>[] = React.useMemo(
    () => [
      {
        accessorKey: "displayName",
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
            className="-ml-3"
          >
            Connector
            <ArrowUpDownIcon />
          </Button>
        ),
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.displayName}</div>
            <div className="text-xs text-muted-foreground">
              {row.original.name}
              {row.original.version && (
                <span className="ml-1.5 opacity-60">
                  v{row.original.version}
                </span>
              )}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "category",
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
            className="-ml-3"
          >
            Category
            <ArrowUpDownIcon />
          </Button>
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.getValue("category")}
          </span>
        ),
      },
      {
        id: "installed",
        accessorFn: (row) => (row.installed ? "installed" : "not installed"),
        header: "Installed",
        cell: ({ row }) =>
          row.original.installed ? (
            <span className="flex items-center gap-1.5 text-green-600 dark:text-green-400 text-sm">
              <CheckCircle2Icon className="size-3.5" />
              Yes
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-muted-foreground text-sm">
              <CircleDashedIcon className="size-3.5" />
              No
            </span>
          ),
      },
      {
        id: "authType",
        accessorFn: (row) => row.auth?.type || "—",
        header: "Auth Type",
        cell: ({ row }) => {
          if (!row.original.installed || !row.original.auth) {
            return <span className="text-muted-foreground">—</span>;
          }
          return (
            <AuthTypeBadge type={row.original.auth.type} />
          );
        },
      },
      {
        id: "status",
        accessorFn: (row) => {
          if (!row.installed) return "not installed";
          return row.auth?.configured ? "configured" : "not configured";
        },
        header: "Status",
        cell: ({ row }) => {
          if (!row.original.installed) {
            return (
              <Badge
                variant="outline"
                className="border-muted-foreground/20 text-muted-foreground"
              >
                Not installed
              </Badge>
            );
          }
          if (row.original.auth?.configured) {
            return (
              <Badge
                variant="outline"
                className="border-green-300 text-green-700 dark:border-green-800 dark:text-green-400"
              >
                Configured
              </Badge>
            );
          }
          return (
            <Badge
              variant="outline"
              className="border-orange-300 text-orange-700 dark:border-orange-800 dark:text-orange-400"
            >
              Needs auth
            </Badge>
          );
        },
      },
      {
        id: "token",
        header: "Token",
        cell: ({ row }) => {
          const auth = row.original.auth;
          if (
            !row.original.installed ||
            auth?.type !== "oauth" ||
            !auth?.configured ||
            !auth?.tokenExpiry
          ) {
            return <span className="text-muted-foreground">—</span>;
          }
          const isExpired = auth.tokenExpiry < Date.now();
          return (
            <span
              className={
                isExpired
                  ? "text-red-600 dark:text-red-400 text-sm"
                  : "text-green-600 dark:text-green-400 text-sm"
              }
            >
              {isExpired ? "Expired " : "Expires "}
              {timeAgo(auth.tokenExpiry)}
            </span>
          );
        },
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => {
          const c = row.original;

          if (!c.installed) {
            return (
              <div className="flex justify-end">
                <CopyCommand command={`connectors install ${c.name}`} />
              </div>
            );
          }

          const auth = c.auth;
          if (auth?.type === "oauth") {
            if (auth.configured) {
              return (
                <div className="flex justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRefresh(c.name)}
                  >
                    <RefreshCwIcon className="size-3.5" />
                    Refresh
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onOAuthStart(c.name)}
                  >
                    <ExternalLinkIcon className="size-3.5" />
                    Reconnect
                  </Button>
                </div>
              );
            }
            return (
              <div className="flex justify-end">
                <Button size="sm" onClick={() => onOAuthStart(c.name)}>
                  <ExternalLinkIcon className="size-3.5" />
                  Connect
                </Button>
              </div>
            );
          }

          return (
            <div className="flex justify-end">
              <Button
                variant={auth?.configured ? "ghost" : "default"}
                size="sm"
                onClick={() => onConfigure(c)}
              >
                {auth?.configured ? (
                  <>
                    <SettingsIcon className="size-3.5" />
                    Update
                  </>
                ) : (
                  <>
                    <KeyIcon className="size-3.5" />
                    Configure
                  </>
                )}
              </Button>
            </div>
          );
        },
      },
    ],
    [onConfigure, onRefresh, onOAuthStart]
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
          placeholder="Filter connectors..."
          value={
            (table.getColumn("displayName")?.getFilterValue() as string) ?? ""
          }
          onChange={(e) =>
            table.getColumn("displayName")?.setFilterValue(e.target.value)
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
                    !row.original.installed ? "opacity-60" : undefined
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
                  No connectors found.
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
          connector{table.getFilteredRowModel().rows.length !== 1 ? "s" : ""})
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
