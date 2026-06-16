// Types
export * from "./types/index.js";

// Database
export { getDatabase, closeDatabase } from "./db/database.js";

// Projects
export {
  createProject,
  getProjectById,
  getProjectBySlug,
  listProjects,
  updateProject,
  deleteProject,
} from "./db/projects.js";

// Collections
export {
  createCollection,
  getCollectionById,
  listCollections,
  updateCollection,
  deleteCollection,
} from "./db/collections.js";

// Tags
export {
  createTag,
  getTagById,
  getTagByName,
  listTags,
  getOrCreateTag,
  addTagToDocument,
  removeTagFromDocument,
  getTagsForDocument,
  deleteTag,
} from "./db/tags.js";

// Documents
export {
  createDocument,
  getDocumentById,
  getDocumentBySlug,
  getDocumentByIdOrSlug,
  listDocuments,
  updateDocument,
  deleteDocument,
} from "./db/documents.js";

// Signatures
export {
  createSignature,
  getSignatureById,
  listSignatures,
  updateSignature,
  deleteSignature,
} from "./db/signatures.js";

// Signature Fields
export {
  createSignatureField,
  getFieldById,
  listFieldsForDocument,
  deleteFieldsForDocument,
  deleteField,
} from "./db/signature-fields.js";

// Signature Placements
export {
  createPlacement,
  getPlacementById,
  listPlacementsForDocument,
  deletePlacement,
} from "./db/signature-placements.js";

// Signing Sessions
export {
  createSigningSession,
  getSessionById,
  getSessionByToken,
  listSessionsForDocument,
  updateSessionStatus,
  updateSessionAttachment,
  updateSessionSigningUrl,
  updateSessionCompletion,
} from "./db/signing-sessions.js";

export {
  createPerson,
  getPersonById,
  getPersonByEmail,
  getPersonByIdOrEmail,
  listPeople,
  updatePerson,
  deletePerson,
} from "./db/people.js";

export {
  createAuditEvent,
  getAuditEvent,
  listAuditEvents,
} from "./db/audit-events.js";

export {
  createSigningCertificate,
  getSigningCertificateById,
  getSigningCertificateBySession,
  listSigningCertificates,
} from "./db/certificates.js";

// Settings
export {
  getSetting,
  setSetting,
  deleteSetting,
  getAllSettings,
} from "./db/settings.js";

// Stats
export { getStats } from "./db/stats.js";

// Lib
export { search, searchDocuments, searchSignatures } from "./lib/search.js";
export { signPdf } from "./lib/pdf-signer.js";
export { detectSignatureFields } from "./lib/pdf-detector.js";
export { generateTextSignature, generateDrawingSignature } from "./lib/signature-gen.js";
export { storeDocument, getSignaturesDir, getDocumentsDir, getSignedDir, getSignatureImagesDir, getCertificatesDir, getRenderedDir } from "./lib/files.js";
export { signWithBrowseruse, registerSigningSession, completeSigningSession } from "./lib/connector-integration.js";
export { detectFieldsHeuristic, detectSignatureFieldsOnPage, isCerebrasConfigured } from "./lib/pdf-detector.js";
export { renderPageToPng, renderPageToBase64, getPageCount } from "./lib/pdf-renderer.js";
export { shareDocument, receiveDocument, isAttachmentsConfigured } from "./lib/attachments-integration.js";
export type { ShareOptions, SharedDocument } from "./lib/attachments-integration.js";
export { renderMarkdown, renderMarkdownFile, renderTemplateVariables, parseVariables, parseSignatureAnchors, parseCliVariables } from "./lib/markdown-template.js";
export { renderMarkdownToPdf, renderMarkdownFileToPdf } from "./lib/markdown-pdf.js";
export type { MarkdownPdfResult, RenderedSignatureField } from "./lib/markdown-pdf.js";
export { createCompletionCertificate } from "./lib/certificate.js";
export { createDocumentFromMarkdown, signDocumentLocally, sendDocumentForSignature } from "./lib/workflow.js";
export { sendSigningEmail } from "./lib/email-integration.js";
export { setupSigningDomain } from "./lib/domain-integration.js";
export { sendWithProvider } from "./lib/provider-integration.js";
