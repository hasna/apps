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

/**
 * Convert an env var name like STRIPE_API_KEY to a camelCase field name
 * by dropping the connector prefix: STRIPE_API_KEY -> apiKey
 */
function envVarToField(variable: string): string {
  const parts = variable.toLowerCase().split("_");
  // Drop first segment (connector prefix like "stripe", "anthropic")
  const rest = parts.slice(1);
  if (rest.length === 0) return parts[0];
  return rest
    .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join("");
}

export function ConfigureDialog({
  connector,
  open,
  onOpenChange,
  onSaved,
}: ConfigureDialogProps) {
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const envVars = connector?.auth?.envVars || [];

  React.useEffect(() => {
    if (open) {
      setValues({});
      setError(null);
    }
  }, [open]);

  if (!connector) return null;

  const hasAnyValue = Object.values(values).some((v) => v.trim());

  async function handleSave() {
    if (!hasAnyValue || !connector) return;
    setSaving(true);
    setError(null);

    try {
      // Save each filled field individually
      const filled = Object.entries(values).filter(([, v]) => v.trim());
      for (const [variable, value] of filled) {
        const field = envVarToField(variable);
        const res = await fetch(`/api/connectors/${connector.name}/key`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: value.trim(), field }),
        });
        const data = await res.json();
        if (!data.success) {
          setError(data.error || `Failed to save ${variable}`);
          setSaving(false);
          return;
        }
      }
      onOpenChange(false);
      onSaved();
    } catch {
      setError("Failed to save keys");
    } finally {
      setSaving(false);
    }
  }

  // If there's only one env var (or none), show a simple single input
  const showPerFieldInputs = envVars.length > 1;

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

        {showPerFieldInputs ? (
          <div className="space-y-3">
            {envVars.map((v, i) => (
              <div key={v.variable} className="space-y-1.5">
                <label
                  className="flex items-center gap-2 text-sm"
                  htmlFor={`env-${v.variable}`}
                >
                  {v.set ? (
                    <CheckCircleIcon className="size-3.5 text-green-500 shrink-0" />
                  ) : (
                    <XCircleIcon className="size-3.5 text-muted-foreground shrink-0" />
                  )}
                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                    {v.variable}
                  </code>
                  <span className="text-muted-foreground text-xs truncate">
                    {v.description}
                  </span>
                </label>
                <Input
                  id={`env-${v.variable}`}
                  type="password"
                  placeholder={v.set ? "Already set (leave empty to keep)" : `Enter ${v.description.toLowerCase()}...`}
                  value={values[v.variable] || ""}
                  onChange={(e) =>
                    setValues((prev) => ({
                      ...prev,
                      [v.variable]: e.target.value,
                    }))
                  }
                  onKeyDown={(e) => e.key === "Enter" && handleSave()}
                  autoFocus={i === 0}
                />
              </div>
            ))}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        ) : (
          <>
            {envVars.length === 1 && (
              <div className="flex items-center gap-2 text-sm">
                {envVars[0].set ? (
                  <CheckCircleIcon className="size-3.5 text-green-500 shrink-0" />
                ) : (
                  <XCircleIcon className="size-3.5 text-muted-foreground shrink-0" />
                )}
                <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                  {envVars[0].variable}
                </code>
                <span className="text-muted-foreground text-xs">
                  {envVars[0].description}
                </span>
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
                value={values["__single__"] || ""}
                onChange={(e) =>
                  setValues({ __single__: e.target.value })
                }
                onKeyDown={(e) => e.key === "Enter" && handleSingleSave()}
                autoFocus
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={showPerFieldInputs ? handleSave : handleSingleSave}
            disabled={!hasAnyValue || saving}
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  async function handleSingleSave() {
    const val = values["__single__"]?.trim();
    if (!val || !connector) return;
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/connectors/${connector.name}/key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: val }),
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
}
