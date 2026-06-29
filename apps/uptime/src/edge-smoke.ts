import { randomUUID } from "node:crypto";

export interface EdgeSmokeOptions {
  url: string;
  workspaceId?: string;
  readToken?: string;
  writeToken?: string;
  probeToken?: string;
  reportToken?: string;
  adminToken?: string;
  mutation?: boolean;
  directOriginUrl?: string;
  directOriginAllowedStatuses?: number[];
  directOriginUnreachableAllowed?: boolean;
  timeoutMs?: number;
  smokeId?: string;
  fetchImpl?: typeof fetch;
}

export interface EdgeSmokeCheck {
  name: string;
  ok: boolean;
  requiredForPromotion: boolean;
  promotionOk?: boolean;
  skipped?: boolean;
  status?: number;
  detail: string;
}

export interface EdgeSmokeReport {
  kind: "open-uptime.edge-smoke";
  status: "passed" | "failed";
  promotionReady: boolean;
  edgeUrl: string;
  directOriginUrl: string | null;
  directOriginUnreachableAllowed: boolean;
  workspaceId: string | null;
  mutationRequested: boolean;
  smokeId: string;
  startedAt: string;
  finishedAt: string;
  checks: EdgeSmokeCheck[];
  nextActions: string[];
}

export interface RedactedEdgeSmokeReport extends Omit<EdgeSmokeReport, "checks" | "edgeUrl" | "directOriginUrl" | "nextActions" | "workspaceId" | "smokeId"> {
  edgeUrl: "[redacted-edge-url]";
  directOriginUrl: "[redacted-direct-origin-url]" | null;
  workspaceId: "[redacted-workspace-id]" | null;
  smokeId: "[redacted-smoke-id]";
  checks: EdgeSmokeCheck[];
  nextActions: string[];
  redacted: true;
  redactionStatus: "redacted";
}

export async function runEdgeSmoke(options: EdgeSmokeOptions): Promise<EdgeSmokeReport> {
  const startedAt = new Date().toISOString();
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const edgeUrl = normalizeBaseUrl(options.url, "url");
  const directOriginUrl = options.directOriginUrl ? normalizeBaseUrl(options.directOriginUrl, "directOriginUrl") : null;
  const directOriginUnreachableAllowed = Boolean(options.directOriginUnreachableAllowed);
  const workspaceId = options.workspaceId?.trim() || null;
  const smokeId = options.smokeId?.trim() || `smoke_${randomUUID()}`;
  const negativeMutationTarget = `edge-smoke-negative-${randomUUID()}`;
  const checks: EdgeSmokeCheck[] = [];

  checks.push(await guardedCheck("health", () => checkHealth(edgeUrl, fetchImpl, timeoutMs)));
  checks.push(await guardedCheck("readiness", () => checkReadiness(edgeUrl, workspaceId, options.readToken, fetchImpl, timeoutMs)));
  checks.push(...await guardedChecks(() => checkUnauthDenied(edgeUrl, workspaceId, fetchImpl, timeoutMs), [
    "unauth-dashboard-denied",
    "unauth-ready-denied",
    "unauth-summary-denied",
    "unauth-monitors-denied",
  ]));
  checks.push(await guardedCheck("authenticated-dashboard-fail-closed", () => checkAuthenticatedDashboard(edgeUrl, workspaceId, options.readToken, fetchImpl, timeoutMs)));
  checks.push(await guardedCheck("workspace-header-forwarded", () => checkWorkspaceHeaderForwarded(edgeUrl, workspaceId, options.readToken, fetchImpl, timeoutMs)));
  checks.push(await guardedCheck("read-token-allowed", () => checkReadAllowed(edgeUrl, workspaceId, options.readToken, fetchImpl, timeoutMs)));
  checks.push(await guardedCheck("wrong-workspace-denied", () => checkWrongWorkspaceDenied(edgeUrl, workspaceId, options.readToken, fetchImpl, timeoutMs)));
  checks.push(await guardedCheck("wrong-workspace-mutation-denied", () => checkWrongWorkspaceMutationDenied(edgeUrl, workspaceId, options.writeToken, negativeMutationTarget, fetchImpl, timeoutMs)));
  checks.push(await guardedCheck("wrong-scope-mutation-denied", () => checkWrongScopeMutationDenied(edgeUrl, workspaceId, options.readToken, negativeMutationTarget, fetchImpl, timeoutMs)));
  checks.push(await guardedCheck("denied-origin-mutation", () => checkDeniedOriginMutation(edgeUrl, workspaceId, options.writeToken, negativeMutationTarget, fetchImpl, timeoutMs)));
  checks.push(...await guardedChecks(() => checkHostedFailClosedRoutes(edgeUrl, workspaceId, {
    readToken: options.readToken,
    writeToken: options.writeToken,
    probeToken: options.probeToken ?? options.adminToken,
    reportToken: options.reportToken ?? options.adminToken,
  }, fetchImpl, timeoutMs), [
    "report-delivery-fail-closed",
    "probe-api-fail-closed",
    "import-apply-fail-closed",
    "inline-check-fail-closed",
  ]));

  if (options.mutation) {
    checks.push(...await checkMutationRoundTrip(edgeUrl, workspaceId, options.writeToken, smokeId, fetchImpl, timeoutMs));
  } else {
    checks.push(skippedCheck("write-mutation-roundtrip", true, "not requested; run with mutation enabled before live promotion"));
  }

  if (directOriginUrl) {
    checks.push(await checkDirectOriginDenied(
      directOriginUrl,
      normalizeDirectOriginDeniedStatuses(options.directOriginAllowedStatuses),
      directOriginUnreachableAllowed,
      fetchImpl,
      timeoutMs,
    ));
  } else {
    checks.push(skippedCheck("direct-origin-denied", true, "not requested; pass a direct ALB/origin URL before live promotion"));
  }

  const failed = checks.filter((check) => !check.ok && !check.skipped);
  const requiredPromotionChecks = checks.filter((check) => check.requiredForPromotion);
  const promotionReady = failed.length === 0 && requiredPromotionChecks.every((check) => (check.promotionOk ?? check.ok) && !check.skipped);
  const finishedAt = new Date().toISOString();
  return {
    kind: "open-uptime.edge-smoke",
    status: failed.length === 0 ? "passed" : "failed",
    promotionReady,
    edgeUrl,
    directOriginUrl,
    directOriginUnreachableAllowed,
    workspaceId,
    mutationRequested: Boolean(options.mutation),
    smokeId,
    startedAt,
    finishedAt,
    checks,
    nextActions: edgeSmokeNextActions(checks, promotionReady),
  };
}

