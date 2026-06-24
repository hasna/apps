import { tool, type ToolSet } from "ai";
import { z } from "zod/v4";
import {
  APPROVED_FLEET_ARTIFACT_NAMESPACES,
  FLEET_ARTIFACT_DEFAULT_MAX_BYTES,
  FLEET_ARTIFACT_HARD_MAX_BYTES,
  FLEET_ARTIFACT_SOURCE_SCOPES,
  isSensitiveFleetArtifactId,
} from "./fleet-artifacts.js";
import { evaluateTerminalCommandTextPolicy } from "./policy.js";

const MAX_COORDINATE = 100_000;
const MAX_RESOURCE_ID_LENGTH = 192;
const SAFE_PROTOCOLS = new Set(["http:", "https:"]);

export const coordinateSchema = z.number().int().min(0).max(MAX_COORDINATE);
export const pointSchema = z.object({
  x: coordinateSchema,
  y: coordinateSchema,
}).strict();

export const resourceIdSchema = z.string()
  .min(1)
  .max(MAX_RESOURCE_ID_LENGTH)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/)
  .refine((value) => !value.includes(".."), "Resource IDs cannot contain path traversal.");

export const fleetMachineIdSchema = z.string()
  .min(1)
  .max(MAX_RESOURCE_ID_LENGTH)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Fleet machine IDs must be registry IDs, not shell, SSH, URL, or path specs.");

export const fleetArtifactIdSchema = resourceIdSchema
  .refine(
    (value) => (APPROVED_FLEET_ARTIFACT_NAMESPACES as readonly string[]).some((namespace) => value.startsWith(`${namespace}/`)),
    "Fleet artifacts must be in an approved evidence namespace.",
  )
  .refine(
    (value) => !value.includes("\\") && !value.includes("://") && !value.includes("@") && !value.includes(":"),
    "Fleet artifact IDs must be canonical POSIX artifact IDs, not URLs, SSH specs, or platform paths.",
  )
  .refine(
    (value) => value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== ".."),
    "Fleet artifact IDs cannot contain empty, current-directory, or traversal segments.",
  )
  .refine(
    (value) => !isSensitiveFleetArtifactId(value),
    "Fleet artifact IDs cannot target private or credential-like filenames.",
  );

export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i, "Expected digest must be a sha256 hex string.");
export const fleetArtifactSourceScopeSchema = z.enum(FLEET_ARTIFACT_SOURCE_SCOPES).default("run_artifact");
export const fleetArtifactMaxBytesSchema = z.number()
  .int()
  .min(1)
  .max(FLEET_ARTIFACT_HARD_MAX_BYTES)
  .default(FLEET_ARTIFACT_DEFAULT_MAX_BYTES);

export const workspacePathSchema = z.string()
  .min(1)
  .max(512)
  .refine((value) => value.startsWith("/") || value.startsWith("~/"), "Workspace paths must be absolute.")
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Workspace paths cannot contain control characters.");

export const httpUrlSchema = z.string()
  .url()
  .refine((value) => SAFE_PROTOCOLS.has(new URL(value).protocol), "Only http and https URLs are allowed.");

export const terminalCommandSchema = z.string()
  .min(1)
  .max(4_000)
  .refine((value) => value.trim().length > 0, "Commands cannot be blank.")
  .refine((value) => evaluateTerminalCommandTextPolicy([value]).allowed, "Command is blocked by terminal command policy.");

export const computerToolInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("screenshot") }).strict(),
  z.object({ action: z.literal("click"), point: pointSchema, button: z.enum(["left", "right", "middle"]).default("left"), count: z.number().int().min(1).max(3).default(1) }).strict(),
  z.object({ action: z.literal("type"), text: z.string().min(1).max(8_000) }).strict(),
  z.object({ action: z.literal("key"), keys: z.string().min(1).max(128).regex(/^[A-Za-z0-9_+\- ]+$/) }).strict(),
  z.object({ action: z.literal("scroll"), point: pointSchema, deltaX: z.number().int().min(-10_000).max(10_000).default(0), deltaY: z.number().int().min(-10_000).max(10_000) }).strict(),
  z.object({ action: z.literal("wait"), ms: z.number().int().min(0).max(30_000) }).strict(),
  z.object({ action: z.literal("open_url"), url: httpUrlSchema }).strict(),
  z.object({ action: z.literal("open_app"), name: resourceIdSchema }).strict(),
]);

