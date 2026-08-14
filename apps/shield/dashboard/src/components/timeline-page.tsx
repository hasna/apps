import { useState, useEffect } from "react";
import { fetchAdvisories } from "../lib/api";
import type { Advisory } from "../types";

const ATTACK_COLORS: Record<string, string> = {
  "maintainer-hijack": "bg-purple-600",
  "ci-cd-compromise": "bg-orange-600",
  "tag-hijack": "bg-yellow-600",
  "typosquatting": "bg-cyan-600",
  "malicious-package": "bg-red-600",
  "postinstall-exploit": "bg-pink-600",
  "pth-injection": "bg-blue-600",
  "dependency-confusion": "bg-green-600",
};

const ECOSYSTEM_BADGE: Record<string, string> = {
  npm: "bg-red-900/50 text-red-300",
  pypi: "bg-blue-900/50 text-blue-300",
  "github-actions": "bg-zinc-700/50 text-zinc-300",
  go: "bg-cyan-900/50 text-cyan-300",
  "crates.io": "bg-orange-900/50 text-orange-300",
};

function groupByMonth(advisories: Advisory[]): Map<string, Advisory[]> {
  const groups = new Map<string, Advisory[]>();
  for (const a of advisories) {
    const key = new Date(a.detected_at).toLocaleDateString("en-US", { year: "numeric", month: "long" });
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(a);
  }
  return groups;
}

function ThreatActorBadge({ actor, count }: { actor: string; count: number }) {
  return (
    <div className="flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 rounded-full px-3 py-1">
      <span className="w-2 h-2 rounded-full bg-red-500 inline-block"></span>
      <span className="text-xs text-zinc-300 font-medium">{actor}</span>
      <span className="text-xs text-zinc-500">({count})</span>
    </div>
  );
}

export function TimelinePage() {
  const [advisories, setAdvisories] = useState<Advisory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAdvisories({ limit: 200 })
      .then((data) => {
        // Sort by detected_at desc
        const sorted = [...data.advisories].sort(
          (a, b) => new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime()
        );
        setAdvisories(sorted);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Stats
  const byEcosystem = advisories.reduce((acc, a) => {
    acc[a.ecosystem] = (acc[a.ecosystem] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const byAttackType = advisories.reduce((acc, a) => {
    acc[a.attack_type] = (acc[a.attack_type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const threatActors = advisories.reduce((acc, a) => {
    if (a.threat_actor) acc[a.threat_actor] = (acc[a.threat_actor] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const grouped = groupByMonth(advisories);

  return (
    <div>
      <h2 className="text-xl font-bold text-zinc-100 mb-2">Attack Timeline</h2>
      <p className="text-sm text-zinc-500 mb-6">Chronological view of supply chain attacks</p>

      {loading && <div className="text-zinc-500 text-sm">Loading...</div>}
      {error && <div className="text-red-400 text-sm">Error: {error}</div>}

      {!loading && !error && advisories.length === 0 && (
        <div className="text-center py-12 text-zinc-500">
          <div className="text-4xl mb-3">📅</div>
          <div>No advisories to display.</div>
        </div>
      )}

      {advisories.length > 0 && (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-3 gap-4 mb-8">
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <div className="text-3xl font-bold text-zinc-100">{advisories.length}</div>
              <div className="text-sm text-zinc-500 mt-1">Total advisories</div>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <div className="text-3xl font-bold text-red-400">
                {advisories.filter((a) => a.severity === "critical").length}
              </div>
              <div className="text-sm text-zinc-500 mt-1">Critical severity</div>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <div className="text-3xl font-bold text-orange-400">
                {Object.keys(threatActors).length}
              </div>
              <div className="text-sm text-zinc-500 mt-1">Threat actors</div>
            </div>
          </div>

          {/* Threat actors */}
          {Object.keys(threatActors).length > 0 && (
            <div className="mb-6">
              <div className="text-sm text-zinc-400 font-medium mb-2">Active threat actors</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(threatActors).sort((a, b) => b[1] - a[1]).map(([actor, count]) => (
                  <ThreatActorBadge key={actor} actor={actor} count={count} />
                ))}
              </div>
            </div>
          )}

          {/* Attack type breakdown */}
          <div className="mb-8">
            <div className="text-sm text-zinc-400 font-medium mb-3">Attack vectors</div>
            <div className="space-y-2">
              {Object.entries(byAttackType).sort((a, b) => b[1] - a[1]).map(([type, count]) => {
                const pct = Math.round((count / advisories.length) * 100);
                const color = ATTACK_COLORS[type] || "bg-zinc-600";
                return (
                  <div key={type} className="flex items-center gap-3">
                    <div className="text-xs text-zinc-400 w-40 shrink-0">{type}</div>
                    <div className="flex-1 bg-zinc-800 rounded-full h-2">
                      <div className={`${color} h-2 rounded-full`} style={{ width: `${pct}%` }}></div>
                    </div>
                    <div className="text-xs text-zinc-500 w-12 text-right">{count} ({pct}%)</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Timeline */}
          <div className="relative">
            <div className="absolute left-[7px] top-0 bottom-0 w-0.5 bg-zinc-800"></div>

            {Array.from(grouped.entries()).map(([month, monthAdvisories]) => (
              <div key={month} className="mb-8">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-4 h-4 rounded-full bg-zinc-600 border-2 border-zinc-400 z-10 shrink-0"></div>
                  <div className="text-sm font-semibold text-zinc-300">{month}</div>
                  <div className="text-xs text-zinc-600">({monthAdvisories.length} advisories)</div>
                </div>

                <div className="ml-7 space-y-2">
                  {monthAdvisories.map((advisory) => {
                    const dotColor = ATTACK_COLORS[advisory.attack_type] || "bg-zinc-600";
                    const ecoBadge = ECOSYSTEM_BADGE[advisory.ecosystem] || "bg-zinc-700/50 text-zinc-400";
                    const date = new Date(advisory.detected_at).toLocaleDateString("en-US", {
                      month: "short", day: "numeric",
                    });

                    return (
                      <div
                        key={advisory.id}
                        className="relative flex items-start gap-3 bg-zinc-900/50 border border-zinc-800 rounded-lg p-3 hover:border-zinc-700 transition-colors"
                      >
                        <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${dotColor}`}></div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs text-zinc-500">{date}</span>
                            <span className={`text-xs px-1.5 py-0.5 rounded ${ecoBadge}`}>
                              {advisory.ecosystem}
                            </span>
                            {advisory.severity === "critical" && (
                              <span className="text-xs text-red-400 font-bold">CRITICAL</span>
                            )}
                            {advisory.threat_actor && (
                              <span className="text-xs text-zinc-500">by {advisory.threat_actor}</span>
                            )}
                          </div>
                          <div className="text-sm text-zinc-200 mt-0.5 truncate">
                            <span className="font-mono text-emerald-400">{advisory.package_name}</span>
                            {" — "}
                            <span className="text-zinc-400">{advisory.title.replace(/^[^:]+:\s*/, "")}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-xs text-zinc-600">
                            <span>affected: <span className="font-mono text-red-400/70">{advisory.affected_versions.join(", ")}</span></span>
                            {advisory.safe_versions.length > 0 && (
                              <span>· safe: <span className="font-mono text-green-400/70">{advisory.safe_versions[0]}</span></span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
