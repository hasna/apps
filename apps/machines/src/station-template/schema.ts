import { z } from "zod";

/**
 * hasna.station_template.v1 — versioned station template (station contract §8).
 *
 * Every item in the shipped template traces to a measured 2026-07-28 failure on
 * station01; the `lesson` field carries that trace so the template stays
 * evidence-first instead of accreting cargo cult.
 */

export const STATION_TEMPLATE_SCHEMA_ID = "hasna.station_template.v1";

const semverPattern = /^\d+\.\d+\.\d+$/;

/** Files that participate in lexicographic-ordering directories must sort last. */
export const ORDERING_SENSITIVE_KINDS = ["sysctl", "tmpfiles"] as const;
export const ORDERING_PREFIX = "99-zz-";

export const templateFileSchema = z.object({
  id: z.string().min(1),
  /** Path relative to the template directory. */
  source: z.string().min(1),
  /**
   * Absolute target path, or `~/`-prefixed for a home-relative target
   * (e.g. systemd user units).
   */
  target: z.string().min(1),
  mode: z.string().regex(/^0[0-7]{3}$/).default("0644"),
  kind: z.enum(["sysctl", "tmpfiles", "systemd-dropin", "systemd-user-unit", "plain"]).default("plain"),
  /** Which measured failure this file exists to prevent. */
  lesson: z.string().min(1),
});

export const templatePackagesSchema = z.object({
  apt: z.array(z.string().min(1)).default([]),
  bun: z.array(z.string().min(1)).default([]),
});

/**
 * A binary the station must be able to resolve on PATH, plus the idempotent
 * shell that provides it.
 *
 * This exists because "apt package" is NOT a general way to say "this command
 * must be present": the ec2 overlay declared apt `awscli`, which has no
 * installation candidate on Ubuntu 24.04 (noble dropped the deb), so the
 * requirement could never be satisfied and could never be converged away.
 * Express the requirement as the command, and carry the install alongside it.
 */
export const templateCommandSchema = z.object({
  id: z.string().min(1),
  /** Binary that must resolve on PATH. */
  command: z.string().min(1),
  /** Idempotent shell that installs it. Runs only when the command is absent. */
  install: z.string().min(1),
  /** Which measured failure this command exists to prevent. */
  lesson: z.string().min(1),
});

export const templateServiceSchema = z.object({
  name: z.string().min(1),
  scope: z.enum(["system", "user"]).default("system"),
  expectEnabled: z.boolean().default(true),
  expectActive: z.boolean().default(true),
});

export const runtimeValueSchema = z.object({
  /** Absolute path of the runtime file to compare (e.g. /sys/kernel/mm/lru_gen/min_ttl_ms). */
  path: z.string().min(1),
  value: z.string().min(1),
  lesson: z.string().min(1),
});

export const unitConventionsSchema = z.object({
  /** Unit-name glob the conventions apply to. */
  match: z.string().min(1).default("hasna-*.service"),
  startLimitIntervalSec: z.number().int().positive().default(300),
  startLimitBurst: z.number().int().positive().default(5),
  onFailureUnit: z.string().min(1).default("hasna-unit-failure-notify@%n.service"),
  requireAbsoluteExecStart: z.boolean().default(true),
  lesson: z.string().min(1),
});

/**
 * The guaranteed access path for a station class — a service that depends only
 * on identity the platform already grants (EC2: the SSM agent via the instance
 * profile), NEVER on a credential fetched at boot.
 *
 * Owner ruling 2026-07-29 (station17): nothing that requires fetching a secret
 * at boot may sit on the critical path to a machine's reachability. Tailscale
 * is an access path, not a boot dependency; the floor is what makes its
 * failure survivable. Physical station classes declare no floor service here —
 * their floor is an out-of-band path (console, physical port).
 */
export const accessFloorSchema = z.object({
  /** systemd unit that provides the floor access path. */
  service: z.string().min(1),
  /** Idempotent shell that installs/enables the floor. Must need no secret. */
  ensure: z.string().min(1),
  /** Which measured failure this floor exists to prevent. */
  lesson: z.string().min(1),
});

export const tailscaleSchema = z.object({
  join: z.boolean().default(true),
  /** Secret NAME only — the value is pulled at runtime, never rendered. */
  authKeySecretName: z.string().min(1),
  hostnameFromStation: z.boolean().default(true),
  /** Enable Tailscale SSH so the tailnet is the whole access plane. */
  ssh: z.boolean().default(true),
});

export const secretsBootstrapSchema = z.object({
  /** Secret NAME only. */
  envSecretName: z.string().min(1),
  optional: z.boolean().default(true),
});

export const swapSchema = z.object({
  sizeGb: z.number().int().min(0).default(0),
});

export const templateLayerSchema = z.object({
  files: z.array(templateFileSchema).default([]),
  packages: templatePackagesSchema.default({ apt: [], bun: [] }),
  /** Binaries that must resolve on PATH, with their idempotent installers. */
  commands: z.array(templateCommandSchema).default([]),
  services: z.array(templateServiceSchema).default([]),
  /** Runtime sysctl expectations (key → value), checked via /proc/sys. */
  sysctls: z.record(z.string()).default({}),
  runtimeValues: z.array(runtimeValueSchema).default([]),
  unitConventions: unitConventionsSchema.optional(),
  accessFloor: accessFloorSchema.optional(),
  tailscale: tailscaleSchema.optional(),
  secretsBootstrap: secretsBootstrapSchema.optional(),
  swap: swapSchema.optional(),
});

export const stationTemplateSchema = z.object({
  $schema: z.literal(STATION_TEMPLATE_SCHEMA_ID),
  name: z.string().min(1),
  version: z.string().regex(semverPattern, "template version must be semver x.y.z"),
  description: z.string().min(1),
  base: templateLayerSchema,
  overlays: z.record(templateLayerSchema).default({}),
});

export type TemplateFile = z.infer<typeof templateFileSchema>;
export type TemplateLayer = z.infer<typeof templateLayerSchema>;
export type StationTemplate = z.infer<typeof stationTemplateSchema>;
export type TemplateService = z.infer<typeof templateServiceSchema>;
export type TemplateCommand = z.infer<typeof templateCommandSchema>;
export type AccessFloor = z.infer<typeof accessFloorSchema>;
export type UnitConventions = z.infer<typeof unitConventionsSchema>;

/** A template file with its content loaded from disk. */
export interface LoadedTemplateFile extends TemplateFile {
  content: string;
  /** Keys managed by this file when kind=sysctl (parsed from content). */
  sysctlKeys: string[];
}

/** The result of merging base + selected overlays. */
export interface EffectiveTemplate {
  schemaId: typeof STATION_TEMPLATE_SCHEMA_ID;
  name: string;
  version: string;
  layers: string[];
  files: LoadedTemplateFile[];
  packages: { apt: string[]; bun: string[] };
  commands: TemplateCommand[];
  services: TemplateService[];
  sysctls: Record<string, string>;
  runtimeValues: z.infer<typeof runtimeValueSchema>[];
  unitConventions?: UnitConventions;
  accessFloor?: AccessFloor;
  tailscale?: z.infer<typeof tailscaleSchema>;
  secretsBootstrap?: z.infer<typeof secretsBootstrapSchema>;
  swap: { sizeGb: number };
}
