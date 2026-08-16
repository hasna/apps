import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createProjectChannelRegistrationAuthority,
} from "@hasna/conversations";
import { canonicalJson, sha256 } from "../src/lib/guarded-project-mutation.js";
import {
  deriveProjectRegistrationIdempotencyKey,
  ProjectRegistrationPathHandle,
} from "../src/lib/project-registration.js";
import {
  buildProjectResourceLinkMigrationPlan,
} from "../src/lib/project-resource-link-migrations.js";
import {
  createProductionProjectResourceLinkProducerEvidenceVerifier,
} from "../src/lib/project-resource-link-producer-verifier.js";

const root = mkdtempSync(join(tmpdir(), "projects-installed-producer-authority-"));
const previousDb = process.env["HASNA_CONVERSATIONS_DB_PATH"];
process.env["HASNA_CONVERSATIONS_DB_PATH"] = join(root, "conversations.db");

try {
  const authority = createProjectChannelRegistrationAuthority();
  const capability = await authority.capability();
  const bounds = { response_byte_limit: 100_000, time_budget_ms: 5_000 };
  const operationId = "installed-authority-project-isolation";
  const stepId = "channel-link";
  const projectA = {
    id: "wks_installed_authority_project_a",
    slug: "installed-authority-project-a",
    name: "Installed Authority Project A",
    kind: "generic" as const,
    conversations_channel: "installed-authority-project-a",
  };
  const projectB = {
    id: "wks_installed_authority_project_b",
    slug: "installed-authority-project-b",
    name: "Installed Authority Project B",
    kind: "generic" as const,
    conversations_channel: "installed-authority-project-b",
  };
  const target = ProjectRegistrationPathHandle.fromPath(root);
  const forwardDesired = {
    channel: projectA.conversations_channel,
    project_id: projectA.id,
    project_slug: projectA.slug,
    project_kind: projectA.kind,
  };
  const forwardRequestDigest = sha256(canonicalJson(forwardDesired));
  const forwardPreconditionDigest = sha256(canonicalJson({
    target_selector: projectA.conversations_channel,
    expected: "absent",
  }));
  const forwardRequest = {
    operation_id: operationId,
    step_id: stepId,
    resource_kind: "channel" as const,
    direction: "forward" as const,
    authority_route: capability.route,
    package_version: capability.package_version,
    authority_id: capability.authority_id,
    tenant_id: capability.tenant_id,
    corpus_id: capability.corpus_id,
    target_selector: projectA.conversations_channel,
    idempotency_key: deriveProjectRegistrationIdempotencyKey({
      operation_id: operationId,
      step_id: stepId,
      direction: "forward",
      target_selector: projectA.conversations_channel,
      request_digest: forwardRequestDigest,
      precondition_digest: forwardPreconditionDigest,
    }),
    request_digest: forwardRequestDigest,
    precondition_digest: forwardPreconditionDigest,
    project_id: projectA.id,
    project_slug: projectA.slug,
    project_name: projectA.name,
    desired: forwardDesired,
    target,
    ...bounds,
  };
  const forwardReceipt = await authority.create(forwardRequest);
  if (forwardReceipt.outcome !== "accepted" || !forwardReceipt.target_id) {
    throw new Error(`installed authority did not accept forward request: ${forwardReceipt.outcome}`);
  }
  const record = await authority.readExact({
    resource_kind: "channel",
    target_id: forwardReceipt.target_id,
    target,
    ...bounds,
  });
  const capabilityDigest = sha256(canonicalJson(capability));
  const manifestFor = (project: typeof projectA) => {
    const planned = buildProjectResourceLinkMigrationPlan({
      project_id: project.id,
      operation_id: operationId,
      step_id: stepId,
      expected_project_revision: "2026-08-10T00:00:00.000Z",
      links: [{
        link: {
          authority: "conversations",
          service_instance: "urn:hasna:conversations:installed-authority",
          source_package: "@hasna/conversations",
          target_kind: "channel",
          locator: {
            kind: "conversations_channel_id",
            value: forwardReceipt.target_id!,
          },
          scope: "resource",
          labels: { channel_name: project.conversations_channel },
        },
        producer_resource_kind: "conversations_channel",
        producer_binding: {
          authority_id: capability.authority_id,
          tenant_id: capability.tenant_id,
          corpus_id: capability.corpus_id,
          capability_digest: capabilityDigest,
        },
      }],
      max_items: 1,
      ...bounds,
    }, "2026-08-10T00:00:00.000Z");
    return {
      ...planned,
      links: planned.links.map((item) => ({
        ...item,
        producer_evidence: {
          created_by_operation: true,
          forward_receipt_id: forwardReceipt.receipt_id,
          child_link_receipt_ids: [],
          target_revision: forwardReceipt.result_revision!,
          target_digest: forwardReceipt.result_digest!,
          inverse_verified: null,
          inverse_outcome: null,
        },
      })),
    };
  };
  const manifestA = manifestFor(projectA);
  const manifestB = manifestFor(projectB);
  const readbackEvidence = [{
    created_by_operation: true,
    forward_receipt_id: forwardReceipt.receipt_id,
    child_link_receipt_ids: [],
    target_revision: record.revision,
    target_digest: record.digest,
    inverse_verified: null,
    inverse_outcome: null,
  }];
  const verificationEnvelope = (
    manifest: typeof manifestA,
    project: typeof projectA,
    inverse?: {
      receipt: typeof forwardReceipt;
      desired: Record<string, string | null>;
    },
  ) => ({
    producer_verification: {
      schema: "projects.project_resource_link_producer_verification.v1",
      links: [{
        link_id: manifest.links[0]!.link_id,
        target_context_digest: target.digest,
        target_selector: project.conversations_channel,
        forward_receipt: forwardReceipt,
        ...(inverse
          ? {
              inverse_receipt: inverse.receipt,
              inverse_request: {
                project_slug: project.slug,
                project_name: project.name,
                desired: inverse.desired,
              },
            }
          : {}),
      }],
    },
  });
  const verifier = createProductionProjectResourceLinkProducerEvidenceVerifier({
    authorities: { conversations: authority },
    now: () => "2026-08-10T12:00:00.000Z",
  });

  const forwardAttestation = await verifier({
    manifest: manifestA,
    trusted_project: projectA,
    phase: "readback",
    producer_evidence: readbackEvidence,
    transition_evidence: verificationEnvelope(manifestA, projectA),
    ...bounds,
  });
  console.log(`INSTALLED_AUTHORITY_FORWARD=${forwardAttestation.verifier}`);

  try {
    await verifier({
      manifest: manifestB,
      trusted_project: projectB,
      phase: "readback",
      producer_evidence: readbackEvidence,
      transition_evidence: verificationEnvelope(manifestB, projectB),
      ...bounds,
    });
    console.log("INSTALLED_AUTHORITY_PROJECT_ISOLATION=FAILED");
    process.exitCode = 2;
  } catch (error) {
    console.log(
      `INSTALLED_AUTHORITY_PROJECT_ISOLATION=PASS:${error instanceof Error ? error.message : String(error)}`,
    );
  }

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
  const inverseRequest = {
    ...forwardRequest,
    direction: "inverse" as const,
    target_selector: forwardReceipt.target_id,
    idempotency_key: deriveProjectRegistrationIdempotencyKey({
      operation_id: operationId,
      step_id: stepId,
      direction: "inverse",
      target_selector: forwardReceipt.target_id,
      request_digest: inverseRequestDigest,
      precondition_digest: inversePreconditionDigest,
    }),
    request_digest: inverseRequestDigest,
    precondition_digest: inversePreconditionDigest,
    desired: inverseDesired,
    accepted_receipt: forwardReceipt,
  };
  const inverseReceipt = await authority.compensate(inverseRequest);
  if (inverseReceipt.outcome !== "accepted") {
    throw new Error(`installed authority did not accept inverse request: ${inverseReceipt.outcome}`);
  }
  const inverseEvidence = [{
    ...readbackEvidence[0]!,
    target_revision: inverseReceipt.result_revision!,
    target_digest: inverseReceipt.result_digest!,
    inverse_verified: true,
    inverse_outcome: "complete" as const,
  }];
  const inverseAttestation = await verifier({
    manifest: manifestA,
    trusted_project: projectA,
    phase: "inverse_complete",
    producer_evidence: inverseEvidence,
    transition_evidence: verificationEnvelope(manifestA, projectA, {
      receipt: inverseReceipt,
      desired: inverseDesired,
    }),
    ...bounds,
  });
  console.log(`INSTALLED_AUTHORITY_INVERSE=${inverseAttestation.verifier}`);
} finally {
  if (previousDb === undefined) delete process.env["HASNA_CONVERSATIONS_DB_PATH"];
  else process.env["HASNA_CONVERSATIONS_DB_PATH"] = previousDb;
  rmSync(root, { recursive: true, force: true });
}
