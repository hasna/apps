export interface RocketChatConfig { url: string; authToken: string; userId: string; }

export interface RCUser { _id: string; username: string; name: string; emails: { address: string; verified: boolean }[]; status: string; roles: string[]; active: boolean; }
export interface RCChannel { _id: string; name: string; t: 'c' | 'p' | 'd'; msgs: number; usersCount: number; topic: string; description: string; }
export interface RCMessage { _id: string; rid: string; msg: string; ts: string; u: { _id: string; username: string; name: string }; mentions: { _id: string; username: string }[]; }
export interface RCMessageList { messages: RCMessage[]; count: number; offset: number; total: number; }
export interface RCRoom { _id: string; name: string; t: string; usernames: string[]; msgs: number; }

export class RocketChatApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'RocketChatApiError'; this.statusCode = statusCode; }
}
