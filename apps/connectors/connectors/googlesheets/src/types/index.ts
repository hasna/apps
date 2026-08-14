// Google Sheets API v4 Types

// ============================================
// Configuration
// ============================================

export interface GoogleSheetsConfig {
  /** API key for read-only access to public spreadsheets */
  apiKey?: string;
  /** OAuth access token for full read/write access */
  accessToken?: string;
  /** OAuth refresh token for token renewal */
  refreshToken?: string;
  /** OAuth client ID */
  clientId?: string;
  /** OAuth client secret */
  clientSecret?: string;
  /** Override default base URL */
  baseUrl?: string;
}

// ============================================
// Authentication Types
// ============================================

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType?: string;
  scope?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export type ValueInputOption = 'RAW' | 'USER_ENTERED';
export type ValueRenderOption = 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' | 'FORMULA';
export type InsertDataOption = 'OVERWRITE' | 'INSERT_ROWS';
export type DateTimeRenderOption = 'SERIAL_NUMBER' | 'FORMATTED_STRING';

// ============================================
// Spreadsheet Types
// ============================================

export interface Spreadsheet {
  spreadsheetId: string;
  properties: SpreadsheetProperties;
  sheets?: Sheet[];
  namedRanges?: NamedRange[];
  spreadsheetUrl?: string;
}

export interface SpreadsheetProperties {
  title: string;
  locale?: string;
  autoRecalc?: 'ON_CHANGE' | 'MINUTE' | 'HOUR';
  timeZone?: string;
  defaultFormat?: CellFormat;
}

export interface Sheet {
  properties: SheetProperties;
  data?: GridData[];
  merges?: GridRange[];
  conditionalFormats?: ConditionalFormatRule[];
  filterViews?: FilterView[];
  charts?: EmbeddedChart[];
  basicFilter?: BasicFilter;
}

