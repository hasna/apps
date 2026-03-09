import * as React from "react";
import {
  RefreshCwIcon,
  ArrowUpCircleIcon,
  CopyIcon,
  CheckIcon,
  BookOpenIcon,
  TerminalIcon,
  DownloadIcon,
  UploadIcon,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { StatsCards } from "@/components/stats-cards";
import { ConnectorsTable } from "@/components/connectors-table";
import { ConfigureDialog } from "@/components/configure-dialog";
import { ConnectorDetailDialog } from "@/components/connector-detail";
import { ActivityLog } from "@/components/activity-log";
import { Button } from "@/components/ui/button";
import type { ConnectorWithAuth } from "@/types";

export function App() {
  const [connectors, setConnectors] = React.useState<ConnectorWithAuth[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [configuring, setConfiguring] = React.useState<ConnectorWithAuth | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [detailData, setDetailData] = React.useState<Record<string, unknown> | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [activities, setActivities] = React.useState<
    { action: string; connector: string; timestamp: number; detail?: string }[]
  >([]);
  const [toast, setToast] = React.useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  const loadConnectors = React.useCallback(async () => {
    try {
      const [connectorsRes, activityRes] = await Promise.all([
        fetch("/api/connectors"),
        fetch("/api/activity"),
      ]);
      const connectorsData = await connectorsRes.json();
      setConnectors(connectorsData);
      if (activityRes.ok) {
        const activityData = await activityRes.json();
        setActivities(activityData);
      }
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

  const [updating, setUpdating] = React.useState(false);
  const [copied, setCopied] = React.useState<string | null>(null);

  async function handleRowClick(connector: ConnectorWithAuth) {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailData(null);
    try {
      const res = await fetch(`/api/connectors/${connector.name}`);
      const data = await res.json();
      setDetailData(data);
    } catch {
      showToast("Failed to load connector details", "error");
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  }

  function handleOAuthStart(name: string) {
    window.open(
      `/oauth/${name}/start`,
      "_blank",
      "width=600,height=700"
    );
  }

  async function handleInstall(name: string) {
    try {
      const res = await fetch(`/api/connectors/${name}/install`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Installed ${name}`, "success");
        await loadConnectors();
      } else {
        showToast(data.error || `Failed to install ${name}`, "error");
      }
    } catch {
      showToast(`Failed to install ${name}`, "error");
    }
  }

  async function handleUninstall(name: string) {
    try {
      const res = await fetch(`/api/connectors/${name}/uninstall`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Uninstalled ${name}`, "success");
        await loadConnectors();
      } else {
        showToast(data.error || `Failed to uninstall ${name}`, "error");
      }
    } catch {
      showToast(`Failed to uninstall ${name}`, "error");
    }
  }

  async function handleUpdate() {
    setUpdating(true);
    try {
      const res = await fetch("/api/update", { method: "POST" });
      const data = await res.json();
      if (data.count !== undefined) {
        showToast(
          data.count > 0
            ? `Updated ${data.count}/${data.total} connectors`
            : "No connectors to update",
          data.count > 0 ? "success" : "error"
        );
        loadConnectors();
      } else {
        showToast(data.error || "Update failed", "error");
      }
    } catch {
      showToast("Failed to update connectors", "error");
    } finally {
      setUpdating(false);
    }
  }

  function copyCommand(cmd: string) {
    navigator.clipboard.writeText(cmd).then(() => {
      setCopied(cmd);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  const importInputRef = React.useRef<HTMLInputElement>(null);

  async function handleExport() {
    try {
      const res = await fetch("/api/export");
      if (!res.ok) {
        const data = await res.json();
        showToast(data.error || "Export failed", "error");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const disposition = res.headers.get("Content-Disposition");
      const filenameMatch = disposition?.match(/filename="(.+)"/);
      a.download = filenameMatch?.[1] || "connectors-backup.json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast("Credentials exported", "success");
    } catch {
      showToast("Failed to export credentials", "error");
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await res.json();
      if (res.ok && result.success) {
        showToast(`Imported ${result.imported} credential profiles`, "success");
        loadConnectors();
      } else {
        showToast(result.error || "Import failed", "error");
      }
    } catch {
      showToast("Failed to import credentials — invalid file", "error");
    } finally {
      // Reset input so the same file can be selected again
      if (importInputRef.current) importInputRef.current.value = "";
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

        {/* Global Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleUpdate}
            disabled={updating}
          >
            <ArrowUpCircleIcon
              className={`size-3.5 ${updating ? "animate-spin" : ""}`}
            />
            {updating ? "Updating..." : "Update All Connectors"}
          </Button>
          <CopyableCommand
            label="Install via npm"
            command="npx @hasna/connectors"
            icon={<TerminalIcon className="size-3.5" />}
            copied={copied}
            onCopy={copyCommand}
          />
          <CopyableCommand
            label="Update package"
            command="bun install -g @hasna/connectors@latest"
            icon={<ArrowUpCircleIcon className="size-3.5" />}
            copied={copied}
            onCopy={copyCommand}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
          >
            <DownloadIcon className="size-3.5" />
            Export Credentials
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => importInputRef.current?.click()}
          >
            <UploadIcon className="size-3.5" />
            Import Credentials
          </Button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImport}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open("https://github.com/hasna/connectors", "_blank")}
          >
            <BookOpenIcon className="size-3.5" />
            Docs
          </Button>
        </div>

        <ConnectorsTable
          data={connectors}
          onConfigure={handleConfigure}
          onRefresh={handleRefresh}
          onOAuthStart={handleOAuthStart}
          onInstall={handleInstall}
          onUninstall={handleUninstall}
          onRowClick={handleRowClick}
        />

        <ActivityLog activities={activities} />
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

      {/* Connector Detail Dialog */}
      <ConnectorDetailDialog
        connector={detailData as any}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        loading={detailLoading}
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

function CopyableCommand({
  label,
  command,
  icon,
  copied,
  onCopy,
}: {
  label: string;
  command: string;
  icon: React.ReactNode;
  copied: string | null;
  onCopy: (cmd: string) => void;
}) {
  const isCopied = copied === command;
  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5"
      onClick={() => onCopy(command)}
    >
      {icon}
      {label}
      <code className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground">
        {command}
      </code>
      {isCopied ? (
        <CheckIcon className="size-3 text-green-500" />
      ) : (
        <CopyIcon className="size-3 opacity-50" />
      )}
    </Button>
  );
}
