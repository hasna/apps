import { useState, useEffect } from "react";
import { fetchAdvisories, fetchAdvisory } from "../lib/api";
import type { Advisory } from "../types";

const SEVERITY_COLORS: Record<string, string> = {
  critical: "text-red-400 bg-red-950/40 border-red-800",
  high: "text-orange-400 bg-orange-950/40 border-orange-800",
  medium: "text-yellow-400 bg-yellow-950/40 border-yellow-800",
  low: "text-blue-400 bg-blue-950/40 border-blue-800",
  info: "text-zinc-400 bg-zinc-800/40 border-zinc-700",
};

const ATTACK_ICONS: Record<string, string> = {
  "maintainer-hijack": "👤",
  "ci-cd-compromise": "⚙️",
  "tag-hijack": "🏷️",
  "typosquatting": "🔤",
  "dependency-confusion": "📦",
  "malicious-package": "💀",
  "postinstall-exploit": "📜",
  "pth-injection": "🐍",
};

function AdvisoryCard({ advisory, onClick }: { advisory: Advisory; onClick: () => void }) {
  const severityStyle = SEVERITY_COLORS[advisory.severity] || SEVERITY_COLORS.info;
  const icon = ATTACK_ICONS[advisory.attack_type] || "⚠️";
  const detectedDate = new Date(advisory.detected_at).toLocaleDateString();

  return (
    <div
      onClick={onClick}
      className="border border-zinc-800 rounded-lg p-4 hover:border-zinc-600 cursor-pointer transition-colors bg-zinc-900/50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs font-bold px-2 py-0.5 rounded border ${severityStyle}`}>
              {advisory.severity.toUpperCase()}
            </span>
            <span className="text-xs text-zinc-500">{icon} {advisory.attack_type}</span>
            {advisory.threat_actor && (
              <span className="text-xs text-zinc-500">by {advisory.threat_actor}</span>
            )}
          </div>
          <h3 className="text-sm font-medium text-zinc-100 truncate">{advisory.title}</h3>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-xs font-mono text-emerald-400">{advisory.package_name}</span>
            <span className="text-xs text-zinc-500">{advisory.ecosystem}</span>
            <span className="text-xs text-zinc-600">{detectedDate}</span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs text-zinc-500">affected</div>
          <div className="text-xs font-mono text-red-400">{advisory.affected_versions.join(", ")}</div>
          {advisory.safe_versions.length > 0 && (
            <>
              <div className="text-xs text-zinc-500 mt-1">safe</div>
              <div className="text-xs font-mono text-green-400">{advisory.safe_versions[0]}</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AdvisoryDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const [advisory, setAdvisory] = useState<Advisory | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAdvisory(id)
      .then(setAdvisory)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 text-zinc-400">Loading...</div>
    </div>
  );

  if (!advisory) return null;

  const severityStyle = SEVERITY_COLORS[advisory.severity] || SEVERITY_COLORS.info;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <span className={`text-xs font-bold px-2 py-0.5 rounded border ${severityStyle}`}>
              {advisory.severity.toUpperCase()}
            </span>
            <h2 className="text-lg font-semibold text-zinc-100 mt-2">{advisory.title}</h2>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-xl">✕</button>
        </div>

        <p className="text-sm text-zinc-400 mb-4">{advisory.description}</p>

        <div className="grid grid-cols-2 gap-3 text-sm mb-4">
          {[
            ["Package", advisory.package_name],
            ["Ecosystem", advisory.ecosystem],
            ["Attack type", advisory.attack_type],
            ["Threat actor", advisory.threat_actor || "unknown"],
            ["Affected", advisory.affected_versions.join(", ")],
            ["Safe versions", advisory.safe_versions.join(", ") || "remove package"],
            ["Detected", new Date(advisory.detected_at).toLocaleString()],
            ...(advisory.cve_id ? [["CVE", advisory.cve_id]] : []),
          ].map(([label, value]) => (
            <div key={label} className="bg-zinc-800/50 rounded p-2">
              <div className="text-xs text-zinc-500 mb-0.5">{label}</div>
              <div className="text-zinc-200 font-mono text-xs">{value}</div>
            </div>
          ))}
        </div>

        {advisory.iocs && advisory.iocs.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-zinc-300 mb-2">
              Indicators of Compromise ({advisory.iocs.length})
            </h3>
            <div className="space-y-1">
              {advisory.iocs.map((ioc) => (
                <div key={ioc.id} className="flex items-start gap-2 text-xs bg-zinc-800/50 rounded p-2">
                  <span className="text-zinc-500 shrink-0 w-20">[{ioc.type}]</span>
                  <span className="font-mono text-red-400 break-all">{ioc.value}</span>
                  {ioc.context && <span className="text-zinc-500 ml-auto shrink-0">— {ioc.context}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {advisory.source && (
          <div className="mt-4 text-xs text-zinc-600">
            Source: <a href={advisory.source} className="text-blue-400 hover:underline" target="_blank" rel="noreferrer">{advisory.source}</a>
          </div>
        )}
      </div>
    </div>
  );
}

export function FeedPage() {
  const [advisories, setAdvisories] = useState<Advisory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ecosystemFilter, setEcosystemFilter] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");

  useEffect(() => {
    setLoading(true);
    fetchAdvisories({ ecosystem: ecosystemFilter || undefined, severity: severityFilter || undefined, limit: 100 })
      .then((data) => { setAdvisories(data.advisories); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [ecosystemFilter, severityFilter]);

  return (
    <div>
      {selectedId && <AdvisoryDetail id={selectedId} onClose={() => setSelectedId(null)} />}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-zinc-100">Supply Chain Advisory Feed</h2>
          <p className="text-sm text-zinc-500 mt-1">
            Known supply chain attacks — {advisories.length} advisories
          </p>
        </div>
        <div className="flex gap-2">
          <select
            value={ecosystemFilter}
            onChange={(e) => setEcosystemFilter(e.target.value)}
            className="text-sm bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-zinc-300"
          >
            <option value="">All ecosystems</option>
            <option value="npm">npm</option>
            <option value="pypi">PyPI</option>
            <option value="github-actions">GitHub Actions</option>
            <option value="go">Go</option>
          </select>
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="text-sm bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-zinc-300"
          >
            <option value="">All severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
          </select>
        </div>
      </div>

      {loading && <div className="text-zinc-500 text-sm">Loading advisories...</div>}
      {error && <div className="text-red-400 text-sm">Error: {error}</div>}

      {!loading && !error && advisories.length === 0 && (
        <div className="text-center py-12 text-zinc-500">
          <div className="text-4xl mb-3">🛡️</div>
          <div>No advisories found.</div>
          <div className="text-xs mt-1">Run <code className="text-zinc-400">security scan --scanner ioc</code> to populate the advisory database.</div>
        </div>
      )}

      <div className="space-y-3">
        {advisories.map((advisory) => (
          <AdvisoryCard
            key={advisory.id}
            advisory={advisory}
            onClick={() => setSelectedId(advisory.id)}
          />
        ))}
      </div>
    </div>
  );
}
