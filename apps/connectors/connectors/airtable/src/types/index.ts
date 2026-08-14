// Airtable Connector Types

// ============================================
// Configuration
// ============================================

export interface AirtableConfig {
  accessToken: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export type FieldType =
  | 'singleLineText'
  | 'email'
  | 'url'
  | 'multilineText'
  | 'number'
  | 'percent'
  | 'currency'
  | 'singleSelect'
  | 'multipleSelects'
  | 'singleCollaborator'
  | 'multipleCollaborators'
  | 'multipleRecordLinks'
  | 'date'
  | 'dateTime'
  | 'phoneNumber'
  | 'multipleAttachments'
  | 'checkbox'
  | 'formula'
  | 'createdTime'
  | 'rollup'
  | 'count'
  | 'lookup'
  | 'multipleLookupValues'
  | 'autoNumber'
  | 'barcode'
  | 'rating'
  | 'richText'
  | 'duration'
  | 'lastModifiedTime'
  | 'createdBy'
  | 'lastModifiedBy'
  | 'button'
  | 'externalSyncSource'
  | 'aiText';

// ============================================
// Base Types
// ============================================

export interface Base {
  id: string;
  name: string;
  permissionLevel: 'none' | 'read' | 'comment' | 'edit' | 'create';
}

export interface ListBasesResult {
  bases: Base[];
  offset?: string;
}

export interface BaseSchema {
  tables: Table[];
}

// ============================================
// Table Types
// ============================================

export interface Table {
  id: string;
  name: string;
  description?: string;
  primaryFieldId: string;
  fields: Field[];
  views: View[];
}

export interface Field {
  id: string;
  name: string;
  type: FieldType;
  description?: string;
  options?: FieldOptions;
}

export interface FieldOptions {
  // Single/Multi select options
  choices?: SelectChoice[];
  // Number options
  precision?: number;
  // Currency options
  symbol?: string;
  // Linked record options
  linkedTableId?: string;
  inverseLinkFieldId?: string;
  prefersSingleRecordLink?: boolean;
  // Formula options
  formula?: string;
  result?: { type: FieldType };
  // Rollup options
  recordLinkFieldId?: string;
  fieldIdInLinkedTable?: string;
  referencedFieldIds?: string[];
  // Date options
  dateFormat?: { name: string; format: string };
  timeFormat?: { name: string; format: string };
  timeZone?: string;
  // Rating options
  max?: number;
  icon?: string;
  color?: string;
  // Duration options
  durationFormat?: string;
  // Other options
  [key: string]: unknown;
}

export interface SelectChoice {
  id?: string;
  name: string;
  color?: string;
}

export interface View {
  id: string;
  name: string;
  type: 'grid' | 'form' | 'calendar' | 'gallery' | 'kanban' | 'timeline' | 'block';
}

// ============================================
// Record Types
// ============================================

export interface Record {
  id: string;
  createdTime: string;
  fields: RecordFields;
}

export type RecordFields = { [fieldNameOrId: string]: FieldValue };

export type FieldValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | string[]
  | Attachment[]
  | Collaborator
  | Collaborator[]
  | RecordLink
  | RecordLink[]
  | { [key: string]: unknown };

export interface Attachment {
  id: string;
  url: string;
  filename: string;
  size: number;
  type: string;
  width?: number;
  height?: number;
  thumbnails?: {
    small?: Thumbnail;
    large?: Thumbnail;
    full?: Thumbnail;
  };
}

export interface Thumbnail {
  url: string;
  width: number;
  height: number;
}

export interface Collaborator {
  id: string;
  email: string;
  name?: string;
}

export interface RecordLink {
  id: string;
  name?: string;
}

export interface ListRecordsResult {
  records: Record[];
  offset?: string;
}

export interface CreateRecordResult {
  id: string;
  createdTime: string;
  fields: RecordFields;
}

export interface UpdateRecordResult {
  id: string;
  createdTime: string;
  fields: RecordFields;
}

export interface DeleteRecordResult {
  deleted: boolean;
  id: string;
}

export interface BatchCreateResult {
  records: CreateRecordResult[];
}

export interface BatchUpdateResult {
  records: UpdateRecordResult[];
}

export interface BatchDeleteResult {
  records: DeleteRecordResult[];
}

// ============================================
// Comment Types
// ============================================

export interface Comment {
  id: string;
  author: {
    id: string;
    email: string;
    name?: string;
  };
  createdTime: string;
  text: string;
  mentioned?: { [userId: string]: string };
}

export interface ListCommentsResult {
  comments: Comment[];
  offset?: string;
}

// ============================================
// Webhook Types
// ============================================

export interface Webhook {
  id: string;
  macSecretBase64: string;
  notificationUrl?: string;
  cursorForNextPayload?: number;
  areNotificationsEnabled: boolean;
  isHookEnabled: boolean;
  expirationTime?: string;
  specification: WebhookSpecification;
}

export interface WebhookSpecification {
  options: {
    filters: {
      dataTypes?: ('tableData' | 'tableFields' | 'tableMetadata')[];
      recordChangeScope?: string;
      watchDataInFieldIds?: string[];
      watchSchemasOfFieldIds?: string[];
      sourceOptions?: {
        formSubmission?: {
          viewId: string;
        };
      };
    };
    includes?: {
      includePreviousCellValues?: boolean;
      includePreviousFieldDefinitions?: boolean;
    };
  };
}

export interface ListWebhooksResult {
  webhooks: Webhook[];
}

export interface WebhookPayload {
  timestamp: string;
  baseTransactionNumber: number;
  payloadFormat: 'v0';
  actionMetadata: {
    source: 'client' | 'automation' | 'formSubmission' | 'publicApi' | 'sync' | 'system';
    sourceMetadata?: {
      user?: { id: string; email: string; name?: string };
      automation?: { id: string; name?: string };
      view?: { id: string; name?: string };
    };
  };
  changedTablesById: { [tableId: string]: TableChange };
  createdTablesById?: { [tableId: string]: CreatedTable };
  destroyedTableIds?: string[];
}

export interface TableChange {
  changedRecordsById?: { [recordId: string]: RecordChange };
  createdRecordsById?: { [recordId: string]: { cellValuesByFieldId: RecordFields; createdTime: string } };
  destroyedRecordIds?: string[];
  changedFieldsById?: { [fieldId: string]: { current: Field; previous?: Field } };
  createdFieldsById?: { [fieldId: string]: Field };
  destroyedFieldIds?: string[];
  changedMetadata?: { current: { name?: string; description?: string }; previous?: { name?: string; description?: string } };
}

export interface RecordChange {
  current: { cellValuesByFieldId: RecordFields };
  previous?: { cellValuesByFieldId: RecordFields };
  unchanged?: { cellValuesByFieldId: RecordFields };
}

export interface CreatedTable {
  metadata: { name: string; description?: string };
  fieldsById: { [fieldId: string]: Field };
  recordsById: { [recordId: string]: { cellValuesByFieldId: RecordFields; createdTime: string } };
}

// ============================================
// API Error Types
// ============================================

export interface AirtableErrorResponse {
  error?: {
    type: string;
    message: string;
  };
}

export class AirtableApiError extends Error {
  public readonly statusCode: number;
  public readonly errorType?: string;

  constructor(message: string, statusCode: number, errorType?: string) {
    super(message);
    this.name = 'AirtableApiError';
    this.statusCode = statusCode;
    this.errorType = errorType;
  }
}
