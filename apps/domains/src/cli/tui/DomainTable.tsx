import React from "react";
import { Box, Text } from "ink";
import type { Domain } from "../../db/domains.js";
import {
  TABLE_COLS,
  STATUS_COLORS,
  clampSelectedIndex,
  daysUntil,
  formatDate,
  pad,
} from "./format.js";

const VISIBLE_ROWS = 16;

interface DomainTableProps {
  domains: Domain[];
  selectedIndex: number;
  compact?: boolean;
  emptyMessage?: string;
}

export function DomainTable({
  domains,
  selectedIndex,
  compact = false,
  emptyMessage = "No domains match this filter. Press [f] to change filter or [r] to refresh.",
}: DomainTableProps) {
  if (domains.length === 0) {
    return (
      <Box flexDirection="column" paddingLeft={compact ? 0 : 1}>
        <Text dimColor>{emptyMessage}</Text>
      </Box>
    );
  }

  const safeSelectedIndex = clampSelectedIndex(selectedIndex, domains.length);

  const start = Math.max(
    0,
    Math.min(
      safeSelectedIndex - Math.floor(VISIBLE_ROWS / 2),
      Math.max(0, domains.length - VISIBLE_ROWS),
    ),
  );
  const visible = domains.slice(start, start + VISIBLE_ROWS);

  return (
    <Box flexDirection="column" width="100%" paddingRight={0}>
      <Box>
        <Text bold dimColor>
          {pad("NAME", TABLE_COLS.name)}
          {pad("STATUS", TABLE_COLS.status)}
          {pad("EXPIRES", TABLE_COLS.expires)}
          {pad("REGISTRAR", TABLE_COLS.registrar)}
          {!compact ? " TTL" : ""}
        </Text>
      </Box>
      <Text dimColor>{"─".repeat(TABLE_COLS.name + TABLE_COLS.status + TABLE_COLS.expires + TABLE_COLS.registrar + (compact ? 0 : 6))}</Text>

      {start > 0 && (
        <Text dimColor>  ↑ {start} more above</Text>
      )}

      {visible.map((domain, offset) => {
        const index = start + offset;
        const selected = index === safeSelectedIndex;
        const statusColor = STATUS_COLORS[domain.status] ?? "white";

        return (
          <Box key={domain.id}>
            <Text color={selected ? "cyan" : undefined} bold={selected}>
              {selected ? "❯ " : "  "}
            </Text>
            <Text bold={selected}>{pad(domain.name, TABLE_COLS.name)}</Text>
            <Text color={statusColor}>{pad(domain.status, TABLE_COLS.status)}</Text>
            <Text>{pad(formatDate(domain.expires_at), TABLE_COLS.expires)}</Text>
            <Text dimColor>{pad(domain.registrar ?? "—", TABLE_COLS.registrar)}</Text>
            {!compact && <Text dimColor> {daysUntil(domain.expires_at)}</Text>}
          </Box>
        );
      })}

      {start + visible.length < domains.length && (
        <Text dimColor>  ↓ {domains.length - start - visible.length} more below</Text>
      )}
    </Box>
  );
}
