export interface MiroConfig { token: string; }

export interface MRBoard { id: string; name: string; description: string; owner: { id: string; name: string }; team: { id: string; name: string }; createdAt: string; modifiedAt: string; viewLink: string; }
export interface MRBoardList { data: MRBoard[]; total: number; size: number; offset: number; }
export interface MRItem { id: string; type: string; data: Record<string, unknown>; position: { x: number; y: number }; geometry: { width: number; height: number }; createdAt: string; modifiedAt: string; }
export interface MRItemList { data: MRItem[]; total: number; size: number; cursor: string | null; }
export interface MRStickyNote { id: string; type: 'sticky_note'; data: { content: string; shape: string }; style: { fillColor: string; textAlign: string }; position: { x: number; y: number }; }
export interface MRFrame { id: string; type: 'frame'; data: { title: string }; position: { x: number; y: number }; geometry: { width: number; height: number }; }
export interface MRConnector { id: string; startItem: { id: string }; endItem: { id: string }; style: Record<string, unknown>; }

export class MiroApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'MiroApiError'; this.statusCode = statusCode; }
}
