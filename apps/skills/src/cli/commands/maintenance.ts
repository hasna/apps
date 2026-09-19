import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Command } from "commander";
import { createStore } from "../../server/store.js";
import type { OperatorScopeEnrollmentInput } from "../../server/types.js";

type EnrollmentManifest = OperatorScopeEnrollmentInput & {
  operation: "enroll-publish";
  manifestVersion: 1;
  expiresAt: string;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).filter(([key]) => key !== "manifestDigest").sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
  return JSON.stringify(value);
}

function readManifest(path: string): EnrollmentManifest {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<EnrollmentManifest>;
  if (parsed.operation !== "enroll-publish") throw new Error("maintenance manifest operation must be enroll-publish");
  if (parsed.manifestVersion !== 1) throw new Error("unsupported maintenance manifest version");
  for (const field of ["keyId", "stationId", "orgId", "operationId", "manifestDigest", "operatorJobId", "operatorTaskArn", "expiresAt"] as const) {
    if (typeof parsed[field] !== "string" || !parsed[field]!.trim()) throw new Error(`maintenance manifest is missing ${field}`);
  }
  if (!Array.isArray(parsed.expectedScopes) || parsed.expectedScopes.length === 0 || parsed.expectedScopes.some((scope) => typeof scope !== "string" || !scope.trim())) {
    throw new Error("maintenance manifest expectedScopes must be a non-empty string array");
  }
  if (parsed.expectedScopes.includes("skills:publish")) throw new Error("maintenance manifest must describe current scopes without skills:publish");
  if (Date.parse(parsed.expiresAt!) <= Date.now()) throw new Error("maintenance manifest is expired");
  if (!/^[a-f0-9]{64}$/.test(parsed.manifestDigest!)) throw new Error("maintenance manifest digest must be SHA-256");
  if (sha256(canonical(parsed)) !== parsed.manifestDigest) throw new Error("maintenance manifest digest does not match its bytes");
  return parsed as EnrollmentManifest;
}

export function registerMaintenance(parent: Command): void {
  const maintenance = parent.command("maintenance").description("Run protected, metadata-only Skills maintenance operations");
  maintenance.command("enroll-publish")
    .requiredOption("--manifest <path>", "Immutable operator target manifest supplied by the protected task wrapper")
    .option("--apply", "Commit the bounded scope update; defaults to dry-run", false)
    .option("--json", "Output a safe JSON receipt", false)
    .action(async (options: { manifest: string; apply?: boolean; json?: boolean }) => {
      let manifest: EnrollmentManifest;
      try {
        manifest = readManifest(options.manifest);
        const databaseUrl = process.env.HASNA_SKILLS_DATABASE_URL || process.env.DATABASE_URL;
        if (!databaseUrl) throw new Error("maintenance requires HASNA_SKILLS_DATABASE_URL");
        const store = await createStore({ databaseUrl });
        const snapshot = await store.inspectOperatorScopeTarget?.(manifest.keyId, manifest.orgId);
        if (!snapshot) throw new Error("configured store does not support operator maintenance");
        if (snapshot.kind !== "found") throw new Error(`operator target ${snapshot.kind}`);
        const base = { status: "dry-run", operationId: manifest.operationId, keyId: manifest.keyId, stationId: manifest.stationId, orgId: manifest.orgId, expectedScopes: manifest.expectedScopes, currentScopes: snapshot.scopes, addScopes: ["skills:publish"] };
        if (!options.apply) {
          console.log(JSON.stringify(base));
          await store.close?.();
          return;
        }
        const result = await store.enrollPublishScopeByOperator?.(manifest);
        if (!result) throw new Error("configured store does not support operator maintenance");
        console.log(JSON.stringify({ ...base, status: result.kind, scopes: "scopes" in result ? result.scopes : undefined }));
        await store.close?.();
        if (result.kind === "updated" || result.kind === "already_applied") return;
        process.exitCode = 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "maintenance operation failed";
        if (options.json || !process.stdout.isTTY) console.log(JSON.stringify({ status: "failed", error: message }));
        else console.error(message);
        process.exitCode = 1;
      }
    });
}
