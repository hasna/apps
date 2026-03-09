import * as React from "react";
import { RefreshCwIcon, SendIcon, HashIcon, MessageSquareIcon, FolderIcon, DownloadIcon } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { StatsCards } from "@/components/stats-cards";
import { MessagesTable } from "@/components/messages-table";
import { SpacesList } from "@/components/spaces-list";
import { ProjectsList } from "@/components/projects-list";
import { ChatPanel } from "@/components/chat-panel";
import { SendDialog } from "@/components/send-dialog";
import { UpdateDialog } from "@/components/update-dialog";
import { Button } from "@/components/ui/button";
import type { Message, Space, Project, DashboardStatus } from "@/types";

type Tab = "messages" | "spaces" | "projects";

export function App() {
  const [status, setStatus] = React.useState<DashboardStatus | null>(null);
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [spaces, setSpaces] = React.useState<Space[]>([]);
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [tab, setTab] = React.useState<Tab>("messages");
  const [sendOpen, setSendOpen] = React.useState(false);
  const [updateOpen, setUpdateOpen] = React.useState(false);
  const [chatOpen, setChatOpen] = React.useState(false);
  const [chatSpace, setChatSpace] = React.useState<string | undefined>();
  const [chatSession, setChatSession] = React.useState<string | undefined>();
  const [chatTitle, setChatTitle] = React.useState("");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [searchResults, setSearchResults] = React.useState<Message[] | null>(null);
  const [versionInfo, setVersionInfo] = React.useState<{
    current: string;
    latest: string;
    updateAvailable: boolean;
  } | null>(null);
  const [toast, setToast] = React.useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  const toastTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadInFlight = React.useRef(false);

  const showToast = React.useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type });
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const fetchJson = React.useCallback(async <T,>(input: RequestInfo, init?: RequestInit): Promise<T> => {
    const res = await fetch(input, init);
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      // ignore parse errors for now
    }
    if (!res.ok) {
      const errorMessage = typeof (data as { error?: string })?.error === "string"
        ? (data as { error?: string }).error
        : `Request failed (${res.status})`;
      throw new Error(errorMessage);
    }
    if (data === null) {
      throw new Error("Invalid server response");
    }
    return data as T;
  }, []);

  const isVersionInfo = (value: unknown): value is { current: string; latest: string; updateAvailable: boolean } => {
    if (!value || typeof value !== "object") return false;
    const v = value as Record<string, unknown>;
    return typeof v.current === "string" && typeof v.latest === "string" && typeof v.updateAvailable === "boolean";
  };

  const loadData = React.useCallback(async () => {
    if (loadInFlight.current) return;
    loadInFlight.current = true;
    try {
      const [statusRes, messagesRes, spacesRes, projectsRes] = await Promise.all([
        fetchJson<DashboardStatus>("/api/status"),
        fetchJson<Message[]>("/api/messages?limit=50"),
        fetchJson<Space[]>("/api/spaces"),
        fetchJson<Project[]>("/api/projects"),
      ]);
      setStatus(statusRes);
      setMessages(messagesRes);
      setSpaces(spacesRes);
      setProjects(projectsRes);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load data";
      showToast(message, "error");
    } finally {
      loadInFlight.current = false;
      setLoading(false);
    }
  }, [fetchJson, showToast]);

  const handleSearch = React.useCallback(async (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults(null);
      return;
    }
    try {
      const res = await fetch(`/api/messages/search?q=${encodeURIComponent(query)}&limit=50`);
      if (res.ok) {
        const data = await res.json() as Message[];
        setSearchResults(data);
      }
    } catch {
      setSearchResults(null);
    }
  }, []);

  const openChat = React.useCallback((opts: { spaceName?: string; sessionId?: string; title: string }) => {
    setChatSpace(opts.spaceName);
    setChatSession(opts.sessionId);
    setChatTitle(opts.title);
    setChatOpen(true);
  }, []);

  React.useEffect(() => {
    loadData();
    const timer = setInterval(loadData, 3000);
    return () => clearInterval(timer);
  }, [loadData]);

  React.useEffect(() => {
    fetchJson("/api/version")
      .then((data) => {
        if (isVersionInfo(data)) {
          setVersionInfo(data);
        } else {
          setVersionInfo(null);
        }
      })
      .catch(() => setVersionInfo(null));
  }, [fetchJson]);

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
            {versionInfo && (
              versionInfo.updateAvailable ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setUpdateOpen(true)}
                  className="text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
                >
                  <DownloadIcon className="size-3.5" />
                  Update v{versionInfo.latest}
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground px-2">
                  v{versionInfo.current}
                </span>
              )
            )}
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
            onClick={() => setTab("spaces")}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === "spaces"
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <HashIcon className="size-4" />
            Spaces
            {spaces.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {spaces.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab("projects")}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === "projects"
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <FolderIcon className="size-4" />
            Projects
            {projects.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {projects.length}
              </span>
            )}
          </button>
        </div>

        {tab === "messages" && (
          <>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  placeholder="Search messages..."
                  className="w-full rounded-lg border px-4 py-2 text-sm bg-background pl-9"
                />
                <svg className="absolute left-3 top-2.5 size-4 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
              </div>
              {searchQuery && (
                <button
                  onClick={() => { setSearchQuery(""); setSearchResults(null); }}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  Clear
                </button>
              )}
            </div>
            <MessagesTable messages={searchResults ?? messages} />
          </>
        )}
        {tab === "spaces" && <SpacesList spaces={spaces} onSelectSpace={(name) => openChat({ spaceName: name, title: `#${name}` })} />}
        {tab === "projects" && <ProjectsList projects={projects} />}
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

      {/* Update Dialog */}
      {versionInfo?.updateAvailable && (
        <UpdateDialog
          open={updateOpen}
          onOpenChange={setUpdateOpen}
          current={versionInfo.current}
          latest={versionInfo.latest}
          onUpdated={(message, type) => {
            showToast(message, type);
            if (type === "success") {
              fetchJson("/api/version")
                .then((data) => {
                  if (isVersionInfo(data)) {
                    setVersionInfo(data);
                  } else {
                    setVersionInfo(null);
                  }
                })
                .catch(() => setVersionInfo(null));
            }
          }}
        />
      )}

      {/* Chat Panel */}
      <ChatPanel
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        spaceName={chatSpace}
        sessionId={chatSession}
        title={chatTitle}
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
