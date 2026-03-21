import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { lazy } from "react";

const RootLayout = lazy(() => import("./components/RootLayout.tsx"));
const OverviewPage = lazy(() => import("./components/OverviewPage.tsx"));
const TicketsPage = lazy(() => import("./components/TicketsPage.tsx"));
const TicketDetailPage = lazy(() => import("./components/TicketDetailPage.tsx"));
const ProjectsPage = lazy(() => import("./components/ProjectsPage.tsx"));
const SearchPage = lazy(() => import("./components/SearchPage.tsx"));
const SettingsPage = lazy(() => import("./components/SettingsPage.tsx"));

const rootRoute = createRootRoute({ component: RootLayout });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: OverviewPage });
const ticketsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/tickets", component: TicketsPage });
const ticketDetailRoute = createRoute({ getParentRoute: () => rootRoute, path: "/tickets/$shortId", component: TicketDetailPage });
const projectsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/projects", component: ProjectsPage });
const searchRoute = createRoute({ getParentRoute: () => rootRoute, path: "/search", component: SearchPage });
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/settings", component: SettingsPage });

export const routeTree = rootRoute.addChildren([
  indexRoute,
  ticketsRoute,
  ticketDetailRoute,
  projectsRoute,
  searchRoute,
  settingsRoute,
]);
