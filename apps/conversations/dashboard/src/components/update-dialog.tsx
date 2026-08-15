import * as React from "react";
import { DownloadIcon, CheckCircleIcon, XCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface UpdateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: string;
  latest: string;
  onUpdated: (message: string, type: "success" | "error") => void;
}

export function UpdateDialog({ open, onOpenChange, current, latest, onUpdated }: UpdateDialogProps) {
  const [updating, setUpdating] = React.useState(false);
  const [result, setResult] = React.useState<{ status: string; message: string } | null>(null);

  function handleClose() {
    if (updating) return;
    setResult(null);
    onOpenChange(false);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      handleClose();
      return;
    }
    onOpenChange(true);
  }

  async function handleUpdate() {
    setUpdating(true);
    setResult(null);

    try {
      const res = await fetch("/api/update", { method: "POST" });
      let data: any = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (!res.ok) {
        const message = data?.stderr || data?.error || `Update failed (${res.status})`;
        setResult({ status: "error", message });
        onUpdated("Update failed", "error");
      } else if (data?.status === "updated") {
        setResult({ status: "success", message: `Updated to v${latest}` });
        onUpdated(`Updated to v${latest}`, "success");
      } else if (data?.status === "up-to-date") {
        setResult({ status: "success", message: "Already up to date" });
      } else {
        setResult({ status: "error", message: data?.stderr || data?.error || "Update failed" });
        onUpdated("Update failed", "error");
      }
    } catch {
      setResult({ status: "error", message: "Failed to connect to server" });
      onUpdated("Update failed", "error");
    } finally {
      setUpdating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DownloadIcon className="size-5" />
            Update Available
          </DialogTitle>
          <DialogDescription>
            A new version of Conversations is available.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-md border px-4 py-3 text-sm">
            <span className="text-muted-foreground">Current version</span>
            <span className="font-mono font-medium">v{current}</span>
          </div>
          <div className="flex items-center justify-between rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm dark:border-green-900 dark:bg-green-950">
            <span className="text-muted-foreground">Latest version</span>
            <span className="font-mono font-medium text-green-700 dark:text-green-300">v{latest}</span>
          </div>

          {result && (
            <div
              className={`flex items-center gap-2 rounded-md border px-4 py-3 text-sm ${
                result.status === "success"
                  ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200"
                  : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
              }`}
            >
              {result.status === "success" ? (
                <CheckCircleIcon className="size-4 shrink-0" />
              ) : (
                <XCircleIcon className="size-4 shrink-0" />
              )}
              {result.message}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={updating}>
            {result ? "Close" : "Cancel"}
          </Button>
          {!result && (
            <Button onClick={handleUpdate} disabled={updating}>
              {updating ? "Updating..." : "Update Now"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