export function redactEdgeSmokeReportForEvidence(report: EdgeSmokeReport): RedactedEdgeSmokeReport {
  return {
    ...report,
    edgeUrl: "[redacted-edge-url]",
    directOriginUrl: report.directOriginUrl ? "[redacted-direct-origin-url]" : null,
    workspaceId: report.workspaceId ? "[redacted-workspace-id]" : null,
    smokeId: "[redacted-smoke-id]",
    checks: report.checks.map((check) => ({
      ...check,
      detail: redactEdgeSmokeEvidenceText(check.detail, report),
    })),
    nextActions: report.nextActions.map((action) => redactEdgeSmokeEvidenceText(action, report)),
    redacted: true,
    redactionStatus: "redacted",
  };
}

async function guardedCheck(name: string, fn: () => Promise<EdgeSmokeCheck>): Promise<EdgeSmokeCheck> {
  try {
    return await fn();
  } catch (error) {
    return {
      name,
      ok: false,
      requiredForPromotion: true,
      detail: errorMessage(error),
    };
  }
}

async function guardedChecks(fn: () => Promise<EdgeSmokeCheck[]>, names: string[]): Promise<EdgeSmokeCheck[]> {
  try {
    return await fn();
  } catch (error) {
    return names.map((name) => ({
      name,
      ok: false,
      requiredForPromotion: true,
      detail: errorMessage(error),
    }));
  }
}

