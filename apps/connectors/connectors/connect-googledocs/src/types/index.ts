// Google Docs API Types
// Based on Google Docs API v1

// ============================================
// Configuration
// ============================================

export interface GoogleDocsConfig {
  apiKey?: string;        // API key for read-only public documents
  accessToken?: string;   // OAuth2 access token for full access
  baseUrl?: string;       // Override default base URL
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

// ============================================
// Document Types
// ============================================

export interface Document {
  documentId: string;
  title: string;
  body?: Body;
  headers?: Record<string, Header>;
  footers?: Record<string, Footer>;
  footnotes?: Record<string, Footnote>;
  documentStyle?: DocumentStyle;
  namedStyles?: NamedStyles;
  revisionId?: string;
  suggestionsViewMode?: SuggestionsViewMode;
  inlineObjects?: Record<string, InlineObject>;
  lists?: Record<string, List>;
}

export type SuggestionsViewMode =
  | 'DEFAULT_FOR_CURRENT_ACCESS'
  | 'SUGGESTIONS_INLINE'
  | 'PREVIEW_SUGGESTIONS_ACCEPTED'
  | 'PREVIEW_WITHOUT_SUGGESTIONS';

export interface Body {
  content?: StructuralElement[];
}

export interface Header {
  headerId: string;
  content?: StructuralElement[];
}

export interface Footer {
  footerId: string;
  content?: StructuralElement[];
}

export interface Footnote {
  footnoteId: string;
  content?: StructuralElement[];
}

export interface StructuralElement {
  startIndex?: number;
  endIndex?: number;
  paragraph?: Paragraph;
  sectionBreak?: SectionBreak;
  table?: Table;
  tableOfContents?: TableOfContents;
}

export interface Paragraph {
  elements?: ParagraphElement[];
  paragraphStyle?: ParagraphStyle;
  bullet?: Bullet;
}

export interface ParagraphElement {
  startIndex?: number;
  endIndex?: number;
  textRun?: TextRun;
  inlineObjectElement?: InlineObjectElement;
  pageBreak?: PageBreak;
  horizontalRule?: HorizontalRule;
  footnoteReference?: FootnoteReference;
  autoText?: AutoText;
  columnBreak?: ColumnBreak;
  equation?: Equation;
  richLink?: RichLink;
  person?: Person;
}

export interface TextRun {
  content?: string;
  textStyle?: TextStyle;
}

export interface TextStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  smallCaps?: boolean;
  backgroundColor?: OptionalColor;
  foregroundColor?: OptionalColor;
  fontSize?: Dimension;
  weightedFontFamily?: WeightedFontFamily;
  baselineOffset?: BaselineOffset;
  link?: Link;
}

export type BaselineOffset = 'BASELINE_OFFSET_UNSPECIFIED' | 'NONE' | 'SUPERSCRIPT' | 'SUBSCRIPT';

export interface OptionalColor {
  color?: Color;
}

export interface Color {
  rgbColor?: RgbColor;
}

export interface RgbColor {
  red?: number;
  green?: number;
  blue?: number;
}

export interface Dimension {
  magnitude?: number;
  unit?: Unit;
}

export type Unit = 'UNIT_UNSPECIFIED' | 'PT';

export interface WeightedFontFamily {
  fontFamily?: string;
  weight?: number;
}

export interface Link {
  url?: string;
  bookmarkId?: string;
  headingId?: string;
}

export interface ParagraphStyle {
  headingId?: string;
  namedStyleType?: NamedStyleType;
  alignment?: Alignment;
  lineSpacing?: number;
  direction?: Direction;
  spacingMode?: SpacingMode;
  spaceAbove?: Dimension;
  spaceBelow?: Dimension;
  borderBetween?: ParagraphBorder;
  borderTop?: ParagraphBorder;
  borderBottom?: ParagraphBorder;
  borderLeft?: ParagraphBorder;
  borderRight?: ParagraphBorder;
  indentFirstLine?: Dimension;
  indentStart?: Dimension;
  indentEnd?: Dimension;
  tabStops?: TabStop[];
  keepLinesTogether?: boolean;
  keepWithNext?: boolean;
  avoidWidowAndOrphan?: boolean;
  shading?: Shading;
  pageBreakBefore?: boolean;
}

