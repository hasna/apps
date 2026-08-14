import type { Page } from "playwright";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { getDataDir } from "../db/schema.js";
import { createSession, closeSession, getSession } from "./session.js";
import { takeScreenshot } from "./screenshot.js";
import type { BrowserEngine, Session } from "../types/index.js";
import { ensureOwnerOnlyDir, writeOwnerOnlyFile } from "./security.js";
import {
  closeKernelSandbox,
  createKernelSandbox,
  downloadKernelFileToDownloads,
  executeKernelPlaywright,
  listKernelBrowsers,
  retrieveKernelBrowser,
  type KernelSandbox,
} from "../engines/kernel.js";

export type WorkflowRunner = BrowserEngine | "kernel";

export interface WorkflowManifestAction {
  description?: string;
  startUrl?: string;
  runner?: WorkflowRunner;
  scriptFile?: string;
  mutatesExternalAccount?: boolean | string;
  stopBeforeCheckout?: boolean;
  timeoutSeconds?: number;
  variables?: Record<string, string | number | boolean | null>;
}

export interface WorkflowManifest {
  name: string;
  site: string;
  runner: WorkflowRunner;
  description?: string;
  startUrl?: string;
  capabilities?: string[];
  actions: Record<string, WorkflowManifestAction>;
  kernel: {
    closeAfterRun: boolean;
    timeoutSeconds: number;
    stealth?: boolean;
    authMode?: "managed" | "cdp_autofill" | "auto" | "off";
    persistenceId?: string;
    requiresRiskyCapabilityApproval?: boolean;
  };
  stopConditions: string[];
  secrets: Record<string, unknown>;
  evidence: {
    captureBeforeClose: boolean;
    verifySessionCleanup: boolean;
    dir?: string;
  };
  safety: {
    redactSecrets: boolean;
    stopBeforeSensitiveActions: boolean;
    allowCustomCaptchaSolving: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface LoadedWorkflowManifest {
  manifest: WorkflowManifest;
  path: string;
  dir: string;
}

export interface WorkflowValidationIssue {
  level: "error" | "warning";
  path: string;
  message: string;
}

export interface WorkflowValidationResult {
  ok: boolean;
  path: string;
  name?: string;
  errors: string[];
  warnings: string[];
}

export interface WorkflowRunOptions {
  action: string;
  engine?: BrowserEngine;
  headed?: boolean;
  allowMutation?: boolean;
  allowRiskyCapabilities?: boolean;
  approvalToken?: string;
  timeoutSeconds?: number;
  variables?: Record<string, string>;
}

export interface WorkflowRunEvidence {
  ok: boolean;
  runId: string;
  workflow: string;
  action: string;
  manifestPath: string;
  workflowDir: string;
  startedAt: string;
  finishedAt: string;
  session?: {
    id: string;
    engine: string;
    remoteSessionId?: string;
    status?: string;
  };
  result?: unknown;
  screenshots: Array<Record<string, unknown>>;
  cleanup: {
    closeAttempted: boolean;
    closed: boolean;
    verified: boolean;
    statusAfterClose?: string;
    error?: string;
  };
  evidencePath: string;
  error?: string;
}

const REQUIRED_STOP_CONDITIONS = [
  "interactive-captcha",
  "mfa",
  "payment",
  "purchase",
  "identity-verification",
];

const VALID_WORKFLOW_ENGINES = new Set<WorkflowRunner>([
  "playwright",
  "cdp",
  "lightpanda",
  "bun",
  "tui",
  "extension",
  "kernel",
  "auto",
]);

const SENSITIVE_NAME_PATTERN = /secret|password|token|api[_-]?key|authorization|cookie|credential/i;
const SENSITIVE_VALUE_PATTERN = /\b(sk-[A-Za-z0-9_-]{12,}|npm_[A-Za-z0-9_-]{12,}|gh[op]_[A-Za-z0-9_-]{12,}|AKIA[A-Z0-9]{16})\b/;

type AsyncWorkflowFunction = (
  page: Page,
  context: Record<string, unknown>,
  helpers: Record<string, unknown>,
) => Promise<unknown>;

interface KernelWorkflowScreenshot {
  label?: string;
  remotePath?: string;
  width?: number;
  height?: number;
  runId?: string;
  action?: string;
}

interface KernelWorkflowPayload {
  result?: unknown;
  screenshots?: KernelWorkflowScreenshot[];
  pageUrl?: string;
}

export function getWorkflowDir(): string {
  const dir = process.env["BROWSER_WORKFLOW_DIR"] || join(getDataDir(), "workflows");
  ensureOwnerOnlyDir(dir);
  return dir;
}

export function getWorkflowEvidenceDir(manifest?: WorkflowManifest): string {
  const configured = manifest?.evidence?.dir;
  const dir = configured
    ? isAbsolute(configured) ? configured : join(getWorkflowDir(), configured)
    : join(getWorkflowDir(), "evidence");
  assertPathInsideWorkflowDir(dir, "evidence.dir");
  ensureOwnerOnlyDir(dir);
  return dir;
}

export function listWorkflowManifestFiles(dir = getWorkflowDir()): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue;
    }
    if (stat.isFile() && entry.endsWith(".workflow.json")) {
      files.push(path);
    } else if (stat.isDirectory()) {
      const manifest = join(path, "manifest.json");
      if (existsSync(manifest)) files.push(manifest);
      const namedManifest = join(path, `${entry}.workflow.json`);
      if (existsSync(namedManifest)) files.push(namedManifest);
    }
  }
  return files.sort();
}

