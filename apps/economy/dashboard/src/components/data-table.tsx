import * as React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SearchIcon,
  MoreHorizontalIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  XIcon,
} from "lucide-react";

export interface DataTableColumn<T> {
  header: string;
  accessor: keyof T | ((row: T) => React.ReactNode);
  render?: (value: unknown, row: T) => React.ReactNode;
  sortable?: boolean;
  className?: string;
}

export interface DataTableAction<T> {
  label: string;
  onClick: (row: T) => void;
  icon?: React.ReactNode;
}

export interface BulkAction<T> {
  label: string;
  onClick: (rows: T[]) => void;
  variant?: "default" | "destructive";
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  searchPlaceholder?: string;
  actions?: DataTableAction<T>[];
  bulkActions?: BulkAction<T>[];
  pageSize?: number;
  getRowId?: (row: T, index: number) => string;
  loading?: boolean;
  error?: string | null;
  emptyMessage?: string;
  /** External search handler — if provided, the table won't filter locally */
  onSearchChange?: (value: string) => void;
  /** External search value */
  searchValue?: string;
  /** External pagination — total item count (if undefined, uses local pagination) */
  totalCount?: number;
  /** External pagination — callback */
  onPageChange?: (page: number) => void;
  /** External current page */
  currentPage?: number;
}

type SortDir = "asc" | "desc" | null;

function getCellValue<T>(row: T, accessor: DataTableColumn<T>["accessor"]): unknown {
  if (typeof accessor === "function") return accessor(row);
  return row[accessor];
}

