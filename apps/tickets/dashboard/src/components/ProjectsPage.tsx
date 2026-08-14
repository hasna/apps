import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib.ts";
import type { Project } from "../../../src/types/index.ts";

export default function ProjectsPage() {
  const { data: projects } = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: () => apiFetch("/projects"),
  });

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Projects</h1>
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
        {projects?.map((p) => (
          <div key={p.id} className="border border-gray-200 dark:border-gray-800 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              {p.icon && <span className="text-xl">{p.icon}</span>}
              <h2 className="font-semibold">{p.name}</h2>
              <span className="ml-auto font-mono text-xs text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded">{p.ticket_prefix}</span>
            </div>
            {p.description && <p className="text-sm text-gray-500 mb-3">{p.description}</p>}
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <span>{p.ticket_counter} tickets</span>
              {p.is_public && <span className="bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 px-1.5 py-0.5 rounded">Public</span>}
            </div>
          </div>
        ))}
        {(!projects || projects.length === 0) && (
          <div className="col-span-full text-center py-12 text-gray-400">No projects yet.</div>
        )}
      </div>
    </div>
  );
}
