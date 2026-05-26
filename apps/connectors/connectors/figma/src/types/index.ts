// Figma Connector Types

// ============================================
// Configuration
// ============================================

export interface FigmaConfig {
  accessToken: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface PaginatedResponse<T> {
  data: T[];
  cursor?: string;
  hasMore: boolean;
}

// ============================================
// User Types
// ============================================

export interface User {
  id: string;
  handle: string;
  img_url: string;
  email?: string;
}

// ============================================
// File Types
// ============================================

export interface FileResponse {
  name: string;
  role: string;
  lastModified: string;
  editorType: string;
  thumbnailUrl?: string;
  version: string;
  document?: DocumentNode;
  components?: Record<string, Component>;
  componentSets?: Record<string, ComponentSet>;
  schemaVersion: number;
  styles?: Record<string, Style>;
  mainFileKey?: string;
  branches?: Branch[];
}

export interface DocumentNode {
  id: string;
  name: string;
  type: string;
  children?: Node[];
}

export interface Node {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  locked?: boolean;
  children?: Node[];
  absoluteBoundingBox?: Rectangle;
  constraints?: LayoutConstraint;
  fills?: Paint[];
  strokes?: Paint[];
  strokeWeight?: number;
  strokeAlign?: string;
  effects?: Effect[];
  blendMode?: string;
  opacity?: number;
  backgroundColor?: Color;
  exportSettings?: ExportSetting[];
  [key: string]: unknown;
}

export interface FileNodesResponse {
  name: string;
  lastModified: string;
  thumbnailUrl?: string;
  version: string;
  role: string;
  editorType: string;
  nodes: Record<string, {
    document: Node;
    components?: Record<string, Component>;
    schemaVersion: number;
    styles?: Record<string, Style>;
  }>;
}

export interface FileMetaResponse {
  name: string;
  lastModified: string;
  thumbnailUrl?: string;
  version: string;
  role: string;
  editorType: string;
  linkAccess?: string;
  folderName?: string;
  createdAt?: string;
  branches?: Branch[];
}

// ============================================
// Image Types
// ============================================

export interface ImageResponse {
  err: string | null;
  images: Record<string, string | null>;
}

export interface ImageFillsResponse {
  err: string | null;
  meta?: {
    images: Record<string, string>;
  };
}

export type ImageFormat = 'jpg' | 'png' | 'svg' | 'pdf';

export interface ImageExportOptions {
  ids: string[];
  scale?: number;
  format?: ImageFormat;
  svg_include_id?: boolean;
  svg_include_node_id?: boolean;
  svg_simplify_stroke?: boolean;
  use_absolute_bounds?: boolean;
  version?: string;
}

// ============================================
// Comment Types
// ============================================

export interface Comment {
  id: string;
  uuid?: string;
  file_key: string;
  parent_id?: string;
  user: User;
  created_at: string;
  resolved_at?: string;
  message: string;
  client_meta?: ClientMeta;
  order_id?: string;
  reactions?: Reaction[];
}

export interface ClientMeta {
  x?: number;
  y?: number;
  node_id?: string;
  node_offset?: Vector;
}

export interface Reaction {
  user: User;
  emoji: string;
  created_at: string;
}

export interface CommentRequest {
  message: string;
  client_meta?: ClientMeta;
  comment_id?: string;
}

export interface CommentsResponse {
  comments: Comment[];
}

// ============================================
// Project Types
// ============================================

export interface Project {
  id: string;
  name: string;
}

export interface ProjectsResponse {
  name: string;
  projects: Project[];
}

export interface ProjectFile {
  key: string;
  name: string;
  thumbnail_url?: string;
  last_modified: string;
}

export interface ProjectFilesResponse {
  name: string;
  files: ProjectFile[];
}

// ============================================
// Team Types
// ============================================

export interface TeamProject {
  id: string;
  name: string;
}

export interface TeamProjectsResponse {
  name: string;
  projects: TeamProject[];
}

// ============================================
// Component Types
// ============================================

export interface Component {
  key: string;
  file_key?: string;
  node_id?: string;
  thumbnail_url?: string;
  name: string;
  description: string;
  created_at?: string;
  updated_at?: string;
  containing_frame?: FrameInfo;
  user?: User;
}

export interface ComponentSet {
  key: string;
  file_key?: string;
  node_id?: string;
  thumbnail_url?: string;
  name: string;
  description: string;
  created_at?: string;
  updated_at?: string;
  containing_frame?: FrameInfo;
  user?: User;
}

export interface TeamComponentsResponse {
  status?: number;
  error?: boolean;
  meta?: {
    components: Component[];
    cursor?: Record<string, number>;
  };
}

export interface TeamComponentSetsResponse {
  status?: number;
  error?: boolean;
  meta?: {
    component_sets: ComponentSet[];
    cursor?: Record<string, number>;
  };
}

export interface FrameInfo {
  pageId: string;
  pageName: string;
  nodeId?: string;
  name?: string;
  backgroundColor?: Color;
}

// ============================================
// Style Types
// ============================================

export interface Style {
  key: string;
  file_key?: string;
  node_id?: string;
  style_type: StyleType;
  thumbnail_url?: string;
  name: string;
  description: string;
  created_at?: string;
  updated_at?: string;
  user?: User;
  sort_position?: string;
}

export type StyleType = 'FILL' | 'TEXT' | 'EFFECT' | 'GRID';

export interface TeamStylesResponse {
  status?: number;
  error?: boolean;
  meta?: {
    styles: Style[];
    cursor?: Record<string, number>;
  };
}

// ============================================
// Webhook Types
// ============================================

export interface Webhook {
  id: string;
  event_type: WebhookEventType;
  team_id: string;
  status: WebhookStatus;
  client_id?: string;
  passcode: string;
  endpoint: string;
  description?: string;
  protocol_version?: string;
}

export type WebhookEventType =
  | 'FILE_UPDATE'
  | 'FILE_DELETE'
  | 'FILE_VERSION_UPDATE'
  | 'LIBRARY_PUBLISH'
  | 'FILE_COMMENT';

export type WebhookStatus = 'ACTIVE' | 'PAUSED';

export interface WebhookRequest {
  event_type: WebhookEventType;
  team_id: string;
  endpoint: string;
  passcode: string;
  status?: WebhookStatus;
  description?: string;
}

export interface WebhooksResponse {
  webhooks: Webhook[];
}

export interface WebhookRequestsResponse {
  requests: WebhookRequest[];
}

// ============================================
// Common Design Types
// ============================================

export interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface Vector {
  x: number;
  y: number;
}

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutConstraint {
  vertical: string;
  horizontal: string;
}

export interface Paint {
  type: string;
  visible?: boolean;
  opacity?: number;
  color?: Color;
  blendMode?: string;
  gradientHandlePositions?: Vector[];
  gradientStops?: ColorStop[];
  scaleMode?: string;
  imageTransform?: number[][];
  scalingFactor?: number;
  rotation?: number;
  imageRef?: string;
  filters?: ImageFilters;
  gifRef?: string;
}

export interface ColorStop {
  position: number;
  color: Color;
}

export interface ImageFilters {
  exposure?: number;
  contrast?: number;
  saturation?: number;
  temperature?: number;
  tint?: number;
  highlights?: number;
  shadows?: number;
}

export interface Effect {
  type: string;
  visible?: boolean;
  radius?: number;
  color?: Color;
  blendMode?: string;
  offset?: Vector;
  spread?: number;
  showShadowBehindNode?: boolean;
}

export interface ExportSetting {
  suffix: string;
  format: string;
  constraint: ExportConstraint;
}

export interface ExportConstraint {
  type: string;
  value: number;
}

export interface Branch {
  key: string;
  name: string;
  thumbnail_url?: string;
  last_modified: string;
  link_access?: string;
}

// ============================================
// Version Types
// ============================================

export interface Version {
  id: string;
  created_at: string;
  label?: string;
  description?: string;
  user: User;
  thumbnail_url?: string;
}

export interface VersionsResponse {
  versions: Version[];
  pagination?: {
    prev_page?: string;
    next_page?: string;
  };
}

// ============================================
// Variables Types
// ============================================

export interface Variable {
  id: string;
  name: string;
  key: string;
  variableCollectionId: string;
  resolvedType: VariableResolvedType;
  valuesByMode: Record<string, VariableValue>;
  remote?: boolean;
  description?: string;
  hiddenFromPublishing?: boolean;
  scopes?: VariableScope[];
  codeSyntax?: VariableCodeSyntax;
  deletedButReferenced?: boolean;
}

export type VariableResolvedType = 'BOOLEAN' | 'FLOAT' | 'STRING' | 'COLOR';

export type VariableValue = boolean | number | string | Color | VariableAlias;

export interface VariableAlias {
  type: 'VARIABLE_ALIAS';
  id: string;
}

export type VariableScope =
  | 'ALL_SCOPES'
  | 'TEXT_CONTENT'
  | 'CORNER_RADIUS'
  | 'WIDTH_HEIGHT'
  | 'GAP'
  | 'ALL_FILLS'
  | 'FRAME_FILL'
  | 'SHAPE_FILL'
  | 'TEXT_FILL'
  | 'STROKE_COLOR'
  | 'STROKE_FLOAT'
  | 'EFFECT_FLOAT'
  | 'EFFECT_COLOR'
  | 'OPACITY'
  | 'FONT_FAMILY'
  | 'FONT_STYLE'
  | 'FONT_WEIGHT'
  | 'FONT_SIZE'
  | 'LINE_HEIGHT'
  | 'LETTER_SPACING'
  | 'PARAGRAPH_SPACING'
  | 'PARAGRAPH_INDENT';

export interface VariableCodeSyntax {
  WEB?: string;
  ANDROID?: string;
  iOS?: string;
}

export interface VariableCollection {
  id: string;
  name: string;
  key: string;
  modes: VariableMode[];
  defaultModeId: string;
  remote?: boolean;
  hiddenFromPublishing?: boolean;
  variableIds?: string[];
}

export interface VariableMode {
  modeId: string;
  name: string;
}

export interface LocalVariablesResponse {
  status?: number;
  error?: boolean;
  meta?: {
    variables: Record<string, Variable>;
    variableCollections: Record<string, VariableCollection>;
  };
}

export interface PublishedVariablesResponse {
  status?: number;
  error?: boolean;
  meta?: {
    variables: Record<string, Variable>;
    variableCollections: Record<string, VariableCollection>;
  };
}

// ============================================
// Dev Resources Types
// ============================================

export interface DevResource {
  id: string;
  name: string;
  url: string;
  file_key: string;
  node_id: string;
}

export interface DevResourcesResponse {
  dev_resources: DevResource[];
}

export interface DevResourceCreateRequest {
  name: string;
  url: string;
  file_key: string;
  node_id: string;
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class FigmaApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.name = 'FigmaApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}
