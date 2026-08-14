import * as React from "react";
import { PlusIcon } from "lucide-react";
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

interface AddServerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
}

export function AddServerDialog({
  open,
  onOpenChange,
  onAdded,
}: AddServerDialogProps) {
  const [name, setName] = React.useState("");
  const [command, setCommand] = React.useState("npx");
  const [args, setArgs] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setName("");
      setCommand("npx");
      setArgs("");
      setDescription("");
      setError(null);
    }
  }, [open]);

  function parseArgs(input: string): string[] {
    const result: string[] = [];
    const regex = /"([^"\\]*(\\.[^"\\]*)*)"|'([^'\\]*(\\.[^'\\]*)*)'|[^\s]+/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(input)) !== null) {
      const raw = match[1] ?? match[3] ?? match[0];
      result.push(raw.replace(/\\(["'\\])/g, "$1"));
    }
    return result;
  }

  async function readJsonSafe(res: Response): Promise<any | null> {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }

  async function handleSave() {
    if (!command.trim()) return;
    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || undefined,
          command: command.trim(),
          args: parseArgs(args.trim()),
          description: description.trim() || undefined,
        }),
      });
      const data = await readJsonSafe(res);
      if (!res.ok) {
        setError(data?.error || `Failed to add server (${res.status})`);
        return;
      }
      if (data?.id) {
        onOpenChange(false);
        onAdded();
      } else {
        setError(data?.error || "Failed to add server");
      }
    } catch {
      setError("Failed to add server");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlusIcon className="size-5" />
            Add MCP Server
          </DialogTitle>
          <DialogDescription>
            Register a new MCP server to the local registry.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="server-name">
              Name (optional)
            </label>
            <Input
              id="server-name"
              placeholder="e.g. GitHub"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="server-command">
              Command
            </label>
            <Input
              id="server-command"
              placeholder="npx"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="server-args">
              Arguments
            </label>
            <Input
              id="server-args"
              placeholder="-y @modelcontextprotocol/server-github"
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="server-desc">
              Description (optional)
            </label>
            <Input
              id="server-desc"
              placeholder="What does this server do?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!command.trim() || saving}>
            {saving ? "Adding..." : "Add Server"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