export const browserToolInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status"), sessionId: resourceIdSchema.optional() }).strict(),
  z.object({ action: z.literal("snapshot"), sessionId: resourceIdSchema.optional() }).strict(),
  z.object({ action: z.literal("navigate"), sessionId: resourceIdSchema.optional(), url: httpUrlSchema }).strict(),
  z.object({ action: z.literal("click"), sessionId: resourceIdSchema.optional(), point: pointSchema }).strict(),
  z.object({ action: z.literal("type"), sessionId: resourceIdSchema.optional(), text: z.string().min(1).max(8_000) }).strict(),
  z.object({ action: z.literal("key"), sessionId: resourceIdSchema.optional(), keys: z.string().min(1).max(128).regex(/^[A-Za-z0-9_+\- ]+$/) }).strict(),
  z.object({ action: z.literal("scroll"), sessionId: resourceIdSchema.optional(), deltaX: z.number().int().min(-10_000).max(10_000).default(0), deltaY: z.number().int().min(-10_000).max(10_000) }).strict(),
]);

export const terminalToolInputSchema = z.object({
  app: z.enum(["ghostty"]).default("ghostty"),
  dir: workspacePathSchema,
  commands: z.array(terminalCommandSchema).min(1).max(16),
  allPanes: z.boolean().default(false),
}).strict();

export const appToolInputSchema = z.object({
  app: resourceIdSchema,
  grid: z.string().regex(/^[1-9]\d*x[1-9]\d*$/).optional(),
  tabs: z.array(z.string().regex(/^[1-9]\d*x[1-9]\d*$/)).max(16).optional(),
  maximize: z.boolean().default(false),
}).strict();

const fleetTimeoutSchema = z.number().int().min(1_000).max(120_000).default(15_000);

const fleetCapabilitiesToolInputSchema = z.object({
  machineId: fleetMachineIdSchema,
  action: z.literal("capabilities"),
  timeoutMs: fleetTimeoutSchema,
}).strict();
const fleetRouteToolInputSchema = z.object({
  machineId: fleetMachineIdSchema,
  action: z.literal("route"),
  timeoutMs: fleetTimeoutSchema,
}).strict();
const fleetRunSmokeToolInputSchema = z.object({
  machineId: fleetMachineIdSchema,
  action: z.literal("run_smoke"),
  workspacePath: workspacePathSchema,
  timeoutMs: fleetTimeoutSchema,
}).strict();
const fleetPullArtifactBaseSchema = {
  machineId: fleetMachineIdSchema,
  action: z.literal("pull_artifact"),
  artifactId: fleetArtifactIdSchema,
  sourceScope: fleetArtifactSourceScopeSchema,
  maxBytes: fleetArtifactMaxBytesSchema,
  timeoutMs: fleetTimeoutSchema,
} as const;
const fleetPullArtifactHashOnlyToolInputSchema = z.object({
  ...fleetPullArtifactBaseSchema,
  mode: z.literal("hash_only").default("hash_only"),
  expectedSha256: sha256Schema.optional(),
}).strict();
const fleetPullArtifactMaterializeToolInputSchema = z.object({
  ...fleetPullArtifactBaseSchema,
  mode: z.literal("materialize"),
  expectedSha256: sha256Schema,
}).strict();

export const fleetToolInputSchema = z.union([
  fleetCapabilitiesToolInputSchema,
  fleetRouteToolInputSchema,
  fleetRunSmokeToolInputSchema,
  fleetPullArtifactHashOnlyToolInputSchema,
  fleetPullArtifactMaterializeToolInputSchema,
]);