export type NamedStyleType =
  | 'NAMED_STYLE_TYPE_UNSPECIFIED'
  | 'NORMAL_TEXT'
  | 'TITLE'
  | 'SUBTITLE'
  | 'HEADING_1'
  | 'HEADING_2'
  | 'HEADING_3'
  | 'HEADING_4'
  | 'HEADING_5'
  | 'HEADING_6';

export type Alignment = 'ALIGNMENT_UNSPECIFIED' | 'START' | 'CENTER' | 'END' | 'JUSTIFIED';

export type Direction = 'CONTENT_DIRECTION_UNSPECIFIED' | 'LEFT_TO_RIGHT' | 'RIGHT_TO_LEFT';

export type SpacingMode = 'SPACING_MODE_UNSPECIFIED' | 'NEVER_COLLAPSE' | 'COLLAPSE_LISTS';

export interface ParagraphBorder {
  color?: OptionalColor;
  width?: Dimension;
  padding?: Dimension;
  dashStyle?: DashStyle;
}

export type DashStyle = 'DASH_STYLE_UNSPECIFIED' | 'SOLID' | 'DOT' | 'DASH';

export interface TabStop {
  offset?: Dimension;
  alignment?: TabStopAlignment;
}

export type TabStopAlignment = 'TAB_STOP_ALIGNMENT_UNSPECIFIED' | 'START' | 'CENTER' | 'END';

export interface Shading {
  backgroundColor?: OptionalColor;
}

export interface Bullet {
  listId?: string;
  nestingLevel?: number;
  textStyle?: TextStyle;
}

export interface SectionBreak {
  sectionStyle?: SectionStyle;
}

export interface SectionStyle {
  columnSeparatorStyle?: ColumnSeparatorStyle;
  contentDirection?: Direction;
  sectionType?: SectionType;
}

export type ColumnSeparatorStyle = 'COLUMN_SEPARATOR_STYLE_UNSPECIFIED' | 'NONE' | 'BETWEEN_EACH_COLUMN';

export type SectionType = 'SECTION_TYPE_UNSPECIFIED' | 'CONTINUOUS' | 'NEXT_PAGE';

export interface Table {
  rows?: number;
  columns?: number;
  tableRows?: TableRow[];
  tableStyle?: TableStyle;
}

export interface TableRow {
  startIndex?: number;
  endIndex?: number;
  tableCells?: TableCell[];
  tableRowStyle?: TableRowStyle;
}

export interface TableCell {
  startIndex?: number;
  endIndex?: number;
  content?: StructuralElement[];
  tableCellStyle?: TableCellStyle;
}

export interface TableRowStyle {
  minRowHeight?: Dimension;
}

export interface TableCellStyle {
  rowSpan?: number;
  columnSpan?: number;
  backgroundColor?: OptionalColor;
  borderLeft?: TableCellBorder;
  borderRight?: TableCellBorder;
  borderTop?: TableCellBorder;
  borderBottom?: TableCellBorder;
  paddingLeft?: Dimension;
  paddingRight?: Dimension;
  paddingTop?: Dimension;
  paddingBottom?: Dimension;
  contentAlignment?: ContentAlignment;
}

export type ContentAlignment = 'CONTENT_ALIGNMENT_UNSPECIFIED' | 'CONTENT_ALIGNMENT_UNSUPPORTED' | 'TOP' | 'MIDDLE' | 'BOTTOM';

export interface TableCellBorder {
  color?: OptionalColor;
  width?: Dimension;
  dashStyle?: DashStyle;
}

export interface TableStyle {
  tableColumnProperties?: TableColumnProperties[];
}

