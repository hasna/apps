// Tableau Connector Types

// ============================================
// Configuration
// ============================================

// Tableau supports two credential methods:
//  - Personal Access Token (patName + patSecret)
//  - Username + password
// A site content URL scopes every request (empty string = Default site).
export interface TableauConfig {
  serverUrl: string;
  siteName?: string;
  apiVersion?: string;
  username?: string;
  password?: string;
  patName?: string;
  patSecret?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'table' | 'pretty';

export interface Pagination {
  pageNumber: string;
  pageSize: string;
  totalAvailable: string;
}

export interface PageOptions {
  pageSize?: number;
  pageNumber?: number;
}

// ============================================
// Sign-in Types
// ============================================

export interface SignInResponse {
  credentials: {
    site: {
      id: string;
      contentUrl: string;
    };
    user: {
      id: string;
    };
    token: string;
  };
}

export interface SignInState {
  token: string;
  siteId: string;
  userId: string;
}

// ============================================
// Project Types
// ============================================

export interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
  contentPermissions?: string;
  parentProjectId?: string;
}

export interface ProjectsResponse {
  pagination?: Pagination;
  projects: {
    project: Project[];
  };
}

// ============================================
// Workbook Types
// ============================================

export interface Workbook {
  id: string;
  name: string;
  description?: string;
  contentUrl?: string;
  webpageUrl?: string;
  showTabs?: string;
  size?: string;
  createdAt?: string;
  updatedAt?: string;
  project?: {
    id: string;
    name: string;
  };
  owner?: {
    id: string;
    name?: string;
  };
  tags?: {
    tag?: Array<{ label: string }>;
  };
}

export interface WorkbooksResponse {
  pagination?: Pagination;
  workbooks: {
    workbook: Workbook[];
  };
}

export interface WorkbookResponse {
  workbook: Workbook;
}

// ============================================
// View Types
// ============================================

export interface View {
  id: string;
  name: string;
  contentUrl?: string;
  createdAt?: string;
  updatedAt?: string;
  viewUrlName?: string;
  workbook?: {
    id: string;
  };
  owner?: {
    id: string;
  };
  project?: {
    id: string;
  };
  usage?: {
    totalViewCount?: string;
  };
  tags?: {
    tag?: Array<{ label: string }>;
  };
}

export interface ViewsResponse {
  pagination?: Pagination;
  views: {
    view: View[];
  };
}

export interface ViewResponse {
  view: View;
}

// ============================================
// Data Source Types
// ============================================

export interface DataSource {
  id: string;
  name: string;
  description?: string;
  contentUrl?: string;
  webpageUrl?: string;
  type?: string;
  createdAt?: string;
  updatedAt?: string;
  isCertified?: string;
  project?: {
    id: string;
    name: string;
  };
  owner?: {
    id: string;
  };
  tags?: {
    tag?: Array<{ label: string }>;
  };
}

export interface DataSourcesResponse {
  pagination?: Pagination;
  datasources: {
    datasource: DataSource[];
  };
}

// ============================================
// User Types
// ============================================

export interface User {
  id: string;
  name: string;
  fullName?: string;
  email?: string;
  siteRole?: string;
  lastLogin?: string;
  externalAuthUserId?: string;
  authSetting?: string;
}

export interface UsersResponse {
  pagination?: Pagination;
  users: {
    user: User[];
  };
}

// ============================================
// API Error Types
// ============================================

export interface TableauErrorResponse {
  error?: {
    summary?: string;
    detail?: string;
    code?: string;
  };
}

export class TableauApiError extends Error {
  public readonly statusCode: number;
  public readonly tableauCode?: string;
  public readonly detail?: string;

  constructor(message: string, statusCode: number, tableauCode?: string, detail?: string) {
    super(message);
    this.name = 'TableauApiError';
    this.statusCode = statusCode;
    this.tableauCode = tableauCode;
    this.detail = detail;
  }
}