export function listWorkflowManifests(dir = getWorkflowDir()): LoadedWorkflowManifest[] {
  return listWorkflowManifestFiles(dir).flatMap((path) => {
    try {
      return [loadWorkflowManifest(path)];
    } catch {
      return [];
    }
  });
}

export function loadWorkflowManifest(nameOrPath: string): LoadedWorkflowManifest {
  const path = resolveWorkflowManifestPath(nameOrPath);
  const raw = JSON.parse(readFileSync(path, "utf8")) as WorkflowManifest;
  return { manifest: raw, path, dir: dirname(path) };
}

export function resolveWorkflowManifestPath(nameOrPath: string): string {
  const workflowDir = getWorkflowDir();
  const candidate = resolve(nameOrPath);
  if (existsSync(candidate)) {
    assertPathInside(candidate, workflowDir, "workflow manifest path");
    const stat = statSync(candidate);
    if (stat.isDirectory()) {
      const manifest = join(candidate, "manifest.json");
      if (existsSync(manifest)) return manifest;
      const namedManifest = join(candidate, `${basename(candidate)}.workflow.json`);
      if (existsSync(namedManifest)) return namedManifest;
      throw new Error(`Workflow directory has no manifest: ${candidate}`);
    }
    return candidate;
  }

  const dir = workflowDir;
  const direct = resolveWorkflowDirCandidate(dir, `${nameOrPath}.workflow.json`);
  if (existsSync(direct)) return direct;
  const nested = resolveWorkflowDirCandidate(dir, nameOrPath, "manifest.json");
  if (existsSync(nested)) return nested;
  const nestedNamed = resolveWorkflowDirCandidate(dir, nameOrPath, `${basename(nameOrPath)}.workflow.json`);
  if (existsSync(nestedNamed)) return nestedNamed;

  const byManifestName = listWorkflowManifestFiles(dir).find((file) => {
    try {
      const manifest = JSON.parse(readFileSync(file, "utf8")) as WorkflowManifest;
      return manifest.name === nameOrPath;
    } catch {
      return false;
    }
  });
  if (byManifestName) return byManifestName;

  throw new Error(`Workflow not found: ${nameOrPath}`);
}