export interface TableColumnProperties {
  widthType?: WidthType;
  width?: Dimension;
}

export type WidthType = 'WIDTH_TYPE_UNSPECIFIED' | 'EVENLY_DISTRIBUTED' | 'FIXED_WIDTH';

export interface TableOfContents {
  content?: StructuralElement[];
}

export interface InlineObjectElement {
  inlineObjectId?: string;
  textStyle?: TextStyle;
}

export interface PageBreak {
  textStyle?: TextStyle;
}

export interface HorizontalRule {
  textStyle?: TextStyle;
}

export interface FootnoteReference {
  footnoteId?: string;
  footnoteNumber?: string;
  textStyle?: TextStyle;
}

export interface AutoText {
  type?: AutoTextType;
  textStyle?: TextStyle;
}

export type AutoTextType = 'TYPE_UNSPECIFIED' | 'PAGE_NUMBER' | 'PAGE_COUNT';

export interface ColumnBreak {
  textStyle?: TextStyle;
}

export interface Equation {
  // Equation is read-only
}

export interface RichLink {
  richLinkId?: string;
  textStyle?: TextStyle;
  richLinkProperties?: RichLinkProperties;
}

export interface RichLinkProperties {
  title?: string;
  uri?: string;
  mimeType?: string;
}

export interface Person {
  personId?: string;
  personProperties?: PersonProperties;
  textStyle?: TextStyle;
}

export interface PersonProperties {
  name?: string;
  email?: string;
}

export interface InlineObject {
  objectId?: string;
  inlineObjectProperties?: InlineObjectProperties;
}

export interface InlineObjectProperties {
  embeddedObject?: EmbeddedObject;
}

export interface EmbeddedObject {
  title?: string;
  description?: string;
  embeddedObjectBorder?: EmbeddedObjectBorder;
  size?: Size;
  marginTop?: Dimension;
  marginBottom?: Dimension;
  marginRight?: Dimension;
  marginLeft?: Dimension;
  linkedContentReference?: LinkedContentReference;
  imageProperties?: ImageProperties;
  embeddedDrawingProperties?: EmbeddedDrawingProperties;
}

export interface EmbeddedObjectBorder {
  color?: OptionalColor;
  width?: Dimension;
  dashStyle?: DashStyle;
  propertyState?: PropertyState;
}

export type PropertyState = 'RENDERED' | 'NOT_RENDERED';

export interface Size {
  width?: Dimension;
  height?: Dimension;
}

export interface LinkedContentReference {
  sheetsChartReference?: SheetsChartReference;
}

export interface SheetsChartReference {
  spreadsheetId?: string;
  chartId?: number;
}

export interface ImageProperties {
  contentUri?: string;
  sourceUri?: string;
  brightness?: number;
  contrast?: number;
  transparency?: number;
  cropProperties?: CropProperties;
  angle?: number;
}

export interface CropProperties {
  offsetLeft?: number;
  offsetRight?: number;
  offsetTop?: number;
  offsetBottom?: number;
  angle?: number;
}

export interface EmbeddedDrawingProperties {
  // Read-only
}

export interface List {
  listProperties?: ListProperties;
}

export interface ListProperties {
  nestingLevels?: NestingLevel[];
}

export interface NestingLevel {
  bulletAlignment?: BulletAlignment;
  glyphType?: GlyphType;
  glyphFormat?: string;
  indentFirstLine?: Dimension;
  indentStart?: Dimension;
  textStyle?: TextStyle;
  startNumber?: number;
}

export type BulletAlignment = 'BULLET_ALIGNMENT_UNSPECIFIED' | 'START' | 'CENTER' | 'END';

export type GlyphType =
  | 'GLYPH_TYPE_UNSPECIFIED'
  | 'NONE'
  | 'DECIMAL'
  | 'ZERO_DECIMAL'
  | 'UPPER_ALPHA'
  | 'ALPHA'
  | 'UPPER_ROMAN'
  | 'ROMAN';

