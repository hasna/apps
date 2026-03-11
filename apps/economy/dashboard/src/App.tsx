import * as React from "react";
import { RefreshCwIcon } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { ThemeProvider } from "@/components/theme-provider";
import { OverviewTab } from "@/tabs/OverviewTab";
import { SessionsTab } from "@/tabs/SessionsTab";
import { ModelsTab } from "@/tabs/ModelsTab";
import { ProjectsTab } from "@/tabs/ProjectsTab";
import { BudgetsTab } from "@/tabs/BudgetsTab";
import { PricingTab } from "@/tabs/PricingTab";
import { Button } from "@/components/ui/button";
import {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuLink,
  navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu";

type Tab = "overview" | "sessions" | "models" | "projects" | "budgets" | "pricing";

const navItems: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "sessions", label: "Sessions" },
  { key: "models", label: "Models" },
  { key: "projects", label: "Projects" },
  { key: "budgets", label: "Budgets" },
  { key: "pricing", label: "Pricing" },
];

function AppInner() {
  const [tab, setTab] = React.useState<Tab>("overview");
  const [loading, setLoading] = React.useState(false);
  const [reloadKey, setReloadKey] = React.useState(0);

  function reload() {
    setLoading(true);
    setReloadKey((k) => k + 1);
    setTimeout(() => setLoading(false), 500);
  }

  React.useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "r" && !e.ctrlKey && !e.metaKey) reload();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <button
              className="flex items-center gap-3 hover:opacity-80 transition-opacity"
              onClick={() => setTab("overview")}
            >
              <img src="/logo.jpg" alt="Hasna" className="h-7 w-auto rounded" />
              <h1 className="text-base font-semibold">
                Open <span className="font-normal text-muted-foreground">Economy</span>
              </h1>
            </button>
            <NavigationMenu>
              <NavigationMenuList>
                {navItems.map((item) => (
                  <NavigationMenuItem key={item.key}>
                    <NavigationMenuLink
                      className={navigationMenuTriggerStyle()}
                      data-active={tab === item.key ? "" : undefined}
                      onClick={() => setTab(item.key)}
                      style={{ cursor: "pointer" }}
                    >
                      {item.label}
                    </NavigationMenuLink>
                  </NavigationMenuItem>
                ))}
              </NavigationMenuList>
            </NavigationMenu>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={reload}
              disabled={loading}
              title="Reload (r)"
            >
              <RefreshCwIcon className={`size-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-6 py-6">
        {tab === "overview" && <OverviewTab key={reloadKey} />}
        {tab === "sessions" && <SessionsTab key={reloadKey} />}
        {tab === "models" && <ModelsTab key={reloadKey} />}
        {tab === "projects" && <ProjectsTab key={reloadKey} />}
        {tab === "budgets" && <BudgetsTab key={reloadKey} />}
        {tab === "pricing" && <PricingTab key={reloadKey} />}
      </main>
    </div>
  );
}

export function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="economy-dashboard-theme">
      <AppInner />
    </ThemeProvider>
  );
}

export default App;
