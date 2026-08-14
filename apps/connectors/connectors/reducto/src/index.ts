// Reducto Connector - Document parsing, extraction, and manipulation via Reducto API
// API key authentication required

export { ReductoClient, getApiKey } from './api';
export type {
  ProfileConfig,
  ReductoConfig,
  OutputFormat,
  BoundingBox,
  BoundingBoxOrigin,
  ChunkingStrategy,
  OutputMode,
  ParseOptions,
  TableCell,
  Table,
  Image,
  Chunk,
  ParseResult,
  FieldDefinition,
  Schema,
  ExtractOptions,
  ExtractResult,
  SplitOptions,
  SplitSegment,
  SplitResult,
  EditOperation,
  FieldEdit,
  EditOptions,
  EditResult,
  JobStatus,
  Document,
  ReductoError,
  AuthenticationError,
} from './types';

// Export config utilities
export {
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  setApiKey,
  clearApiKey,
  clearConfig,
} from './utils/config';
