export interface LiveAgentConfig { domain: string; apiKey: string; }

export interface LATicket { id: string; code: string; subject: string; status: string; department_id: string; agent_id: string | null; requester_email: string; requester_name: string; date_created: string; date_changed: string; messages: LAMessage[]; tags: string[]; }
export interface LAMessage { id: string; type: string; body: string; author_email: string; author_name: string; date_created: string; }
export interface LAAgent { id: string; firstname: string; lastname: string; email: string; status: string; role: string; department_ids: string[]; }
export interface LADepartment { id: string; name: string; status: string; agent_count: number; }
export interface LAContact { id: string; email: string; firstname: string; lastname: string; phone: string; company: string; date_created: string; }
export interface LAChatSession { id: string; visitor_name: string; visitor_email: string; status: string; department_id: string; agent_id: string | null; date_created: string; }

export class LiveAgentApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'LiveAgentApiError'; this.statusCode = statusCode; }
}
