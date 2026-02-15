import * as React from "react";
import { SendIcon } from "lucide-react";
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

interface SendDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent: () => void;
}

export function SendDialog({ open, onOpenChange, onSent }: SendDialogProps) {
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [content, setContent] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSend() {
    if (!from.trim() || !to.trim() || !content.trim()) return;
    setSending(true);
    setError(null);

    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: from.trim(),
          to: to.trim(),
          content: content.trim(),
        }),
      });
      const data = await res.json();
      if (data.id) {
        setFrom("");
        setTo("");
        setContent("");
        onOpenChange(false);
        onSent();
      } else {
        setError(data.error || "Failed to send");
      }
    } catch {
      setError("Failed to send message");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SendIcon className="size-5" />
            Send Message
          </DialogTitle>
          <DialogDescription>
            Send a direct message between agents.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="send-from">
              From
            </label>
            <Input
              id="send-from"
              placeholder="sender-agent"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="send-to">
              To
            </label>
            <Input
              id="send-to"
              placeholder="recipient-agent"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="send-content">
              Message
            </label>
            <Input
              id="send-content"
              placeholder="Your message..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSend}
            disabled={!from.trim() || !to.trim() || !content.trim() || sending}
          >
            {sending ? "Sending..." : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
