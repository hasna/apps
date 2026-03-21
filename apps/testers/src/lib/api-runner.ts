import type { ApiCheck, ApiCheckResult, ApiCheckFilter } from "../types/index.js";
import { createApiCheckResult, listApiChecks } from "../db/api-checks.js";
import { dispatchApiCheckWebhooks } from "./webhooks.js";

export interface RunApiCheckOptions {
  runId?: string;
  baseUrl?: string;
}

export async function runApiCheck(
  check: ApiCheck,
  options?: RunApiCheckOptions,
): Promise<ApiCheckResult> {
  const startTime = Date.now();
  const assertionsPassed: string[] = [];
  const assertionsFailed: string[] = [];

  // Build full URL
  let url = check.url;
  if (!url.startsWith("http") && options?.baseUrl) {
    const base = options.baseUrl.replace(/\/$/, "");
    url = `${base}${url.startsWith("/") ? "" : "/"}${url}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), check.timeoutMs);

  try {
    const fetchOptions: RequestInit = {
      method: check.method,
      headers: check.headers as Record<string, string>,
      signal: controller.signal,
    };

    if (check.body && ["POST", "PUT", "PATCH"].includes(check.method)) {
      fetchOptions.body = check.body;
      if (!(fetchOptions.headers as Record<string, string>)["Content-Type"]) {
        (fetchOptions.headers as Record<string, string>)["Content-Type"] = "application/json";
      }
    }

    const response = await fetch(url, fetchOptions);
    clearTimeout(timeoutId);

    const responseTimeMs = Date.now() - startTime;
    const responseText = await response.text().then((t) => t.slice(0, 10240));
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => { responseHeaders[key] = value; });

    // Assertion 1: status code
    if (response.status === check.expectedStatus) {
      assertionsPassed.push(`Status code is ${check.expectedStatus}`);
    } else {
      assertionsFailed.push(`Expected status ${check.expectedStatus}, got ${response.status}`);
    }

    // Assertion 2: body contains
    if (check.expectedBodyContains) {
      if (responseText.includes(check.expectedBodyContains)) {
        assertionsPassed.push(`Response body contains "${check.expectedBodyContains}"`);
      } else {
        assertionsFailed.push(`Response body does not contain "${check.expectedBodyContains}"`);
      }
    }

    // Assertion 3: response time
    if (check.expectedResponseTimeMs) {
      if (responseTimeMs <= check.expectedResponseTimeMs) {
        assertionsPassed.push(`Response time ${responseTimeMs}ms ≤ ${check.expectedResponseTimeMs}ms`);
      } else {
        assertionsFailed.push(`Response time ${responseTimeMs}ms exceeds ${check.expectedResponseTimeMs}ms`);
      }
    }

    const status = assertionsFailed.length === 0 ? "passed" : "failed";

    const result = createApiCheckResult({
      checkId: check.id,
      runId: options?.runId,
      status,
      statusCode: response.status,
      responseTimeMs,
      responseBody: responseText,
      responseHeaders,
      assertionsPassed,
      assertionsFailed,
    });
    // Fire webhooks asynchronously for failures — don't await to avoid slowing down the run
    if (status !== "passed") dispatchApiCheckWebhooks(check, result).catch(() => {});
    return result;
  } catch (error) {
    clearTimeout(timeoutId);
    const responseTimeMs = Date.now() - startTime;

    let errorMessage: string;
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        errorMessage = `Request timed out after ${check.timeoutMs}ms`;
      } else {
        errorMessage = error.message;
      }
    } else {
      errorMessage = String(error);
    }

    const result = createApiCheckResult({
      checkId: check.id,
      runId: options?.runId,
      status: "error",
      responseTimeMs,
      error: errorMessage,
      assertionsPassed,
      assertionsFailed,
    });
    dispatchApiCheckWebhooks(check, result).catch(() => {});
    return result;
  }
}

export async function runApiChecks(
  checks: ApiCheck[],
  options?: RunApiCheckOptions & { parallel?: number },
): Promise<ApiCheckResult[]> {
  const parallel = options?.parallel ?? 5;
  const results: ApiCheckResult[] = [];

  for (let i = 0; i < checks.length; i += parallel) {
    const batch = checks.slice(i, i + parallel);
    const batchResults = await Promise.all(
      batch.map((check) => runApiCheck(check, options))
    );
    results.push(...batchResults);
  }

  return results;
}

export async function runApiChecksByFilter(
  filter: ApiCheckFilter & { baseUrl: string; parallel?: number; runId?: string },
): Promise<{ results: ApiCheckResult[]; passed: number; failed: number; errors: number }> {
  const { baseUrl, parallel, runId, ...checkFilter } = filter;
  const checks = listApiChecks({ ...checkFilter, enabled: true });
  const results = await runApiChecks(checks, { baseUrl, parallel, runId });

  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const errors = results.filter((r) => r.status === "error").length;

  return { results, passed, failed, errors };
}
