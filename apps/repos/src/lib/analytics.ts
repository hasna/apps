import { getDb } from "../db/database.js";

export interface ActivityHeatmap {
  // day_of_week (0=Sun) x hour (0-23) -> commit count
  grid: number[][];
  total: number;
  most_active_day: string;
  most_active_hour: number;
}

export interface ContributorStats {
  author_name: string;
  author_email: string;
  commit_count: number;
  first_commit: string;
  last_commit: string;
  repos: string[];
  insertions: number;
  deletions: number;
}

export interface StaleRepo {
  id: number;
  name: string;
  path: string;
  org: string | null;
  last_commit_date: string | null;
  days_stale: number;
}

export interface LanguageBreakdown {
  language: string;
  repo_count: number;
  repos: string[];
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function getActivityHeatmap(repo_id?: number): ActivityHeatmap {
  const db = getDb();
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  let total = 0;

  const where = repo_id ? "WHERE repo_id = ?" : "";
  const params = repo_id ? [repo_id] : [];

  const rows = db.query(`
    SELECT
      CAST(strftime('%w', date) AS INTEGER) as dow,
      CAST(strftime('%H', date) AS INTEGER) as hour,
      COUNT(*) as count
    FROM commits ${where}
    GROUP BY dow, hour
  `).all(...params) as Array<{ dow: number; hour: number; count: number }>;

  for (const row of rows) {
    grid[row.dow]![row.hour] = row.count;
    total += row.count;
  }

  // Find most active
  let maxDay = 0, maxDayCount = 0;
  let maxHour = 0, maxHourCount = 0;

  for (let d = 0; d < 7; d++) {
    const dayTotal = grid[d]!.reduce((a, b) => a + b, 0);
    if (dayTotal > maxDayCount) { maxDay = d; maxDayCount = dayTotal; }
  }

  const hourTotals = Array(24).fill(0);
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      hourTotals[h] += grid[d]![h]!;
    }
  }
  for (let h = 0; h < 24; h++) {
    if (hourTotals[h] > maxHourCount) { maxHour = h; maxHourCount = hourTotals[h]; }
  }

  return { grid, total, most_active_day: DAY_NAMES[maxDay]!, most_active_hour: maxHour };
}

export function getContributorStats(opts: { repo_id?: number; limit?: number } = {}): ContributorStats[] {
  const db = getDb();
  const { repo_id, limit = 20 } = opts;

  const where = repo_id ? "WHERE c.repo_id = ?" : "";
  const params: any[] = repo_id ? [repo_id] : [];
  params.push(limit);

  return db.query(`
    SELECT
      c.author_name,
      c.author_email,
      COUNT(*) as commit_count,
      MIN(c.date) as first_commit,
      MAX(c.date) as last_commit,
      GROUP_CONCAT(DISTINCT r.name) as repos,
      SUM(c.insertions) as insertions,
      SUM(c.deletions) as deletions
    FROM commits c
    JOIN repos r ON r.id = c.repo_id
    ${where}
    GROUP BY c.author_email
    ORDER BY commit_count DESC
    LIMIT ?
  `).all(...params).map((row: any) => ({
    ...row,
    repos: row.repos ? row.repos.split(",") : [],
  })) as ContributorStats[];
}

export function getStaleRepos(days = 30): StaleRepo[] {
  const db = getDb();
  return db.query(`
    SELECT
      r.id, r.name, r.path, r.org,
      MAX(c.date) as last_commit_date,
      CAST(julianday('now') - julianday(MAX(c.date)) AS INTEGER) as days_stale
    FROM repos r
    LEFT JOIN commits c ON c.repo_id = r.id
    GROUP BY r.id
    HAVING last_commit_date IS NULL OR last_commit_date < datetime('now', '-' || ? || ' days')
    ORDER BY days_stale DESC
  `).all(days) as StaleRepo[];
}

export function getRecentActivity(days = 7, limit = 20): Array<{
  repo_name: string;
  commit_count: number;
  last_commit: string;
  authors: string[];
}> {
  const db = getDb();
  return db.query(`
    SELECT
      r.name as repo_name,
      COUNT(c.id) as commit_count,
      MAX(c.date) as last_commit,
      GROUP_CONCAT(DISTINCT c.author_name) as authors
    FROM repos r
    JOIN commits c ON c.repo_id = r.id
    WHERE c.date >= datetime('now', '-' || ? || ' days')
    GROUP BY r.id
    ORDER BY commit_count DESC
    LIMIT ?
  `).all(days, limit).map((row: any) => ({
    ...row,
    authors: row.authors ? row.authors.split(",") : [],
  })) as any;
}
