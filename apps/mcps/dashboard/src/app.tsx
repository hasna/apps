import * as React from "react";
import { RefreshCwIcon, PlusIcon, DownloadIcon } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { StatsCards } from "@/components/stats-cards";
import { ServersTable } from "@/components/servers-table";
import { AddServerDialog } from "@/components/add-server-dialog";
import { Button } from "@/components/ui/button";
import type { McpServerEntry } from "@/types";

export function App() {
  const [servers, setServers] = React.useState<McpServerEntry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [addOpen, setAddOpen] = React.useState(false);
  const [updating, setUpdating] = React.useState(false);
  const [version, setVersion] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);
  const loadIdRef = React.useRef(0);
  const toastTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadServers = React.useCallback(async () => {
    const requestId = ++loadIdRef.current;
    setLoading(true);
    try {
      const res = await fetch("/api/servers");
      if (!res.ok) {
        throw new Error(`Failed to load servers (${res.status})`);
      }
      const data = await res.json();
      if (requestId !== loadIdRef.current) return;
      setServers(data);
    } catch {
      if (requestId === loadIdRef.current) {
        showToast("Failed to load servers", "error");
      }
    } finally {
      if (requestId === loadIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  const loadVersion = React.useCallback(async () => {
    try {
      const res = await fetch("/api/version");
      const data = await res.json();
      setVersion(data.version);
    } catch {
      // ignore
    }
  }, []);

  React.useEffect(() => {
    loadServers();
    loadVersion();
  }, [loadServers, loadVersion]);

  React.useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    };
  }, []);

  async function handleUpdate() {
    setUpdating(true);
    try {
      const res = await fetch("/api/update", { method: "POST" });
      const data = await res.json();
      if (data.error) {
        showToast(data.error, "error");
      } else if (data.upToDate) {
        showToast(`Already up to date (v${data.current})`, "success");
      } else {
        showToast(`Updated from v${data.current} to v${data.latest}`, "success");
        loadVersion();
      }
    } catch {
      showToast("Update failed", "error");
    } finally {
      setUpdating(false);
    }
  }

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 3000);
  }

  async function readJsonSafe(res: Response): Promise<any | null> {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }

  async function handleToggle(id: string, enabled: boolean) {
    try {
      const res = await fetch(`/api/servers/${id}/${enabled ? "enable" : "disable"}`, {
        method: "POST",
      });
      const data = await readJsonSafe(res);
      if (!res.ok) {
        showToast(data?.error || `Failed to update (${res.status})`, "error");
        return;
      }
      if (data?.success) {
        showToast(`Server ${enabled ? "enabled" : "disabled"}`, "success");
        loadServers();
      } else {
        showToast(data?.error || "Failed to update", "error");
      }
    } catch {
      showToast("Failed to update server", "error");
    }
  }

  async function handleRemove(id: string) {
    try {
      const res = await fetch(`/api/servers/${id}`, {
        method: "DELETE",
      });
      const data = await readJsonSafe(res);
      if (!res.ok) {
        showToast(data?.error || `Failed to remove (${res.status})`, "error");
        return;
      }
      if (data?.success) {
        showToast("Server removed", "success");
        loadServers();
      } else {
        showToast(data?.error || "Failed to remove", "error");
      }
    } catch {
      showToast("Failed to remove server", "error");
    }
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <img
              src="/logo.jpg"
              alt="Hasna"
              className="h-7 w-auto rounded"
            />
            <h1 className="text-base font-semibold">
              Hasna{" "}
              <span className="font-normal text-muted-foreground">
                MCPs
              </span>
              {version && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  v{version}
                </span>
              )}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddOpen(true)}
            >
              <PlusIcon className="size-3.5" />
              Add Server
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleUpdate}
              disabled={updating}
            >
              <DownloadIcon
                className={`size-3.5 ${updating ? "animate-pulse" : ""}`}
              />
              {updating ? "Updating..." : "Update"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={loadServers}
              disabled={loading}
            >
              <RefreshCwIcon
                className={`size-3.5 ${loading ? "animate-spin" : ""}`}
              />
              Reload
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-6xl space-y-6 px-6 py-6">
        <StatsCards servers={servers} />
        <ServersTable
          data={servers}
          onToggle={handleToggle}
          onRemove={handleRemove}
        />
      </main>

      {/* Add Server Dialog */}
      <AddServerDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdded={() => {
          showToast("Server added", "success");
          loadServers();
        }}
      />

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 rounded-lg border px-4 py-3 text-sm shadow-lg transition-all ${
            toast.type === "success"
              ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200"
              : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
