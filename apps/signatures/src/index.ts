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
} from "./db/signing-sessions.js";

// Stats
export { getStats } from "./db/stats.js";

// Lib
export { search, searchDocuments, searchSignatures } from "./lib/search.js";
export { signPdf } from "./lib/pdf-signer.js";
export { detectSignatureFields } from "./lib/pdf-detector.js";
export { generateTextSignature, generateDrawingSignature } from "./lib/signature-gen.js";
export { storeDocument, getSignaturesDir, getDocumentsDir, getSignedDir, getSignatureImagesDir } from "./lib/files.js";
