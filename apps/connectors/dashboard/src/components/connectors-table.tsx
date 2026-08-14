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
  type RowSelectionState,
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
  DownloadIcon,
  TrashIcon,
  LoaderIcon,
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

function CopyCommandButton({ name }: { name: string }) {
  const [copied, setCopied] = React.useState(false);
  const statement = `connectors run ${name} --help`;

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(statement).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-muted-foreground"
      onClick={handleCopy}
      title={statement}
    >
      {copied ? (
        <CheckIcon className="size-3.5 text-green-500" />
      ) : (
        <CopyIcon className="size-3.5" />
      )}
      {copied ? "Copied!" : "Command"}
    </Button>
  );
}

interface ConnectorsTableProps {
  data: ConnectorWithAuth[];
  onConfigure: (connector: ConnectorWithAuth) => void;
  onRefresh: (name: string) => void;
  onOAuthStart: (name: string) => void;
  onInstall?: (name: string) => Promise<void>;
  onUninstall?: (name: string) => Promise<void>;
  onRowClick?: (connector: ConnectorWithAuth) => void;
}

export function ConnectorsTable({
  data,
  onConfigure,
  onRefresh,
  onOAuthStart,
  onInstall,
  onUninstall,
  onRowClick,
}: ConnectorsTableProps) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] =
    React.useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState({});
  const [categoryFilter, setCategoryFilter] = React.useState<string>("all");
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const [installingSet, setInstallingSet] = React.useState<Set<string>>(new Set());
  const [bulkInstalling, setBulkInstalling] = React.useState(false);
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  // Keyboard shortcut: / to focus search, Escape to clear
  React.useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if (e.key === "Escape" && document.activeElement === searchInputRef.current) {
        table.getColumn("displayName")?.setFilterValue("");
        searchInputRef.current?.blur();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  });

  // Derive unique categories from data
  const categories = React.useMemo(() => {
    const cats = new Map<string, number>();
    data.forEach((c) => cats.set(c.category, (cats.get(c.category) || 0) + 1));
    return Array.from(cats.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [data]);

  // Filter data by category before passing to table
  const filteredData = React.useMemo(() => {
    if (categoryFilter === "all") return data;
    return data.filter((c) => c.category === categoryFilter);
  }, [data, categoryFilter]);

  async function handleInstall(name: string) {
    if (!onInstall) return;
    setInstallingSet((prev) => new Set(prev).add(name));
    try {
      await onInstall(name);
    } finally {
      setInstallingSet((prev) => {
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
    }
  }

  const columns: ColumnDef<ConnectorWithAuth>[] = React.useMemo(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <input
            type="checkbox"
            className="size-4 rounded border-gray-300 accent-primary cursor-pointer"
            checked={table.getIsAllPageRowsSelected()}
            ref={(el) => {
              if (el) el.indeterminate = table.getIsSomePageRowsSelected();
            }}
            onChange={table.getToggleAllPageRowsSelectedHandler()}
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            className="size-4 rounded border-gray-300 accent-primary cursor-pointer"
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            onClick={(e) => e.stopPropagation()}
          />
        ),
        enableSorting: false,
        enableHiding: false,
      },
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
            </div>
            {row.original.description && (
              <div className="text-[11px] text-muted-foreground/60 line-clamp-1">
                {row.original.description}
              </div>
            )}
          </div>
        ),
        filterFn: (row, _columnId, filterValue) => {
          const search = (filterValue as string).toLowerCase();
          return (
            row.original.displayName.toLowerCase().includes(search) ||
            row.original.name.toLowerCase().includes(search)
          );
        },
      },
      {
        accessorKey: "version",
        header: "Version",
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">
            {row.original.version ? `v${row.original.version}` : "—"}
          </span>
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
          if (!row.auth?.configured) {
            // Partially configured: some env vars set but not all
            const auth = row.auth;
            if (auth && auth.type !== "oauth" && auth.envVarTotalCount > 1 && auth.envVarSetCount > 0) {
              return "partial";
            }
            return "needs auth";
          }
          if (row.auth?.type === "oauth" && row.auth?.tokenExpiry && row.auth.tokenExpiry < Date.now()) return "expired";
          return "configured";
        },
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
            className="-ml-3"
          >
            Status
            <ArrowUpDownIcon />
          </Button>
        ),
        sortingFn: (rowA, rowB) => {
          const order: Record<string, number> = { "needs auth": 0, "partial": 1, "expired": 2, "not installed": 3, "configured": 4 };
          const a = order[rowA.getValue("status") as string] ?? 3;
          const b = order[rowB.getValue("status") as string] ?? 3;
          return a - b;
        },
        cell: ({ row }) => {
          const auth = row.original.auth;
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
          if (auth?.configured) {
            return (
              <Badge
                variant="outline"
                className="border-green-300 text-green-700 dark:border-green-800 dark:text-green-400"
              >
                Configured
              </Badge>
            );
          }
          // Partially configured: some env vars set for multi-field connectors
          if (auth && auth.type !== "oauth" && auth.envVarTotalCount > 1 && auth.envVarSetCount > 0) {
            return (
              <Badge
                variant="outline"
                className="border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400"
              >
                {auth.envVarSetCount}/{auth.envVarTotalCount} fields set
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

          // Stop propagation so action buttons don't trigger row click
          const stop = (e: React.MouseEvent) => e.stopPropagation();

          if (!c.installed) {
            const isInstalling = installingSet.has(c.name);
            return (
              <div className="flex justify-end gap-1" onClick={stop}>
                {onInstall ? (
                  <Button
                    size="sm"
                    onClick={() => handleInstall(c.name)}
                    disabled={isInstalling}
                  >
                    {isInstalling ? (
                      <LoaderIcon className="size-3.5 animate-spin" />
                    ) : (
                      <DownloadIcon className="size-3.5" />
                    )}
                    {isInstalling ? "Installing..." : "Install"}
                  </Button>
                ) : (
                  <CopyCommand command={`connectors install ${c.name}`} />
                )}
              </div>
            );
          }

          const auth = c.auth;
          if (auth?.type === "oauth") {
            if (auth.configured) {
              return (
                <div className="flex justify-end gap-1" onClick={stop}>
                  <CopyCommandButton name={c.name} />
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
              <div className="flex justify-end gap-1" onClick={stop}>
                <CopyCommandButton name={c.name} />
                <Button size="sm" onClick={() => onOAuthStart(c.name)}>
                  <ExternalLinkIcon className="size-3.5" />
                  Connect
                </Button>
              </div>
            );
          }

          return (
            <div className="flex justify-end gap-1" onClick={stop}>
              <CopyCommandButton name={c.name} />
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
    [onConfigure, onRefresh, onOAuthStart, onInstall, installingSet]
  );

  // Derive selected rows and compute which are installable (not yet installed)
  const selectedRows = React.useMemo(() => {
    return Object.keys(rowSelection)
      .filter((key) => rowSelection[key])
      .map((key) => filteredData[parseInt(key)])
      .filter(Boolean);
  }, [rowSelection, filteredData]);

  const installableSelected = React.useMemo(
    () => selectedRows.filter((c) => !c.installed),
    [selectedRows]
  );

  async function handleBulkInstall() {
    if (!onInstall || installableSelected.length === 0) return;
    setBulkInstalling(true);
    try {
      for (const connector of installableSelected) {
        await onInstall(connector.name);
      }
    } finally {
      setBulkInstalling(false);
      setRowSelection({});
    }
  }

  const table = useReactTable({
    data: filteredData,
    columns,
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
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
      rowSelection,
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input
          ref={searchInputRef}
          placeholder="Filter connectors... (press / to focus)"
          value={
            (table.getColumn("displayName")?.getFilterValue() as string) ?? ""
          }
          onChange={(e) =>
            table.getColumn("displayName")?.setFilterValue(e.target.value)
          }
          className="max-w-sm"
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="all">All Categories ({data.length})</option>
          {categories.map(([cat, count]) => (
            <option key={cat} value={cat}>
              {cat} ({count})
            </option>
          ))}
        </select>
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
                  className={`cursor-pointer hover:bg-muted/50 ${
                    !row.original.installed ? "opacity-60" : ""
                  }`}
                  onClick={() => onRowClick?.(row.original)}
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
      {/* Floating bulk action bar */}
      {selectedRows.length > 0 && (
        <div className="flex items-center gap-3 rounded-lg border bg-muted/50 px-4 py-2.5">
          <span className="text-sm font-medium">
            {selectedRows.length} selected
          </span>
          {installableSelected.length > 0 && (
            <Button
              size="sm"
              onClick={handleBulkInstall}
              disabled={bulkInstalling}
            >
              {bulkInstalling ? (
                <LoaderIcon className="size-3.5 animate-spin" />
              ) : (
                <DownloadIcon className="size-3.5" />
              )}
              {bulkInstalling
                ? "Installing..."
                : `Install ${installableSelected.length} Selected`}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setRowSelection({})}
          >
            Clear Selection
          </Button>
        </div>
      )}
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