export interface DocumentStyle {
  background?: Background;
  defaultHeaderId?: string;
  defaultFooterId?: string;
  evenPageHeaderId?: string;
  evenPageFooterId?: string;
  firstPageHeaderId?: string;
  firstPageFooterId?: string;
  useFirstPageHeaderFooter?: boolean;
  useEvenPageHeaderFooter?: boolean;
  pageNumberStart?: number;
  marginTop?: Dimension;
  marginBottom?: Dimension;
  marginRight?: Dimension;
  marginLeft?: Dimension;
  pageSize?: Size;
  marginHeader?: Dimension;
  marginFooter?: Dimension;
  useCustomHeaderFooterMargins?: boolean;
}

export interface Background {
  color?: OptionalColor;
}

export interface NamedStyles {
  styles?: NamedStyle[];
}

export interface NamedStyle {
  namedStyleType?: NamedStyleType;
  textStyle?: TextStyle;
  paragraphStyle?: ParagraphStyle;
}

// ============================================
// Request Types (for batchUpdate)
// ============================================

export interface BatchUpdateRequest {
  requests: Request[];
  writeControl?: WriteControl;
}

export interface WriteControl {
  requiredRevisionId?: string;
  targetRevisionId?: string;
}

export interface Request {
  insertText?: InsertTextRequest;
  deleteContentRange?: DeleteContentRangeRequest;
  updateTextStyle?: UpdateTextStyleRequest;
  updateParagraphStyle?: UpdateParagraphStyleRequest;
  insertInlineImage?: InsertInlineImageRequest;
  replaceAllText?: ReplaceAllTextRequest;
  createNamedRange?: CreateNamedRangeRequest;
  deleteNamedRange?: DeleteNamedRangeRequest;
  insertTable?: InsertTableRequest;
  insertTableRow?: InsertTableRowRequest;
  insertTableColumn?: InsertTableColumnRequest;
  deleteTableRow?: DeleteTableRowRequest;
  deleteTableColumn?: DeleteTableColumnRequest;
  insertPageBreak?: InsertPageBreakRequest;
  createHeader?: CreateHeaderRequest;
  createFooter?: CreateFooterRequest;
  createFootnote?: CreateFootnoteRequest;
  mergeTableCells?: MergeTableCellsRequest;
  unmergeTableCells?: UnmergeTableCellsRequest;
  updateTableCellStyle?: UpdateTableCellStyleRequest;
  updateTableRowStyle?: UpdateTableRowStyleRequest;
  updateTableColumnProperties?: UpdateTableColumnPropertiesRequest;
  updateDocumentStyle?: UpdateDocumentStyleRequest;
  deleteHeader?: DeleteHeaderRequest;
  deleteFooter?: DeleteFooterRequest;
  replaceImage?: ReplaceImageRequest;
}

export interface InsertTextRequest {
  text: string;
  location?: Location;
  endOfSegmentLocation?: EndOfSegmentLocation;
}

export interface Location {
  index: number;
  segmentId?: string;
}

export interface EndOfSegmentLocation {
  segmentId?: string;
}

export interface DeleteContentRangeRequest {
  range: Range;
}

export interface Range {
  startIndex: number;
  endIndex: number;
  segmentId?: string;
}

export interface UpdateTextStyleRequest {
  range: Range;
  textStyle: TextStyle;
  fields: string;
}

export interface UpdateParagraphStyleRequest {
  range: Range;
  paragraphStyle: ParagraphStyle;
  fields: string;
}

export interface InsertInlineImageRequest {
  uri: string;
  location?: Location;
  endOfSegmentLocation?: EndOfSegmentLocation;
  objectSize?: Size;
}

export interface ReplaceAllTextRequest {
  containsText: SubstringMatchCriteria;
  replaceText: string;
}

export interface SubstringMatchCriteria {
  text: string;
  matchCase?: boolean;
}

