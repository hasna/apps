import { useEffect, useState } from "react";
import {
  fetchRules,
  toggleRule as apiToggleRule,
  createRule as apiCreateRule,
} from "../lib/api";
import type { Rule, ScannerType, Severity } from "../types";

const SCANNER_OPTIONS: ScannerType[] = [
  "secrets",
  "dependencies",
  "code",
  "git-history",
  "config",
  "ai-safety",
];

const SEVERITY_OPTIONS: Severity[] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
];

const SEVERITY_BADGE: Record<string, string> = {
  critical: "bg-red-500/20 text-red-400",
  high: "bg-orange-500/20 text-orange-400",
  medium: "bg-yellow-500/20 text-yellow-400",
  low: "bg-blue-500/20 text-blue-400",
  info: "bg-zinc-500/20 text-zinc-400",
};

export function RulesPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add rule form
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formScanner, setFormScanner] = useState<ScannerType>("code");
  const [formSeverity, setFormSeverity] = useState<Severity>("medium");
  const [formPattern, setFormPattern] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetchRules();
      setRules(res.rules);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleToggle(id: string, enabled: boolean) {
    try {
      await apiToggleRule(id, !enabled);
      setRules((prev) =>
        prev.map((r) => (r.id === id ? { ...r, enabled: !enabled } : r)),
      );
    } catch (e) {
      alert(`Failed to toggle rule: ${(e as Error).message}`);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!formName.trim()) return;
    setSubmitting(true);
    try {
      await apiCreateRule({
        name: formName.trim(),
        scanner_type: formScanner,
        severity: formSeverity,
        pattern: formPattern || undefined,
        description: formDescription || undefined,
      });
      setShowForm(false);
      setFormName("");
      setFormPattern("");
      setFormDescription("");
      load();
    } catch (err) {
      alert(`Failed to create rule: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Rules</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors"
        >
          {showForm ? "Cancel" : "Add Rule"}
        </button>
      </div>

      {/* Add Rule Form */}
      {showForm && (
        <form
          onSubmit={handleCreate}
          className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-4"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-zinc-400 mb-1">Name</label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Rule name"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-emerald-600"
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-1">
                Pattern
              </label>
              <input
                type="text"
                value={formPattern}
                onChange={(e) => setFormPattern(e.target.value)}
                placeholder="Regex pattern (optional)"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-emerald-600"
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-1">
                Scanner Type
              </label>
              <select
                value={formScanner}
                onChange={(e) =>
                  setFormScanner(e.target.value as ScannerType)
                }
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-emerald-600"
              >
                {SCANNER_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-1">
                Severity
              </label>
              <select
                value={formSeverity}
                onChange={(e) =>
                  setFormSeverity(e.target.value as Severity)
                }
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-emerald-600"
              >
                {SEVERITY_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm text-zinc-400 mb-1">
              Description
            </label>
            <input
              type="text"
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              placeholder="Rule description (optional)"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-emerald-600"
            />
          </div>

          <button
            type="submit"
            disabled={submitting || !formName.trim()}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? "Creating..." : "Create Rule"}
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
      ) : rules.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-10 text-center text-zinc-500">
          No rules configured.
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-zinc-400 border-b border-zinc-800 bg-zinc-900/80">
                  <th className="text-left py-3 px-4 font-medium">Name</th>
                  <th className="text-left py-3 px-4 font-medium">Scanner</th>
                  <th className="text-left py-3 px-4 font-medium">Severity</th>
                  <th className="text-left py-3 px-4 font-medium">Built-in</th>
                  <th className="text-left py-3 px-4 font-medium">Enabled</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr
                    key={rule.id}
                    className="border-b border-zinc-800/50 hover:bg-zinc-800/30"
                  >
                    <td className="py-3 px-4">
                      <div>
                        <p className="text-zinc-200">{rule.name}</p>
                        {rule.description && (
                          <p className="text-xs text-zinc-500 mt-0.5 max-w-md truncate">
                            {rule.description}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-zinc-400">
                      {rule.scanner_type}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          SEVERITY_BADGE[rule.severity]
                        }`}
                      >
                        {rule.severity}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-zinc-400">
                      {rule.builtin ? (
                        <span className="text-xs text-zinc-500">built-in</span>
                      ) : (
                        <span className="text-xs text-zinc-600">custom</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <button
                        onClick={() => handleToggle(rule.id, rule.enabled)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          rule.enabled ? "bg-emerald-600" : "bg-zinc-700"
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                            rule.enabled ? "translate-x-4.5" : "translate-x-0.5"
                          }`}
                        />
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
