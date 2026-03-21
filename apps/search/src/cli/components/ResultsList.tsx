import React from "react";
import { Box, Text } from "ink";
import type { SearchResult } from "../../types/index.js";

interface Props {
  results: SearchResult[];
  duration?: number;
}

export function ResultsList({ results, duration }: Props): React.JSX.Element {
  if (results.length === 0) {
    return <Text color="yellow">No results found</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text bold>
        {results.length} results{duration ? ` (${duration}ms)` : ""}
      </Text>
      <Text> </Text>
      {results.map((r) => (
        <Box key={r.id} flexDirection="column" marginBottom={1}>
          <Box>
            <Text dimColor>{String(r.rank).padStart(3)} </Text>
            <Text backgroundColor="cyan" color="black">
              {" "}
              {r.source}{" "}
            </Text>
            <Text> </Text>
            <Text bold color="blue">
              {r.title}
            </Text>
          </Box>
          <Text dimColor>     {r.url}</Text>
          {r.snippet ? (
            <Text>     {r.snippet.substring(0, 200)}</Text>
          ) : null}
        </Box>
      ))}
    </Box>
  );
}
