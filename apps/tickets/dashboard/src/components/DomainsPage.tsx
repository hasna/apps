import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib.ts";

interface Domain {
  id: string; domain: string; verified: boolean; verified_at: string | null;
  project_id: string | null; created_at: string;
}

export default function DomainsPage() {
  const qc = useQueryClient();
  const [newDomain, setNewDomain] = useState("");
  const [projectId, setProjectId] = useState("");
  const [added, setAdded] = useState<{ domain: Domain; token: string } | null>(null);

  const { data: domains } = useQuery<Domain[]>({
    queryKey: ["domains"],
    queryFn: () => apiFetch("/domains"),
  });

  const add = useMutation({
    mutationFn: (body: { domain: string; project_id?: string }) =>
      apiFetch<{ domain: Domain; verification_token?: string }>("/domains", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: ["domains"] });
      setAdded(result as { domain: Domain; token: string });
      setNewDomain("");
    },
  });

  const verify = useMutation({
    mutationFn: (id: string) => apiFetch<Domain>(`/domains/${id}/verify`, { method: "POST" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["domains"] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/domains/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["domains"] }),
  });

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Custom Domains</h1>

      {/* Add domain form */}
      <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-4 mb-6">
        <h2 className="font-semibold mb-3">Add Domain</h2>
        <div className="flex gap-2">
          <input
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            placeholder="tickets.myapp.com"
            className="flex-1 border border-gray-200 dark:border-gray-700 rounded-md px-3 py-2 text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={() => add.mutate({ domain: newDomain, project_id: projectId || undefined })}
            disabled={!newDomain || add.isPending}
            className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>

      {/* DNS instructions after adding */}
      {added && (
        <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6">
          <h3 className="font-semibold text-blue-800 dark:text-blue-200 mb-2">DNS Verification Required</h3>
          <p className="text-sm text-blue-700 dark:text-blue-300 mb-3">Add this TXT record to your DNS provider:</p>
          <div className="bg-white dark:bg-gray-900 rounded border border-blue-200 dark:border-blue-700 p-3 font-mono text-xs space-y-1">
            <div><span className="text-gray-500">Host:</span> <span className="font-bold">_tickets-verify.{added.domain.domain}</span></div>
            <div><span className="text-gray-500">Value:</span> <span className="font-bold break-all">{added.token}</span></div>
          </div>
          <p className="text-xs text-blue-600 dark:text-blue-400 mt-2">DNS changes may take up to 48 hours. Then click Verify.</p>
          <button onClick={() => setAdded(null)} className="mt-2 text-xs text-blue-600 underline">Dismiss</button>
        </div>
      )}

      {/* Domain list */}
      <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
        {(!domains || domains.length === 0) ? (
          <div className="px-4 py-8 text-center text-sm text-gray-400">No domains yet.</div>
        ) : (
          domains.map((d) => (
            <div key={d.id} className="flex items-center gap-3 px-4 py-3 border-b last:border-0 border-gray-100 dark:border-gray-800">
              <span className={`text-sm ${d.verified ? "text-green-500" : "text-yellow-500"}`}>
                {d.verified ? "✓" : "○"}
              </span>
              <div className="flex-1">
                <span className="font-medium text-sm">{d.domain}</span>
                {d.verified && d.verified_at && (
                  <span className="ml-2 text-xs text-gray-400">verified {new Date(d.verified_at).toLocaleDateString()}</span>
                )}
              </div>
              <div className="flex gap-2">
                {!d.verified && (
                  <button
                    onClick={() => verify.mutate(d.id)}
                    disabled={verify.isPending}
                    className="text-xs text-blue-600 hover:underline disabled:opacity-50"
                  >
                    Verify
                  </button>
                )}
                <button
                  onClick={() => remove.mutate(d.id)}
                  disabled={remove.isPending}
                  className="text-xs text-red-500 hover:underline disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
