import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ORDERING_PREFIX,
  ORDERING_SENSITIVE_KINDS,
  STATION_TEMPLATE_SCHEMA_ID,
  stationTemplateSchema,
  type EffectiveTemplate,
  type LoadedTemplateFile,
  type StationTemplate,
  type TemplateFile,
  type TemplateLayer,
} from "./schema.js";

export interface LoadTemplateOptions {
  /** Override the templates root (tests). Defaults to <package>/templates. */
  templatesDir?: string;
}

export function defaultTemplatesDir(): string {
  const override = process.env["HASNA_MACHINES_TEMPLATES_DIR"];
  if (override && override.trim().length > 0) return override;
  return fileURLToPath(new URL("../../templates", import.meta.url));
}

export function parseSysctlKeys(content: string): string[] {
  const keys: string[] = [];
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (key) keys.push(key);
  }
  return keys;
}

function loadFile(templateDir: string, file: TemplateFile, templatePath: string): LoadedTemplateFile {
  const sourcePath = join(templateDir, file.source);
  if (!existsSync(sourcePath)) {
    throw new Error(`Station template invalid: ${templatePath} file "${file.id}" source missing: ${sourcePath}`);
  }
  const content = readFileSync(sourcePath, "utf8");
  const orderingSensitive = (ORDERING_SENSITIVE_KINDS as readonly string[]).includes(file.kind);
  if (orderingSensitive && !basename(file.target).startsWith(ORDERING_PREFIX)) {
    throw new Error(
      `Station template invalid: ${templatePath} file "${file.id}" targets ${file.target} but ` +
        `${file.kind} files must keep the ${ORDERING_PREFIX} prefix — a plain 99-*.conf fix ` +
        `LOST lexicographic ordering to the vendor 99-dgx-spark.conf on 2026-07-28.`
    );
  }
  return {
    ...file,
    content,
    sysctlKeys: file.kind === "sysctl" ? parseSysctlKeys(content) : [],
  };
}

export interface LoadedStationTemplate {
  template: StationTemplate;
  templateDir: string;
  templatePath: string;
}

export function loadStationTemplate(name = "station", options: LoadTemplateOptions = {}): LoadedStationTemplate {
  const templatesDir = options.templatesDir ?? defaultTemplatesDir();
  const templateDir = join(templatesDir, name);
  const templatePath = join(templateDir, "template.json");
  if (!existsSync(templatePath)) {
    throw new Error(`Station template not found: ${templatePath}`);
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(readFileSync(templatePath, "utf8"));
  } catch (error) {
    throw new Error(`Station template invalid: ${templatePath} is not valid JSON: ${(error as Error).message}`);
  }
  const result = stationTemplateSchema.safeParse(parsedJson);
  if (!result.success) {
    const first = result.error.issues[0];
    const where = first ? `${first.path.join(".") || "(root)"}: ${first.message}` : "unknown issue";
    throw new Error(`Station template invalid: ${templatePath} — ${where}`);
  }
  return { template: result.data, templateDir, templatePath };
}

function mergeLayer(effective: EffectiveTemplate, layer: TemplateLayer, templateDir: string, templatePath: string): void {
  for (const file of layer.files) {
    const loaded = loadFile(templateDir, file, templatePath);
    const existingIndex = effective.files.findIndex((candidate) => candidate.target === file.target);
    if (existingIndex >= 0) {
      effective.files[existingIndex] = loaded;
    } else {
      effective.files.push(loaded);
    }
  }
  effective.packages.apt = [...new Set([...effective.packages.apt, ...layer.packages.apt])];
  effective.packages.bun = [...new Set([...effective.packages.bun, ...layer.packages.bun])];
  for (const command of layer.commands) {
    const existingIndex = effective.commands.findIndex((candidate) => candidate.command === command.command);
    if (existingIndex >= 0) {
      effective.commands[existingIndex] = command;
    } else {
      effective.commands.push(command);
    }
  }
  for (const service of layer.services) {
    const existingIndex = effective.services.findIndex((candidate) => candidate.name === service.name);
    if (existingIndex >= 0) {
      effective.services[existingIndex] = service;
    } else {
      effective.services.push(service);
    }
  }
  effective.sysctls = { ...effective.sysctls, ...layer.sysctls };
  for (const value of layer.runtimeValues) {
    const existingIndex = effective.runtimeValues.findIndex((candidate) => candidate.path === value.path);
    if (existingIndex >= 0) {
      effective.runtimeValues[existingIndex] = value;
    } else {
      effective.runtimeValues.push(value);
    }
  }
  if (layer.unitConventions) effective.unitConventions = layer.unitConventions;
  if (layer.tailscale) effective.tailscale = layer.tailscale;
  if (layer.secretsBootstrap) effective.secretsBootstrap = layer.secretsBootstrap;
  if (layer.swap) effective.swap = layer.swap;
}

/**
 * Resolve base + overlays into one effective template. Overlay order matters:
 * later overlays win on conflicting targets/keys.
 */
export function resolveStationTemplate(
  overlays: string[] = [],
  options: LoadTemplateOptions & { name?: string } = {}
): EffectiveTemplate {
  const { template, templateDir, templatePath } = loadStationTemplate(options.name ?? "station", options);
  const effective: EffectiveTemplate = {
    schemaId: STATION_TEMPLATE_SCHEMA_ID,
    name: template.name,
    version: template.version,
    layers: ["base", ...overlays],
    files: [],
    packages: { apt: [], bun: [] },
    commands: [],
    services: [],
    sysctls: {},
    runtimeValues: [],
    swap: { sizeGb: 0 },
  };
  mergeLayer(effective, template.base, templateDir, templatePath);
  for (const overlayName of overlays) {
    const overlay = template.overlays[overlayName];
    if (!overlay) {
      const known = Object.keys(template.overlays).join(", ") || "(none)";
      throw new Error(`Station template overlay not found: "${overlayName}" (known overlays: ${known})`);
    }
    mergeLayer(effective, overlay, templateDir, templatePath);
  }
  return effective;
}

/** Parse a CLI layer spec like "station" or "station,ec2" into name + overlays. */
export function parseTemplateSpec(spec: string): { name: string; overlays: string[] } {
  const parts = spec
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) throw new Error("Empty template spec");
  return { name: parts[0]!, overlays: parts.slice(1) };
}