export const storageToolInputSchema = z.object({
  action: z.enum(["status", "push", "pull", "sync"]),
  tables: z.array(resourceIdSchema).max(32).optional(),
}).strict();

export const memoryToolInputSchema = z.object({
  scope: z.enum(["goal", "run", "machine", "browser", "operator"]),
  title: z.string().min(1).max(160),
  body: z.string().min(1).max(16_000),
  sourceRef: resourceIdSchema.optional(),
}).strict();

export const approvalToolInputSchema = z.object({
  capability: resourceIdSchema,
  reason: z.string().min(1).max(1_000),
  resourceId: resourceIdSchema.optional(),
  expiresInMs: z.number().int().min(1_000).max(86_400_000).default(300_000),
}).strict();

export const observationToolInputSchema = z.object({
  kind: z.enum(["screenshot", "accessibility_tree", "browser_snapshot", "terminal_transcript", "fleet_status", "note"]),
  runId: resourceIdSchema.optional(),
  artifactPath: workspacePathSchema.optional(),
  summary: z.string().min(1).max(2_000).optional(),
}).strict();

export const plannerToolSchemas = {
  computer: computerToolInputSchema,
  browser: browserToolInputSchema,
  terminal: terminalToolInputSchema,
  app: appToolInputSchema,
  fleet: fleetToolInputSchema,
  storage: storageToolInputSchema,
  memory: memoryToolInputSchema,
  approval: approvalToolInputSchema,
  observation: observationToolInputSchema,
} as const;

export function createPlannerTools(): ToolSet {
  return {
    computer: tool({
      description: "Plan a policy-backed native computer action. Execution is routed separately.",
      inputSchema: computerToolInputSchema,
      needsApproval: (args) => args.action !== "screenshot" && args.action !== "wait",
    }),
    browser: tool({
      description: "Plan a browser-extension action through the open-browser lane.",
      inputSchema: browserToolInputSchema,
      needsApproval: (args) => args.action !== "status" && args.action !== "snapshot",
    }),
    terminal: tool({
      description: "Plan approved terminal command execution in an operator workspace.",
      inputSchema: terminalToolInputSchema,
      needsApproval: true,
    }),
    app: tool({
      description: "Plan deterministic app opening and layout without command execution.",
      inputSchema: appToolInputSchema,
      needsApproval: true,
    }),
    fleet: tool({
      description: "Plan a fleet-machine capability, route, smoke, or artifact operation.",
      inputSchema: fleetToolInputSchema,
      needsApproval: (args) => args.action !== "capabilities" && args.action !== "route",
    }),
    storage: tool({
      description: "Plan local/remote storage status or sync operations.",
      inputSchema: storageToolInputSchema,
      needsApproval: (args) => args.action !== "status",
    }),
    memory: tool({
      description: "Record durable planner memory for goals, runs, machines, browsers, or operator notes.",
      inputSchema: memoryToolInputSchema,
      needsApproval: false,
    }),
    approval: tool({
      description: "Request a durable approval checkpoint for a planned capability.",
      inputSchema: approvalToolInputSchema,
      needsApproval: false,
    }),
    observation: tool({
      description: "Record a structured observation or artifact reference in the run graph.",
      inputSchema: observationToolInputSchema,
      needsApproval: false,
    }),
  } satisfies ToolSet;
}

export type PlannerToolName = keyof typeof plannerToolSchemas;
export type ComputerToolInput = z.infer<typeof computerToolInputSchema>;
export type BrowserToolInput = z.infer<typeof browserToolInputSchema>;
export type TerminalToolInput = z.infer<typeof terminalToolInputSchema>;
export type AppToolInput = z.infer<typeof appToolInputSchema>;
export type FleetToolInput = z.infer<typeof fleetToolInputSchema>;
export type StorageToolInput = z.infer<typeof storageToolInputSchema>;
export type MemoryToolInput = z.infer<typeof memoryToolInputSchema>;
export type ApprovalToolInput = z.infer<typeof approvalToolInputSchema>;
export type ObservationToolInput = z.infer<typeof observationToolInputSchema>;
