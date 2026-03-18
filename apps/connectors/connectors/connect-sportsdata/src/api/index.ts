// SportsData Connector — Real-time sports data, scores, and statistics
import { SportsDataClient } from './client';
import type { SportsDataConfig, SDTeam, SDGame, SDPlayer, SDStanding, SDScore } from '../types';
export { SportsDataClient } from './client';

export class SportsData {
  private readonly client: SportsDataClient;
  constructor(config: SportsDataConfig) { this.client = new SportsDataClient(config); }
  static fromEnv(): SportsData {
    const apiKey = process.env.SPORTSDATA_API_KEY;
    if (!apiKey) throw new Error('SPORTSDATA_API_KEY is required');
    return new SportsData({ apiKey });
  }

  // NFL
  async getNFLTeams(): Promise<SDTeam[]> { return this.client.request<SDTeam[]>('nfl', '/Teams'); }
  async getNFLSchedule(season: string): Promise<SDGame[]> { return this.client.request<SDGame[]>('nfl', `/Schedules/${season}`); }
  async getNFLScores(season: string, week: number): Promise<SDScore[]> { return this.client.request<SDScore[]>('nfl', `/ScoresByWeek/${season}/${week}`); }
  async getNFLStandings(season: string): Promise<SDStanding[]> { return this.client.request<SDStanding[]>('nfl', `/Standings/${season}`); }
  async getNFLPlayers(): Promise<SDPlayer[]> { return this.client.request<SDPlayer[]>('nfl', '/Players'); }

  // NBA
  async getNBATeams(): Promise<SDTeam[]> { return this.client.request<SDTeam[]>('nba', '/Teams'); }
  async getNBAScores(date: string): Promise<SDScore[]> { return this.client.request<SDScore[]>('nba', `/ScoresByDate/${date}`); }
  async getNBAStandings(season: string): Promise<SDStanding[]> { return this.client.request<SDStanding[]>('nba', `/Standings/${season}`); }

  // MLB
  async getMLBTeams(): Promise<SDTeam[]> { return this.client.request<SDTeam[]>('mlb', '/Teams'); }
  async getMLBScores(date: string): Promise<SDScore[]> { return this.client.request<SDScore[]>('mlb', `/ScoresByDate/${date}`); }

  // Soccer
  async getSoccerCompetitions(): Promise<{ CompetitionId: number; Name: string; AreaName: string }[]> {
    return this.client.request('soccer', '/Competitions');
  }

  getClient(): SportsDataClient { return this.client; }
}
