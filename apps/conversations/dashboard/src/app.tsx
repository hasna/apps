import * as React from "react";
import { RefreshCwIcon } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { StatsCards } from "@/components/stats-cards";
import { MessagesTable } from "@/components/messages-table";
import { ChannelsList } from "@/components/channels-list";
import { ProjectsList } from "@/components/projects-list";
import { ChatPanel } from "@/components/chat-panel";
import { ChannelFeed } from "@/components/channel-feed";
import { SendDialog } from "@/components/send-dialog";
import { HelpPage } from "@/components/help-page";
import { AgentsPage } from "@/components/agents-page";
import { Button } from "@/components/ui/button";
import type { Message, Channel, Project, DashboardStatus } from "@/types";

type Page = "dashboard" | "messages" | "channels" | "projects" | "agents" | "help";

export function App() {
  const [status, setStatus] = React.useState<DashboardStatus | null>(null);
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [channels, setChannels] = React.useState<Channel[]>([]);
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [page, setPage] = React.useState<Page>("dashboard");
  const [sendOpen, setSendOpen] = React.useState(false);
  const [chatOpen, setChatOpen] = React.useState(false);
  const [chatSession, setChatSession] = React.useState<string | undefined>();
  const [chatTitle, setChatTitle] = React.useState("");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [searchResults, setSearchResults] = React.useState<Message[] | null>(null);
  const [selectedChannel, setSelectedChannel] = React.useState<string | null>(null);
  const [messageLimit, setMessageLimit] = React.useState(50);
  const [toast, setToast] = React.useState<{ message: string; type: "success" | "error" } | null>(null);

  const [channelUnreadCounts, setChannelUnreadCounts] = React.useState<Record<string, number>>({});
  const loadInFlight = React.useRef(false);

  const showToast = React.useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const fetchJson = React.useCallback(async <T,>(input: RequestInfo, init?: RequestInit): Promise<T> => {
    const res = await fetch(input, init);
    let data: unknown = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      const msg = typeof (data as any)?.error === "string" ? (data as any).error : `Request failed (${res.status})`;
      throw new Error(msg);
    }
    if (data === null) throw new Error("Invalid server response");
    return data as T;
  }, []);

  const loadData = React.useCallback(async () => {
    if (loadInFlight.current) return;
    loadInFlight.current = true;
    try {
      const [statusRes, messagesRes, channelsRes, projectsRes, allMsgsRes] = await Promise.all([
        fetchJson<DashboardStatus>("/api/status"),
        fetchJson<Message[]>(`/api/messages?limit=${messageLimit}`),
        fetchJson<Channel[]>("/api/channels"),
        fetchJson<Project[]>("/api/projects"),
        fetchJson<Message[]>("/api/messages?limit=500"),
      ]);
      setStatus(statusRes);
      // Filter to DMs only for the messages page
      setMessages(messagesRes.filter((m) => !m.channel));
      setChannels(channelsRes);
      setProjects(projectsRes);
      // Compute unread counts per channel
      const counts: Record<string, number> = {};
      for (const m of allMsgsRes) {
        if (m.channel && m.unread) {
          counts[m.channel] = (counts[m.channel] || 0) + 1;
        }
      }
      setChannelUnreadCounts(counts);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to load data", "error");
    } finally {
      loadInFlight.current = false;
      setLoading(false);
    }
  }, [fetchJson, showToast, messageLimit]);

  const handleSearch = React.useCallback(async (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) { setSearchResults(null); return; }
    try {
      const res = await fetch(`/api/messages/search?q=${encodeURIComponent(query)}&limit=50`);
      if (res.ok) {
        const data = await res.json() as Message[];
        // Filter to DMs only
        setSearchResults(data.filter((m) => !m.channel));
      }
    } catch { setSearchResults(null); }
  }, []);

  const openChat = React.useCallback((opts: { sessionId?: string; title: string }) => {
    setChatSession(opts.sessionId);
    setChatTitle(opts.title);
    setChatOpen(true);
  }, []);

  React.useEffect(() => { loadData(); const t = setInterval(loadData, 3000); return () => clearInterval(t); }, [loadData]);

  // Keyboard shortcuts
  React.useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "0") setPage("dashboard");
      if (e.key === "1") setPage("messages");
      if (e.key === "2") { setPage("channels"); setSelectedChannel(null); }
      if (e.key === "3") setPage("projects");
      if (e.key === "4") setPage("agents");
      if (e.key === "5") setPage("help");
      if (e.key === "n" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); setSendOpen(true); }
      if (e.key === "r" && !e.ctrlKey && !e.metaKey) loadData();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [loadData]);

  const navItems: { key: Page; label: string }[] = [
    { key: "dashboard", label: "Dashboard" },
    { key: "messages", label: "Messages" },
    { key: "channels", label: "Channels" },
    { key: "projects", label: "Projects" },
    { key: "agents", label: "Agents" },
    { key: "help", label: "Help" },
  ];

  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-6">
            <button className="flex items-center gap-3 hover:opacity-80 transition-opacity" onClick={() => setPage("dashboard")}>
              <img src="/logo.jpg" alt="Hasna" className="h-7 w-auto rounded" />
              <h1 className="text-base font-semibold">Hasna <span className="font-normal text-muted-foreground">Conversations</span></h1>
            </button>
            <nav className="flex items-center gap-1">
              {navItems.map((item) => (
                <Button
                  key={item.key}
                  variant={page === item.key ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => { setPage(item.key); if (item.key === "channels") setSelectedChannel(null); }}
                >
                  {item.label}
                </Button>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" className="size-8" onClick={loadData} disabled={loading} title="Reload (r)">
              <RefreshCwIcon className={`size-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-6 py-6">
        {page === "dashboard" && <StatsCards status={status} />}

        {page === "messages" && (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Direct Messages</h2>
              <Button size="sm" onClick={() => setSendOpen(true)} title="Press n">Send Message</Button>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  placeholder="Search DMs..."
                  className="w-full rounded-lg border px-4 py-2 text-sm bg-background pl-9"
                />
                <svg className="absolute left-3 top-2.5 size-4 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
              </div>
              {searchQuery && (
                <button onClick={() => { setSearchQuery(""); setSearchResults(null); }} className="text-sm text-muted-foreground hover:text-foreground">Clear</button>
              )}
            </div>
            <MessagesTable
              messages={searchResults ?? messages}
              onSelectMessage={(msg) => openChat({ sessionId: msg.session_id, title: `${msg.from_agent} ↔ ${msg.to_agent}` })}
            />
            {!searchResults && messages.length >= messageLimit && (
              <div className="flex justify-center pt-2">
                <Button variant="outline" size="sm" onClick={() => setMessageLimit((prev) => prev + 50)}>
                  Load more
                </Button>
              </div>
            )}
          </>
        )}

        {page === "channels" && (
          selectedChannel ? (
            <ChannelFeed channelName={selectedChannel} onBack={() => setSelectedChannel(null)} />
          ) : (
            <ChannelsList channels={channels} onSelectChannel={(name) => setSelectedChannel(name)} unreadCounts={channelUnreadCounts} />
          )
        )}

        {page === "projects" && <ProjectsList projects={projects} />}

        {page === "agents" && <AgentsPage />}

        {page === "help" && <HelpPage />}
      </main>

      <SendDialog open={sendOpen} onOpenChange={setSendOpen} onSent={() => { showToast("Message sent", "success"); loadData(); }} />

      <ChatPanel
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        sessionId={chatSession}
        title={chatTitle}
      />

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-lg border px-4 py-3 text-sm shadow-lg ${
          toast.type === "success"
            ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200"
            : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        }`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
