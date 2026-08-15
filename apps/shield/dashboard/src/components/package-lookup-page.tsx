import { useState } from "react";
import { checkPackage } from "../lib/api";

type CheckResult = Awaited<ReturnType<typeof checkPackage>>;

const ECOSYSTEMS = ["npm", "pypi", "github-actions", "go", "crates.io"];

export function PackageLookupPage() {
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [ecosystem, setEcosystem] = useState("npm");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCheck(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await checkPackage({ name: name.trim(), version: version.trim() || undefined, ecosystem });
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const knownAttacks = [
    { name: "axios", version: "1.14.1", ecosystem: "npm" },
    { name: "litellm", version: "1.82.8", ecosystem: "pypi" },
    { name: "plain-crypto-js", version: "4.2.1", ecosystem: "npm" },
    { name: "trivy", version: "0.69.4", ecosystem: "github-actions" },
  ];

  return (
    <div className="max-w-2xl">
      <h2 className="text-xl font-bold text-zinc-100 mb-2">Package Safety Lookup</h2>
      <p className="text-sm text-zinc-500 mb-6">
        Check if a package version is safe or has known supply chain advisories.
      </p>

      <form onSubmit={handleCheck} className="space-y-3 mb-6">
        <div className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Package name (e.g. axios)"
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 text-sm"
          />
          <input
            type="text"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="Version (optional)"
            className="w-36 bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 text-sm font-mono"
          />
          <select
            value={ecosystem}
            onChange={(e) => setEcosystem(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-300 text-sm"
          >
            {ECOSYSTEMS.map((eco) => (
              <option key={eco} value={eco}>{eco}</option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={loading || !name.trim()}
          className="w-full bg-emerald-700 hover:bg-emerald-600 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg py-2.5 text-sm font-medium transition-colors"
        >
          {loading ? "Checking..." : "Check Package"}
        </button>
      </form>

      {/* Quick checks for known attacks */}
      <div className="mb-6">
        <div className="text-xs text-zinc-500 mb-2">Known compromised packages (click to check):</div>
        <div className="flex flex-wrap gap-2">
          {knownAttacks.map((pkg) => (
            <button
              key={`${pkg.name}@${pkg.version}`}
              onClick={() => {
                setName(pkg.name);
                setVersion(pkg.version);
                setEcosystem(pkg.ecosystem);
              }}
              className="text-xs font-mono bg-zinc-800 border border-zinc-700 hover:border-red-800 rounded px-2 py-1 text-zinc-400 hover:text-red-400 transition-colors"
            >
              {pkg.name}@{pkg.version}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-950/40 border border-red-800 rounded-lg p-4 text-red-400 text-sm">
          Error: {error}
        </div>
      )}

      {result && (
        <div className={`rounded-lg border p-5 ${
          result.status === "COMPROMISED"
            ? "bg-red-950/40 border-red-700"
            : result.status === "HAS_ADVISORIES"
            ? "bg-yellow-950/40 border-yellow-700"
            : "bg-green-950/40 border-green-700"
        }`}>
          <div className="flex items-center gap-3 mb-3">
            <span className="text-2xl">
              {result.status === "COMPROMISED" ? "🚨" : result.status === "HAS_ADVISORIES" ? "⚠️" : "✅"}
            </span>
            <div>
              <div className={`text-lg font-bold ${
                result.status === "COMPROMISED" ? "text-red-400" :
                result.status === "HAS_ADVISORIES" ? "text-yellow-400" : "text-green-400"
              }`}>
                {result.status === "COMPROMISED" ? "COMPROMISED" :
                 result.status === "HAS_ADVISORIES" ? "HAS ADVISORIES" : "SAFE"}
              </div>
              <div className="text-sm text-zinc-400 font-mono">{result.package}</div>
            </div>
          </div>

          {result.status === "COMPROMISED" && result.advisory && (
            <div className="space-y-2 text-sm">
              <div className="text-zinc-200 font-medium">{result.advisory.title}</div>
              <div className="grid grid-cols-2 gap-2">
                <div className="text-zinc-500">Attack type</div>
                <div className="text-zinc-300">{result.advisory.attack_type}</div>
                {result.advisory.threat_actor && (
                  <>
                    <div className="text-zinc-500">Threat actor</div>
                    <div className="text-zinc-300">{result.advisory.threat_actor}</div>
                  </>
                )}
                <div className="text-zinc-500">Safe versions</div>
                <div className="text-green-400 font-mono">
                  {result.advisory.safe_versions?.join(", ") || "none — remove package"}
                </div>
              </div>
              {result.action && (
                <div className="mt-2 p-2 bg-black/30 rounded text-zinc-300 text-xs">
                  👉 {result.action}
                </div>
              )}
              {result.iocs && result.iocs.length > 0 && (
                <div className="mt-3">
                  <div className="text-xs text-zinc-500 mb-1">IOCs ({result.iocs.length}):</div>
                  <div className="space-y-1">
                    {result.iocs.map((ioc, i) => (
                      <div key={i} className="text-xs font-mono flex gap-2">
                        <span className="text-zinc-600 w-16 shrink-0">[{ioc.type}]</span>
                        <span className="text-red-400">{ioc.value}</span>
                        {ioc.context && <span className="text-zinc-600">— {ioc.context}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {result.status === "HAS_ADVISORIES" && result.advisories && (
            <div className="space-y-2 text-sm">
              {result.advisories.map((a, i) => (
                <div key={i} className="bg-zinc-900/50 rounded p-2">
                  <div className="text-zinc-200 text-xs">{a.title}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    Affected: <span className="font-mono text-red-400">{a.affected_versions?.join(", ")}</span>
                    {" · "}Safe: <span className="font-mono text-green-400">{a.safe_versions?.join(", ") || "none"}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {result.status === "SAFE" && result.message && (
            <div className="text-sm text-green-300">{result.message}</div>
          )}
        </div>
      )}
    </div>
  );
}
