import React from "react";
import { Box, Text } from "ink";
import type { DomainFilter } from "./format.js";
import { filterLabel } from "./format.js";

interface HeaderProps {
  count: number;
  filter: DomainFilter;
  view: "list" | "detail" | "search";
}

export function Header({ count, filter, view }: HeaderProps) {
  const viewLabel =
    view === "list" ? "Portfolio" : view === "detail" ? "Detail" : "Search";

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text bold color="cyan">
          domains
        </Text>
        <Text dimColor> — interactive portfolio browser</Text>
      </Box>
      <Box>
        <Text dimColor>
          {viewLabel} · {filterLabel(filter)} · {count} domain{count === 1 ? "" : "s"}
        </Text>
      </Box>
    </Box>
  );
}