export function DataTable<T>({
  columns,
  data,
  searchPlaceholder = "Search...",
  actions,
  bulkActions,
  pageSize = 25,
  getRowId,
  loading,
  error,
  emptyMessage = "No data found.",
  onSearchChange,
  searchValue,
  totalCount,
  onPageChange,
  currentPage,
}: DataTableProps<T>) {
  const [localSearch, setLocalSearch] = React.useState("");
  const [sortCol, setSortCol] = React.useState<number | null>(null);
  const [sortDir, setSortDir] = React.useState<SortDir>(null);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [localPage, setLocalPage] = React.useState(0);

  const isExternalSearch = onSearchChange !== undefined;
  const isExternalPagination = onPageChange !== undefined;
  const search = isExternalSearch ? (searchValue ?? "") : localSearch;
  const page = isExternalPagination ? (currentPage ?? 0) : localPage;

  const setSearch = (v: string) => {
    if (isExternalSearch) {
      onSearchChange!(v);
    } else {
      setLocalSearch(v);
      setLocalPage(0);
    }
  };

  const setPage = (p: number | ((prev: number) => number)) => {
    if (isExternalPagination) {
      const newPage = typeof p === "function" ? p(currentPage ?? 0) : p;
      onPageChange!(newPage);
    } else {
      setLocalPage(typeof p === "function" ? p : () => p);
    }
  };

  const rowId = (row: T, index: number) => getRowId ? getRowId(row, index) : String(index);

  // Filter (only if local search)
  const filtered = React.useMemo(() => {
    if (isExternalSearch || !search) return data;
    const q = search.toLowerCase();
    return data.filter((row) =>
      columns.some((col) => {
        const val = getCellValue(row, col.accessor);
        return val != null && String(val).toLowerCase().includes(q);
      })
    );
  }, [data, search, columns, isExternalSearch]);

  // Sort
  const sorted = React.useMemo(() => {
    if (sortCol === null || sortDir === null) return filtered;
    const col = columns[sortCol];
    if (!col) return filtered;
    return [...filtered].sort((a, b) => {
      const av = getCellValue(a, col.accessor);
      const bv = getCellValue(b, col.accessor);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const sa = String(av);
      const sb = String(bv);
      return sortDir === "asc" ? sa.localeCompare(sb) : sb.localeCompare(sa);
    });
  }, [filtered, sortCol, sortDir, columns]);

  // Paginate (only if local pagination)
  const total = isExternalPagination ? (totalCount ?? data.length) : sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageData = isExternalPagination ? sorted : sorted.slice(page * pageSize, (page + 1) * pageSize);

  const handleSort = (colIndex: number) => {
    if (!columns[colIndex].sortable) return;
    if (sortCol === colIndex) {
      if (sortDir === "asc") setSortDir("desc");
      else if (sortDir === "desc") { setSortCol(null); setSortDir(null); }
      else setSortDir("asc");
    } else {
      setSortCol(colIndex);
      setSortDir("asc");
    }
  };

  const toggleRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === pageData.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pageData.map((r, i) => rowId(r, page * pageSize + i))));
    }
  };

  const selectedRows = React.useMemo(() => {
    return pageData.filter((r, i) => selectedIds.has(rowId(r, page * pageSize + i)));
  }, [pageData, selectedIds, page, pageSize]);

  const hasBulk = bulkActions && bulkActions.length > 0;
  const hasActions = actions && actions.length > 0;

  return (
    <div className="space-y-3">
      {/* Search */}
      <div className="relative max-w-xs">
        <SearchIcon className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
        <Input
          placeholder={searchPlaceholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8 h-9"
        />
      </div>

      {/* Table */}
      <div className="rounded-md border">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="size-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          </div>
        ) : error ? (
          <div className="p-4 m-4 rounded-lg border border-red-200 bg-red-50 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            {error}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {hasBulk && (
                  <TableHead className="w-10">
                    <Checkbox
                      checked={pageData.length > 0 && selectedIds.size === pageData.length}
                      onCheckedChange={toggleAll}
                    />
                  </TableHead>
                )}
                {columns.map((col, i) => (
                  <TableHead
                    key={i}
                    className={col.sortable ? "cursor-pointer select-none" : ""}
                    onClick={() => col.sortable && handleSort(i)}
                  >
                    <div className="flex items-center gap-1">
                      {col.header}
                      {col.sortable && sortCol === i && (
                        sortDir === "asc" ? <ArrowUpIcon className="size-3" /> : <ArrowDownIcon className="size-3" />
                      )}
                    </div>
                  </TableHead>
                ))}
                {hasActions && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageData.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={columns.length + (hasBulk ? 1 : 0) + (hasActions ? 1 : 0)}
                    className="h-24 text-center text-muted-foreground"
                  >
                    {emptyMessage}
                  </TableCell>
                </TableRow>
              ) : (
                pageData.map((row, i) => {
                  const id = rowId(row, page * pageSize + i);
                  return (
                    <TableRow key={id} data-state={selectedIds.has(id) ? "selected" : undefined}>
                      {hasBulk && (
                        <TableCell>
                          <Checkbox
                            checked={selectedIds.has(id)}
                            onCheckedChange={() => toggleRow(id)}
                          />
                        </TableCell>
                      )}
                      {columns.map((col, ci) => {
                        const val = getCellValue(row, col.accessor);
                        return (
                          <TableCell key={ci} className={col.className}>
                            {col.render ? col.render(val, row) : (val as React.ReactNode)}
                          </TableCell>
                        );
                      })}
                      {hasActions && (
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="size-7">
                                <MoreHorizontalIcon className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {actions!.map((action) => (
                                <DropdownMenuItem key={action.label} onClick={() => action.onClick(row)}>
                                  {action.icon}
                                  {action.label}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {total > 0
            ? `Showing ${page * pageSize + 1}-${Math.min((page + 1) * pageSize, total)} of ${total}`
            : "No results"}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p: number) => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            <ChevronLeftIcon className="size-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p: number) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
          >
            <ChevronRightIcon className="size-4" />
          </Button>
        </div>
      </div>

      {/* Bulk actions bar */}
      {hasBulk && selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-lg border bg-background px-4 py-2.5 shadow-lg">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          {bulkActions!.map((ba) => (
            <Button
              key={ba.label}
              size="sm"
              variant={ba.variant === "destructive" ? "destructive" : "default"}
              onClick={() => ba.onClick(selectedRows)}
            >
              {ba.label}
            </Button>
          ))}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelectedIds(new Set())}
          >
            <XIcon className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
