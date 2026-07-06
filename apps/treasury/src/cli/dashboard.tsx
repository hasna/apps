import React from "react";
import { Box, Text } from "ink";
import type { RunwayReport } from "../types/index.js";

function fmtMinor(minor: number): string {
  return (minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Minimal Ink cockpit view for `treasury dashboard`. */
export function renderDashboard(report: RunwayReport): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Text bold color="cyan">
        treasury — group cash cockpit
      </Text>
      <Text>
        cash: {fmtMinor(report.cash_in_base_minor)} {report.base_currency}
      </Text>
      <Text>
        monthly burn: {fmtMinor(report.monthly_burn_in_base_minor)} {report.base_currency}
      </Text>
      <Text>
        runway: {report.runway_months === null ? "∞ (no burn)" : `${report.runway_months} months`}
      </Text>
    </Box>
  );
}
