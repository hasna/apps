import type { Page, Route } from "@playwright/test";
import type { Session, SessionDetailResponse, Stats } from "../../src/api";

export interface RecordedRequest {
  method: string;
  path: string;
  authorization?: string;
}

export interface DashboardMockOptions {
  requireAuth?: boolean;
  statsFailure?: boolean;
  detailSequence?: SessionDetailResponse[];
}

export interface DashboardMock {
  requests: RecordedRequest[];
  detailHits: Map<string, number>;
}

const authToken = "test-dashboard-key";
export const sentinelSecret = "SUP3R-SECRET-TYPED-VALUE";

export function fakeApiKey(): string {
  return authToken;
}

export async function installDashboardApiMocks(
  page: Page,
  options: DashboardMockOptions = {},
): Promise<DashboardMock> {
  const mock: DashboardMock = {
    requests: [],
    detailHits: new Map(),
  };

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const authorization = request.headers()["authorization"];

    if (isDashboardAsset(path, request.resourceType())) {
      await route.continue();
      return;
    }

    if (!isDashboardApi(path)) {
      throw new Error(`Unhandled non-asset request in dashboard Playwright mock: ${method} ${path}`);
    }

    mock.requests.push({ method, path: `${path}${url.search}`, authorization });

    if (options.requireAuth && authorization !== `Bearer ${authToken}`) {
      await fulfillJson(route, { error: "Invalid or missing computer API key" }, 401);
      return;
    }

    if (method === "GET" && path === "/sessions") {
      await fulfillJson(route, sessionsFixture);
      return;
    }

    if (method === "GET" && path === "/stats") {
      if (options.statsFailure) {
        await fulfillJson(route, { error: "stats offline" }, 500);
        return;
      }
      await fulfillJson(route, statsFixture);
      return;
    }

    const sessionId = matchSessionDetailPath(path);
    if (method === "GET" && sessionId) {
      const hits = mock.detailHits.get(sessionId) ?? 0;
      mock.detailHits.set(sessionId, hits + 1);
      const sequence = options.detailSequence ?? [detailFixture(sessionId)];
      const detail = sequence[Math.min(hits, sequence.length - 1)] ?? detailFixture(sessionId);
      await fulfillJson(route, detail);
      return;
    }

    throw new Error(`Unhandled dashboard API request: ${method} ${path}`);
  });

  return mock;
}

export const sessionsFixture: Session[] = [
  {
    id: "sess-alpha-browser-fleet",
    task: "Inspect visible browser session",
    provider: "anthropic",
    model: "claude-opus-test",
    status: "running",
    steps: 2,
    total_tokens_in: 120,
    total_tokens_out: 80,
    total_duration_ms: 2400,
    tags: ["browser", "fleet"],
    created_at: "2026-06-19T10:00:00.000Z",
  },
  {
    id: "sess-beta-failed-terminal",
    task: "Open terminal and verify policy",
    provider: "openai",
    model: "gpt-test",
    status: "failed",
    steps: 3,
    total_tokens_in: 220,
    total_tokens_out: 90,
    total_duration_ms: 5800,
    tags: ["terminal"],
    error: "Command blocked by policy",
    created_at: "2026-06-19T09:50:00.000Z",
    completed_at: "2026-06-19T09:50:06.000Z",
  },
  {
    id: "sess-gamma-approval",
    task: "Review pending browser approval",
    provider: "anthropic",
    model: "claude-opus-test",
    status: "waiting_on_approval",
    steps: 1,
    total_tokens_in: 50,
    total_tokens_out: 30,
    total_duration_ms: 1100,
    tags: ["approval"],
    created_at: "2026-06-19T09:40:00.000Z",
  },
];

export const statsFixture: Stats = {
  total_sessions: 3,
  completed: 1,
  failed: 1,
  total_steps: 6,
  total_tokens: 590,
};

export function detailFixture(sessionId: string): SessionDetailResponse {
  if (sessionId === "sess-beta-failed-terminal") {
    const session = sessionsFixture[1]!;
    return {
      session,
      action_logs: [
        {
          id: 20,
          session_id: session.id,
          step: 0,
          action: { type: "open_app", name: "Ghostty" },
          reasoning: "open a terminal window",
          success: true,
          duration_ms: 150,
          created_at: "2026-06-19T09:50:01.000Z",
        },
        {
          id: 21,
          session_id: session.id,
          step: 1,
          action: { type: "type", text: "sudo rm -rf /tmp/nope" },
          reasoning: "try the command",
          success: false,
          error: "Command blocked by policy",
          duration_ms: 10,
          created_at: "2026-06-19T09:50:02.000Z",
        },
      ],
      timeline: timelineFixture(session, "failed"),
    };
  }

  const session = sessionId === "sess-gamma-approval" ? sessionsFixture[2]! : sessionsFixture[0]!;
  return {
    session,
    action_logs: [
      {
        id: 10,
        session_id: session.id,
        step: 0,
        action: { type: "screenshot" },
        reasoning: "observe the current browser",
        success: true,
        duration_ms: 70,
        tokens_in: 40,
        tokens_out: 20,
        screenshot_path: "/tmp/browser-step-0.png",
        created_at: "2026-06-19T10:00:01.000Z",
      },
      {
        id: 11,
        session_id: session.id,
        step: 1,
        action: { type: "type", text: sentinelSecret },
        reasoning: "enter the requested value",
        success: true,
        duration_ms: 40,
        tokens_in: 80,
        tokens_out: 60,
        screenshot_path: "/tmp/browser-step-1.png",
        created_at: "2026-06-19T10:00:02.000Z",
      },
    ],
    timeline: timelineFixture(session, session.status),
  };
}

