import { useEffect, useState, useCallback, useRef } from "react";
import { getSessions, getSessionRequests } from "../api";
import type { Session, SessionRequest } from "../api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CopyIcon, ChevronLeftIcon, ChevronRightIcon, XIcon, RefreshCwIcon } from "lucide-react";

const DEFAULT_PAGE_SIZE = 50;

function truncate(s: string, n: number) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "\u2026" : s;
}

function formatUsd(val: number) {
  if (val == null) return "$0.0000";
  return `$${val.toFixed(4)}`;
}

function formatDate(d: string) {
  if (!d) return "";
  return new Date(d).toLocaleString();
}

function formatMs(ms: number) {
  if (!ms) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function AgentBadge({ agent }: { agent: string }) {
  const colors: Record<string, string> = {
    claude: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    codex: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[agent] ?? "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"}`}
    >
      {agent}
    </span>
  );
}

export function SessionsTab() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Pagination
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  // Date range filter
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Session drill-down
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [sessionRequests, setSessionRequests] = useState<SessionRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [requestsError, setRequestsError] = useState<string | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getSessions({
        project: search || undefined,
        limit: pageSize,
        offset: page * pageSize,
        since: dateFrom || undefined,
      });
      setSessions(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sessions");
    } finally {
      setLoading(false);
    }
  }, [search, page, pageSize, dateFrom]);

  useEffect(() => {
    const t = setTimeout(() => load(), 300);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    intervalRef.current = setInterval(() => load(), 30000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [load]);

  const handleRowClick = async (session: Session) => {
    setSelectedSession(session);
    setSessionRequests([]);
    setRequestsError(null);
    setRequestsLoading(true);
    try {
      const res = await getSessionRequests(session.session_id);
      setSessionRequests(res.data);
    } catch (e) {
      setRequestsError(e instanceof Error ? e.message : "Failed to load requests");
    } finally {
      setRequestsLoading(false);
    }
  };

  const handleClearDates = () => {
    setDateFrom("");
    setDateTo("");
    setPage(0);
  };

  const hasPrev = page > 0;
  const hasNext = sessions.length === pageSize;
  const rangeStart = page * pageSize + 1;
  const rangeEnd = page * pageSize + sessions.length;

  // Filter sessions client-side for dateTo (since API only supports since=)
  const filteredSessions = dateTo
    ? sessions.filter((s) => {
        const sessionDate = s.started_at?.slice(0, 10) ?? "";
        return sessionDate <= dateTo;
      })
    : sessions;

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Sessions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters row */}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search by project..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              className="h-8 w-48 text-sm"
            />
            <div className="flex items-center gap-1.5 ml-auto">
              <span className="text-xs text-muted-foreground">From:</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  setPage(0);
                }}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <span className="text-xs text-muted-foreground">To:</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {(dateFrom || dateTo) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearDates}
                  className="h-8 px-2 text-xs"
                >
                  <XIcon className="size-3 mr-1" />
                  Clear
                </Button>
              )}
            </div>
          </div>

          {/* Table */}
          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              {error}
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCwIcon className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Session ID</TableHead>
                    <TableHead className="text-xs">Agent</TableHead>
                    <TableHead className="text-xs">Project</TableHead>
                    <TableHead className="text-xs text-right">Cost</TableHead>
                    <TableHead className="text-xs text-right">Tokens</TableHead>
                    <TableHead className="text-xs text-right">Requests</TableHead>
                    <TableHead className="text-xs">Started</TableHead>
                    <TableHead className="w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSessions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                        No sessions found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredSessions.map((session) => (
                      <TableRow
                        key={session.session_id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => handleRowClick(session)}
                      >
                        <TableCell>
                          <code className="text-xs text-muted-foreground">
                            {truncate(session.session_id, 16)}
                          </code>
                        </TableCell>
                        <TableCell>
                          <AgentBadge agent={session.agent} />
                        </TableCell>
                        <TableCell>
                          <span className="text-sm truncate block max-w-[200px]">
                            {truncate(String(session.project || session.project_path || ""), 30)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="font-medium text-sm">{formatUsd(session.cost_usd)}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="text-sm text-muted-foreground">
                            {(session.total_tokens ?? 0).toLocaleString()}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="text-sm text-muted-foreground">{session.requests}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-muted-foreground">
                            {formatDate(session.started_at)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(session.session_id);
                            }}
                            title="Copy session ID"
                          >
                            <CopyIcon className="size-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Pagination controls */}
          {!loading && !error && (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {filteredSessions.length > 0
                  ? `Showing ${rangeStart}–${rangeEnd}`
                  : "No results"}
                {hasNext ? "+" : ""}
              </span>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <span>Show:</span>
                  <Select
                    value={String(pageSize)}
                    onValueChange={(v) => {
                      setPageSize(Number(v));
                      setPage(0);
                    }}
                  >
                    <SelectTrigger className="h-7 w-16 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-7"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={!hasPrev}
                  >
                    <ChevronLeftIcon className="size-3.5" />
                  </Button>
                  <span className="px-2">Page {page + 1}</span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-7"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={!hasNext}
                  >
                    <ChevronRightIcon className="size-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Session drill-down dialog */}
      <Dialog open={!!selectedSession} onOpenChange={(open) => !open && setSelectedSession(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="text-sm">
              Session:{" "}
              <code className="font-mono text-xs">{selectedSession?.session_id}</code>
            </DialogTitle>
            <DialogDescription className="text-xs">
              {selectedSession && (
                <>
                  <AgentBadge agent={selectedSession.agent} />{" "}
                  <span className="ml-1">
                    {truncate(String(selectedSession.project || selectedSession.project_path || ""), 50)}
                  </span>
                  <span className="ml-2 text-muted-foreground">
                    · {formatUsd(selectedSession.cost_usd)} total · {selectedSession.requests} requests
                  </span>
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {requestsLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCwIcon className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : requestsError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              {requestsError}
            </div>
          ) : sessionRequests.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No request data available for this session.
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Time</TableHead>
                    <TableHead className="text-xs">Model</TableHead>
                    <TableHead className="text-xs text-right">Input</TableHead>
                    <TableHead className="text-xs text-right">Output</TableHead>
                    <TableHead className="text-xs text-right">Cache read</TableHead>
                    <TableHead className="text-xs text-right">Cache write</TableHead>
                    <TableHead className="text-xs text-right">Cost</TableHead>
                    <TableHead className="text-xs text-right">Duration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessionRequests.map((req) => (
                    <TableRow key={req.id}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDate(req.timestamp)}
                      </TableCell>
                      <TableCell className="text-xs">
                        <code className="text-xs">{req.model}</code>
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {req.input_tokens.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {req.output_tokens.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {req.cache_read_tokens.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {req.cache_create_tokens.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right text-xs font-medium">
                        {formatUsd(req.cost_usd)}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {formatMs(req.duration_ms)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