export function validateWorkflowManifest(loaded: LoadedWorkflowManifest): WorkflowValidationResult {
  const { manifest, path } = loaded;
  const errors: string[] = [];
  const warnings: string[] = [];
  const requireField = (field: string, value: unknown) => {
    if (value === undefined || value === null || value === "") errors.push(`Missing required field: ${field}`);
  };

  requireField("name", manifest.name);
  requireField("site", manifest.site);
  requireField("runner", manifest.runner);
  requireField("kernel", manifest.kernel);
  requireField("stopConditions", manifest.stopConditions);
  requireField("secrets", manifest.secrets);
  requireField("evidence", manifest.evidence);
  requireField("safety", manifest.safety);
  requireField("actions", manifest.actions);
  if (!isPathInside(path, getWorkflowDir())) errors.push("manifest path must be inside the Browser workflow directory");
  if (!isValidWorkflowEngine(manifest.runner)) errors.push(`runner must be a valid engine (${[...VALID_WORKFLOW_ENGINES].join(", ")})`);

  if (!manifest.actions || typeof manifest.actions !== "object" || Object.keys(manifest.actions).length === 0) {
    errors.push("actions must contain at least one action");
  } else {
    for (const [name, action] of Object.entries(manifest.actions)) {
      if ((action as Record<string, unknown>).script !== undefined) {
        errors.push(`Action '${name}' must use scriptFile; inline scripts are not allowed in manifests`);
      }
      if (action.scriptFile) {
        let scriptPath = "";
        try {
          scriptPath = resolveWorkflowScriptPath(loaded, action.scriptFile);
        } catch (err) {
          errors.push(`Action '${name}' scriptFile is invalid: ${err instanceof Error ? err.message : String(err)}`);
        }
        if (!existsSync(scriptPath)) errors.push(`Action '${name}' scriptFile not found: ${action.scriptFile}`);
      } else {
        errors.push(`Action '${name}' must define scriptFile`);
      }
      if (action.runner !== undefined && !isValidWorkflowEngine(action.runner)) {
        errors.push(`Action '${name}' runner must be a valid engine`);
      }
      if (action.timeoutSeconds !== undefined && !isValidWorkflowTimeout(action.timeoutSeconds)) {
        errors.push(`Action '${name}' timeoutSeconds must be an integer between 1 and 300`);
      }
    }
  }

  if (!manifest.kernel || typeof manifest.kernel !== "object") {
    errors.push("kernel must be an object");
  } else {
    if (manifest.kernel.closeAfterRun !== true) errors.push("kernel.closeAfterRun must be true");
    if (!Number.isInteger(manifest.kernel.timeoutSeconds) || manifest.kernel.timeoutSeconds < 30 || manifest.kernel.timeoutSeconds > 300) {
      errors.push("kernel.timeoutSeconds must be an integer between 30 and 300");
    }
    if (manifest.kernel.stealth === true && manifest.kernel.requiresRiskyCapabilityApproval !== true) {
      errors.push("kernel.stealth requires kernel.requiresRiskyCapabilityApproval=true");
    }
  }

  if (!Array.isArray(manifest.stopConditions)) {
    errors.push("stopConditions must be an array");
  } else {
    for (const condition of REQUIRED_STOP_CONDITIONS) {
      if (!manifest.stopConditions.includes(condition)) errors.push(`stopConditions must include '${condition}'`);
    }
  }

  if (!manifest.evidence || typeof manifest.evidence !== "object") {
    errors.push("evidence must be an object");
  } else {
    if (manifest.evidence.captureBeforeClose !== true) errors.push("evidence.captureBeforeClose must be true");
    if (manifest.evidence.verifySessionCleanup !== true) errors.push("evidence.verifySessionCleanup must be true");
    if (manifest.evidence.dir) {
      try {
        assertPathInsideWorkflowDir(
          isAbsolute(manifest.evidence.dir) ? manifest.evidence.dir : join(getWorkflowDir(), manifest.evidence.dir),
          "evidence.dir",
        );
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
  }

  if (!manifest.safety || typeof manifest.safety !== "object") {
    errors.push("safety must be an object");
  } else {
    if (manifest.safety.redactSecrets !== true) errors.push("safety.redactSecrets must be true");
    if (manifest.safety.stopBeforeSensitiveActions !== true) errors.push("safety.stopBeforeSensitiveActions must be true");
    if (manifest.safety.allowCustomCaptchaSolving !== false) errors.push("safety.allowCustomCaptchaSolving must be false");
  }

  return { ok: errors.length === 0, path, name: manifest.name, errors, warnings };
}

export function validateAllWorkflowManifests(dir = getWorkflowDir()): WorkflowValidationResult[] {
  return listWorkflowManifestFiles(dir).map((path) => {
    try {
      return validateWorkflowManifest(loadWorkflowManifest(path));
    } catch (err) {
      return {
        ok: false,
        path,
        errors: [err instanceof Error ? err.message : String(err)],
        warnings: [],
      };
    }
  });
}

export async function runWorkflowAction(nameOrPath: string, opts: WorkflowRunOptions): Promise<WorkflowRunEvidence> {
  const loaded = loadWorkflowManifest(nameOrPath);
  const { manifest } = loaded;
  const validation = validateWorkflowManifest(loaded);
  if (!validation.ok) throw new Error(`Workflow manifest is invalid: ${validation.errors.join("; ")}`);

  const action = manifest.actions[opts.action];
  if (!action) throw new Error(`Workflow '${manifest.name}' has no action '${opts.action}'`);
  if (!action.scriptFile) {
    throw new Error(`Workflow action '${opts.action}' has no scriptFile`);
  }
  if (isMutatingAction(action) && !opts.allowMutation) {
    throw new Error(`Workflow action '${opts.action}' mutates external state. Re-run with --allow-mutation when intentional.`);
  }
  const runner = validateWorkflowEngine(opts.engine ?? action.runner ?? manifest.runner, "workflow runner");
  const kernelTimeoutSeconds = validateWorkflowTimeout(opts.timeoutSeconds ?? manifest.kernel.timeoutSeconds, "timeoutSeconds", 30);
  const actionTimeoutSeconds = validateWorkflowTimeout(action.timeoutSeconds ?? kernelTimeoutSeconds, "action.timeoutSeconds", 1);

  const runId = randomUUID().slice(0, 8);
  const startedAt = new Date().toISOString();
  const screenshots: Array<Record<string, unknown>> = [];
  let session: Session | undefined;
  let kernelSandbox: KernelSandbox | undefined;
  let kernelSessionId: string | undefined;
  let cleanup = { closeAttempted: false, closed: false, verified: false } as WorkflowRunEvidence["cleanup"];
  let result: unknown;
  let error: string | undefined;

  try {
    const startUrl = action.startUrl ?? manifest.startUrl ?? `https://${manifest.site}/`;
    const script = loadActionScript(loaded, action);
    const variables = {
      ...(action.variables ?? {}),
      ...(opts.variables ?? {}),
      allowMutation: opts.allowMutation,
    };

    if (runner === "kernel") {
      kernelSandbox = await createKernelSandbox({
        startUrl,
        name: `workflow-${manifest.name}-${opts.action}-${runId}`,
        headless: !opts.headed,
        stealth: manifest.kernel.stealth,
        timeoutSeconds: kernelTimeoutSeconds,
        persistenceId: manifest.kernel.persistenceId,
        authMode: manifest.kernel.authMode ?? "off",
        approvalToken: opts.approvalToken,
      });
      kernelSessionId = kernelSandbox.metadata.sessionId;
      const kernelResult = await runKernelWorkflowScript({
        sandbox: kernelSandbox,
        manifest,
        action,
        actionName: opts.action,
        actionTimeoutSeconds,
        startUrl,
        runId,
        script,
        variables,
      });
      result = kernelResult.result;
      screenshots.push(...kernelResult.screenshots);
    } else {
      const { session: createdSession, page } = await createSession({
        engine: runner,
        startUrl,
        headless: !opts.headed,
        name: `workflow-${manifest.name}-${opts.action}-${runId}`,
        stealth: manifest.kernel.stealth,
        kernelTimeoutSeconds,
        kernelPersistenceId: manifest.kernel.persistenceId,
        kernelAuthMode: manifest.kernel.authMode ?? "off",
        approvalToken: opts.approvalToken,
        captureConsole: false,
        captureNetwork: false,
      });
      session = createdSession;

      const fn = compileActionScript(script);
      const helpers = createWorkflowHelpers(page, session, manifest, opts.action, runId, screenshots);
      result = await withTimeout(fn(page, {
        manifest: publicManifestContext(manifest),
        action: publicActionContext(action),
        runId,
        variables,
        startUrl,
        workflowDir: getWorkflowDir(),
        manifestPath: loaded.path,
        stopConditions: manifest.stopConditions,
      }, helpers), actionTimeoutSeconds * 1000, `Workflow action '${opts.action}' timed out after ${actionTimeoutSeconds}s`);
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    if (session && manifest.kernel.closeAfterRun) {
      cleanup.closeAttempted = true;
      try {
        await closeSession(session.id);
        cleanup.closed = true;
        const after = getSession(session.id);
        cleanup.statusAfterClose = after.status;
        cleanup.verified = after.status === "closed";
      } catch (err) {
        cleanup.error = err instanceof Error ? err.message : String(err);
      }
    } else if (kernelSandbox && manifest.kernel.closeAfterRun) {
      cleanup.closeAttempted = true;
      try {
        await closeKernelSandbox(kernelSandbox);
        const verification = await verifyKernelSandboxClosed(kernelSandbox);
        cleanup.closed = verification.closed;
        cleanup.verified = verification.verified;
        cleanup.statusAfterClose = verification.status;
      } catch (err) {
        if (isAlreadyClosedKernelError(err)) {
          const verification = await verifyKernelSandboxClosed(kernelSandbox).catch(() => ({
            closed: true,
            verified: false,
            status: "already-closed-unverified",
          }));
          cleanup.closed = verification.closed;
          cleanup.verified = verification.verified;
          cleanup.statusAfterClose = verification.status;
        } else {
          cleanup.error = err instanceof Error ? err.message : String(err);
        }
      }
    }
  }

  const evidenceDir = getWorkflowEvidenceDir(manifest);
  const evidencePath = join(evidenceDir, `${manifest.name}-${opts.action}-${runId}.json`);
  const evidence: WorkflowRunEvidence = {
    ok: !error && cleanup.closed && cleanup.verified,
    runId,
    workflow: manifest.name,
    action: opts.action,
    manifestPath: loaded.path,
    workflowDir: getWorkflowDir(),
    startedAt,
    finishedAt: new Date().toISOString(),
    session: session ? {
      id: session.id,
      engine: session.engine,
      remoteSessionId: session.remote_session_id,
      status: session.status,
    } : kernelSessionId ? {
      id: kernelSessionId,
      engine: "kernel",
      remoteSessionId: kernelSessionId,
      status: cleanup.closed ? "closed" : "unknown",
    } : undefined,
    result: redactForWorkflowOutput(result),
    screenshots,
    cleanup,
    evidencePath,
    error: error ? redactForWorkflowOutput(error) as string : undefined,
  };
  writeOwnerOnlyFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

async function runKernelWorkflowScript(opts: {
  sandbox: KernelSandbox;
  manifest: WorkflowManifest;
  action: WorkflowManifestAction;
  actionName: string;
  actionTimeoutSeconds: number;
  startUrl: string;
  runId: string;
  script: string;
  variables: Record<string, string | number | boolean | null | undefined>;
}): Promise<{ result: unknown; screenshots: Array<Record<string, unknown>> }> {
  const code = buildKernelWorkflowCode({
    script: opts.script,
    context: {
      manifest: publicManifestContext(opts.manifest),
      action: publicActionContext(opts.action),
      runId: opts.runId,
      variables: opts.variables,
      startUrl: opts.startUrl,
      workflowDir: getWorkflowDir(),
      stopConditions: opts.manifest.stopConditions,
    },
    runId: opts.runId,
    actionName: opts.actionName,
  });

  const executed = await executeKernelPlaywright(opts.sandbox.metadata.sessionId, code, {
    timeoutSec: opts.actionTimeoutSeconds,
  });
  const executionFailure = findKernelExecutionFailure(executed);
  if (executionFailure) throw new Error(executionFailure);
  const payload = extractKernelWorkflowPayload(executed);
  const screenshots = await downloadKernelWorkflowScreenshots(
    opts.sandbox.metadata.sessionId,
    payload.screenshots ?? [],
    `workflow-${opts.manifest.name}-${opts.actionName}-${opts.runId}`,
  );
  return { result: payload.result ?? executed, screenshots };
}

function buildKernelWorkflowCode(opts: {
  script: string;
  context: Record<string, unknown>;
  runId: string;
  actionName: string;
}): string {
  const contextJson = JSON.stringify(opts.context);
  const runIdJson = JSON.stringify(opts.runId);
  const actionNameJson = JSON.stringify(opts.actionName);
  return `
const __workflowScreenshots = [];
const __workflowContext = ${contextJson};
const __workflowRunId = ${runIdJson};
const __workflowActionName = ${actionNameJson};
const __workflowHelpers = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Number(ms) || 0)),
  screenshot: async (label, options = {}) => {
    const safeLabel = String(label || "screenshot").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "screenshot";
    const type = options.format === "jpeg" || options.format === "jpg" ? "jpeg" : "png";
    const extension = type === "jpeg" ? "jpg" : "png";
    const remotePath = "/tmp/" + __workflowRunId + "-" + safeLabel + "." + extension;
    await page.screenshot({ path: remotePath, fullPage: Boolean(options.fullPage), type, timeout: Number(options.timeout) || 20000 });
    const entry = { label: safeLabel, remotePath, runId: __workflowRunId, action: __workflowActionName };
    __workflowScreenshots.push(entry);
    return entry;
  },
  pageText: async (limit = 2000) => {
    const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    return text.replace(/\\s+/g, " ").trim().slice(0, Number(limit) || 2000);
  },
  elements: async (selector = "a,button,input,select,[role=button]", limit = 220) => {
    return page.locator(selector).evaluateAll((nodes, max) =>
      nodes.slice(0, Number(max)).map((node) => ({
        tag: node.tagName.toLowerCase(),
        text: ((node.innerText || node.value || "") + "").replace(/\\s+/g, " ").trim().slice(0, 160),
        aria: (node.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim().slice(0, 160),
        placeholder: (node.getAttribute("placeholder") || "").replace(/\\s+/g, " ").trim().slice(0, 160),
        name: node.getAttribute("name") || "",
        type: node.getAttribute("type") || "",
        href: node.href || "",
        disabled: Boolean(node.disabled || node.getAttribute("aria-disabled") === "true"),
      })),
      limit,
    ).catch(() => []);
  },
  stop: (status, reason, extra = {}) => ({ status, reason, ...extra }),
};
const __workflowAction = async (page, context, helpers) => {
  "use strict";
${opts.script}
};
const __workflowResult = await __workflowAction(page, __workflowContext, __workflowHelpers);
let __workflowPageUrl = "";
try {
  __workflowPageUrl = page.url();
} catch {}
return {
  result: __workflowResult,
  screenshots: __workflowScreenshots,
  pageUrl: __workflowPageUrl,
};
`;
}

function extractKernelWorkflowPayload(value: unknown): KernelWorkflowPayload {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const possibleResult = record["result"];
  if (possibleResult && typeof possibleResult === "object") {
    const resultRecord = possibleResult as Record<string, unknown>;
    if (Array.isArray(resultRecord["screenshots"]) || "result" in resultRecord) {
      return {
        result: resultRecord["result"],
        screenshots: Array.isArray(resultRecord["screenshots"]) ? resultRecord["screenshots"] as KernelWorkflowScreenshot[] : [],
        pageUrl: typeof resultRecord["pageUrl"] === "string" ? resultRecord["pageUrl"] : undefined,
      };
    }
  }
  if (Array.isArray(record["screenshots"]) || "result" in record) {
    return {
      result: record["result"],
      screenshots: Array.isArray(record["screenshots"]) ? record["screenshots"] as KernelWorkflowScreenshot[] : [],
      pageUrl: typeof record["pageUrl"] === "string" ? record["pageUrl"] : undefined,
    };
  }
  return { result: value, screenshots: [] };
}

function findKernelExecutionFailure(value: unknown): string | undefined {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : undefined;
  if (!record) return undefined;
  const direct = failureMessageFromRecord(record);
  if (direct) return direct;
  const nested = record["result"];
  if (nested && typeof nested === "object") return failureMessageFromRecord(nested as Record<string, unknown>);
  return undefined;
}

function failureMessageFromRecord(record: Record<string, unknown>): string | undefined {
  if (record["success"] !== false) return undefined;
  const error = typeof record["error"] === "string" ? record["error"] : "Kernel Playwright execution failed";
  const stderr = typeof record["stderr"] === "string" ? record["stderr"].split(/\r?\n/)[0] : "";
  return stderr ? `${error}: ${stderr}` : error;
}

function isAlreadyClosedKernelError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /404|not found|already been deleted|browser not found/i.test(message);
}

async function verifyKernelSandboxClosed(
  sandbox: KernelSandbox,
): Promise<{ closed: boolean; verified: boolean; status?: string }> {
  const sessionId = sandbox.metadata.sessionId;
  const deadline = Date.now() + 1500;
  let latest: { closed: boolean; verified: boolean; status?: string } = {
    closed: false,
    verified: false,
    status: "unverified",
  };

  while (Date.now() <= deadline) {
    latest = await inspectKernelSessionClosed(sessionId);
    if (latest.verified) return latest;
    await new Promise((resolveWait) => setTimeout(resolveWait, Math.min(500, Math.max(0, deadline - Date.now()))));
  }

  return latest;
}

async function inspectKernelSessionClosed(sessionId: string): Promise<{ closed: boolean; verified: boolean; status?: string }> {
  try {
    const session = await retrieveKernelBrowser(sessionId);
    const status = typeof session["status"] === "string" ? session["status"] : "active";
    const closed = ["deleted", "closed", "terminated", "not-active"].includes(status.toLowerCase());
    return { closed, verified: closed, status };
  } catch (err) {
    if (isAlreadyClosedKernelError(err)) return { closed: true, verified: true, status: "deleted" };
  }

  try {
    const active = await listKernelBrowsers({ status: "active", limit: 100 });
    const match = active.find((session) => session["session_id"] === sessionId || session["id"] === sessionId || session["name"] === sessionId);
    if (!match) return { closed: true, verified: true, status: "not-active" };
    const status = typeof match["status"] === "string" ? match["status"] : "active";
    const closed = ["deleted", "closed", "terminated", "not-active"].includes(status.toLowerCase());
    return { closed, verified: closed, status };
  } catch (err) {
    if (isAlreadyClosedKernelError(err)) return { closed: true, verified: true, status: "deleted" };
    return { closed: false, verified: false, status: "list-failed" };
  }
}

async function downloadKernelWorkflowScreenshots(
  kernelSessionId: string,
  remoteScreenshots: KernelWorkflowScreenshot[],
  localSessionId: string,
): Promise<Array<Record<string, unknown>>> {
  const screenshots: Array<Record<string, unknown>> = [];
  for (const screenshot of remoteScreenshots) {
    if (!screenshot.remotePath) continue;
    const safeRemoteName = basename(screenshot.remotePath) || "kernel-screenshot.png";
    const downloaded = await downloadKernelFileToDownloads(kernelSessionId, screenshot.remotePath, {
      filename: safeRemoteName,
      localSessionId,
    });
    screenshots.push({
      label: screenshot.label ?? safeRemoteName,
      path: downloaded.path,
      remotePath: screenshot.remotePath,
      downloadId: downloaded.id,
      filename: downloaded.filename,
      sizeBytes: downloaded.size_bytes,
      runId: screenshot.runId,
      action: screenshot.action,
    });
  }
  return screenshots;
}

function resolveWorkflowScriptPath(loaded: LoadedWorkflowManifest, scriptFile: string): string {
  if (isAbsolute(scriptFile)) throw new Error("absolute scriptFile paths are not allowed");
  const resolved = resolve(loaded.dir, scriptFile);
  assertPathInside(resolved, getWorkflowDir(), "workflow scriptFile");
  return resolved;
}

function resolveWorkflowDirCandidate(workflowDir: string, ...segments: string[]): string {
  const candidate = resolve(workflowDir, ...segments);
  assertPathInside(candidate, workflowDir, "workflow manifest path");
  return candidate;
}

function loadActionScript(loaded: LoadedWorkflowManifest, action: WorkflowManifestAction): string {
  if (!action.scriptFile) throw new Error("Action script missing");
  return readFileSync(resolveWorkflowScriptPath(loaded, action.scriptFile), "utf8");
}

function compileActionScript(script: string): AsyncWorkflowFunction {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => AsyncWorkflowFunction;
  return new AsyncFunction("page", "context", "helpers", `"use strict";\n${script}`);
}

function isMutatingAction(action: WorkflowManifestAction): boolean {
  return action.mutatesExternalAccount === true || action.mutatesExternalAccount === "true";
}

export function redactWorkflowManifest(manifest: WorkflowManifest): WorkflowManifest {
  return redactForWorkflowOutput(manifest) as WorkflowManifest;
}

export function redactWorkflowEvidence(evidence: WorkflowRunEvidence): WorkflowRunEvidence {
  return redactForWorkflowOutput(evidence) as WorkflowRunEvidence;
}

function publicManifestContext(manifest: WorkflowManifest): Record<string, unknown> {
  return {
    name: manifest.name,
    site: manifest.site,
    runner: manifest.runner,
    capabilities: manifest.capabilities ?? [],
    safety: manifest.safety,
  };
}

function publicActionContext(action: WorkflowManifestAction): Record<string, unknown> {
  return {
    description: action.description,
    startUrl: action.startUrl,
    runner: action.runner,
    mutatesExternalAccount: action.mutatesExternalAccount,
    stopBeforeCheckout: action.stopBeforeCheckout,
  };
}

function isValidWorkflowEngine(value: unknown): value is BrowserEngine {
  return typeof value === "string" && VALID_WORKFLOW_ENGINES.has(value as WorkflowRunner);
}

function validateWorkflowEngine(value: unknown, label: string): BrowserEngine {
  if (isValidWorkflowEngine(value)) return value;
  throw new Error(`${label} must be one of: ${[...VALID_WORKFLOW_ENGINES].join(", ")}`);
}

function isValidWorkflowTimeout(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 300;
}

function validateWorkflowTimeout(value: unknown, label: string, min: number): number {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > 300) {
    throw new Error(`${label} must be an integer between ${min} and 300`);
  }
  return Number(value);
}

function isPathInside(child: string, parent: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || Boolean(rel) && !rel.startsWith("..") && !isAbsolute(rel);
}

function assertPathInside(child: string, parent: string, label: string): void {
  if (!isPathInside(child, parent)) throw new Error(`${label} must stay inside ${parent}`);
}

function assertPathInsideWorkflowDir(path: string, label: string): void {
  assertPathInside(path, getWorkflowDir(), label);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function redactForWorkflowOutput(value: unknown): unknown {
  if (typeof value === "string") return SENSITIVE_VALUE_PATTERN.test(value) ? "[redacted]" : value;
  if (Array.isArray(value)) return value.map(redactForWorkflowOutput);
  if (!value || typeof value !== "object") return value;

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (shouldRedactWorkflowKey(key, item)) output[key] = "[redacted]";
    else output[key] = redactForWorkflowOutput(item);
  }
  return output;
}

function shouldRedactWorkflowKey(key: string, value: unknown): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalized === "redactsecrets" || normalized === "credentialstatus") return false;
  if (typeof value === "boolean" || typeof value === "number") return false;
  return SENSITIVE_NAME_PATTERN.test(key);
}

