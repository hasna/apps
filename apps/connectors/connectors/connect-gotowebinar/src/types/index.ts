export interface GoToWebinarConfig { token: string; organizerKey: string; }

export interface GTWWebinar { webinarKey: string; subject: string; description: string; organizerKey: string; times: { startTime: string; endTime: string }[]; registrationUrl: string; numberOfRegistrants: number; }
export interface GTWRegistrant { registrantKey: string; firstName: string; lastName: string; email: string; status: string; registrationDate: string; joinUrl: string; }
export interface GTWAttendee { registrantKey: string; firstName: string; lastName: string; email: string; attendanceTimeInSeconds: number; joinTime: string; leaveTime: string; }
export interface GTWSession { webinarKey: string; sessionKey: string; startTime: string; endTime: string; registrantsAttended: number; }

export class GoToWebinarApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'GoToWebinarApiError'; this.statusCode = statusCode; }
}
