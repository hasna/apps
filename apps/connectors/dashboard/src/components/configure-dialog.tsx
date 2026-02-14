import * as React from "react";
import { KeyIcon, CheckCircleIcon, XCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ConnectorWithAuth } from "@/types";

interface ConfigureDialogProps {
  connector: ConnectorWithAuth | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function ConfigureDialog({
  connector,
  open,
  onOpenChange,
  onSaved,
}: ConfigureDialogProps) {
  const [key, setKey] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setKey("");
      setError(null);
    }
  }, [open]);

  if (!connector) return null;

  const envVars = connector.auth?.envVars || [];

  async function handleSave() {
    if (!key.trim() || !connector) return;
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/connectors/${connector.name}/key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: key.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        onOpenChange(false);
        onSaved();
      } else {
        setError(data.error || "Failed to save");
      }
    } catch {
      setError("Failed to save key");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyIcon className="size-5" />
            Configure {connector.displayName}
          </DialogTitle>
          <DialogDescription>
            Stored locally at{" "}
            <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
              ~/.connect/connect-{connector.name}/
            </code>
          </DialogDescription>
        </DialogHeader>

        {envVars.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Environment Variables</p>
            <div className="space-y-1.5">
              {envVars.map((v) => (
                <div
                  key={v.variable}
                  className="flex items-center gap-2 text-sm"
                >
                  {v.set ? (
                    <CheckCircleIcon className="size-3.5 text-green-500 shrink-0" />
                  ) : (
                    <XCircleIcon className="size-3.5 text-muted-foreground shrink-0" />
                  )}
                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                    {v.variable}
                  </code>
                  <span className="text-muted-foreground truncate">
                    {v.description}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="api-key-input">
            API Key / Token
          </label>
          <Input
            id="api-key-input"
            type="password"
            placeholder="Enter key or token..."
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            autoFocus
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!key.trim() || saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
