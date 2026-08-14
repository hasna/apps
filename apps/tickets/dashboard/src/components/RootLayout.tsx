import { Suspense } from "react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { cn } from "../lib.ts";
import { useSSE } from "../hooks/useSSE.ts";

const NAV = [
  { to: "/", label: "Overview", key: "0" },
  { to: "/tickets", label: "Tickets", key: "1" },
  { to: "/projects", label: "Projects", key: "2" },
  { to: "/search", label: "Search", key: "/" },
  { to: "/settings", label: "Settings", key: "4" },
];

export default function RootLayout() {
  useSSE(); // Subscribe to real-time server events
  const routerState = useRouterState();
  const pathname = routerState.location.pathname;

  return (
    <div className="flex h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      {/* Sidebar */}
      <nav className="w-56 shrink-0 border-r border-gray-200 dark:border-gray-800 flex flex-col py-4 px-3 gap-1">
        <div className="px-3 py-2 mb-2">
          <span className="font-semibold text-lg tracking-tight">🎫 open-tickets</span>
        </div>
        {NAV.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors",
              pathname === item.to
                ? "bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300"
                : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
            )}
          >
            {item.label}
            <span className="ml-auto text-xs text-gray-400">{item.key}</span>
          </Link>
        ))}
      </nav>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        <Suspense fallback={<div className="flex items-center justify-center h-full text-gray-400">Loading…</div>}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
