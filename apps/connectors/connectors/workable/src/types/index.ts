// Workable SPI v3 API Types

export interface ConnectorConfig {
  apiKey?: string;
  token?: string;
  subdomain?: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export type JobState = 'draft' | 'published' | 'archived' | 'closed';

export interface Salary {
  amount: number;
  currency: string;
}

export interface JobLocation {
  country_code?: string;
  country?: string;
  region?: string;
  city?: string;
  zip_code?: string;
  telecommuting?: boolean;
}

export interface Job {
  id?: string;
  shortcode?: string;
  title?: string;
  full_title?: string;
  state?: JobState;
  description?: string;
  requirements?: string;
  benefits?: string;
  department?: string;
  department_hierarchy?: Array<{ id: string; name: string }>;
  url?: string;
  application_url?: string;
  shortlink?: string;
  created_at?: string;
  locations?: JobLocation[];
}

export interface ListJobsParams {
  state?: JobState;
  limit?: number;
  sinceId?: string;
  createdAfter?: string;
}

export interface CreateJobParams {
  title: string;
  full_title?: string;
  locations?: JobLocation[];
  description?: string;
  requirements?: string;
  benefits?: string;
  departmentId?: string;
  functionId?: string;
  industryId?: string;
  experience?: string;
  education?: string;
  salary?: Salary;
  remote?: boolean;
  employment_type?: string;
}

export interface CandidateEducation {
  school?: string;
  degree?: string;
  field_of_study?: string;
  start_date?: string;
  end_date?: string;
}

export interface CandidateExperience {
  title?: string;
  company?: string;
  summary?: string;
  start_date?: string;
  end_date?: string;
  current?: boolean;
}

export interface SocialProfile {
  type?: string;
  url?: string;
}

export interface CandidateInput {
  name: string;
  email?: string;
  firstname?: string;
  lastname?: string;
  headline?: string;
  summary?: string;
  phone?: string;
  education?: CandidateEducation[];
  experience?: CandidateExperience[];
  skills?: string[];
  social_profiles?: SocialProfile[];
  resume_url?: string;
}

export interface Candidate {
  id?: string;
  name?: string;
  firstname?: string;
  lastname?: string;
  headline?: string;
  email?: string;
  phone?: string;
  stage?: string;
  disqualified?: boolean;
  sourced?: boolean;
  profile_url?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ListJobCandidatesParams {
  shortcode: string;
  stage?: string;
  state?: string;
  limit?: number;
  sinceId?: string;
}

export interface CreateCandidateParams {
  shortcode: string;
  candidate: CandidateInput;
  domain?: 'all' | 'candidate' | 'talent_pool';
}

export interface UpdateCandidateParams {
  id: string;
  candidate: Partial<CandidateInput>;
}

export interface MoveCandidateParams {
  id: string;
  targetStage: string;
}

export interface CopyCandidateParams {
  id: string;
  targetJobShortcode: string;
}

export interface DisqualifyCandidateParams {
  id: string;
  disqualificationReason?: string;
  disqualifiedBy?: string;
}

export interface Comment {
  id?: string;
  body?: string;
  member_id?: string;
  created_at?: string;
}

export interface AddCommentParams {
  candidateId: string;
  body: string;
  memberId?: string;
}

export interface Activity {
  id?: string;
  action?: string;
  created_at?: string;
  member?: { id?: string; name?: string };
}

export interface ListActivitiesParams {
  candidateId: string;
  limit?: number;
  sinceId?: string;
}

export interface Offer {
  id?: string;
  state?: string;
  salary?: Salary;
  start_date?: string;
  created_at?: string;
}

export interface CreateOfferParams {
  candidateId: string;
  templateId?: string;
  salary?: Salary;
  startDate?: string;
  documents?: Array<Record<string, unknown>>;
}

export interface Member {
  id?: string;
  name?: string;
  email?: string;
  role?: string;
}

export interface Stage {
  slug?: string;
  name?: string;
  kind?: string;
  position?: number;
}

export interface Department {
  id?: string;
  name?: string;
  parent_id?: string;
}

export interface DisqualificationReason {
  id?: string;
  name?: string;
}

export interface CustomAttribute {
  id?: string;
  name?: string;
  type?: string;
}

export interface EventAttendee {
  email: string;
  name?: string;
}

export interface Event {
  id?: string;
  type?: string;
  start_at?: string;
  duration?: number;
  description?: string;
  agenda?: string;
}

export interface ScheduleEventParams {
  candidateId: string;
  type: string;
  startAt: string;
  durationMinutes?: number;
  description?: string;
  attendees?: EventAttendee[];
  agenda?: string;
}

export interface WorkableListResponse<T> {
  jobs?: T[];
  candidates?: T[];
  members?: T[];
  recruiters?: T[];
  stages?: T[];
  departments?: T[];
  disqualification_reasons?: T[];
  custom_attributes?: T[];
  comments?: T[];
  activities?: T[];
  events?: T[];
}

export class ConnectorApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: Array<{ message: string; field?: string }>;

  constructor(
    message: string,
    statusCode: number,
    options?: { errors?: Array<{ message: string; field?: string }> },
  ) {
    super(message);
    this.name = 'ConnectorApiError';
    this.statusCode = statusCode;
    this.errors = options?.errors;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }

  isNotFound(): boolean {
    return this.statusCode === 404;
  }

  getUserMessage(): string {
    switch (this.statusCode) {
      case 401:
        return 'Authentication failed. Check WORKABLE_API_TOKEN.';
      case 403:
        return 'Access denied for this Workable account.';
      case 404:
        return 'Resource not found.';
      case 429:
        return 'Rate limit exceeded. Please wait and try again.';
      default:
        return this.message;
    }
  }
}

export function parseApiError(response: unknown, statusCode: number): ConnectorApiError {
  if (typeof response === 'string') {
    return new ConnectorApiError(response, statusCode);
  }

  if (!response || typeof response !== 'object') {
    return new ConnectorApiError(`HTTP ${statusCode} Error`, statusCode);
  }

  const data = response as Record<string, unknown>;
  const message =
    (data.message as string) ||
    (data.error as string) ||
    `HTTP ${statusCode} Error`;

  return new ConnectorApiError(message, statusCode);
}