function normalizeBaseUrl(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required`);
  const parsed = new URL(trimmed);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${field} must be an http or https URL`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${field} must not include username or password`);
  }
  if (parsed.pathname && parsed.pathname !== "/") {
    throw new Error(`${field} must be an origin URL without a path`);
  }
  parsed.pathname = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

async function checkHealth(baseUrl: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<EdgeSmokeCheck> {
  const response = await request(fetchImpl, apiUrl(baseUrl, "/health"), { method: "GET", timeoutMs });
  const json = await responseJson(response);
  const noMonitorData = !json || (typeof json === "object" && !("monitors" in json) && !("tokens" in json) && !("hostedTokens" in json));
  const serviceOk = Boolean(json && typeof json === "object" && (json as { ok?: unknown }).ok === true);
  return {
    name: "health",
    ok: response.status === 200 && serviceOk && noMonitorData,
    requiredForPromotion: true,
    status: response.status,
    detail: response.status === 200 && serviceOk && noMonitorData ? "healthy and no monitor/token data returned" : "health endpoint did not return the expected minimal response",
  };
}

async function checkReadiness(baseUrl: string, workspaceId: string | null, token: string | undefined, fetchImpl: typeof fetch, timeoutMs: number): Promise<EdgeSmokeCheck> {
  if (!token?.trim()) {
    return {
      name: "readiness",
      ok: false,
      requiredForPromotion: true,
      detail: "read token missing",
    };
  }
  const response = await request(fetchImpl, apiUrl(baseUrl, "/ready", workspaceId), {
    method: "GET",
    timeoutMs,
    headers: authHeaders(token, workspaceId),
  });
  const json = await responseJson(response);
  const ok = response.status === 200 && isRecord(json) && json.ok === true;
  const productionReady = ok && isRecord(json) && json.productionReady === true;
  return {
    name: "readiness",
    ok,
    promotionOk: productionReady,
    requiredForPromotion: true,
    status: response.status,
    detail: ok
      ? productionReady ? "ready and production data mode verified" : "ready but production data mode is not verified"
      : `expected ready 200, got ${response.status}`,
  };
}

async function checkUnauthDenied(baseUrl: string, workspaceId: string | null, fetchImpl: typeof fetch, timeoutMs: number): Promise<EdgeSmokeCheck[]> {
  return Promise.all([
    expectStatus("unauth-dashboard-denied", baseUrl, "/", workspaceId, undefined, "GET", 401, "unauthenticated dashboard denied", fetchImpl, timeoutMs),
    expectStatus("unauth-ready-denied", baseUrl, "/ready", workspaceId, undefined, "GET", 401, "unauthenticated readiness denied", fetchImpl, timeoutMs),
    expectStatus("unauth-summary-denied", baseUrl, "/api/v1/summary", workspaceId, undefined, "GET", 401, "unauthenticated summary read denied", fetchImpl, timeoutMs),
    expectStatus("unauth-monitors-denied", baseUrl, "/api/v1/monitors", workspaceId, undefined, "GET", 401, "unauthenticated monitor read denied", fetchImpl, timeoutMs),
  ]);
}

async function checkAuthenticatedDashboard(baseUrl: string, workspaceId: string | null, token: string | undefined, fetchImpl: typeof fetch, timeoutMs: number): Promise<EdgeSmokeCheck> {
  return expectStatus("authenticated-dashboard-fail-closed", baseUrl, "/", workspaceId, token, "GET", 501, "hosted dashboard shell remains fail closed", fetchImpl, timeoutMs);
}

async function checkReadAllowed(baseUrl: string, workspaceId: string | null, token: string | undefined, fetchImpl: typeof fetch, timeoutMs: number): Promise<EdgeSmokeCheck> {
  if (!token?.trim()) {
    return {
      name: "read-token-allowed",
      ok: false,
      requiredForPromotion: true,
      detail: "read token missing",
    };
  }
  const response = await request(fetchImpl, apiUrl(baseUrl, "/api/v1/monitors", workspaceId), {
    method: "GET",
    timeoutMs,
    headers: authHeaders(token, workspaceId),
  });
  const json = await responseJson(response);
  return {
    name: "read-token-allowed",
    ok: response.status === 200 && Array.isArray(json),
    requiredForPromotion: true,
    status: response.status,
    detail: response.status === 200 && Array.isArray(json) ? "scoped read token can list monitors" : `expected 200 JSON array, got ${response.status}`,
  };
}

async function checkWorkspaceHeaderForwarded(baseUrl: string, workspaceId: string | null, token: string | undefined, fetchImpl: typeof fetch, timeoutMs: number): Promise<EdgeSmokeCheck> {
  if (!workspaceId) {
    return {
      name: "workspace-header-forwarded",
      ok: false,
      requiredForPromotion: true,
      detail: "workspace id missing",
    };
  }
  if (!token?.trim()) {
    return {
      name: "workspace-header-forwarded",
      ok: false,
      requiredForPromotion: true,
      detail: "read token missing",
    };
  }
  const response = await request(fetchImpl, apiUrl(baseUrl, "/ready", null), {
    method: "GET",
    timeoutMs,
    headers: authHeaders(token, workspaceId),
  });
  const json = await responseJson(response);
  const ok = response.status === 200 && isRecord(json) && json.ok === true;
  return {
    name: "workspace-header-forwarded",
    ok,
    promotionOk: ok && isRecord(json) && json.productionReady === true,
    requiredForPromotion: true,
    status: response.status,
    detail: ok ? "workspace header reached hosted readiness without query fallback" : `expected header-only readiness 200, got ${response.status}`,
  };
}

async function checkWrongWorkspaceDenied(baseUrl: string, workspaceId: string | null, token: string | undefined, fetchImpl: typeof fetch, timeoutMs: number): Promise<EdgeSmokeCheck> {
  if (!workspaceId) {
    return {
      name: "wrong-workspace-denied",
      ok: false,
      requiredForPromotion: true,
      detail: "workspace id missing",
    };
  }
  if (!token?.trim()) {
    return {
      name: "wrong-workspace-denied",
      ok: false,
      requiredForPromotion: true,
      detail: "read token missing",
    };
  }
  const deniedWorkspace = `${workspaceId}-denied`;
  const response = await request(fetchImpl, apiUrl(baseUrl, "/api/v1/monitors", deniedWorkspace), {
    method: "GET",
    timeoutMs,
    headers: authHeaders(token, deniedWorkspace),
  });
  return {
    name: "wrong-workspace-denied",
    ok: response.status === 403,
    requiredForPromotion: true,
    status: response.status,
    detail: response.status === 403 ? "wrong workspace denied" : `expected 403, got ${response.status}`,
  };
}

async function checkWrongWorkspaceMutationDenied(baseUrl: string, workspaceId: string | null, token: string | undefined, negativeTarget: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<EdgeSmokeCheck> {
  if (!workspaceId) {
    return {
      name: "wrong-workspace-mutation-denied",
      ok: false,
      requiredForPromotion: true,
      detail: "workspace id missing",
    };
  }
  if (!token?.trim()) {
    return {
      name: "wrong-workspace-mutation-denied",
      ok: false,
      requiredForPromotion: true,
      detail: "write token missing",
    };
  }
  const deniedWorkspace = `${workspaceId}-denied`;
  const response = await request(fetchImpl, apiUrl(baseUrl, `/api/v1/monitors/${encodeURIComponent(negativeTarget)}`, deniedWorkspace), {
    method: "DELETE",
    timeoutMs,
    headers: {
      ...authHeaders(token, deniedWorkspace),
      origin: new URL(baseUrl).origin,
    },
  });
  return {
    name: "wrong-workspace-mutation-denied",
    ok: response.status === 403,
    requiredForPromotion: true,
    status: response.status,
    detail: response.status === 403 ? "write token cannot mutate a different workspace" : `expected 403, got ${response.status}`,
  };
}

async function checkWrongScopeMutationDenied(baseUrl: string, workspaceId: string | null, token: string | undefined, negativeTarget: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<EdgeSmokeCheck> {
  if (!token?.trim()) {
    return {
      name: "wrong-scope-mutation-denied",
      ok: false,
      requiredForPromotion: true,
      detail: "read token missing",
    };
  }
  const response = await request(fetchImpl, apiUrl(baseUrl, `/api/v1/monitors/${encodeURIComponent(negativeTarget)}`, workspaceId), {
    method: "DELETE",
    timeoutMs,
    headers: {
      ...authHeaders(token, workspaceId),
      origin: new URL(baseUrl).origin,
    },
  });
  return {
    name: "wrong-scope-mutation-denied",
    ok: response.status === 403,
    requiredForPromotion: true,
    status: response.status,
    detail: response.status === 403 ? "read token cannot mutate monitors" : `expected 403, got ${response.status}`,
  };
}

async function checkDeniedOriginMutation(baseUrl: string, workspaceId: string | null, token: string | undefined, negativeTarget: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<EdgeSmokeCheck> {
  if (!token?.trim()) {
    return {
      name: "denied-origin-mutation",
      ok: false,
      requiredForPromotion: true,
      detail: "write token missing",
    };
  }
  const response = await request(fetchImpl, apiUrl(baseUrl, `/api/v1/monitors/${encodeURIComponent(negativeTarget)}`, workspaceId), {
    method: "DELETE",
    timeoutMs,
    headers: {
      ...authHeaders(token, workspaceId),
      origin: "https://denied-origin.invalid",
    },
  });
  return {
    name: "denied-origin-mutation",
    ok: response.status === 403,
    requiredForPromotion: true,
    status: response.status,
    detail: response.status === 403 ? "unapproved browser origin cannot mutate monitors" : `expected 403, got ${response.status}`,
  };
}

async function checkMutationRoundTrip(
  baseUrl: string,
  workspaceId: string | null,
  token: string | undefined,
  smokeId: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<EdgeSmokeCheck[]> {
  if (!token?.trim()) {
    return [{
      name: "write-mutation-roundtrip",
      ok: false,
      requiredForPromotion: true,
      detail: "write token missing",
    }];
  }
  const origin = new URL(baseUrl).origin;
  const headers = {
    ...authHeaders(token, workspaceId),
    "content-type": "application/json",
    origin,
  };
  const smokeName = `edge-smoke-${smokeId}`;
  let createResponse: Response;
  let created: { id?: unknown } | null;
  try {
    createResponse = await request(fetchImpl, apiUrl(baseUrl, "/api/v1/monitors", workspaceId), {
      method: "POST",
      timeoutMs,
      headers,
      body: JSON.stringify({
        name: smokeName,
        kind: "http",
        url: `https://example.com/open-uptime-edge-smoke/${encodeURIComponent(smokeId)}`,
        enabled: false,
        intervalSeconds: 300,
        timeoutMs: 5000,
      }),
    });
    created = await responseJson(createResponse) as { id?: unknown } | null;
  } catch (error) {
    await bestEffortDelete(baseUrl, workspaceId, token, smokeName, fetchImpl, timeoutMs);
    return [{
      name: "write-mutation-roundtrip",
      ok: false,
      requiredForPromotion: true,
      detail: `create failed before response could be verified: ${errorMessage(error)}`,
    }];
  }
  const monitorId = typeof created?.id === "string" ? created.id : null;
  if (createResponse.status !== 201 || !monitorId) {
    await bestEffortDelete(baseUrl, workspaceId, token, smokeName, fetchImpl, timeoutMs);
    return [{
      name: "write-mutation-roundtrip",
      ok: false,
      requiredForPromotion: true,
      status: createResponse.status,
      detail: `create expected 201 with id, got ${createResponse.status}`,
    }];
  }
  try {
    const deleteHeaders = {
      ...headers,
      "idempotency-key": `edge-smoke:${smokeId}:delete:${monitorId}`,
    };
    const deleteResponse = await request(fetchImpl, apiUrl(baseUrl, `/api/v1/monitors/${encodeURIComponent(monitorId)}`, workspaceId), {
      method: "DELETE",
      timeoutMs,
      headers: deleteHeaders,
    });
    const deleted = await responseJson(deleteResponse) as { deleted?: unknown } | null;
    if (deleteResponse.status !== 200 || deleted?.deleted !== true) {
      await bestEffortDelete(baseUrl, workspaceId, token, monitorId, fetchImpl, timeoutMs);
    }
    return [{
      name: "write-mutation-roundtrip",
      ok: deleteResponse.status === 200 && deleted?.deleted === true,
      requiredForPromotion: true,
      status: deleteResponse.status,
      detail: deleteResponse.status === 200 && deleted?.deleted === true ? "write token created and deleted a disabled smoke monitor" : `delete expected 200 deleted=true, got ${deleteResponse.status}`,
    }];
  } catch (error) {
    await bestEffortDelete(baseUrl, workspaceId, token, monitorId, fetchImpl, timeoutMs);
    return [{
      name: "write-mutation-roundtrip",
      ok: false,
      requiredForPromotion: true,
      detail: `delete failed after create: ${errorMessage(error)}`,
    }];
  }
}

