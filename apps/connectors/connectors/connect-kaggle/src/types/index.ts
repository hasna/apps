export interface KaggleConfig { username: string; key: string; }

export interface KGDataset { ref: string; title: string; subtitle: string; creator: string; totalBytes: number; url: string; downloadCount: number; voteCount: number; usabilityRating: number; lastUpdated: string; }
export interface KGCompetition { ref: string; title: string; description: string; category: string; reward: string; deadline: string; teamCount: number; enabledDate: string; }
export interface KGKernel { ref: string; title: string; author: string; language: string; totalVotes: number; lastRunTime: string; }
export interface KGLeaderboardEntry { teamId: number; teamName: string; submissionDate: string; score: number; }

export class KaggleApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'KaggleApiError'; this.statusCode = statusCode; }
}
