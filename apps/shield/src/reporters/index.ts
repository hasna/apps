import type { Finding, Scan } from "../types/index.js";
import { ReportFormat } from "../types/index.js";
import { reportFindings as jsonReport } from "./json.js";
import { reportFindings as sarifReport } from "./sarif.js";
import { reportFindings as terminalReport } from "./terminal.js";

export interface Reporter {
  format: ReportFormat;
  report: (findings: Finding[], scan?: Scan) => string | void;
}

const terminalReporter: Reporter = {
  format: ReportFormat.Terminal,
  report: (findings: Finding[]) => {
    terminalReport(findings);
  },
};

const jsonReporter: Reporter = {
  format: ReportFormat.Json,
  report: (findings: Finding[], scan?: Scan) => jsonReport(findings, scan),
};

const sarifReporter: Reporter = {
  format: ReportFormat.Sarif,
  report: (findings: Finding[], scan?: Scan) => sarifReport(findings, scan),
};

const reporters: Record<ReportFormat, Reporter> = {
  [ReportFormat.Terminal]: terminalReporter,
  [ReportFormat.Json]: jsonReporter,
  [ReportFormat.Sarif]: sarifReporter,
};

export function getReporter(format: ReportFormat): Reporter {
  return reporters[format];
}

export { terminalReport, jsonReport, sarifReport };
