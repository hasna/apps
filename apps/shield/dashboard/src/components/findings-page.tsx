import { useEffect, useState, useCallback } from "react";
import {
  fetchFindings,
  explainFinding,
  fixFinding,
  suppressFinding,
} from "../lib/api";
import type { Finding, Severity, ScannerType } from "../types";

const SEVERITY_OPTIONS: Severity[] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
];

const SCANNER_OPTIONS: ScannerType[] = [
  "secrets",
  "dependencies",
  "code",
  "git-history",
  "config",
  "ai-safety",
];

const SEVERITY_BADGE: Record<string, string> = {
  critical: "bg-red-500/20 text-red-400 border-red-500/30",
  high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  low: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  info: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
};

const PAGE_SIZE = 20;

interface Props {
  scanIdFilter?: string;
}

export function FindingsPage({ scanIdFilter }: Props) {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  // Filters
  const [severity, setSeverity] = useState<Severity | "">("");
  const [scannerType, setScannerType] = useState<ScannerType | "">("");
  const [fileFilter, setFileFilter] = useState("");

  // Expanded rows
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedContent, setExpandedContent] = useState<{
    type: "explain" | "fix";
    text: string;
  } | null>(null);
  const [expandedLoading, setExpandedLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, unknown> = {
        limit: PAGE_SIZE,
        offset,
      };
      if (scanIdFilter) params.scan_id = scanIdFilter;
      if (severity) params.severity = severity;
      if (scannerType) params.scanner_type = scannerType;
      if (fileFilter) params.file = fileFilter;

      const res = await fetchFindings(params as Parameters<typeof fetchFindings>[0]);
      setFindings(res.findings);
      setHasMore(res.findings.length === PAGE_SIZE);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [offset, severity, scannerType, fileFilter, scanIdFilter]);

  useEffect(() => {
    load();
  }, [load]);

  // Reset offset when filters change
  useEffect(() => {
    setOffset(0);
  }, [severity, scannerType, fileFilter, scanIdFilter]);

  async function handleExplain(id: string) {
    if (expandedId === id && expandedContent?.type === "explain") {
      setExpandedId(null);
      setExpandedContent(null);
      return;
    }
    setExpandedId(id);
    setExpandedLoading(true);
    try {
      const res = await explainFinding(id);
      setExpandedContent({ type: "explain", text: res.explanation });
    } catch (e) {
      setExpandedContent({
        type: "explain",
        text: `Error: ${(e as Error).message}`,
      });
    } finally {
      setExpandedLoading(false);
    }
  }

  async function handleFix(id: string) {
    if (expandedId === id && expandedContent?.type === "fix") {
      setExpandedId(null);
      setExpandedContent(null);
      return;
    }
    setExpandedId(id);
    setExpandedLoading(true);
    try {
      const res = await fixFinding(id);
      setExpandedContent({ type: "fix", text: res.fix });
    } catch (e) {
      setExpandedContent({
        type: "fix",
        text: `Error: ${(e as Error).message}`,
      });
    } finally {
      setExpandedLoading(false);
    }
  }

  async function handleSuppress(id: string) {
    const reason = prompt("Suppression reason:");
    if (!reason) return;
    try {
      await suppressFinding(id, reason);
      load();
    } catch (e) {
      alert(`Failed to suppress: ${(e as Error).message}`);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Findings</h2>
        {scanIdFilter && (
          <span className="text-sm text-zinc-400 bg-zinc-800 px-3 py-1 rounded-full">
            Filtered by scan
          </span>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value as Severity | "")}
          className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-emerald-600"
        >
          <option value="">All Severities</option>
          {SEVERITY_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>

        <select
          value={scannerType}
          onChange={(e) => setScannerType(e.target.value as ScannerType | "")}
          className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-emerald-600"
        >
          <option value="">All Scanners</option>
          {SCANNER_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <input
          type="text"
          placeholder="Filter by file..."
          value={fileFilter}
          onChange={(e) => setFileFilter(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-emerald-600 w-64"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-800 bg-red-950/50 p-4 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-zinc-600 border-t-emerald-500" />
        </div>
      ) : findings.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-10 text-center text-zinc-500">
          No findings found.
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-zinc-400 border-b border-zinc-800 bg-zinc-900/80">
                  <th className="text-left py-3 px-4 font-medium">Severity</th>
                  <th className="text-left py-3 px-4 font-medium">Location</th>
                  <th className="text-left py-3 px-4 font-medium">Message</th>
                  <th className="text-left py-3 px-4 font-medium">Scanner</th>
                  <th className="text-left py-3 px-4 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {findings.map((f) => (
                  <>
                    <tr
                      key={f.id}
                      className={`border-b border-zinc-800/50 hover:bg-zinc-800/30 ${
                        f.suppressed ? "opacity-50" : ""
                      }`}
                    >
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                            SEVERITY_BADGE[f.severity]
                          }`}
                        >
                          {f.severity}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-zinc-300 max-w-xs truncate">
                        {f.file}:{f.line}
                      </td>
                      <td className="py-3 px-4 text-zinc-300 max-w-md truncate">
                        {f.message}
                      </td>
                      <td className="py-3 px-4 text-zinc-400">
                        {f.scanner_type}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex gap-1">
                          <button
                            onClick={() => handleExplain(f.id)}
                            className="px-2 py-1 text-xs rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
                          >
                            Explain
                          </button>
                          <button
                            onClick={() => handleFix(f.id)}
                            className="px-2 py-1 text-xs rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
                          >
                            Fix
                          </button>
                          {!f.suppressed && (
                            <button
                              onClick={() => handleSuppress(f.id)}
                              className="px-2 py-1 text-xs rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
                            >
                              Suppress
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expandedId === f.id && (
                      <tr key={`${f.id}-expanded`} className="bg-zinc-800/20">
                        <td colSpan={5} className="px-4 py-4">
                          {expandedLoading ? (
                            <div className="flex items-center gap-2 text-zinc-400 text-sm">
                              <div className="animate-spin rounded-full h-4 w-4 border border-zinc-600 border-t-emerald-500" />
                              Loading...
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <p className="text-xs text-zinc-500 uppercase tracking-wide font-medium">
                                {expandedContent?.type === "explain"
                                  ? "Explanation"
                                  : "Suggested Fix"}
                              </p>
                              <pre className="text-sm text-zinc-300 whitespace-pre-wrap font-mono bg-zinc-900/50 rounded-lg p-4 border border-zinc-800">
                                {expandedContent?.text}
                              </pre>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pagination */}
      {!loading && findings.length > 0 && (
        <div className="flex justify-between items-center">
          <p className="text-sm text-zinc-500">
            Showing {offset + 1}-{offset + findings.length}
          </p>
          <div className="flex gap-2">
            <button
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              className="px-4 py-2 text-sm rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <button
              disabled={!hasMore}
              onClick={() => setOffset(offset + PAGE_SIZE)}
              className="px-4 py-2 text-sm rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
