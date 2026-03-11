import {
  type Screenshot,
  type ScreenshotRow,
  screenshotFromRow,
} from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";

export function createScreenshot(input: {
  resultId: string;
  stepNumber: number;
  action: string;
  filePath: string;
  width: number;
  height: number;
}): Screenshot {
  const db = getDatabase();
  const id = uuid();
  const timestamp = now();

  db.query(`
    INSERT INTO screenshots (id, result_id, step_number, action, file_path, width, height, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.resultId,
    input.stepNumber,
    input.action,
    input.filePath,
    input.width,
    input.height,
    timestamp,
  );

  return getScreenshot(id)!;
}

export function getScreenshot(id: string): Screenshot | null {
  const db = getDatabase();
  const row = db.query("SELECT * FROM screenshots WHERE id = ?").get(id) as ScreenshotRow | null;
  return row ? screenshotFromRow(row) : null;
}

export function listScreenshots(resultId: string): Screenshot[] {
  const db = getDatabase();
  const rows = db
    .query("SELECT * FROM screenshots WHERE result_id = ? ORDER BY step_number ASC")
    .all(resultId) as ScreenshotRow[];
  return rows.map(screenshotFromRow);
}

export function getScreenshotsByResult(resultId: string): Screenshot[] {
  return listScreenshots(resultId);
}
