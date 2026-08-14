import { randomBytes } from "node:crypto";
import { hashBearerToken } from "./auth";
import {
  ComputersError,
  type ProviderKind,
  type ResidentEnrollment,
  type ResidentIdentity,
  type ResidentOperationEnvelope,
} from "./contracts";
import type { StoragePort } from "./storage";
import { makeId } from "./storage";
import { validateDigest, validateId, validateNonce, validateProvider, validateTimestamp } from "./validation";

export interface EnrollmentSecret {
  enrollment: Omit<ResidentEnrollment, "tokenHash">;
  token: string;
}

export interface ResidentEnrollRequest {
  token: string;
  provider: ProviderKind;
  instanceId: string;
  bootId: string;
}

export interface ResidentEnrollmentResult {
  identity: ResidentIdentity;
  transport: "protocol_only";
  limitations: string[];
}

export class ResidentProtocol {
  readonly #storage: StoragePort;

  constructor(storage: StoragePort) { this.#storage = storage; }

  async precreateEnrollment(tenantId: string, computerId: string, ttlSeconds = 300): Promise<EnrollmentSecret> {
    validateId(tenantId, "tenantId"); validateId(computerId, "computerId");
    if (this.#storage.getComputer(tenantId, computerId) === undefined) throw new ComputersError("not_found", "Computer not found", 404);
    const binding = this.#storage.getResidentBinding(tenantId, computerId);
    if (binding === undefined) throw new ComputersError("authorization_denied", "Resident binding is not configured", 403);
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 900) throw new ComputersError("invalid_request", "Invalid enrollment TTL", 400);
    const enrollmentCredential = randomBytes(32).toString("base64url");
    const enrollment: ResidentEnrollment = {
      id: makeId("enr"), tenantId, computerId, expectedProvider: binding.provider, expectedInstanceId: binding.instanceId,
      expectedBootId: binding.bootId, bindingGeneration: binding.generation, tokenHash: await hashBearerToken(enrollmentCredential),
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    };
    this.#storage.createEnrollment(enrollment);
    const { tokenHash: _omitted, ...publicEnrollment } = enrollment;
    return { enrollment: publicEnrollment, token: enrollmentCredential };
  }

  async enroll(request: ResidentEnrollRequest): Promise<ResidentEnrollmentResult> {
    if (typeof request.token !== "string" || request.token.length < 32 || request.token.length > 256) throw new ComputersError("authentication_required", "Enrollment denied", 401);
    validateProvider(request.provider); validateId(request.instanceId, "instanceId"); validateId(request.bootId, "bootId");
    const now = new Date().toISOString();
    const enrollment = this.#storage.consumeEnrollment(await hashBearerToken(request.token), request.provider, request.instanceId, request.bootId, now);
    const computer = this.#storage.getComputer(enrollment.tenantId, enrollment.computerId);
    if (computer === undefined) throw new ComputersError("authentication_required", "Enrollment denied", 401);
    const identity: ResidentIdentity = {
      certificateId: makeId("crt"), tenantId: enrollment.tenantId, computerId: enrollment.computerId, provider: request.provider,
      instanceId: request.instanceId, bootId: request.bootId, generation: computer.policyGeneration, bindingGeneration: enrollment.bindingGeneration, issuedAt: now,
      expiresAt: new Date(Date.parse(now) + 60 * 60 * 1000).toISOString(),
    };
    this.#storage.saveResidentIdentity(identity);
    return {
      identity, transport: "protocol_only",
      limitations: ["This slice validates protocol state but does not issue an X.509 certificate or provide an mTLS transport.", "No privileged resident daemon is implemented."],
    };
  }

  validateOperation(envelope: ResidentOperationEnvelope): void {
    validateId(envelope.operationId, "operationId"); validateId(envelope.attemptId, "attemptId"); validateId(envelope.tenantId, "tenantId");
    validateId(envelope.computerId, "computerId"); validateId(envelope.certificateId, "certificateId"); validateNonce(envelope.nonce);
    validateTimestamp(envelope.issuedAt, "issuedAt"); validateTimestamp(envelope.expiresAt, "expiresAt");
    validateDigest(envelope.payloadDigest, "payloadDigest");
    if (!["exec", "install", "status", "cancel"].includes(envelope.capability)) throw new ComputersError("invalid_request", "Invalid resident capability", 400);
    if (!Number.isSafeInteger(envelope.policyGeneration) || envelope.policyGeneration < 1 || !Number.isSafeInteger(envelope.fence) || envelope.fence < 0 || !Number.isSafeInteger(envelope.sequence) || envelope.sequence < 0) {
      throw new ComputersError("invalid_request", "Invalid resident operation counters", 400);
    }
    this.#storage.acceptResidentEnvelope(envelope, new Date().toISOString());
  }

  doctor(): Record<string, unknown> {
    return {
      ready: false, protocolValidation: true, privilegedDaemon: false, mtlsTransport: false,
      guestCredentialPolicy: "host, cloud, provider, Sandbox, resident, controller, sudo, Docker and hypervisor credentials are forbidden",
    };
  }
}
