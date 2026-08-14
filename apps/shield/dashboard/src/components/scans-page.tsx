import { useEffect, useState } from "react";
import { fetchScans, triggerScan } from "../lib/api";
import type { Scan, ScannerType } from "../types";

const ALL_SCANNERS: ScannerType[] = [
  "secrets",
  "dependencies",
  "code",
  "git-history",
  "config",
  "ai-safety",
];

function formatDuration(ms: number | null): string {
  if (ms === null) return "-";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface Props {
  onViewFindings: (scanId: string) => void;
}

export function ScansPage({ onViewFindings }: Props) {
  const [scans, setScans] = useState<Scan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New scan form
  const [showForm, setShowForm] = useState(false);
  const [scanPath, setScanPath] = useState("");
  const [selectedScanners, setSelectedScanners] = useState<Set<ScannerType>>(
    new Set(ALL_SCANNERS),
  );
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetchScans({ limit: 50 });
      setScans(res.scans);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function toggleScanner(s: ScannerType) {
    setSelectedScanners((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!scanPath.trim()) return;
    setSubmitting(true);
    try {
      await triggerScan(scanPath.trim(), {
        scanners: Array.from(selectedScanners),
      });
      setShowForm(false);
      setScanPath("");
      // Refresh after a short delay to pick up the new scan
      setTimeout(load, 500);
    } catch (err) {
      alert(`Scan failed: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Scans</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors"
        >
          {showForm ? "Cancel" : "New Scan"}
        </button>
      </div>

      {/* New Scan Form */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-4"
        >
          <div>
            <label className="block text-sm text-zinc-400 mb-1">
              Project Path
            </label>
            <input
              type="text"
              value={scanPath}
              onChange={(e) => setScanPath(e.target.value)}
              placeholder="/path/to/project"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-emerald-600"
            />
          </div>

          <div>
            <label className="block text-sm text-zinc-400 mb-2">
              Scanners
            </label>
            <div className="flex flex-wrap gap-2">
              {ALL_SCANNERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleScanner(s)}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                    selectedScanners.has(s)
                      ? "bg-emerald-600/20 border-emerald-600/50 text-emerald-300"
                      : "bg-zinc-800 border-zinc-700 text-zinc-400"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting || !scanPath.trim()}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? "Starting..." : "Start Scan"}
          </button>
        </form>
      )}

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
      ) : scans.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-10 text-center text-zinc-500">
          No scans yet. Start a new scan to begin.
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-zinc-400 border-b border-zinc-800 bg-zinc-900/80">
                  <th className="text-left py-3 px-4 font-medium">ID</th>
                  <th className="text-left py-3 px-4 font-medium">Status</th>
                  <th className="text-left py-3 px-4 font-medium">Scanners</th>
                  <th className="text-left py-3 px-4 font-medium">Findings</th>
                  <th className="text-left py-3 px-4 font-medium">Duration</th>
                  <th className="text-left py-3 px-4 font-medium">Date</th>
                  <th className="text-left py-3 px-4 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {scans.map((scan) => (
                  <tr
                    key={scan.id}
                    className="border-b border-zinc-800/50 hover:bg-zinc-800/30"
                  >
                    <td className="py-3 px-4 font-mono text-xs text-zinc-400">
                      {scan.id.slice(0, 8)}
                    </td>
                    <td className="py-3 px-4">
                      <StatusBadge status={scan.status} />
                    </td>
                    <td className="py-3 px-4 text-zinc-400">
                      <div className="flex flex-wrap gap-1">
                        {scan.scanner_types.map((t) => (
                          <span
                            key={t}
                            className="px-1.5 py-0.5 text-xs rounded bg-zinc-800 text-zinc-400"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-3 px-4 tabular-nums">
                      {scan.findings_count}
                    </td>
                    <td className="py-3 px-4 text-zinc-400 tabular-nums">
                      {formatDuration(scan.duration_ms)}
                    </td>
                    <td className="py-3 px-4 text-zinc-400">
                      {formatDate(scan.created_at)}
                    </td>
                    <td className="py-3 px-4">
                      <button
                        onClick={() => onViewFindings(scan.id)}
                        className="px-2 py-1 text-xs rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
                      >
                        View Findings
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    running: "bg-blue-500/20 text-blue-400 animate-pulse",
    completed: "bg-emerald-500/20 text-emerald-400",
    failed: "bg-red-500/20 text-red-400",
    pending: "bg-zinc-500/20 text-zinc-400",
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] || styles.pending}`}
    >
      {status}
    </span>
  );
}