export interface CreateNamedRangeRequest {
  name: string;
  range: Range;
}

export interface DeleteNamedRangeRequest {
  name?: string;
  namedRangeId?: string;
}

export interface InsertTableRequest {
  rows: number;
  columns: number;
  location?: Location;
  endOfSegmentLocation?: EndOfSegmentLocation;
}

export interface InsertTableRowRequest {
  tableCellLocation: TableCellLocation;
  insertBelow: boolean;
}

export interface TableCellLocation {
  tableStartLocation: Location;
  rowIndex?: number;
  columnIndex?: number;
}

export interface InsertTableColumnRequest {
  tableCellLocation: TableCellLocation;
  insertRight: boolean;
}

export interface DeleteTableRowRequest {
  tableCellLocation: TableCellLocation;
}

export interface DeleteTableColumnRequest {
  tableCellLocation: TableCellLocation;
}

export interface InsertPageBreakRequest {
  location?: Location;
  endOfSegmentLocation?: EndOfSegmentLocation;
}

export interface CreateHeaderRequest {
  type: HeaderFooterType;
  sectionBreakLocation?: Location;
}

export type HeaderFooterType = 'DEFAULT' | 'FIRST';

export interface CreateFooterRequest {
  type: HeaderFooterType;
  sectionBreakLocation?: Location;
}

export interface CreateFootnoteRequest {
  location?: Location;
  endOfSegmentLocation?: EndOfSegmentLocation;
}

export interface MergeTableCellsRequest {
  tableRange: TableRange;
}

export interface TableRange {
  tableCellLocation: TableCellLocation;
  rowSpan: number;
  columnSpan: number;
}

export interface UnmergeTableCellsRequest {
  tableRange: TableRange;
}

export interface UpdateTableCellStyleRequest {
  tableCellStyle: TableCellStyle;
  fields: string;
  tableRange?: TableRange;
  tableStartLocation?: Location;
}

export interface UpdateTableRowStyleRequest {
  tableRowStyle: TableRowStyle;
  fields: string;
  tableStartLocation: Location;
  rowIndices: number[];
}

export interface UpdateTableColumnPropertiesRequest {
  tableStartLocation: Location;
  columnIndices: number[];
  tableColumnProperties: TableColumnProperties;
  fields: string;
}

export interface UpdateDocumentStyleRequest {
  documentStyle: DocumentStyle;
  fields: string;
}

export interface DeleteHeaderRequest {
  headerId: string;
}

export interface DeleteFooterRequest {
  footerId: string;
}

export interface ReplaceImageRequest {
  imageObjectId: string;
  uri: string;
  imageReplaceMethod?: ImageReplaceMethod;
}

export type ImageReplaceMethod = 'IMAGE_REPLACE_METHOD_UNSPECIFIED' | 'CENTER_CROP';

// ============================================
// Response Types
// ============================================

export interface BatchUpdateResponse {
  documentId: string;
  replies: Reply[];
  writeControl?: WriteControl;
}

export interface Reply {
  createNamedRange?: CreateNamedRangeResponse;
  createHeader?: CreateHeaderResponse;
  createFooter?: CreateFooterResponse;
  createFootnote?: CreateFootnoteResponse;
  replaceAllText?: ReplaceAllTextResponse;
  insertInlineImage?: InsertInlineImageResponse;
  insertInlineSheetsChart?: InsertInlineSheetsChartResponse;
}

export interface CreateNamedRangeResponse {
  namedRangeId: string;
}

export interface CreateHeaderResponse {
  headerId: string;
}

export interface CreateFooterResponse {
  footerId: string;
}

export interface CreateFootnoteResponse {
  footnoteId: string;
}

export interface ReplaceAllTextResponse {
  occurrencesChanged: number;
}

export interface InsertInlineImageResponse {
  objectId: string;
}

export interface InsertInlineSheetsChartResponse {
  objectId: string;
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class GoogleDocsApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'GoogleDocsApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
