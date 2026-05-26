export interface LINEConfig { channelAccessToken: string; }

export interface LINEProfile { userId: string; displayName: string; pictureUrl: string; statusMessage: string; language: string; }
export interface LINEMessage { type: 'text' | 'image' | 'video' | 'audio' | 'location' | 'sticker' | 'flex'; text?: string; originalContentUrl?: string; previewImageUrl?: string; title?: string; address?: string; latitude?: number; longitude?: number; packageId?: string; stickerId?: string; altText?: string; contents?: Record<string, unknown>; }
export interface LINESendResult { sentMessages: { id: string; quoteToken: string }[]; }
export interface LINERichMenu { richMenuId: string; name: string; size: { width: number; height: number }; chatBarText: string; selected: boolean; areas: { bounds: { x: number; y: number; width: number; height: number }; action: Record<string, unknown> }[]; }
export interface LINEGroupSummary { groupId: string; groupName: string; pictureUrl: string; }
export interface LINEQuota { type: string; value: number; }

export class LINEApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'LINEApiError'; this.statusCode = statusCode; }
}
