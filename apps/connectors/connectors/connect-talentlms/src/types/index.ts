export interface TalentLMSConfig {
  apiKey: string;
  domain: string; // e.g. "mycompany" for mycompany.talentlms.com
  baseUrl?: string;
}

export interface TLMSUser {
  id: number;
  login: string;
  first_name: string;
  last_name: string;
  email: string;
  user_type: 'Learner-Type' | 'Administrator-Type' | 'Instructor-Type';
  status: 'active' | 'inactive';
  points: number;
  level: string | null;
}

export interface TLMSCourse {
  id: number;
  name: string;
  description: string;
  status: 'active' | 'inactive' | 'inactive-temp';
  creator: string;
  creation_date: string;
  last_update_on: string;
  enrolled_users: number;
  completion_percentage: number;
  category_id: number | null;
  shared: string;
  shared_url: string;
}

export interface TLMSBranch {
  id: number;
  name: string;
  description: string | null;
  parent_branch_id: number | null;
}

export interface TLMSEnrollment {
  id: number;
  user_id: number;
  course_id: number;
  enrollment_date: string;
  status: 'not_attempted' | 'incomplete' | 'failed' | 'passed' | 'completed';
  completion_percentage: number;
  total_time: string;
}

export class TalentLMSApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'TalentLMSApiError';
    this.statusCode = statusCode;
  }
}
