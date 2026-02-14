import * as React from "react";
import { RefreshCwIcon } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { StatsCards } from "@/components/stats-cards";
import { ConnectorsTable } from "@/components/connectors-table";
import { ConfigureDialog } from "@/components/configure-dialog";
import { Button } from "@/components/ui/button";
import type { ConnectorWithAuth } from "@/types";

export function App() {
  const [connectors, setConnectors] = React.useState<ConnectorWithAuth[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [configuring, setConfiguring] = React.useState<ConnectorWithAuth | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [toast, setToast] = React.useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  const loadConnectors = React.useCallback(async () => {
    try {
      const res = await fetch("/api/connectors");
      const data = await res.json();
      setConnectors(data);
    } catch {
      showToast("Failed to load connectors", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadConnectors();
  }, [loadConnectors]);

  // Listen for OAuth popup completion
  React.useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (e.data?.type === "oauth-complete") {
        showToast(`Connected ${e.data.connector}`, "success");
        loadConnectors();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [loadConnectors]);

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  function handleConfigure(connector: ConnectorWithAuth) {
    setConfiguring(connector);
    setDialogOpen(true);
  }

  async function handleRefresh(name: string) {
    try {
      const res = await fetch(`/api/connectors/${name}/refresh`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Token refreshed for ${name}`, "success");
        loadConnectors();
      } else {
        showToast(data.error || "Failed to refresh", "error");
      }
    } catch {
      showToast("Failed to refresh token", "error");
    }
  }

  function handleOAuthStart(name: string) {
    window.open(
      `/oauth/${name}/start`,
      "_blank",
      "width=600,height=700"
    );
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
                Connectors
              </span>
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={loadConnectors}
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
        <StatsCards connectors={connectors} />
        <ConnectorsTable
          data={connectors}
          onConfigure={handleConfigure}
          onRefresh={handleRefresh}
          onOAuthStart={handleOAuthStart}
        />
      </main>

      {/* Configure Dialog */}
      <ConfigureDialog
        connector={configuring}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSaved={() => {
          showToast(`Key saved for ${configuring?.name}`, "success");
          loadConnectors();
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
