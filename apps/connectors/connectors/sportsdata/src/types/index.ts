export interface SportsDataConfig { apiKey: string; }

export interface SDTeam { TeamID: number; Key: string; City: string; Name: string; Conference: string; Division: string; FullName: string; StadiumID: number; }
export interface SDGame { GameID: number; Season: number; Week: number; Status: string; DateTime: string; HomeTeam: string; AwayTeam: string; HomeScore: number | null; AwayScore: number | null; Quarter: string | null; }
export interface SDPlayer { PlayerID: number; Team: string; FirstName: string; LastName: string; Position: string; Status: string; Height: string; Weight: number; College: string; Experience: number; }
export interface SDStanding { Team: string; Wins: number; Losses: number; Percentage: number; Conference: string; Division: string; }
export interface SDScore { GameID: number; HomeTeam: string; AwayTeam: string; HomeScore: number; AwayScore: number; Status: string; DateTime: string; }

export class SportsDataApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'SportsDataApiError'; this.statusCode = statusCode; }
}
