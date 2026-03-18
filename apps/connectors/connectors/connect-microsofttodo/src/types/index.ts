export interface MSTodoConfig { token: string; }

export interface MTTaskList { id: string; displayName: string; isOwner: boolean; isShared: boolean; wellknownListName: string; }
export interface MTTask { id: string; title: string; body: { content: string; contentType: string }; status: 'notStarted' | 'inProgress' | 'completed' | 'waitingOnOthers' | 'deferred'; importance: 'low' | 'normal' | 'high'; isReminderOn: boolean; dueDateTime: { dateTime: string; timeZone: string } | null; completedDateTime: { dateTime: string; timeZone: string } | null; createdDateTime: string; lastModifiedDateTime: string; }
export interface MTChecklistItem { id: string; displayName: string; isChecked: boolean; createdDateTime: string; }

export class MSTodoApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'MSTodoApiError'; this.statusCode = statusCode; }
}
