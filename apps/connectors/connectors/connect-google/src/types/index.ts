// Google Workspace Connector Types

// ============================================
// Configuration
// ============================================

export interface GoogleConfig {
  accessToken: string;
  baseUrls?: {
    gmail?: string;
    drive?: string;
    calendar?: string;
    docs?: string;
    sheets?: string;
  };
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface PaginatedResponse<T> {
  data: T[];
  nextPageToken?: string;
  hasMore: boolean;
}

// ============================================
// Gmail Types
// ============================================

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  payload?: GmailMessagePayload;
  sizeEstimate?: number;
  historyId?: string;
  internalDate?: string;
  raw?: string;
}

export interface GmailMessagePayload {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: GmailBody;
  parts?: GmailMessagePayload[];
}

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailBody {
  attachmentId?: string;
  size: number;
  data?: string;
}

export interface GmailListMessagesResponse {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

export interface GmailLabel {
  id: string;
  name: string;
  type?: 'system' | 'user';
  messageListVisibility?: 'show' | 'hide';
  labelListVisibility?: 'labelShow' | 'labelShowIfUnread' | 'labelHide';
  messagesTotal?: number;
  messagesUnread?: number;
  threadsTotal?: number;
  threadsUnread?: number;
  color?: {
    textColor?: string;
    backgroundColor?: string;
  };
}

export interface GmailListLabelsResponse {
  labels: GmailLabel[];
}

export interface GmailDraft {
  id: string;
  message: GmailMessage;
}

export interface GmailListDraftsResponse {
  drafts?: GmailDraft[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

export interface GmailSendParams {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  isHtml?: boolean;
}

// ============================================
// Drive Types
// ============================================

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  kind?: string;
  driveId?: string;
  fileExtension?: string;
  copyRequiresWriterPermission?: boolean;
  md5Checksum?: string;
  contentHints?: {
    thumbnail?: { image: string; mimeType: string };
    indexableText?: string;
  };
  writersCanShare?: boolean;
  viewedByMe?: boolean;
  exportLinks?: Record<string, string>;
  parents?: string[];
  shared?: boolean;
  ownedByMe?: boolean;
  viewersCanCopyContent?: boolean;
  webViewLink?: string;
  webContentLink?: string;
  iconLink?: string;
  thumbnailLink?: string;
  createdTime?: string;
  modifiedTime?: string;
  modifiedByMeTime?: string;
  viewedByMeTime?: string;
  quotaBytesUsed?: string;
  size?: string;
  description?: string;
  starred?: boolean;
  trashed?: boolean;
  capabilities?: DriveFileCapabilities;
  permissions?: DrivePermission[];
}

export interface DriveFileCapabilities {
  canAddChildren?: boolean;
  canComment?: boolean;
  canCopy?: boolean;
  canDelete?: boolean;
  canDownload?: boolean;
  canEdit?: boolean;
  canListChildren?: boolean;
  canMoveItemIntoTeamDrive?: boolean;
  canMoveItemOutOfDrive?: boolean;
  canRead?: boolean;
  canRemoveChildren?: boolean;
  canRename?: boolean;
  canShare?: boolean;
  canTrash?: boolean;
  canUntrash?: boolean;
}

export interface DrivePermission {
  id: string;
  type: 'user' | 'group' | 'domain' | 'anyone';
  role: 'owner' | 'organizer' | 'fileOrganizer' | 'writer' | 'commenter' | 'reader';
  emailAddress?: string;
  domain?: string;
  displayName?: string;
  photoLink?: string;
  expirationTime?: string;
  deleted?: boolean;
}

export interface DriveListFilesResponse {
  files: DriveFile[];
  nextPageToken?: string;
  kind?: string;
  incompleteSearch?: boolean;
}

export interface DriveCreateParams {
  name: string;
  mimeType?: string;
  parents?: string[];
  description?: string;
  content?: string;
}

export interface DriveUpdateParams {
  name?: string;
  description?: string;
  mimeType?: string;
  starred?: boolean;
  trashed?: boolean;
  addParents?: string[];
  removeParents?: string[];
}

export interface DrivePermissionCreateParams {
  type: 'user' | 'group' | 'domain' | 'anyone';
  role: 'owner' | 'organizer' | 'fileOrganizer' | 'writer' | 'commenter' | 'reader';
  emailAddress?: string;
  domain?: string;
  sendNotificationEmail?: boolean;
  emailMessage?: string;
}

// ============================================
// Calendar Types
// ============================================

export interface CalendarEvent {
  id: string;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  htmlLink?: string;
  created?: string;
  updated?: string;
  summary?: string;
  description?: string;
  location?: string;
  colorId?: string;
  creator?: {
    id?: string;
    email?: string;
    displayName?: string;
    self?: boolean;
  };
  organizer?: {
    id?: string;
    email?: string;
    displayName?: string;
    self?: boolean;
  };
  start?: CalendarEventDateTime;
  end?: CalendarEventDateTime;
  endTimeUnspecified?: boolean;
  recurrence?: string[];
  recurringEventId?: string;
  originalStartTime?: CalendarEventDateTime;
  transparency?: 'opaque' | 'transparent';
  visibility?: 'default' | 'public' | 'private' | 'confidential';
  iCalUID?: string;
  sequence?: number;
  attendees?: CalendarEventAttendee[];
  attendeesOmitted?: boolean;
  hangoutLink?: string;
  conferenceData?: CalendarConferenceData;
  gadget?: CalendarGadget;
  anyoneCanAddSelf?: boolean;
  guestsCanInviteOthers?: boolean;
  guestsCanModify?: boolean;
  guestsCanSeeOtherGuests?: boolean;
  privateCopy?: boolean;
  locked?: boolean;
  reminders?: {
    useDefault?: boolean;
    overrides?: Array<{ method: 'email' | 'popup'; minutes: number }>;
  };
  source?: {
    url?: string;
    title?: string;
  };
  attachments?: CalendarEventAttachment[];
  eventType?: 'default' | 'outOfOffice' | 'focusTime' | 'workingLocation';
}

export interface CalendarEventDateTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface CalendarEventAttendee {
  id?: string;
  email?: string;
  displayName?: string;
  organizer?: boolean;
  self?: boolean;
  resource?: boolean;
  optional?: boolean;
  responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
  comment?: string;
  additionalGuests?: number;
}

export interface CalendarConferenceData {
  createRequest?: {
    requestId?: string;
    conferenceSolutionKey?: { type?: string };
    status?: { statusCode?: string };
  };
  entryPoints?: Array<{
    entryPointType?: string;
    uri?: string;
    label?: string;
    pin?: string;
    accessCode?: string;
    meetingCode?: string;
    passcode?: string;
    password?: string;
  }>;
  conferenceSolution?: {
    key?: { type?: string };
    name?: string;
    iconUri?: string;
  };
  conferenceId?: string;
  notes?: string;
}

export interface CalendarGadget {
  type?: string;
  title?: string;
  link?: string;
  iconLink?: string;
  width?: number;
  height?: number;
  display?: 'icon' | 'chip';
}

export interface CalendarEventAttachment {
  fileUrl?: string;
  title?: string;
  mimeType?: string;
  iconLink?: string;
  fileId?: string;
}

export interface CalendarListEventsResponse {
  kind?: string;
  etag?: string;
  summary?: string;
  description?: string;
  updated?: string;
  timeZone?: string;
  accessRole?: string;
  defaultReminders?: Array<{ method: string; minutes: number }>;
  nextPageToken?: string;
  nextSyncToken?: string;
  items: CalendarEvent[];
}

export interface Calendar {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  timeZone?: string;
  summaryOverride?: string;
  colorId?: string;
  backgroundColor?: string;
  foregroundColor?: string;
  hidden?: boolean;
  selected?: boolean;
  accessRole?: 'freeBusyReader' | 'reader' | 'writer' | 'owner';
  defaultReminders?: Array<{ method: 'email' | 'popup'; minutes: number }>;
  notificationSettings?: {
    notifications?: Array<{ type: string; method: string }>;
  };
  primary?: boolean;
  deleted?: boolean;
}

export interface CalendarListResponse {
  kind?: string;
  etag?: string;
  nextPageToken?: string;
  nextSyncToken?: string;
  items: Calendar[];
}

export interface CalendarEventCreateParams {
  summary: string;
  description?: string;
  location?: string;
  start: CalendarEventDateTime;
  end: CalendarEventDateTime;
  attendees?: Array<{ email: string; displayName?: string }>;
  recurrence?: string[];
  reminders?: {
    useDefault?: boolean;
    overrides?: Array<{ method: 'email' | 'popup'; minutes: number }>;
  };
  colorId?: string;
  visibility?: 'default' | 'public' | 'private' | 'confidential';
  sendUpdates?: 'all' | 'externalOnly' | 'none';
}

// ============================================
// Docs Types
// ============================================

export interface Document {
  documentId: string;
  title: string;
  body?: DocumentBody;
  documentStyle?: DocumentStyle;
  namedStyles?: NamedStyles;
  headers?: Record<string, Header>;
  footers?: Record<string, Footer>;
  footnotes?: Record<string, Footnote>;
  lists?: Record<string, List>;
  namedRanges?: Record<string, NamedRange>;
  revisionId?: string;
  suggestionsViewMode?: 'DEFAULT_FOR_CURRENT_ACCESS' | 'SUGGESTIONS_INLINE' | 'PREVIEW_SUGGESTIONS_ACCEPTED' | 'PREVIEW_WITHOUT_SUGGESTIONS';
  inlineObjects?: Record<string, InlineObject>;
  positionedObjects?: Record<string, PositionedObject>;
}

export interface DocumentBody {
  content?: StructuralElement[];
}

export interface DocumentStyle {
  background?: Background;
  defaultHeaderId?: string;
  defaultFooterId?: string;
  evenPageHeaderId?: string;
  evenPageFooterId?: string;
  firstPageHeaderId?: string;
  firstPageFooterId?: string;
  pageNumberStart?: number;
  marginTop?: Dimension;
  marginBottom?: Dimension;
  marginRight?: Dimension;
  marginLeft?: Dimension;
  pageSize?: Size;
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
}

export interface TextRun {
  content?: string;
  textStyle?: TextStyle;
  suggestedInsertionIds?: string[];
  suggestedDeletionIds?: string[];
  suggestedTextStyleChanges?: Record<string, SuggestedTextStyle>;
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
  baselineOffset?: 'BASELINE_OFFSET_UNSPECIFIED' | 'NONE' | 'SUPERSCRIPT' | 'SUBSCRIPT';
  link?: Link;
}

export interface Link {
  url?: string;
  bookmarkId?: string;
  headingId?: string;
}

export interface Dimension {
  magnitude?: number;
  unit?: 'UNIT_UNSPECIFIED' | 'PT';
}

export interface Size {
  width?: Dimension;
  height?: Dimension;
}

export interface Background {
  color?: OptionalColor;
}

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

export interface WeightedFontFamily {
  fontFamily?: string;
  weight?: number;
}

export interface ParagraphStyle {
  headingId?: string;
  namedStyleType?: 'NORMAL_TEXT' | 'TITLE' | 'SUBTITLE' | 'HEADING_1' | 'HEADING_2' | 'HEADING_3' | 'HEADING_4' | 'HEADING_5' | 'HEADING_6';
  alignment?: 'ALIGNMENT_UNSPECIFIED' | 'START' | 'CENTER' | 'END' | 'JUSTIFIED';
  lineSpacing?: number;
  direction?: 'CONTENT_DIRECTION_UNSPECIFIED' | 'LEFT_TO_RIGHT' | 'RIGHT_TO_LEFT';
  spacingMode?: 'SPACING_MODE_UNSPECIFIED' | 'NEVER_COLLAPSE' | 'COLLAPSE_LISTS';
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
}

export interface ParagraphBorder {
  color?: OptionalColor;
  width?: Dimension;
  padding?: Dimension;
  dashStyle?: 'DASH_STYLE_UNSPECIFIED' | 'SOLID' | 'DOT' | 'DASH';
}

export interface TabStop {
  offset?: Dimension;
  alignment?: 'TAB_STOP_ALIGNMENT_UNSPECIFIED' | 'START' | 'CENTER' | 'END';
}

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
  columnSeparatorStyle?: 'COLUMN_SEPARATOR_STYLE_UNSPECIFIED' | 'NONE' | 'BETWEEN_EACH_COLUMN';
  contentDirection?: 'CONTENT_DIRECTION_UNSPECIFIED' | 'LEFT_TO_RIGHT' | 'RIGHT_TO_LEFT';
  marginTop?: Dimension;
  marginBottom?: Dimension;
  marginRight?: Dimension;
  marginLeft?: Dimension;
  marginHeader?: Dimension;
  marginFooter?: Dimension;
  sectionType?: 'SECTION_TYPE_UNSPECIFIED' | 'CONTINUOUS' | 'NEXT_PAGE';
}

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

export interface TableStyle {
  tableColumnProperties?: TableColumnProperties[];
}

export interface TableColumnProperties {
  widthType?: 'WIDTH_TYPE_UNSPECIFIED' | 'EVENLY_DISTRIBUTED' | 'FIXED_WIDTH';
  width?: Dimension;
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
  contentAlignment?: 'CONTENT_ALIGNMENT_UNSPECIFIED' | 'CONTENT_ALIGNMENT_UNSUPPORTED' | 'TOP' | 'MIDDLE' | 'BOTTOM';
}

export interface TableCellBorder {
  color?: OptionalColor;
  width?: Dimension;
  dashStyle?: 'DASH_STYLE_UNSPECIFIED' | 'SOLID' | 'DOT' | 'DASH';
}

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

export interface NamedStyles {
  styles?: NamedStyle[];
}

export interface NamedStyle {
  namedStyleType?: string;
  textStyle?: TextStyle;
  paragraphStyle?: ParagraphStyle;
}

export interface Header {
  headerId?: string;
  content?: StructuralElement[];
}

export interface Footer {
  footerId?: string;
  content?: StructuralElement[];
}

export interface Footnote {
  footnoteId?: string;
  content?: StructuralElement[];
}

export interface List {
  listProperties?: ListProperties;
}

export interface ListProperties {
  nestingLevels?: NestingLevel[];
}

export interface NestingLevel {
  bulletAlignment?: 'BULLET_ALIGNMENT_UNSPECIFIED' | 'START' | 'CENTER' | 'END';
  glyphType?: string;
  glyphFormat?: string;
  indentFirstLine?: Dimension;
  indentStart?: Dimension;
  textStyle?: TextStyle;
  startNumber?: number;
}

export interface NamedRange {
  namedRangeId?: string;
  name?: string;
  ranges?: Range[];
}

export interface Range {
  segmentId?: string;
  startIndex?: number;
  endIndex?: number;
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
}

export interface EmbeddedObjectBorder {
  color?: OptionalColor;
  width?: Dimension;
  dashStyle?: 'DASH_STYLE_UNSPECIFIED' | 'SOLID' | 'DOT' | 'DASH';
  propertyState?: 'RENDERED' | 'NOT_RENDERED';
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

export interface PositionedObject {
  objectId?: string;
  positionedObjectProperties?: PositionedObjectProperties;
}

export interface PositionedObjectProperties {
  positioning?: PositionedObjectPositioning;
  embeddedObject?: EmbeddedObject;
}

export interface PositionedObjectPositioning {
  layout?: 'POSITIONED_OBJECT_LAYOUT_UNSPECIFIED' | 'WRAP_TEXT' | 'BREAK_LEFT' | 'BREAK_RIGHT' | 'BREAK_LEFT_RIGHT' | 'IN_FRONT_OF_TEXT';
  leftOffset?: Dimension;
  topOffset?: Dimension;
}

export interface SuggestedTextStyle {
  textStyle?: TextStyle;
  textStyleSuggestionState?: TextStyleSuggestionState;
}

export interface TextStyleSuggestionState {
  boldSuggested?: boolean;
  italicSuggested?: boolean;
  underlineSuggested?: boolean;
  strikethroughSuggested?: boolean;
  smallCapsSuggested?: boolean;
  backgroundColorSuggested?: boolean;
  foregroundColorSuggested?: boolean;
  fontSizeSuggested?: boolean;
  weightedFontFamilySuggested?: boolean;
  baselineOffsetSuggested?: boolean;
  linkSuggested?: boolean;
}

export interface DocumentCreateParams {
  title: string;
}

export interface DocumentBatchUpdateRequest {
  requests: DocumentRequest[];
  writeControl?: WriteControl;
}

export interface WriteControl {
  requiredRevisionId?: string;
  targetRevisionId?: string;
}

export interface DocumentRequest {
  insertText?: InsertTextRequest;
  deleteContentRange?: DeleteContentRangeRequest;
  insertInlineImage?: InsertInlineImageRequest;
  insertTable?: InsertTableRequest;
  insertTableRow?: InsertTableRowRequest;
  insertTableColumn?: InsertTableColumnRequest;
  deleteTableRow?: DeleteTableRowRequest;
  deleteTableColumn?: DeleteTableColumnRequest;
  updateTextStyle?: UpdateTextStyleRequest;
  updateParagraphStyle?: UpdateParagraphStyleRequest;
  updateTableColumnProperties?: UpdateTableColumnPropertiesRequest;
  updateTableRowStyle?: UpdateTableRowStyleRequest;
  updateTableCellStyle?: UpdateTableCellStyleRequest;
  replaceAllText?: ReplaceAllTextRequest;
  createNamedRange?: CreateNamedRangeRequest;
  deleteNamedRange?: DeleteNamedRangeRequest;
  createParagraphBullets?: CreateParagraphBulletsRequest;
  deleteParagraphBullets?: DeleteParagraphBulletsRequest;
}

export interface InsertTextRequest {
  text: string;
  location?: Location;
  endOfSegmentLocation?: EndOfSegmentLocation;
}

export interface DeleteContentRangeRequest {
  range: Range;
}

export interface InsertInlineImageRequest {
  uri: string;
  location?: Location;
  endOfSegmentLocation?: EndOfSegmentLocation;
  objectSize?: Size;
}

export interface InsertTableRequest {
  rows: number;
  columns: number;
  location?: Location;
  endOfSegmentLocation?: EndOfSegmentLocation;
}

export interface InsertTableRowRequest {
  tableCellLocation: TableCellLocation;
  insertBelow?: boolean;
}

export interface InsertTableColumnRequest {
  tableCellLocation: TableCellLocation;
  insertRight?: boolean;
}

export interface DeleteTableRowRequest {
  tableCellLocation: TableCellLocation;
}

export interface DeleteTableColumnRequest {
  tableCellLocation: TableCellLocation;
}

export interface UpdateTextStyleRequest {
  textStyle: TextStyle;
  range: Range;
  fields: string;
}

export interface UpdateParagraphStyleRequest {
  paragraphStyle: ParagraphStyle;
  range: Range;
  fields: string;
}

export interface UpdateTableColumnPropertiesRequest {
  tableStartLocation: Location;
  columnIndices: number[];
  tableColumnProperties: TableColumnProperties;
  fields: string;
}

export interface UpdateTableRowStyleRequest {
  tableStartLocation: Location;
  rowIndices: number[];
  tableRowStyle: TableRowStyle;
  fields: string;
}

export interface UpdateTableCellStyleRequest {
  tableStartLocation?: Location;
  tableRange?: TableRange;
  tableCellStyle: TableCellStyle;
  fields: string;
}

export interface ReplaceAllTextRequest {
  replaceText: string;
  containsText: SubstringMatchCriteria;
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

export interface CreateParagraphBulletsRequest {
  range: Range;
  bulletPreset: string;
}

export interface DeleteParagraphBulletsRequest {
  range: Range;
}

export interface Location {
  segmentId?: string;
  index: number;
}

export interface EndOfSegmentLocation {
  segmentId?: string;
}

export interface TableCellLocation {
  tableStartLocation: Location;
  rowIndex: number;
  columnIndex: number;
}

export interface TableRange {
  tableCellLocation: TableCellLocation;
  rowSpan?: number;
  columnSpan?: number;
}

export interface DocumentBatchUpdateResponse {
  documentId: string;
  replies: DocumentReply[];
  writeControl?: WriteControl;
}

export interface DocumentReply {
  createNamedRange?: CreateNamedRangeResponse;
  replaceAllText?: ReplaceAllTextResponse;
}

export interface CreateNamedRangeResponse {
  namedRangeId: string;
}

export interface ReplaceAllTextResponse {
  occurrencesChanged: number;
}

// ============================================
// Sheets Types
// ============================================

export interface Spreadsheet {
  spreadsheetId: string;
  properties?: SpreadsheetProperties;
  sheets?: Sheet[];
  namedRanges?: SpreadsheetNamedRange[];
  spreadsheetUrl?: string;
  developerMetadata?: DeveloperMetadata[];
}

export interface SpreadsheetProperties {
  title?: string;
  locale?: string;
  autoRecalc?: 'RECALCULATION_INTERVAL_UNSPECIFIED' | 'ON_CHANGE' | 'MINUTE' | 'HOUR';
  timeZone?: string;
  defaultFormat?: CellFormat;
  iterativeCalculationSettings?: IterativeCalculationSettings;
  spreadsheetTheme?: SpreadsheetTheme;
}

export interface IterativeCalculationSettings {
  maxIterations?: number;
  convergenceThreshold?: number;
}

export interface SpreadsheetTheme {
  primaryFontFamily?: string;
  themeColors?: ThemeColorPair[];
}

export interface ThemeColorPair {
  colorType?: string;
  color?: ColorStyle;
}

export interface ColorStyle {
  rgbColor?: RgbColor;
  themeColor?: string;
}

export interface Sheet {
  properties?: SheetProperties;
  data?: GridData[];
  merges?: GridRange[];
  conditionalFormats?: ConditionalFormatRule[];
  filterViews?: FilterView[];
  protectedRanges?: ProtectedRange[];
  basicFilter?: BasicFilter;
  charts?: EmbeddedChart[];
  bandedRanges?: BandedRange[];
  developerMetadata?: DeveloperMetadata[];
  rowGroups?: DimensionGroup[];
  columnGroups?: DimensionGroup[];
  slicers?: Slicer[];
}

export interface SheetProperties {
  sheetId?: number;
  title?: string;
  index?: number;
  sheetType?: 'SHEET_TYPE_UNSPECIFIED' | 'GRID' | 'OBJECT' | 'DATA_SOURCE';
  gridProperties?: GridProperties;
  hidden?: boolean;
  tabColor?: ColorStyle;
  tabColorStyle?: ColorStyle;
  rightToLeft?: boolean;
  dataSourceSheetProperties?: DataSourceSheetProperties;
}

export interface GridProperties {
  rowCount?: number;
  columnCount?: number;
  frozenRowCount?: number;
  frozenColumnCount?: number;
  hideGridlines?: boolean;
  rowGroupControlAfter?: boolean;
  columnGroupControlAfter?: boolean;
}

export interface GridData {
  startRow?: number;
  startColumn?: number;
  rowData?: RowData[];
  rowMetadata?: DimensionProperties[];
  columnMetadata?: DimensionProperties[];
}

export interface RowData {
  values?: CellData[];
}

export interface CellData {
  userEnteredValue?: ExtendedValue;
  effectiveValue?: ExtendedValue;
  formattedValue?: string;
  userEnteredFormat?: CellFormat;
  effectiveFormat?: CellFormat;
  hyperlink?: string;
  note?: string;
  textFormatRuns?: TextFormatRun[];
  dataValidation?: DataValidationRule;
  pivotTable?: PivotTable;
  dataSourceTable?: DataSourceTable;
  dataSourceFormula?: DataSourceFormula;
}

export interface ExtendedValue {
  numberValue?: number;
  stringValue?: string;
  boolValue?: boolean;
  formulaValue?: string;
  errorValue?: ErrorValue;
}

export interface ErrorValue {
  type?: string;
  message?: string;
}

export interface CellFormat {
  numberFormat?: NumberFormat;
  backgroundColor?: RgbColor;
  backgroundColorStyle?: ColorStyle;
  borders?: Borders;
  padding?: Padding;
  horizontalAlignment?: 'HORIZONTAL_ALIGN_UNSPECIFIED' | 'LEFT' | 'CENTER' | 'RIGHT';
  verticalAlignment?: 'VERTICAL_ALIGN_UNSPECIFIED' | 'TOP' | 'MIDDLE' | 'BOTTOM';
  wrapStrategy?: 'WRAP_STRATEGY_UNSPECIFIED' | 'OVERFLOW_CELL' | 'LEGACY_WRAP' | 'CLIP' | 'WRAP';
  textDirection?: 'TEXT_DIRECTION_UNSPECIFIED' | 'LEFT_TO_RIGHT' | 'RIGHT_TO_LEFT';
  textFormat?: TextFormat;
  hyperlinkDisplayType?: 'HYPERLINK_DISPLAY_TYPE_UNSPECIFIED' | 'LINKED' | 'PLAIN_TEXT';
  textRotation?: TextRotation;
}

export interface NumberFormat {
  type?: 'NUMBER_FORMAT_TYPE_UNSPECIFIED' | 'TEXT' | 'NUMBER' | 'PERCENT' | 'CURRENCY' | 'DATE' | 'TIME' | 'DATE_TIME' | 'SCIENTIFIC';
  pattern?: string;
}

export interface Borders {
  top?: Border;
  bottom?: Border;
  left?: Border;
  right?: Border;
}

export interface Border {
  style?: 'STYLE_UNSPECIFIED' | 'DOTTED' | 'DASHED' | 'SOLID' | 'SOLID_MEDIUM' | 'SOLID_THICK' | 'NONE' | 'DOUBLE';
  width?: number;
  color?: RgbColor;
  colorStyle?: ColorStyle;
}

export interface Padding {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

export interface TextFormat {
  foregroundColor?: RgbColor;
  foregroundColorStyle?: ColorStyle;
  fontFamily?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
  link?: SheetLink;
}

export interface SheetLink {
  uri?: string;
}

export interface TextRotation {
  angle?: number;
  vertical?: boolean;
}

export interface TextFormatRun {
  startIndex?: number;
  format?: TextFormat;
}

export interface DataValidationRule {
  condition?: BooleanCondition;
  inputMessage?: string;
  strict?: boolean;
  showCustomUi?: boolean;
}

export interface BooleanCondition {
  type?: string;
  values?: ConditionValue[];
}

export interface ConditionValue {
  relativeDate?: string;
  userEnteredValue?: string;
}

export interface PivotTable {
  source?: GridRange;
  rows?: PivotGroup[];
  columns?: PivotGroup[];
  criteria?: Record<string, PivotFilterCriteria>;
  filterSpecs?: PivotFilterSpec[];
  values?: PivotValue[];
  valueLayout?: 'HORIZONTAL' | 'VERTICAL';
  dataExecutionStatus?: DataExecutionStatus;
  dataSourceId?: string;
}

export interface PivotGroup {
  sourceColumnOffset?: number;
  showTotals?: boolean;
  valueBucket?: PivotGroupValueBucket;
  sortOrder?: 'SORT_ORDER_UNSPECIFIED' | 'ASCENDING' | 'DESCENDING';
  valueMetadata?: PivotGroupSortValueBucket[];
  repeatHeadings?: boolean;
  label?: string;
  groupRule?: PivotGroupRule;
  groupLimit?: PivotGroupLimit;
  dataSourceColumnReference?: DataSourceColumnReference;
}

export interface PivotGroupValueBucket {
  buckets?: ExtendedValue[];
  valuesIndex?: number;
}

export interface PivotGroupSortValueBucket {
  buckets?: ExtendedValue[];
  valuesIndex?: number;
}

export interface PivotGroupRule {
  manualRule?: ManualRule;
  histogramRule?: HistogramRule;
  dateTimeRule?: DateTimeRule;
}

export interface ManualRule {
  groups?: ManualRuleGroup[];
}

export interface ManualRuleGroup {
  groupName?: ExtendedValue;
  items?: ExtendedValue[];
}

export interface HistogramRule {
  interval?: number;
  start?: number;
  end?: number;
}

export interface DateTimeRule {
  type?: string;
}

export interface PivotGroupLimit {
  countLimit?: number;
  applyOrder?: number;
}

export interface PivotFilterCriteria {
  visibleValues?: string[];
  condition?: BooleanCondition;
  visibleByDefault?: boolean;
}

export interface PivotFilterSpec {
  filterCriteria?: PivotFilterCriteria;
  columnOffsetIndex?: number;
  dataSourceColumnReference?: DataSourceColumnReference;
}

export interface PivotValue {
  summarizeFunction?: string;
  name?: string;
  calculatedDisplayType?: string;
  sourceColumnOffset?: number;
  formula?: string;
  dataSourceColumnReference?: DataSourceColumnReference;
}

export interface DataSourceColumnReference {
  name?: string;
}

export interface DataSourceTable {
  dataSourceId?: string;
  columnSelectionType?: string;
  columns?: DataSourceColumnReference[];
  filterSpecs?: FilterSpec[];
  sortSpecs?: SortSpec[];
  rowLimit?: number;
  dataExecutionStatus?: DataExecutionStatus;
}

export interface DataSourceFormula {
  dataSourceId?: string;
  dataExecutionStatus?: DataExecutionStatus;
}

export interface DataExecutionStatus {
  state?: string;
  errorCode?: string;
  errorMessage?: string;
  lastRefreshTime?: string;
}

export interface GridRange {
  sheetId?: number;
  startRowIndex?: number;
  endRowIndex?: number;
  startColumnIndex?: number;
  endColumnIndex?: number;
}

export interface DimensionProperties {
  hiddenByFilter?: boolean;
  hiddenByUser?: boolean;
  pixelSize?: number;
  developerMetadata?: DeveloperMetadata[];
  dataSourceColumnReference?: DataSourceColumnReference;
}

export interface SpreadsheetNamedRange {
  namedRangeId?: string;
  name?: string;
  range?: GridRange;
}

export interface ConditionalFormatRule {
  ranges?: GridRange[];
  booleanRule?: BooleanRule;
  gradientRule?: GradientRule;
}

export interface BooleanRule {
  condition?: BooleanCondition;
  format?: CellFormat;
}

export interface GradientRule {
  minpoint?: InterpolationPoint;
  midpoint?: InterpolationPoint;
  maxpoint?: InterpolationPoint;
}

export interface InterpolationPoint {
  color?: RgbColor;
  colorStyle?: ColorStyle;
  type?: string;
  value?: string;
}

export interface FilterView {
  filterViewId?: number;
  title?: string;
  range?: GridRange;
  namedRangeId?: string;
  sortSpecs?: SortSpec[];
  criteria?: Record<string, FilterCriteria>;
  filterSpecs?: FilterSpec[];
}

export interface SortSpec {
  dimensionIndex?: number;
  sortOrder?: 'SORT_ORDER_UNSPECIFIED' | 'ASCENDING' | 'DESCENDING';
  foregroundColor?: RgbColor;
  foregroundColorStyle?: ColorStyle;
  backgroundColor?: RgbColor;
  backgroundColorStyle?: ColorStyle;
  dataSourceColumnReference?: DataSourceColumnReference;
}

export interface FilterCriteria {
  hiddenValues?: string[];
  condition?: BooleanCondition;
  visibleBackgroundColor?: RgbColor;
  visibleBackgroundColorStyle?: ColorStyle;
  visibleForegroundColor?: RgbColor;
  visibleForegroundColorStyle?: ColorStyle;
}

export interface FilterSpec {
  filterCriteria?: FilterCriteria;
  columnIndex?: number;
  dataSourceColumnReference?: DataSourceColumnReference;
}

export interface ProtectedRange {
  protectedRangeId?: number;
  range?: GridRange;
  namedRangeId?: string;
  description?: string;
  warningOnly?: boolean;
  requestingUserCanEdit?: boolean;
  unprotectedRanges?: GridRange[];
  editors?: Editors;
}

export interface Editors {
  users?: string[];
  groups?: string[];
  domainUsersCanEdit?: boolean;
}

export interface BasicFilter {
  range?: GridRange;
  sortSpecs?: SortSpec[];
  criteria?: Record<string, FilterCriteria>;
  filterSpecs?: FilterSpec[];
}

export interface EmbeddedChart {
  chartId?: number;
  position?: EmbeddedObjectPosition;
  spec?: ChartSpec;
  border?: EmbeddedObjectBorder;
}

export interface EmbeddedObjectPosition {
  sheetId?: number;
  overlayPosition?: OverlayPosition;
  newSheet?: boolean;
}

export interface OverlayPosition {
  anchorCell?: GridCoordinate;
  offsetXPixels?: number;
  offsetYPixels?: number;
  widthPixels?: number;
  heightPixels?: number;
}

export interface GridCoordinate {
  sheetId?: number;
  rowIndex?: number;
  columnIndex?: number;
}

export interface ChartSpec {
  title?: string;
  altText?: string;
  titleTextFormat?: TextFormat;
  titleTextPosition?: TextPosition;
  subtitle?: string;
  subtitleTextFormat?: TextFormat;
  subtitleTextPosition?: TextPosition;
  fontName?: string;
  maximized?: boolean;
  backgroundColor?: RgbColor;
  backgroundColorStyle?: ColorStyle;
  dataSourceChartProperties?: DataSourceChartProperties;
  filterSpecs?: FilterSpec[];
  sortSpecs?: SortSpec[];
  hiddenDimensionStrategy?: string;
  basicChart?: BasicChartSpec;
  pieChart?: PieChartSpec;
  bubbleChart?: BubbleChartSpec;
  candlestickChart?: CandlestickChartSpec;
  orgChart?: OrgChartSpec;
  histogramChart?: HistogramChartSpec;
  waterfallChart?: WaterfallChartSpec;
  treemapChart?: TreemapChartSpec;
  scorecardChart?: ScorecardChartSpec;
}

export interface TextPosition {
  horizontalAlignment?: string;
}

export interface DataSourceChartProperties {
  dataSourceId?: string;
  dataExecutionStatus?: DataExecutionStatus;
}

export interface BasicChartSpec {
  chartType?: string;
  legendPosition?: string;
  axis?: BasicChartAxis[];
  domains?: BasicChartDomain[];
  series?: BasicChartSeries[];
  headerCount?: number;
  threeDimensional?: boolean;
  interpolateNulls?: boolean;
  stackedType?: string;
  lineSmoothing?: boolean;
  compareMode?: string;
  totalDataLabel?: DataLabel;
}

export interface BasicChartAxis {
  position?: string;
  title?: string;
  format?: TextFormat;
  titleTextPosition?: TextPosition;
  viewWindowOptions?: ChartAxisViewWindowOptions;
}

export interface ChartAxisViewWindowOptions {
  viewWindowMin?: number;
  viewWindowMax?: number;
  viewWindowMode?: string;
}

export interface BasicChartDomain {
  domain?: ChartData;
  reversed?: boolean;
}

export interface ChartData {
  sourceRange?: ChartSourceRange;
  columnReference?: DataSourceColumnReference;
  aggregateType?: string;
  groupRule?: ChartGroupRule;
}

export interface ChartSourceRange {
  sources?: GridRange[];
}

export interface ChartGroupRule {
  dateTimeRule?: ChartDateTimeRule;
  histogramRule?: ChartHistogramRule;
}

export interface ChartDateTimeRule {
  type?: string;
}

export interface ChartHistogramRule {
  minValue?: number;
  maxValue?: number;
  intervalSize?: number;
}

export interface BasicChartSeries {
  series?: ChartData;
  targetAxis?: string;
  type?: string;
  lineStyle?: LineStyle;
  color?: RgbColor;
  colorStyle?: ColorStyle;
  dataLabel?: DataLabel;
  pointStyle?: PointStyle;
  styleOverrides?: BasicSeriesDataPointStyleOverride[];
}

export interface LineStyle {
  width?: number;
  type?: string;
}

export interface DataLabel {
  type?: string;
  textFormat?: TextFormat;
  placement?: string;
  customLabelData?: ChartData;
}

export interface PointStyle {
  size?: number;
  shape?: string;
}

export interface BasicSeriesDataPointStyleOverride {
  index?: number;
  color?: RgbColor;
  colorStyle?: ColorStyle;
  pointStyle?: PointStyle;
}

export interface PieChartSpec {
  legendPosition?: string;
  domain?: ChartData;
  series?: ChartData;
  threeDimensional?: boolean;
  pieHole?: number;
}

export interface BubbleChartSpec {
  legendPosition?: string;
  bubbleLabels?: ChartData;
  domain?: ChartData;
  series?: ChartData;
  groupIds?: ChartData;
  bubbleSizes?: ChartData;
  bubbleOpacity?: number;
  bubbleBorderColor?: RgbColor;
  bubbleBorderColorStyle?: ColorStyle;
  bubbleMaxRadiusSize?: number;
  bubbleMinRadiusSize?: number;
  bubbleTextStyle?: TextFormat;
}

export interface CandlestickChartSpec {
  domain?: CandlestickDomain;
  data?: CandlestickData[];
}

export interface CandlestickDomain {
  data?: ChartData;
  reversed?: boolean;
}

export interface CandlestickData {
  lowSeries?: CandlestickSeries;
  openSeries?: CandlestickSeries;
  closeSeries?: CandlestickSeries;
  highSeries?: CandlestickSeries;
}

export interface CandlestickSeries {
  data?: ChartData;
}

export interface OrgChartSpec {
  nodeSize?: string;
  nodeColor?: RgbColor;
  nodeColorStyle?: ColorStyle;
  selectedNodeColor?: RgbColor;
  selectedNodeColorStyle?: ColorStyle;
  labels?: ChartData;
  parentLabels?: ChartData;
  tooltips?: ChartData;
}

export interface HistogramChartSpec {
  series?: HistogramSeries[];
  legendPosition?: string;
  showItemDividers?: boolean;
  bucketSize?: number;
  outlierPercentile?: number;
}

export interface HistogramSeries {
  barColor?: RgbColor;
  barColorStyle?: ColorStyle;
  data?: ChartData;
}

export interface WaterfallChartSpec {
  domain?: WaterfallChartDomain;
  series?: WaterfallChartSeries[];
  stackedType?: string;
  firstValueIsTotal?: boolean;
  hideConnectorLines?: boolean;
  connectorLineStyle?: LineStyle;
  totalDataLabel?: DataLabel;
}

export interface WaterfallChartDomain {
  data?: ChartData;
  reversed?: boolean;
}

export interface WaterfallChartSeries {
  data?: ChartData;
  positiveColumnsStyle?: WaterfallChartColumnStyle;
  negativeColumnsStyle?: WaterfallChartColumnStyle;
  subtotalColumnsStyle?: WaterfallChartColumnStyle;
  hideTrailingSubtotal?: boolean;
  customSubtotals?: WaterfallChartCustomSubtotal[];
  dataLabel?: DataLabel;
}

export interface WaterfallChartColumnStyle {
  label?: string;
  color?: RgbColor;
  colorStyle?: ColorStyle;
}

export interface WaterfallChartCustomSubtotal {
  subtotalIndex?: number;
  label?: string;
  dataIsSubtotal?: boolean;
}

export interface TreemapChartSpec {
  labels?: ChartData;
  parentLabels?: ChartData;
  sizeData?: ChartData;
  colorData?: ChartData;
  textFormat?: TextFormat;
  levels?: number;
  hintedLevels?: number;
  minValue?: number;
  maxValue?: number;
  headerColor?: RgbColor;
  headerColorStyle?: ColorStyle;
  colorScale?: TreemapChartColorScale;
  hideTooltips?: boolean;
}

export interface TreemapChartColorScale {
  minValueColor?: RgbColor;
  minValueColorStyle?: ColorStyle;
  midValueColor?: RgbColor;
  midValueColorStyle?: ColorStyle;
  maxValueColor?: RgbColor;
  maxValueColorStyle?: ColorStyle;
  noDataColor?: RgbColor;
  noDataColorStyle?: ColorStyle;
}

export interface ScorecardChartSpec {
  keyValueData?: ChartData;
  baselineValueData?: ChartData;
  aggregateType?: string;
  keyValueFormat?: KeyValueFormat;
  baselineValueFormat?: BaselineValueFormat;
  scaleFactor?: number;
  numberFormatSource?: string;
  customFormatOptions?: ChartCustomNumberFormatOptions;
}

export interface KeyValueFormat {
  textFormat?: TextFormat;
  position?: TextPosition;
}

export interface BaselineValueFormat {
  comparisonType?: string;
  textFormat?: TextFormat;
  position?: TextPosition;
  description?: string;
  positiveColor?: RgbColor;
  positiveColorStyle?: ColorStyle;
  negativeColor?: RgbColor;
  negativeColorStyle?: ColorStyle;
}

export interface ChartCustomNumberFormatOptions {
  prefix?: string;
  suffix?: string;
}

// EmbeddedObjectBorder defined earlier (for Docs) - Sheets uses same structure

export interface BandedRange {
  bandedRangeId?: number;
  range?: GridRange;
  rowProperties?: BandingProperties;
  columnProperties?: BandingProperties;
}

export interface BandingProperties {
  headerColor?: RgbColor;
  headerColorStyle?: ColorStyle;
  firstBandColor?: RgbColor;
  firstBandColorStyle?: ColorStyle;
  secondBandColor?: RgbColor;
  secondBandColorStyle?: ColorStyle;
  footerColor?: RgbColor;
  footerColorStyle?: ColorStyle;
}

export interface DeveloperMetadata {
  metadataId?: number;
  metadataKey?: string;
  metadataValue?: string;
  location?: DeveloperMetadataLocation;
  visibility?: 'DEVELOPER_METADATA_VISIBILITY_UNSPECIFIED' | 'DOCUMENT' | 'PROJECT';
}

export interface DeveloperMetadataLocation {
  locationType?: 'DEVELOPER_METADATA_LOCATION_TYPE_UNSPECIFIED' | 'ROW' | 'COLUMN' | 'SHEET' | 'SPREADSHEET';
  spreadsheet?: boolean;
  sheetId?: number;
  dimensionRange?: DimensionRange;
}

export interface DimensionRange {
  sheetId?: number;
  dimension?: 'DIMENSION_UNSPECIFIED' | 'ROWS' | 'COLUMNS';
  startIndex?: number;
  endIndex?: number;
}

export interface DimensionGroup {
  range?: DimensionRange;
  depth?: number;
  collapsed?: boolean;
}

export interface Slicer {
  slicerId?: number;
  spec?: SlicerSpec;
  position?: EmbeddedObjectPosition;
}

export interface SlicerSpec {
  dataRange?: GridRange;
  filterCriteria?: FilterCriteria;
  columnIndex?: number;
  applyToPivotTables?: boolean;
  title?: string;
  textFormat?: TextFormat;
  backgroundColor?: RgbColor;
  backgroundColorStyle?: ColorStyle;
  horizontalAlignment?: string;
}

export interface DataSourceSheetProperties {
  dataSourceId?: string;
  columns?: DataSourceColumn[];
  dataExecutionStatus?: DataExecutionStatus;
}

export interface DataSourceColumn {
  reference?: DataSourceColumnReference;
  formula?: string;
}

export interface SpreadsheetCreateParams {
  title: string;
  sheets?: Array<{
    title?: string;
    gridProperties?: {
      rowCount?: number;
      columnCount?: number;
    };
  }>;
}

export interface ValueRange {
  range?: string;
  majorDimension?: 'ROWS' | 'COLUMNS';
  values?: unknown[][];
}

export interface UpdateValuesResponse {
  spreadsheetId: string;
  updatedRange: string;
  updatedRows: number;
  updatedColumns: number;
  updatedCells: number;
  updatedData?: ValueRange;
}

export interface AppendValuesResponse {
  spreadsheetId: string;
  tableRange?: string;
  updates?: UpdateValuesResponse;
}

export interface BatchGetValuesResponse {
  spreadsheetId: string;
  valueRanges?: ValueRange[];
}

export interface BatchUpdateValuesRequest {
  valueInputOption: 'INPUT_VALUE_OPTION_UNSPECIFIED' | 'RAW' | 'USER_ENTERED';
  data: ValueRange[];
  includeValuesInResponse?: boolean;
  responseValueRenderOption?: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' | 'FORMULA';
  responseDateTimeRenderOption?: 'SERIAL_NUMBER' | 'FORMATTED_STRING';
}

export interface BatchUpdateValuesResponse {
  spreadsheetId: string;
  totalUpdatedRows: number;
  totalUpdatedColumns: number;
  totalUpdatedCells: number;
  totalUpdatedSheets: number;
  responses?: UpdateValuesResponse[];
}

export interface ClearValuesResponse {
  spreadsheetId: string;
  clearedRange: string;
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class GoogleApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'GoogleApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
