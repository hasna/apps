import { useEffect, useState } from "react";
import { fetchProjects, createProject as apiCreateProject } from "../lib/api";
import type { Project } from "../types";

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add project form
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formPath, setFormPath] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetchProjects();
      setProjects(res.projects);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!formName.trim() || !formPath.trim()) return;
    setSubmitting(true);
    try {
      await apiCreateProject(formName.trim(), formPath.trim());
      setShowForm(false);
      setFormName("");
      setFormPath("");
      load();
    } catch (err) {
      alert(`Failed to create project: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Projects</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors"
        >
          {showForm ? "Cancel" : "Add Project"}
        </button>
      </div>

      {/* Add Project Form */}
      {showForm && (
        <form
          onSubmit={handleCreate}
          className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-4"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-zinc-400 mb-1">
                Project Name
              </label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="my-project"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-emerald-600"
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-1">Path</label>
              <input
                type="text"
                value={formPath}
                onChange={(e) => setFormPath(e.target.value)}
                placeholder="/path/to/project"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-emerald-600"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting || !formName.trim() || !formPath.trim()}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? "Creating..." : "Create Project"}
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
      ) : projects.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-10 text-center text-zinc-500">
          No projects yet. Add a project or run a scan to get started.
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-zinc-400 border-b border-zinc-800 bg-zinc-900/80">
                  <th className="text-left py-3 px-4 font-medium">Name</th>
                  <th className="text-left py-3 px-4 font-medium">Path</th>
                  <th className="text-left py-3 px-4 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr
                    key={project.id}
                    className="border-b border-zinc-800/50 hover:bg-zinc-800/30"
                  >
                    <td className="py-3 px-4 text-zinc-200 font-medium">
                      {project.name}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-zinc-400">
                      {project.path}
                    </td>
                    <td className="py-3 px-4 text-zinc-400">
                      {formatDate(project.created_at)}
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
