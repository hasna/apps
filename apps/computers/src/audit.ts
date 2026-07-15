import { ComputersError, type AuditCheckpoint, type AuditCheckpointSink, type AuditVerification } from "./contracts";
import type { StoragePort } from "./storage";

export class AuditCheckpointManager {
  readonly #storage: StoragePort;
  readonly #sink: AuditCheckpointSink | undefined;

  constructor(storage: StoragePort, sink?: AuditCheckpointSink) { this.#storage = storage; this.#sink = sink; }

  async readiness(): Promise<{ configured: boolean; ready: boolean; independentlyAnchored: boolean; limitations: string[] }> {
    if (this.#sink === undefined) return {
      configured: false, ready: true, independentlyAnchored: false,
      limitations: ["No external checkpoint/WORM sink is configured; the local hash chain is not independently anchored."],
    };
    const readiness = await this.#sink.readiness();
    return { configured: readiness.configured, ready: readiness.ready, independentlyAnchored: readiness.ready && readiness.durable, limitations: readiness.limitations };
  }

  async writeCheckpoint(tenantId: string): Promise<AuditCheckpoint> {
    if (this.#sink === undefined) throw new ComputersError("provider_not_configured", "External audit checkpoint sink is not configured", 503);
    const checkpoint = this.#storage.currentAuditCheckpoint(tenantId);
    if (checkpoint === undefined) throw new ComputersError("not_found", "Audit checkpoint is unavailable", 404);
    await this.#sink.write(checkpoint);
    return checkpoint;
  }

  verify(tenantId: string, checkpoint?: AuditCheckpoint): AuditVerification { return this.#storage.verifyAuditChain(tenantId, checkpoint); }
}
