/**
 * Idempotent admission: the submitRun service.
 *
 * Every input that must not change between attempts is frozen into the
 * admission record under one stable run_id: tenant, skill id + version,
 * canonical bundle digest, runtime-image digest, input digest, and the policy
 * + limits the run executes under. A duplicate submission — same
 * Idempotency-Key, or the same (tenant, skill, version, bundle digest, input
 * digest) tuple — returns the existing run instead of minting a second one.
 */

import { createHash } from "node:crypto";
import type { ImageProfileRegistry } from "./image-profile.js";
import { resolveImageProfile } from "./image-profile.js";
import type { RunExecutionStore } from "./storage.js";
import { newRunId } from "./storage.js";
import { EXECUTION_PROTOCOL_VERSION, canonicalJson, type FrozenAdmission, type RunLimits, type RunPolicy, type RuntimeName } from "./types.js";

export interface SubmitRunInput {
  tenantId: string;
  skillId: string;
  skillVersion: string;
  /** Canonical sha256 of the skill bundle. */
  bundleDigest: string;
  input: unknown;
  idempotencyKey: string;
  runtime: RuntimeName;
  /** system_deps declared by the skill manifest. */
  systemDeps?: string[];
  policy?: Partial<RunPolicy>;
  limits?: Partial<RunLimits>;
}

export interface SubmitRunResult {
  run: FrozenAdmission;
  created: boolean;
}

export const DEFAULT_RUN_POLICY: RunPolicy = {
  egress: "deny",
  egressAllowlist: [],
  networkByteCap: 0,
};

export const DEFAULT_RUN_LIMITS: RunLimits = {
  maxDurationMs: 10 * 60 * 1000,
  maxMemoryMb: 512,
  maxCpuUnits: 256,
  maxArtifactsBytes: 10 * 1024 * 1024,
  maxConcurrency: 1,
};

export interface SubmitRunService {
  submit(input: SubmitRunInput): Promise<SubmitRunResult>;
}

export interface SubmitRunServiceOptions {
  store: RunExecutionStore;
  imageProfiles: ImageProfileRegistry;
  now?: () => Date;
}

export function createSubmitRunService(options: SubmitRunServiceOptions): SubmitRunService {
  const { store, imageProfiles } = options;
  const now = options.now ?? (() => new Date());

  return {
    async submit(input) {
      if (!input.idempotencyKey.trim()) throw new Error("admission: idempotencyKey is required");
      const byKey = await store.getRunByKey(input.tenantId, input.idempotencyKey);
      if (byKey) return { run: byKey.admission, created: false };

      const inputDigest = digestInput(input.input);
      const byDigests = await store.getRunByDigests({
        tenantId: input.tenantId,
        skillId: input.skillId,
        skillVersion: input.skillVersion,
        bundleDigest: input.bundleDigest,
        inputDigest: inputDigest,
      });
      if (byDigests) return { run: byDigests.admission, created: false };

      const image = resolveImageProfile(imageProfiles, {
        runtime: input.runtime,
        systemDeps: input.systemDeps ?? [],
      });

      const admission: FrozenAdmission = {
        contractVersion: EXECUTION_PROTOCOL_VERSION,
        runId: newRunId(),
        tenantId: input.tenantId,
        skillId: input.skillId,
        skillVersion: input.skillVersion,
        bundleDigest: input.bundleDigest,
        runtimeImageDigest: image.runtimeImageDigest,
        dependencyLayerTag: image.dependencyLayerTag,
        inputDigest,
        runtime: image.runtime,
        policy: { ...DEFAULT_RUN_POLICY, ...input.policy },
        limits: { ...DEFAULT_RUN_LIMITS, ...input.limits },
        idempotencyKey: input.idempotencyKey,
        createdAt: now().toISOString(),
      };

      const row = await store.admit(admission);
      return { run: row.admission, created: true };
    },
  };
}

/** Canonical digest of a run input: stable serialization, sha256. */
export function digestInput(input: unknown): string {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}