export function completedDetailFixture(): SessionDetailResponse {
  const base = detailFixture("sess-alpha-browser-fleet");
  const session: Session = {
    ...base.session,
    status: "completed",
    steps: 3,
    completed_at: "2026-06-19T10:00:05.000Z",
  };
  return {
    ...base,
    session,
    timeline: {
      ...base.timeline!,
      run: {
        ...base.timeline!.run!,
        status: "completed",
        updated_at: "2026-06-19T10:00:05.000Z",
        completed_at: "2026-06-19T10:00:05.000Z",
      },
      items: [
        ...base.timeline!.items,
        {
          id: "verifier:complete",
          kind: "verifier",
          source: "observations",
          timestamp: "2026-06-19T10:00:05.000Z",
          title: "Verifier result",
          status: "done",
          summary: "done (92% confidence)",
        },
      ],
      counts: {
        ...base.timeline!.counts,
        verifier: 1,
      },
      last_event_at: "2026-06-19T10:00:05.000Z",
    },
  };
}

function timelineFixture(session: Session, status: string): SessionDetailResponse["timeline"] {
  return {
    run: {
      id: session.id,
      status,
      created_at: session.created_at,
      updated_at: "2026-06-19T10:00:03.000Z",
    },
    counts: {
      run_step: 1,
      model_decision: 1,
      action: 1,
      observation: 1,
      approval: 1,
      artifact: 1,
      policy: 1,
      verifier: 0,
      model_usage: 1,
    },
    items: [
      {
        id: "run-step:1",
        kind: "run_step",
        source: "run_steps",
        timestamp: "2026-06-19T10:00:00.500Z",
        title: "Step 1",
        status: "running",
        step: 0,
        summary: "screenshot: success",
      },
      {
        id: "model-decision:10",
        kind: "model_decision",
        source: "action_logs",
        timestamp: "2026-06-19T10:00:01.000Z",
        title: "Model chose screenshot",
        status: "accepted",
        step: 0,
        summary: "observe the current browser",
        tokens: { input: 40, output: 20, total: 60 },
      },
      {
        id: "action:11",
        kind: "action",
        source: "action_logs",
        timestamp: "2026-06-19T10:00:02.000Z",
        title: "Action: type",
        status: "succeeded",
        step: 1,
        summary: `typed ${sentinelSecret.length} characters`,
        duration_ms: 40,
        action: { type: "type", text: "[redacted]", text_length: sentinelSecret.length },
      },
      {
        id: "approval:1",
        kind: "approval",
        source: "approvals",
        timestamp: "2026-06-19T10:00:02.200Z",
        title: "Approval: browser.type",
        status: "pending",
        capability: "browser.type",
        summary: "Browser typing requires operator review",
      },
      {
        id: "policy:1",
        kind: "policy",
        source: "policy_decisions",
        timestamp: "2026-06-19T10:00:02.300Z",
        title: "Policy: browser.type",
        status: "requires_confirmation",
        capability: "browser.type",
        summary: "visible browser mutation",
      },
      {
        id: "observation:1",
        kind: "observation",
        source: "observations",
        timestamp: "2026-06-19T10:00:02.400Z",
        title: "Observation: browser_snapshot",
        summary: "visible tab snapshot captured",
      },
      {
        id: "artifact:1",
        kind: "artifact",
        source: "artifacts",
        timestamp: "2026-06-19T10:00:02.500Z",
        title: "Artifact: screenshot",
        artifact_path: "/tmp/browser-step-1.png",
        summary: "sha256 abc123",
      },
      {
        id: "model-usage:1",
        kind: "model_usage",
        source: "model_usage",
        timestamp: "2026-06-19T10:00:03.000Z",
        title: "Model usage: executor",
        status: "executor",
        provider: session.provider,
        model: session.model,
        tokens: { input: 120, output: 80, total: 200 },
        summary: "200 tokens",
      },
    ],
    last_event_at: "2026-06-19T10:00:03.000Z",
  };
}

function isDashboardAsset(path: string, resourceType: string): boolean {
  if (path === "/dashboard/" || path === "/dashboard") return true;
  if (path.startsWith("/dashboard/assets/")) return true;
  return ["document", "script", "stylesheet", "font", "image"].includes(resourceType)
    && !isDashboardApi(path);
}

function isDashboardApi(path: string): boolean {
  return path === "/sessions"
    || path.startsWith("/sessions/")
    || path === "/stats"
    || path === "/screenshot"
    || path === "/run"
    || path === "/action"
    || path === "/emergency-stop"
    || path === "/mcp";
}

function matchSessionDetailPath(path: string): string | undefined {
  const match = path.match(/^\/sessions\/([^/]+)$/);
  return match?.[1];
}

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}
