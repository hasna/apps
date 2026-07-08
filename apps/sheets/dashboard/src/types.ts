export type { Sheet, Workbook } from "@hasna/sheets";

export interface StatusMessage {
  kind: "info" | "error";
  text: string;
}