async function checkHostedFailClosedRoutes(
  baseUrl: string,
  workspaceId: string | null,
  tokens: { readToken?: string; writeToken?: string; probeToken?: string; reportToken?: string },
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<EdgeSmokeCheck[]> {
  return [
    await expectFailClosedRoute({
      name: "report-delivery-fail-closed",
      baseUrl,
      path: "/api/v1/report",
      token: tokens.reportToken,
      workspaceId,
      method: "POST",
      body: { logs: { apiUrl: "https://logs.invalid", projectId: "open-uptime" } },
      expectedStatus: 501,
      expectedDetail: "hosted report delivery remains fail closed",
      fetchImpl,
      timeoutMs,
    }),
    await expectFailClosedRoute({
      name: "probe-api-fail-closed",
      baseUrl,
      path: "/api/v1/probes",
      token: tokens.readToken,
      workspaceId,
      method: "GET",
      expectedStatus: 501,
      expectedDetail: "hosted probe API remains fail closed",
      fetchImpl,
      timeoutMs,
    }),
    await expectFailClosedRoute({
      name: "import-apply-fail-closed",
      baseUrl,
      path: "/api/v1/imports/apply",
      token: tokens.writeToken,
      workspaceId,
      method: "POST",
      body: { source: "manual", records: [] },
      expectedStatus: 501,
      expectedDetail: "hosted import apply remains fail closed",
      fetchImpl,
      timeoutMs,
    }),
    await expectFailClosedRoute({
      name: "inline-check-fail-closed",
      baseUrl,
      path: "/api/v1/check-all",
      token: tokens.probeToken,
      workspaceId,
      method: "POST",
      expectedStatus: 501,
      expectedDetail: "hosted inline checks remain fail closed",
      fetchImpl,
      timeoutMs,
    }),
  ];
}

async function expectFailClosedRoute(options: {
  name: string;
  baseUrl: string;
  path: string;
  token?: string;
  workspaceId: string | null;
  method: string;
  body?: unknown;
  expectedStatus: number;
  expectedDetail: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}): Promise<EdgeSmokeCheck> {
  if (!options.token?.trim()) {
    return {
      name: options.name,
      ok: false,
      requiredForPromotion: true,
      detail: "scoped token missing",
    };
  }
  const response = await request(options.fetchImpl, apiUrl(options.baseUrl, options.path, options.workspaceId), {
    method: options.method,
    timeoutMs: options.timeoutMs,
    headers: {
      ...authHeaders(options.token, options.workspaceId),
      ...(options.body === undefined ? {} : { "content-type": "application/json", origin: new URL(options.baseUrl).origin }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return {
    name: options.name,
    ok: response.status === options.expectedStatus,
    requiredForPromotion: true,
    status: response.status,
    detail: response.status === options.expectedStatus ? options.expectedDetail : `expected ${options.expectedStatus}, got ${response.status}`,
  };
}

async function checkDirectOriginDenied(directOriginUrl: string, allowedStatuses: number[], unreachableAllowed: boolean, fetchImpl: typeof fetch, timeoutMs: number): Promise<EdgeSmokeCheck> {
  try {
    const response = await request(fetchImpl, apiUrl(directOriginUrl, "/health"), {
      method: "GET",
      timeoutMs,
      redirect: "manual",
    });
    return {
      name: "direct-origin-denied",
      ok: allowedStatuses.includes(response.status),
      requiredForPromotion: true,
      status: response.status,
      detail: allowedStatuses.includes(response.status) ? "direct origin denied without CloudFront origin verification header" : `expected one of ${allowedStatuses.join(",")}, got ${response.status}`,
    };
  } catch (error) {
    return {
      name: "direct-origin-denied",
      ok: unreachableAllowed,
      requiredForPromotion: true,
      detail: unreachableAllowed
        ? `direct origin was unreachable without CloudFront header and unreachable evidence was explicitly allowed: ${errorMessage(error)}`
        : `direct origin was not reachable without CloudFront header: ${errorMessage(error)}`,
    };
  }
}

async function expectStatus(
  name: string,
  baseUrl: string,
  path: string,
  workspaceId: string | null,
  token: string | undefined,
  method: string,
  expectedStatus: number,
  successDetail: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<EdgeSmokeCheck> {
  const response = await request(fetchImpl, apiUrl(baseUrl, path, workspaceId), {
    method,
    timeoutMs,
    headers: token ? authHeaders(token, workspaceId) : undefined,
  });
  return {
    name,
    ok: response.status === expectedStatus,
    requiredForPromotion: true,
    status: response.status,
    detail: response.status === expectedStatus ? successDetail : `expected ${expectedStatus}, got ${response.status}`,
  };
}

async function bestEffortDelete(baseUrl: string, workspaceId: string | null, token: string | undefined, monitorId: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<void> {
  if (!token?.trim()) return;
  try {
    await request(fetchImpl, apiUrl(baseUrl, `/api/v1/monitors/${encodeURIComponent(monitorId)}`, workspaceId), {
      method: "DELETE",
      timeoutMs,
      headers: {
        ...authHeaders(token, workspaceId),
        origin: new URL(baseUrl).origin,
      },
    });
  } catch {
    // The primary smoke result records the failure; cleanup is best effort only.
  }
}

function apiUrl(baseUrl: string, path: string, workspaceId?: string | null): string {
  const url = new URL(path, `${baseUrl}/`);
  if (workspaceId) url.searchParams.set("workspaceId", workspaceId);
  return url.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeDirectOriginDeniedStatuses(statuses?: number[]): number[] {
  const values = statuses?.length ? statuses : [403];
  for (const status of values) {
    if (status !== 403) {
      throw new Error("direct-origin denial evidence requires the fixed HTTP 403 status; use --allow-direct-origin-unreachable only for explicit private-network unreachable evidence paired with origin-binding readback");
    }
  }
  return [...new Set(values)];
}

function redactEdgeSmokeEvidenceText(value: string, report: EdgeSmokeReport): string {
  let redacted = value;
  redacted = redacted.split(report.edgeUrl).join("[redacted-edge-url]");
  if (report.directOriginUrl) redacted = redacted.split(report.directOriginUrl).join("[redacted-direct-origin-url]");
  if (report.workspaceId) redacted = redacted.split(report.workspaceId).join("[redacted-workspace-id]");
  redacted = redacted.split(report.smokeId).join("[redacted-smoke-id]");
  return redacted.replace(/https?:\/\/[^\s"'<>]+/gi, "[redacted-url]");
}

function authHeaders(token: string, workspaceId: string | null): Record<string, string> {
  return {
    accept: "application/json",
    authorization: `Bearer ${token}`,
    ...(workspaceId ? { "x-uptime-workspace": workspaceId } : {}),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function request(fetchImpl: typeof fetch, url: string, init: RequestInit & { timeoutMs: number }): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init.timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function responseJson(response: Response): Promise<unknown | null> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function skippedCheck(name: string, requiredForPromotion: boolean, detail: string): EdgeSmokeCheck {
  return {
    name,
    ok: true,
    requiredForPromotion,
    skipped: true,
    detail,
  };
}

function edgeSmokeNextActions(checks: EdgeSmokeCheck[], promotionReady: boolean): string[] {
  if (promotionReady) return ["Record this smoke report with the Terraform plan/apply evidence before accepting live traffic."];
  const actions: string[] = [];
  for (const check of checks) {
    if (check.skipped && check.name === "write-mutation-roundtrip") actions.push("Run the edge smoke with mutation enabled and a scoped write token.");
    if (check.skipped && check.name === "direct-origin-denied") actions.push("Run the edge smoke with the direct ALB/origin URL and verify it is denied without the CloudFront origin header.");
    if (!check.ok && check.name === "read-token-allowed") actions.push("Provide a scoped read token through the configured environment variable and verify hosted auth.");
    if (!check.ok && check.name === "wrong-workspace-denied") actions.push("Use the production workspace id and verify cross-workspace denial.");
    if (!check.ok && check.name.startsWith("unauth-")) actions.push("Fix hosted auth before exposing protected routes.");
    if (!check.ok && check.name === "health") actions.push("Fix web health/readiness before routing traffic.");
    if (!check.ok && check.name === "write-mutation-roundtrip") actions.push("Fix scoped write-token mutation and cleanup before live promotion.");
    if (!check.ok && check.name === "direct-origin-denied") actions.push("Fix ALB/CloudFront origin restriction before live promotion.");
  }
  return [...new Set(actions)];
}
