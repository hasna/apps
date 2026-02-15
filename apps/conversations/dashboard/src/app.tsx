import * as React from "react";
import { RefreshCwIcon, SendIcon, HashIcon, MessageSquareIcon } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { StatsCards } from "@/components/stats-cards";
import { MessagesTable } from "@/components/messages-table";
import { ChannelsList } from "@/components/channels-list";
import { SendDialog } from "@/components/send-dialog";
import { Button } from "@/components/ui/button";
import type { Message, Channel, DashboardStatus } from "@/types";

type Tab = "messages" | "channels";

export function App() {
  const [status, setStatus] = React.useState<DashboardStatus | null>(null);
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [channels, setChannels] = React.useState<Channel[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [tab, setTab] = React.useState<Tab>("messages");
  const [sendOpen, setSendOpen] = React.useState(false);
  const [toast, setToast] = React.useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  const loadData = React.useCallback(async () => {
    try {
      const [statusRes, messagesRes, channelsRes] = await Promise.all([
        fetch("/api/status"),
        fetch("/api/messages?limit=50"),
        fetch("/api/channels"),
      ]);
      setStatus(await statusRes.json());
      setMessages(await messagesRes.json());
      setChannels(await channelsRes.json());
    } catch {
      showToast("Failed to load data", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadData();
    const timer = setInterval(loadData, 3000);
    return () => clearInterval(timer);
  }, [loadData]);

  function showToast(message: string, type: "success" | "error") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <h1 className="text-base font-semibold">
              Hasna{" "}
              <span className="font-normal text-muted-foreground">
                Conversations
              </span>
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSendOpen(true)}
            >
              <SendIcon className="size-3.5" />
              Send
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setLoading(true); loadData(); }}
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
        <StatsCards status={status} />

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b">
          <button
            onClick={() => setTab("messages")}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === "messages"
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <MessageSquareIcon className="size-4" />
            Messages
          </button>
          <button
            onClick={() => setTab("channels")}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === "channels"
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <HashIcon className="size-4" />
            Channels
            {channels.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {channels.length}
              </span>
            )}
          </button>
        </div>

        {tab === "messages" && <MessagesTable messages={messages} />}
        {tab === "channels" && <ChannelsList channels={channels} />}
      </main>

      {/* Send Dialog */}
      <SendDialog
        open={sendOpen}
        onOpenChange={setSendOpen}
        onSent={() => {
          showToast("Message sent", "success");
          loadData();
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
