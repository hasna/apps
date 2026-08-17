import type {
  ProjectRegistrationAuthorityAdapter,
  ProjectRegistrationAuthorityCapability,
  ProjectRegistrationAuthorityReceipt,
  ProjectRegistrationAuthorityRecord,
} from "./project-registration.js";
import { deriveProjectRegistrationIdempotencyKey } from "./project-registration.js";
import { canonicalJson, sha256 } from "./guarded-project-mutation.js";
import type {
  JsonObject,
  ProjectResourceLinkProducerEvidence,
  WorkspaceKind,
} from "../types/workspace.js";
import type {
  ProductionProjectRegistrationAuthorityOptions,
} from "./production-project-registration-authorities.js";

export const TEST_PRODUCER_VERIFIER_NOW = "2026-08-10T12:00:00.000Z";

interface TestConversationsProducerFixtureOptions {
  operationId: string;
  stepId: string;
  targetId: string;
  projectId: string;
  projectSlug: string;
  projectName: string;
  projectKind: WorkspaceKind;
}

export function testConversationsProducerFixture(
  options: TestConversationsProducerFixtureOptions,
) {
  const capability: ProjectRegistrationAuthorityCapability = {
    authority: "conversations",
    route: "conversations.project-channel-registration.v1",
    package_version: "0.5.41",
    authority_id: "conversations",
    tenant_id: "tenant-primary",
    corpus_id: "corpus-primary",
    supported_resources: ["channel"],
    conditional_create: true,
    immutable_receipts: true,
    exact_terminal_lookup: true,
    exact_readback: true,
    conditional_inverse: true,
    ambiguous_outcome_reconciliation: true,
  };
  const targetContextDigest = sha256(canonicalJson({
    authority: capability.authority,
    target_id: options.targetId,
  }));
  const targetSelector = options.projectSlug;
  const forwardDesired = {
    channel: targetSelector,
    project_id: options.projectId,
    project_slug: options.projectSlug,
    project_kind: options.projectKind,
  };
  const forwardRequestDigest = sha256(canonicalJson(forwardDesired));
  const forwardPreconditionDigest = sha256(canonicalJson({
    target_selector: targetSelector,
    expected: "absent",
  }));
  const forwardReceipt: ProjectRegistrationAuthorityReceipt = {
    receipt_id: "conversations-forward-receipt",
    authority: "conversations",
    route: capability.route,
    package_version: capability.package_version,
    authority_id: capability.authority_id,
    tenant_id: capability.tenant_id,
    corpus_id: capability.corpus_id,
    operation_id: options.operationId,
    step_id: options.stepId,
    resource_kind: "channel",
    direction: "forward",
    idempotency_key: deriveProjectRegistrationIdempotencyKey({
      operation_id: options.operationId,
      step_id: options.stepId,
      direction: "forward",
      target_selector: targetSelector,
      request_digest: forwardRequestDigest,
      precondition_digest: forwardPreconditionDigest,
    }),
    request_digest: forwardRequestDigest,
    precondition_digest: forwardPreconditionDigest,
    outcome: "accepted",
    reason: null,
    target_id: options.targetId,
    result_revision: "conversations-revision-1",
    result_digest: "sha256:conversations-target-1",
    duplicate_of_receipt_id: null,
    accepted_receipt_id: null,
    created_by_operation: true,
    created_at: "2026-08-10T11:00:00.000Z",
  };
  const inverseDesired = {
    accepted_receipt_id: forwardReceipt.receipt_id,
    target_id: forwardReceipt.target_id,
  };
  const inverseRequestDigest = sha256(canonicalJson(inverseDesired));
  const inversePreconditionDigest = sha256(canonicalJson({
    target_id: forwardReceipt.target_id,
    expected_revision: forwardReceipt.result_revision,
    expected_digest: forwardReceipt.result_digest,
  }));
  const inverseReceipt: ProjectRegistrationAuthorityReceipt = {
    ...forwardReceipt,
    receipt_id: "conversations-inverse-receipt",
    direction: "inverse",
    idempotency_key: deriveProjectRegistrationIdempotencyKey({
      operation_id: options.operationId,
      step_id: options.stepId,
      direction: "inverse",
      target_selector: options.targetId,
      request_digest: inverseRequestDigest,
      precondition_digest: inversePreconditionDigest,
    }),
    request_digest: inverseRequestDigest,
    precondition_digest: inversePreconditionDigest,
    result_revision: "conversations-revision-3",
    result_digest: "sha256:conversations-target-3",
    accepted_receipt_id: forwardReceipt.receipt_id,
    created_by_operation: false,
    created_at: "2026-08-10T11:30:00.000Z",
  };
  let record: ProjectRegistrationAuthorityRecord = {
    target_id: options.targetId,
    revision: "conversations-revision-2",
    digest: "sha256:conversations-target-2",
  };
  const calls: string[] = [];
  const responseControl = {
    response_byte_limit: 100_000,
    time_budget_ms: 5_000,
    response_bytes: 1_000,
    elapsed_ms: 1,
    complete: true,
    truncated: false,
  };
  const authority: ProjectRegistrationAuthorityAdapter = {
    authority: "conversations",
    async capability() {
      calls.push("capability");
      return capability;
    },
    async lookupReceipt(request) {
      calls.push(`lookup:${request.direction}`);
      const stored = request.direction === "forward" ? forwardReceipt : inverseReceipt;
      const expectedTargetSelector = request.direction === "forward"
        ? targetSelector
        : options.targetId;
      if (
        request.target_selector !== expectedTargetSelector
        || request.idempotency_key !== stored.idempotency_key
        || request.request_digest !== stored.request_digest
        || request.precondition_digest !== stored.precondition_digest
      ) {
        throw new Error("unexpected trusted receipt lookup request");
      }
      return {
        receipt: stored,
        response_control: { ...responseControl, ...request },
      };
    },
    async readExact(request) {
      calls.push("readExact");
      if (request.target_id !== record.target_id) throw new Error("unexpected target readback");
      return { ...record };
    },
    async verifyInverse(request) {
      calls.push("verifyInverse");
      if (
        request.accepted_receipt?.receipt_id !== forwardReceipt.receipt_id
        || request.project_id !== options.projectId
        || request.project_slug !== options.projectSlug
        || request.project_name !== options.projectName
        || request.target_selector !== options.targetId
        || request.idempotency_key !== inverseReceipt.idempotency_key
        || request.request_digest !== inverseReceipt.request_digest
        || request.precondition_digest !== inverseReceipt.precondition_digest
        || canonicalJson(request.desired) !== canonicalJson(inverseDesired)
      ) {
        throw new Error("unexpected accepted receipt");
      }
      return {
        target_id: options.targetId,
        accepted_receipt_id: forwardReceipt.receipt_id,
        absent: true,
        digest: sha256(canonicalJson({
          target_id: options.targetId,
          accepted_receipt_id: forwardReceipt.receipt_id,
          absent: true,
        })),
      };
    },
    async create() {
      throw new Error("unexpected create");
    },
    async compensate() {
      throw new Error("unexpected compensate");
    },
  };

  function producerEvidence(
    phase: "forward" | "readback" | "inverse",
  ): ProjectResourceLinkProducerEvidence[] {
    if (phase === "forward") {
      return [{
        created_by_operation: true,
        forward_receipt_id: forwardReceipt.receipt_id,
        child_link_receipt_ids: [],
        target_revision: forwardReceipt.result_revision!,
        target_digest: forwardReceipt.result_digest!,
        inverse_verified: null,
        inverse_outcome: null,
      }];
    }
    if (phase === "readback") {
      return [{
        ...producerEvidence("forward")[0]!,
        target_revision: record.revision,
        target_digest: record.digest,
      }];
    }
    return [{
      ...producerEvidence("readback")[0]!,
      target_revision: inverseReceipt.result_revision!,
      target_digest: inverseReceipt.result_digest!,
      inverse_verified: true,
      inverse_outcome: "complete",
    }];
  }

  function verificationEvidence(
    linkId: string,
    optionsOverride: {
      inverse?: boolean;
      forwardReceipt?: ProjectRegistrationAuthorityReceipt;
    } = {},
  ): JsonObject {
    return {
      producer_verification: {
        schema: "projects.project_resource_link_producer_verification.v1",
        links: [{
          link_id: linkId,
          target_context_digest: targetContextDigest,
          target_selector: targetSelector,
          forward_receipt: optionsOverride.forwardReceipt ?? forwardReceipt,
          ...(optionsOverride.inverse
            ? {
                inverse_receipt: inverseReceipt,
                inverse_request: {
                  project_slug: options.projectSlug,
                  project_name: options.projectName,
                  desired: inverseDesired,
                },
              }
            : {}),
        }],
      },
    };
  }

  return {
    authorityOptions: {
      env: {
        HASNA_CONVERSATIONS_DB_PATH: "/test/conversations.db",
      },
      importModule: async (specifier: string): Promise<unknown> => {
        if (specifier !== "@hasna/conversations") {
          throw new Error(`unexpected authority module import: ${specifier}`);
        }
        return {
          createProjectChannelRegistrationAuthority: () => authority,
        };
      },
    } satisfies ProductionProjectRegistrationAuthorityOptions,
    capability,
    capabilityDigest: sha256(canonicalJson(capability)),
    calls,
    forwardReceipt,
    inverseReceipt,
    producerEvidence,
    setRecord(next: ProjectRegistrationAuthorityRecord) {
      record = { ...next };
    },
    verificationEvidence,
  };
}