function createWorkflowHelpers(
  page: Page,
  session: Session,
  manifest: WorkflowManifest,
  actionName: string,
  runId: string,
  screenshots: Array<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    sleep: (ms: number) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)),
    screenshot: async (label: string, options?: Record<string, unknown>) => {
      const safeLabel = label.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "screenshot";
      const result = await takeScreenshot(page, {
        sessionId: session.id,
        projectId: `workflow-${manifest.name}`,
        fullPage: Boolean(options?.["fullPage"]),
        format: (options?.["format"] as "webp" | "jpeg" | "png" | undefined) ?? "webp",
        path: options?.["path"] as string | undefined,
      });
      const entry = {
        label: safeLabel,
        path: result.path,
        width: result.width,
        height: result.height,
        sizeBytes: result.size_bytes,
        galleryId: result.gallery_id,
        runId,
        action: actionName,
      };
      screenshots.push(entry);
      return entry;
    },
    pageText: async (limit = 2000) => {
      const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
      return text.replace(/\s+/g, " ").trim().slice(0, limit);
    },
    elements: async (selector = "a,button,input,select,[role=button]", limit = 220) => {
      return page.locator(selector).evaluateAll((nodes, max) =>
        nodes.slice(0, Number(max)).map((node) => ({
          tag: node.tagName.toLowerCase(),
          text: ((node as HTMLElement).innerText || (node as HTMLInputElement).value || "").replace(/\s+/g, " ").trim().slice(0, 160),
          aria: (node.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 160),
          placeholder: (node.getAttribute("placeholder") || "").replace(/\s+/g, " ").trim().slice(0, 160),
          name: node.getAttribute("name") || "",
          type: node.getAttribute("type") || "",
          href: (node as HTMLAnchorElement).href || "",
          disabled: Boolean((node as HTMLButtonElement).disabled || node.getAttribute("aria-disabled") === "true"),
        })),
      limit).catch(() => []);
    },
    stop: (status: string, reason: string, extra?: Record<string, unknown>) => ({
      status,
      reason,
      ...(extra ?? {}),
    }),
  };
}
