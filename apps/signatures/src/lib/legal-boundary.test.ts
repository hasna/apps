import { describe, expect, test } from "bun:test";
import {
  DEFAULT_WORKFLOW_ONLY_BOUNDARY,
  validateLegalBoundaryPacket,
  type LegalBoundaryPacket,
} from "./legal-boundary.js";

function packet(overrides: Partial<LegalBoundaryPacket> = {}): LegalBoundaryPacket {
  return {
    packetVersion: "hasna.legal-boundary.v1",
    workflowId: "workflow-1",
    document: {
      sourceApp: "iapp-ip",
      sourceId: "portfolio-doc-1",
      documentHash: "sha256:abc123",
      storageUri: "open-files://documents/portfolio-doc-1",
      version: "v1",
      createdBy: "agent-ip",
      createdAt: "2026-07-06T00:00:00.000Z",
    },
    signing: DEFAULT_WORKFLOW_ONLY_BOUNDARY.signing,
    filing: DEFAULT_WORKFLOW_ONLY_BOUNDARY.filing,
    evidenceBundle: {
      certificateId: "cert-1",
      auditEventIds: ["audit-1"],
    },
    ...overrides,
  };
}

describe("legal boundary packet", () => {
  test("accepts workflow-only IP/signature evidence packets", () => {
    expect(validateLegalBoundaryPacket(packet())).toEqual([]);
  });

  test("requires legal approval before prepared filing packets are used externally", () => {
    expect(validateLegalBoundaryPacket(packet({
      filing: { scope: "prepared_packet", legalReview: "required", jurisdiction: "US" },
    }))).toContain("prepared_packet requires approved legalReview before external use");

    expect(validateLegalBoundaryPacket(packet({
      filing: { scope: "prepared_packet", legalReview: "approved", jurisdiction: "US" },
    }))).toEqual([]);
  });

  test("requires provider evidence and filing references for submitted filings", () => {
    const missing = validateLegalBoundaryPacket(packet({
      filing: { scope: "provider_submitted", legalReview: "required", provider: "uspto" },
    }));
    expect(missing).toContain("provider_submitted filing requires filingReference");
    expect(missing).toContain("provider_submitted filing requires approved legalReview");
    expect(missing).toContain("provider_submitted filing requires providerEvidenceId");

    expect(validateLegalBoundaryPacket(packet({
      filing: {
        scope: "provider_submitted",
        legalReview: "approved",
        jurisdiction: "US",
        provider: "uspto",
        filingReference: "USPTO-123",
      },
      evidenceBundle: {
        certificateId: "cert-1",
        providerEvidenceId: "provider-evidence-1",
        auditEventIds: ["audit-1", "audit-2"],
      },
    }))).toEqual([]);
  });

  test("rejects signing packets without identity, consent, certificate, or audit evidence", () => {
    const errors = validateLegalBoundaryPacket(packet({
      signing: {
        ...DEFAULT_WORKFLOW_ONLY_BOUNDARY.signing,
        signerIdentityRequired: false,
        signerConsentRequired: false,
      },
      evidenceBundle: {
        auditEventIds: [],
      },
    }));
    expect(errors).toContain("signer identity is required for legal/IP workflows");
    expect(errors).toContain("signer consent is required for legal/IP workflows");
    expect(errors).toContain("evidence bundle requires certificateId or certificatePath");
    expect(errors).toContain("evidence bundle requires auditEventIds");
  });
});