export interface SheetProperties {
  sheetId: number;
  title: string;
  index?: number;
  sheetType?: 'GRID' | 'OBJECT' | 'DATA_SOURCE';
  gridProperties?: GridProperties;
  hidden?: boolean;
  tabColor?: Color;
  tabColorStyle?: ColorStyle;
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

export interface NamedRange {
  namedRangeId: string;
  name: string;
  range: GridRange;
}

export interface GridRange {
  sheetId?: number;
  startRowIndex?: number;
  endRowIndex?: number;
  startColumnIndex?: number;
  endColumnIndex?: number;
}

// ============================================
// Cell and Value Types
// ============================================

export interface CellData {
  userEnteredValue?: ExtendedValue;
  effectiveValue?: ExtendedValue;
  formattedValue?: string;
  userEnteredFormat?: CellFormat;
  effectiveFormat?: CellFormat;
  hyperlink?: string;
  note?: string;
}

export interface ExtendedValue {
  numberValue?: number;
  stringValue?: string;
  boolValue?: boolean;
  formulaValue?: string;
  errorValue?: ErrorValue;
}

export interface ErrorValue {
  type: 'ERROR_TYPE_UNSPECIFIED' | 'ERROR' | 'NULL_VALUE' | 'DIVIDE_BY_ZERO' | 'VALUE' | 'REF' | 'NAME' | 'NUM' | 'N_A' | 'LOADING';
  message?: string;
}

export interface CellFormat {
  numberFormat?: NumberFormat;
  backgroundColor?: Color;
  backgroundColorStyle?: ColorStyle;
  borders?: Borders;
  padding?: Padding;
  horizontalAlignment?: 'LEFT' | 'CENTER' | 'RIGHT';
  verticalAlignment?: 'TOP' | 'MIDDLE' | 'BOTTOM';
  wrapStrategy?: 'OVERFLOW_CELL' | 'LEGACY_WRAP' | 'CLIP' | 'WRAP';
  textDirection?: 'LEFT_TO_RIGHT' | 'RIGHT_TO_LEFT';
  textFormat?: TextFormat;
  hyperlinkDisplayType?: 'LINKED' | 'PLAIN_TEXT';
  textRotation?: TextRotation;
}

export interface NumberFormat {
  type: 'TEXT' | 'NUMBER' | 'PERCENT' | 'CURRENCY' | 'DATE' | 'TIME' | 'DATE_TIME' | 'SCIENTIFIC';
  pattern?: string;
}

export interface Color {
  red?: number;
  green?: number;
  blue?: number;
  alpha?: number;
}

export interface ColorStyle {
  rgbColor?: Color;
  themeColor?: string;
}

export interface Borders {
  top?: Border;
  bottom?: Border;
  left?: Border;
  right?: Border;
}

export interface Border {
  style?: 'NONE' | 'DOTTED' | 'DASHED' | 'SOLID' | 'SOLID_MEDIUM' | 'SOLID_THICK' | 'DOUBLE';
  width?: number;
  color?: Color;
  colorStyle?: ColorStyle;
}

export interface Padding {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

export interface TextFormat {
  foregroundColor?: Color;
  foregroundColorStyle?: ColorStyle;
  fontFamily?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
  link?: Link;
}

export interface Link {
  uri?: string;
}

export interface TextRotation {
  angle?: number;
  vertical?: boolean;
}

// ============================================
// Value Range Types
// ============================================

export interface ValueRange {
  range: string;
  majorDimension?: 'ROWS' | 'COLUMNS';
  values?: CellValue[][];
}

export type CellValue = string | number | boolean | null;

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
  updates: UpdateValuesResponse;
}

export interface ClearValuesResponse {
  spreadsheetId: string;
  clearedRange: string;
}

export interface BatchGetValuesResponse {
  spreadsheetId: string;
  valueRanges: ValueRange[];
}

export interface BatchUpdateValuesRequest {
  valueInputOption: ValueInputOption;
  data: ValueRange[];
  includeValuesInResponse?: boolean;
  responseValueRenderOption?: ValueRenderOption;
  responseDateTimeRenderOption?: DateTimeRenderOption;
}

export interface BatchUpdateValuesResponse {
  spreadsheetId: string;
  totalUpdatedRows: number;
  totalUpdatedColumns: number;
  totalUpdatedCells: number;
  totalUpdatedSheets: number;
  responses: UpdateValuesResponse[];
}

// ============================================
// Batch Update Request Types
// ============================================

export interface BatchUpdateSpreadsheetRequest {
  requests: Request[];
  includeSpreadsheetInResponse?: boolean;
  responseRanges?: string[];
  responseIncludeGridData?: boolean;
}

export interface BatchUpdateSpreadsheetResponse {
  spreadsheetId: string;
  replies: Response[];
  updatedSpreadsheet?: Spreadsheet;
}

export interface Request {
  updateSpreadsheetProperties?: UpdateSpreadsheetPropertiesRequest;
  updateSheetProperties?: UpdateSheetPropertiesRequest;
  addSheet?: AddSheetRequest;
  deleteSheet?: DeleteSheetRequest;
  duplicateSheet?: DuplicateSheetRequest;
  copyPaste?: CopyPasteRequest;
  mergeCells?: MergeCellsRequest;
  unmergeCells?: UnmergeCellsRequest;
  updateCells?: UpdateCellsRequest;
  updateBorders?: UpdateBordersRequest;
  autoFill?: AutoFillRequest;
  cutPaste?: CutPasteRequest;
  appendCells?: AppendCellsRequest;
  clearBasicFilter?: ClearBasicFilterRequest;
  deleteDimension?: DeleteDimensionRequest;
  insertDimension?: InsertDimensionRequest;
  moveDimension?: MoveDimensionRequest;
  updateDimensionProperties?: UpdateDimensionPropertiesRequest;
  autoResizeDimensions?: AutoResizeDimensionsRequest;
  addNamedRange?: AddNamedRangeRequest;
  deleteNamedRange?: DeleteNamedRangeRequest;
  updateNamedRange?: UpdateNamedRangeRequest;
  repeatCell?: RepeatCellRequest;
  addFilterView?: AddFilterViewRequest;
  appendDimension?: AppendDimensionRequest;
  updateFilterView?: UpdateFilterViewRequest;
  deleteFilterView?: DeleteFilterViewRequest;
  sortRange?: SortRangeRequest;
  setDataValidation?: SetDataValidationRequest;
  setBasicFilter?: SetBasicFilterRequest;
  addProtectedRange?: AddProtectedRangeRequest;
  updateProtectedRange?: UpdateProtectedRangeRequest;
  deleteProtectedRange?: DeleteProtectedRangeRequest;
  addConditionalFormatRule?: AddConditionalFormatRuleRequest;
  updateConditionalFormatRule?: UpdateConditionalFormatRuleRequest;
  deleteConditionalFormatRule?: DeleteConditionalFormatRuleRequest;
  findReplace?: FindReplaceRequest;
}

export interface Response {
  addSheet?: { properties: SheetProperties };
  duplicateSheet?: { properties: SheetProperties };
  addNamedRange?: { namedRange: NamedRange };
  addFilterView?: { filter: FilterView };
  findReplace?: FindReplaceResponse;
  addProtectedRange?: { protectedRange: ProtectedRange };
  addConditionalFormatRule?: { index: number };
}

// ============================================
// Request Detail Types
// ============================================

export interface UpdateSpreadsheetPropertiesRequest {
  properties: SpreadsheetProperties;
  fields: string;
}

export interface UpdateSheetPropertiesRequest {
  properties: SheetProperties;
  fields: string;
}

export interface AddSheetRequest {
  properties?: SheetProperties;
}

export interface DeleteSheetRequest {
  sheetId: number;
}

export interface DuplicateSheetRequest {
  sourceSheetId: number;
  insertSheetIndex?: number;
  newSheetId?: number;
  newSheetName?: string;
}

export interface CopyPasteRequest {
  source: GridRange;
  destination: GridRange;
  pasteType?: 'PASTE_NORMAL' | 'PASTE_VALUES' | 'PASTE_FORMAT' | 'PASTE_NO_BORDERS' | 'PASTE_FORMULA' | 'PASTE_DATA_VALIDATION' | 'PASTE_CONDITIONAL_FORMATTING';
  pasteOrientation?: 'NORMAL' | 'TRANSPOSE';
}

export interface MergeCellsRequest {
  range: GridRange;
  mergeType?: 'MERGE_ALL' | 'MERGE_COLUMNS' | 'MERGE_ROWS';
}

export interface UnmergeCellsRequest {
  range: GridRange;
}

export interface UpdateCellsRequest {
  rows?: RowData[];
  fields: string;
  start?: GridCoordinate;
  range?: GridRange;
}

export interface RowData {
  values?: CellData[];
}

export interface GridCoordinate {
  sheetId?: number;
  rowIndex?: number;
  columnIndex?: number;
}

export interface UpdateBordersRequest {
  range: GridRange;
  top?: Border;
  bottom?: Border;
  left?: Border;
  right?: Border;
  innerHorizontal?: Border;
  innerVertical?: Border;
}

export interface AutoFillRequest {
  useAlternateSeries?: boolean;
  range: GridRange;
  sourceAndDestination?: SourceAndDestination;
}

export interface SourceAndDestination {
  source: GridRange;
  dimension: 'ROWS' | 'COLUMNS';
  fillLength?: number;
}

export interface CutPasteRequest {
  source: GridRange;
  destination: GridCoordinate;
  pasteType?: 'PASTE_NORMAL' | 'PASTE_VALUES' | 'PASTE_FORMAT' | 'PASTE_NO_BORDERS' | 'PASTE_FORMULA' | 'PASTE_DATA_VALIDATION' | 'PASTE_CONDITIONAL_FORMATTING';
}

export interface AppendCellsRequest {
  sheetId: number;
  rows: RowData[];
  fields: string;
}

export interface ClearBasicFilterRequest {
  sheetId: number;
}

export interface DeleteDimensionRequest {
  range: DimensionRange;
}

export interface InsertDimensionRequest {
  range: DimensionRange;
  inheritFromBefore?: boolean;
}

export interface MoveDimensionRequest {
  source: DimensionRange;
  destinationIndex: number;
}

export interface UpdateDimensionPropertiesRequest {
  range: DimensionRange;
  properties: DimensionProperties;
  fields: string;
}

export interface AutoResizeDimensionsRequest {
  dimensions: DimensionRange;
}

export interface DimensionRange {
  sheetId?: number;
  dimension: 'ROWS' | 'COLUMNS';
  startIndex?: number;
  endIndex?: number;
}

export interface DimensionProperties {
  hiddenByFilter?: boolean;
  hiddenByUser?: boolean;
  pixelSize?: number;
  developerMetadata?: DeveloperMetadata[];
}

export interface DeveloperMetadata {
  metadataId?: number;
  metadataKey: string;
  metadataValue?: string;
  location?: DeveloperMetadataLocation;
  visibility?: 'DOCUMENT' | 'PROJECT';
}

export interface DeveloperMetadataLocation {
  locationType?: 'ROW' | 'COLUMN' | 'SHEET' | 'SPREADSHEET';
  spreadsheet?: boolean;
  sheetId?: number;
  dimensionRange?: DimensionRange;
}

export interface AddNamedRangeRequest {
  namedRange: NamedRange;
}

export interface DeleteNamedRangeRequest {
  namedRangeId: string;
}

export interface UpdateNamedRangeRequest {
  namedRange: NamedRange;
  fields: string;
}

export interface RepeatCellRequest {
  range: GridRange;
  cell: CellData;
  fields: string;
}

export interface AddFilterViewRequest {
  filter: FilterView;
}

export interface AppendDimensionRequest {
  sheetId: number;
  dimension: 'ROWS' | 'COLUMNS';
  length: number;
}

export interface UpdateFilterViewRequest {
  filter: FilterView;
  fields: string;
}

export interface DeleteFilterViewRequest {
  filterId: number;
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
  sortOrder?: 'ASCENDING' | 'DESCENDING';
  foregroundColor?: Color;
  foregroundColorStyle?: ColorStyle;
  backgroundColor?: Color;
  backgroundColorStyle?: ColorStyle;
}

export interface FilterCriteria {
  hiddenValues?: string[];
  condition?: BooleanCondition;
  visibleBackgroundColor?: Color;
  visibleBackgroundColorStyle?: ColorStyle;
  visibleForegroundColor?: Color;
  visibleForegroundColorStyle?: ColorStyle;
}

export interface FilterSpec {
  columnIndex?: number;
  filterCriteria?: FilterCriteria;
}

export interface BooleanCondition {
  type: string;
  values?: ConditionValue[];
}

export interface ConditionValue {
  relativeDate?: 'PAST_YEAR' | 'PAST_MONTH' | 'PAST_WEEK' | 'YESTERDAY' | 'TODAY' | 'TOMORROW';
  userEnteredValue?: string;
}

export interface SortRangeRequest {
  range: GridRange;
  sortSpecs: SortSpec[];
}

export interface SetDataValidationRequest {
  range: GridRange;
  rule?: DataValidationRule;
}

export interface DataValidationRule {
  condition: BooleanCondition;
  inputMessage?: string;
  strict?: boolean;
  showCustomUi?: boolean;
}

export interface SetBasicFilterRequest {
  filter: BasicFilter;
}

export interface BasicFilter {
  range?: GridRange;
  sortSpecs?: SortSpec[];
  criteria?: Record<string, FilterCriteria>;
  filterSpecs?: FilterSpec[];
}

export interface AddProtectedRangeRequest {
  protectedRange: ProtectedRange;
}

export interface UpdateProtectedRangeRequest {
  protectedRange: ProtectedRange;
  fields: string;
}

export interface DeleteProtectedRangeRequest {
  protectedRangeId: number;
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

export interface AddConditionalFormatRuleRequest {
  rule: ConditionalFormatRule;
  index?: number;
}

export interface UpdateConditionalFormatRuleRequest {
  index: number;
  rule?: ConditionalFormatRule;
  sheetId?: number;
  newIndex?: number;
}

export interface DeleteConditionalFormatRuleRequest {
  index: number;
  sheetId: number;
}

export interface ConditionalFormatRule {
  ranges: GridRange[];
  booleanRule?: BooleanRule;
  gradientRule?: GradientRule;
}

export interface BooleanRule {
  condition: BooleanCondition;
  format: CellFormat;
}

export interface GradientRule {
  minpoint: InterpolationPoint;
  midpoint?: InterpolationPoint;
  maxpoint: InterpolationPoint;
}

export interface InterpolationPoint {
  color?: Color;
  colorStyle?: ColorStyle;
  type?: 'MIN' | 'MAX' | 'NUMBER' | 'PERCENT' | 'PERCENTILE';
  value?: string;
}

export interface FindReplaceRequest {
  find: string;
  replacement?: string;
  matchCase?: boolean;
  matchEntireCell?: boolean;
  searchByRegex?: boolean;
  includeFormulas?: boolean;
  range?: GridRange;
  sheetId?: number;
  allSheets?: boolean;
}

export interface FindReplaceResponse {
  valuesChanged: number;
  formulasChanged: number;
  rowsChanged: number;
  sheetsChanged: number;
  occurrencesChanged: number;
}

// ============================================
// Additional Types
// ============================================

export interface GridData {
  startRow?: number;
  startColumn?: number;
  rowData?: RowData[];
  rowMetadata?: DimensionProperties[];
  columnMetadata?: DimensionProperties[];
}

export interface EmbeddedChart {
  chartId?: number;
  position?: EmbeddedObjectPosition;
  spec?: ChartSpec;
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
  backgroundColor?: Color;
  backgroundColorStyle?: ColorStyle;
  hiddenDimensionStrategy?: 'CHART_HIDDEN_DIMENSION_STRATEGY_UNSPECIFIED' | 'SKIP_HIDDEN_ROWS_AND_COLUMNS' | 'SKIP_HIDDEN_ROWS' | 'SKIP_HIDDEN_COLUMNS' | 'SHOW_ALL';
}

export interface TextPosition {
  horizontalAlignment?: 'LEFT' | 'CENTER' | 'RIGHT';
}

// ============================================
// Copy Sheet Response
// ============================================

export interface CopySheetToAnotherSpreadsheetRequest {
  destinationSpreadsheetId: string;
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class GoogleSheetsApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'GoogleSheetsApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
