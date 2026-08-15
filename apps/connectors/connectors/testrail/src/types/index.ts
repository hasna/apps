// TestRail Connector Types

export interface TestRailConfig {
  email: string;
  apiKey: string;
  baseUrl: string;
}

export type OutputFormat = 'json' | 'pretty' | 'table';

export interface TestRailError {
  error?: string;
}

export class TestRailApiError extends Error {
  public readonly statusCode: number;
  public readonly errorData?: TestRailError;

  constructor(message: string, statusCode: number, errorData?: TestRailError) {
    super(message);
    this.name = 'TestRailApiError';
    this.statusCode = statusCode;
    this.errorData = errorData;
  }
}

export interface Project {
  id: number;
  name: string;
  announcement?: string | null;
  show_announcement?: boolean;
  is_completed?: boolean;
  completed_on?: number | null;
  url?: string;
  suite_mode?: number;
}

export interface Case {
  id: number;
  title: string;
  section_id: number;
  template_id?: number;
  type_id?: number;
  priority_id?: number;
  milestone_id?: number | null;
  refs?: string | null;
  created_by?: number;
  created_on?: number;
  updated_by?: number;
  updated_on?: number;
  estimate?: string | null;
  estimate_forecast?: string | null;
  suite_id?: number;
  display_order?: number;
  custom_steps?: string | null;
  custom_expected?: string | null;
  custom_preconds?: string | null;
}

export interface Run {
  id: number;
  suite_id: number;
  name: string;
  description?: string | null;
  milestone_id?: number | null;
  assignedto_id?: number | null;
  include_all?: boolean;
  is_completed?: boolean;
  completed_on?: number | null;
  config?: string | null;
  config_ids?: number[];
  passed_count?: number;
  blocked_count?: number;
  untested_count?: number;
  retest_count?: number;
  failed_count?: number;
  project_id?: number;
  plan_id?: number | null;
  created_on?: number;
  updated_on?: number;
  url?: string;
}

export interface Result {
  id: number;
  test_id: number;
  status_id: number;
  created_on?: number;
  assignedto_id?: number | null;
  comment?: string | null;
  version?: string | null;
  elapsed?: string | null;
  defects?: string | null;
  created_by?: number;
}

export interface Plan {
  id: number;
  name: string;
  description?: string | null;
  milestone_id?: number | null;
  assignedto_id?: number | null;
  is_completed?: boolean;
  completed_on?: number | null;
  passed_count?: number;
  blocked_count?: number;
  untested_count?: number;
  retest_count?: number;
  failed_count?: number;
  project_id?: number;
  created_on?: number;
  url?: string;
}

export interface Milestone {
  id: number;
  name: string;
  description?: string | null;
  start_on?: number | null;
  started_on?: number | null;
  is_started?: boolean;
  is_completed?: boolean;
  completed_on?: number | null;
  due_on?: number | null;
  project_id?: number;
  url?: string;
}

export interface CreateCaseInput {
  title: string;
  section_id: number;
  template_id?: number;
  type_id?: number;
  priority_id?: number;
  milestone_id?: number;
  refs?: string;
  estimate?: string;
  custom_steps?: string;
  custom_expected?: string;
  custom_preconds?: string;
}

export interface UpdateCaseInput {
  title?: string;
  section_id?: number;
  template_id?: number;
  type_id?: number;
  priority_id?: number;
  milestone_id?: number;
  refs?: string;
  estimate?: string;
  custom_steps?: string;
  custom_expected?: string;
  custom_preconds?: string;
}

export interface CreateRunInput {
  name: string;
  description?: string;
  milestone_id?: number;
  assignedto_id?: number;
  include_all?: boolean;
  suite_id?: number;
  case_ids?: number[];
}

export interface AddResultInput {
  status_id: number;
  comment?: string;
  version?: string;
  elapsed?: string;
  defects?: string;
  assignedto_id?: number;
}
