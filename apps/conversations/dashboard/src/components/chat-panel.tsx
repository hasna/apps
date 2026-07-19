import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { XIcon, SendIcon } from "lucide-react";
import { Markdown } from "@/components/markdown";
import type { Message } from "@/types";

interface ChatPanelProps {
  open: boolean;
  onClose: () => void;
  sessionId?: string;
  title: string;
}

export function ChatPanel({ open, onClose, sessionId, title }: ChatPanelProps) {
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [input, setInput] = React.useState("");
  const [fromAgent, setFromAgent] = React.useState("dashboard-user");
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open || !sessionId) return;

    const loadMessages = async () => {
      const params = new URLSearchParams();
      params.set("session", sessionId);
      params.set("limit", "100");
      try {
        const res = await fetch(`/api/messages?${params}`);
        const data = (await res.json()) as Message[];
        setMessages(data.reverse());
      } catch {}
    };

    loadMessages();
    const timer = setInterval(loadMessages, 1000);
    return () => clearInterval(timer);
  }, [open, sessionId]);

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const handleSend = async () => {
    if (!input.trim() || !fromAgent.trim()) return;

    // Derive recipient from the other participant in the session
    const others = messages.map((m) => m.from_agent === fromAgent ? m.to_agent : m.from_agent);
    const to = others[0] || "unknown";

    try {
      await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: fromAgent, to, content: input.trim() }),
      });
      setInput("");
    } catch {}
  };

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-96 border-l bg-background shadow-xl flex flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="font-semibold text-sm truncate">{title}</h3>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <XIcon className="size-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No messages yet</p>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className="text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium text-xs">{msg.from_agent}</span>
                <span className="text-xs text-muted-foreground">{msg.created_at.slice(11, 19)}</span>
              </div>
              <div className="mt-0.5 text-sm">
                <Markdown>{msg.preview}</Markdown>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t px-4 py-3 space-y-2">
        <Input value={fromAgent} onChange={(e) => setFromAgent(e.target.value)} placeholder="Your agent name" className="text-xs" />
        <div className="flex gap-2">
          <Input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSend()} placeholder="Type a message..." />
          <Button size="sm" onClick={handleSend}>
            <SendIcon className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
