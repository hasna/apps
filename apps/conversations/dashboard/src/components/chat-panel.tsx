import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { XIcon, SendIcon } from "lucide-react";
import type { Message } from "@/types";

interface ChatPanelProps {
  open: boolean;
  onClose: () => void;
  spaceName?: string;
  sessionId?: string;
  title: string;
}

export function ChatPanel({ open, onClose, spaceName, sessionId, title }: ChatPanelProps) {
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [input, setInput] = React.useState("");
  const [fromAgent, setFromAgent] = React.useState("dashboard-user");
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  // Load and poll messages
  React.useEffect(() => {
    if (!open) return;

    const loadMessages = async () => {
      const params = new URLSearchParams();
      if (spaceName) params.set("space", spaceName);
      else if (sessionId) params.set("session", sessionId);
      params.set("limit", "100");

      try {
        const res = await fetch(`/api/messages?${params}`);
        const data = (await res.json()) as Message[];
        // API returns newest first, reverse for chat view
        setMessages(data.reverse());
      } catch {
        // ignore fetch errors
      }
    };

    loadMessages();
    const timer = setInterval(loadMessages, 1000);
    return () => clearInterval(timer);
  }, [open, spaceName, sessionId]);

  // Auto-scroll to bottom
  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const handleSend = async () => {
    if (!input.trim() || !fromAgent.trim()) return;

    const body: Record<string, string> = {
      from: fromAgent,
      to: spaceName || "unknown",
      content: input.trim(),
    };
    if (spaceName) body.space = spaceName;

    try {
      await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setInput("");
    } catch {
      // ignore send errors
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-96 border-l bg-background shadow-xl flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="font-semibold text-sm truncate">{title}</h3>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <XIcon className="size-4" />
        </Button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No messages yet
          </p>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className="text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium text-xs">{msg.from_agent}</span>
                <span className="text-xs text-muted-foreground">
                  {msg.created_at.slice(11, 19)}
                </span>
              </div>
              <p className="mt-0.5 text-sm">{msg.content}</p>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t px-4 py-3 space-y-2">
        <Input
          value={fromAgent}
          onChange={(e) => setFromAgent(e.target.value)}
          placeholder="Your agent name"
          className="text-xs"
        />
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Type a message..."
          />
          <Button size="sm" onClick={handleSend}>
            <SendIcon className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
