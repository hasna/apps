export interface TurboHireConfig { apiKey: string; }

export interface THJob { id: string; title: string; department: string; location: string; type: string; status: string; description: string; requirements: string; created_at: string; updated_at: string; applicants_count: number; }
export interface THCandidate { id: string; name: string; email: string; phone: string; resume_url: string; score: number; stage: { id: string; name: string }; job_id: string; source: string; tags: string[]; created_at: string; }
export interface THCandidateList { candidates: THCandidate[]; total: number; page: number; per_page: number; }
export interface THStage { id: string; name: string; order: number; type: string; }
export interface THInterview { id: string; candidate_id: string; job_id: string; type: string; scheduled_at: string; duration: number; interviewers: { id: string; name: string; email: string }[]; status: string; feedback: string | null; }

export class TurboHireApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'TurboHireApiError'; this.statusCode = statusCode; }
}
