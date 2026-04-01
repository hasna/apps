import { useState } from "react";
import { DashboardPage } from "./components/dashboard-page";
import { FindingsPage } from "./components/findings-page";
import { ScansPage } from "./components/scans-page";
import { RulesPage } from "./components/rules-page";
import { ProjectsPage } from "./components/projects-page";
import { FeedPage } from "./components/feed-page";
import { PackageLookupPage } from "./components/package-lookup-page";
import { TimelinePage } from "./components/timeline-page";

type Tab = "dashboard" | "findings" | "scans" | "rules" | "projects" | "feed" | "lookup" | "timeline";

const tabs: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "feed", label: "🛡️ Feed" },
  { id: "lookup", label: "🔍 Lookup" },
  { id: "timeline", label: "📅 Timeline" },
  { id: "findings", label: "Findings" },
  { id: "scans", label: "Scans" },
  { id: "rules", label: "Rules" },
  { id: "projects", label: "Projects" },
];

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [scanFilter, setScanFilter] = useState<string | undefined>();

  function navigateToFindings(scanId: string) {
    setScanFilter(scanId);
    setActiveTab("findings");
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-7 h-7 text-emerald-500"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            <h1 className="text-xl font-bold tracking-tight">security</h1>
          </div>

          <nav className="flex gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  if (tab.id !== "findings") setScanFilter(undefined);
                }}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? "bg-zinc-800 text-zinc-100"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {activeTab === "dashboard" && (
          <DashboardPage onNavigateToFindings={navigateToFindings} />
        )}
        {activeTab === "findings" && (
          <FindingsPage scanIdFilter={scanFilter} />
        )}
        {activeTab === "scans" && (
          <ScansPage onViewFindings={navigateToFindings} />
        )}
        {activeTab === "rules" && <RulesPage />}
        {activeTab === "projects" && <ProjectsPage />}
        {activeTab === "feed" && <FeedPage />}
        {activeTab === "lookup" && <PackageLookupPage />}
        {activeTab === "timeline" && <TimelinePage />}
      </main>
    </div>
  );
}
