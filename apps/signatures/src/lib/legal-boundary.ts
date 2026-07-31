export type FilingScope = "workflow_only" | "prepared_packet" | "provider_submitted";
export type LegalReviewStatus = "not_required" | "required" | "approved" | "rejected";

export interface DocumentProvenanceRef {
  sourceApp: "signatures" | "iapp-ip" | "iapp-trademarks" | "open-contracts" | "open-files" | string;
  sourceId: string;
  documentHash: string;
  storageUri?: string;
  version?: string;
  createdBy?: string;
  createdAt: string;
}

export interface SigningCeremonyRequirements {
  signerIdentityRequired: boolean;
  signerConsentRequired: boolean;
  documentHashPinned: boolean;
  auditCertificateRequired: boolean;
  tamperEvidenceRequired: boolean;
  retentionPolicy: "local-evidence" | "legal-hold" | "provider-retained";
}

export interface FilingBoundary {
  scope: FilingScope;
  jurisdiction?: string;
  provider?: string;
  legalReview: LegalReviewStatus;
  docketDeadline?: string;
  filingReference?: string;
}

export interface LegalBoundaryPacket {
  packetVersion: "hasna.legal-boundary.v1";
  workflowId: string;
  document: DocumentProvenanceRef;
  signing: SigningCeremonyRequirements;
  filing: FilingBoundary;
  evidenceBundle: {
    signedDocumentHash?: string;
    certificateId?: string;
    certificatePath?: string;
    auditEventIds: string[];
    providerEvidenceId?: string;
  };
}

export const DEFAULT_WORKFLOW_ONLY_BOUNDARY: Pick<LegalBoundaryPacket, "packetVersion" | "signing" | "filing"> = {
  packetVersion: "hasna.legal-boundary.v1",
  signing: {
    signerIdentityRequired: true,
    signerConsentRequired: true,
    documentHashPinned: true,
    auditCertificateRequired: true,
    tamperEvidenceRequired: true,
    retentionPolicy: "local-evidence",
  },
  filing: {
    scope: "workflow_only",
    legalReview: "required",
  },
};

export function validateLegalBoundaryPacket(packet: LegalBoundaryPacket): string[] {
  const errors: string[] = [];
  if (packet.packetVersion !== "hasna.legal-boundary.v1") errors.push("packetVersion must be hasna.legal-boundary.v1");
  if (!packet.workflowId) errors.push("workflowId is required");
  if (!packet.document?.sourceApp) errors.push("document.sourceApp is required");
  if (!packet.document?.sourceId) errors.push("document.sourceId is required");
  if (!packet.document?.documentHash) errors.push("document.documentHash is required");
  if (!packet.document?.createdAt) errors.push("document.createdAt is required");
  if (!packet.signing) errors.push("signing is required");
  if (!packet.filing) errors.push("filing is required");
  if (!packet.evidenceBundle) errors.push("evidenceBundle is required");
  if (!packet.signing || !packet.filing || !packet.evidenceBundle) return errors;
  if (!packet.signing.signerIdentityRequired) errors.push("signer identity is required for legal/IP workflows");
  if (!packet.signing.signerConsentRequired) errors.push("signer consent is required for legal/IP workflows");
  if (!packet.signing.documentHashPinned) errors.push("document hash must be pinned before signing");
  if (!packet.signing.auditCertificateRequired) errors.push("audit certificate is required");
  if (!packet.signing.tamperEvidenceRequired) errors.push("tamper evidence is required");
  if (packet.filing.scope === "provider_submitted") {
    if (!packet.filing.provider) errors.push("provider_submitted filing requires provider");
    if (!packet.filing.filingReference) errors.push("provider_submitted filing requires filingReference");
    if (packet.filing.legalReview !== "approved") errors.push("provider_submitted filing requires approved legalReview");
    if (!packet.evidenceBundle.providerEvidenceId) errors.push("provider_submitted filing requires providerEvidenceId");
  }
  if (packet.filing.scope === "prepared_packet" && packet.filing.legalReview !== "approved") {
    errors.push("prepared_packet requires approved legalReview before external use");
  }
  if (!packet.evidenceBundle.certificateId && !packet.evidenceBundle.certificatePath) {
    errors.push("evidence bundle requires certificateId or certificatePath");
  }
  if (!Array.isArray(packet.evidenceBundle.auditEventIds) || packet.evidenceBundle.auditEventIds.length === 0) {
    errors.push("evidence bundle requires auditEventIds");
  }
  return errors;
}
