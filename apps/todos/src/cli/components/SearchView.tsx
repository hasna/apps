import { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { Task } from "../../types/index.js";

interface SearchViewProps {
  results: Task[];
  onSearch: (query: string) => void;
  onSelect: (task: Task) => void;
  onBack: () => void;
}

const statusColors: Record<string, string> = {
  pending: "yellow",
  in_progress: "blue",
  completed: "green",
  failed: "red",
  cancelled: "gray",
};

export function SearchView({ results, onSearch, onSelect, onBack }: SearchViewProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isTyping, setIsTyping] = useState(true);

  useInput((input, key) => {
    if (key.escape) {
      if (!isTyping) {
        setIsTyping(true);
      } else {
        onBack();
      }
      return;
    }

    if (isTyping) {
      if (key.return) {
        onSearch(query);
        setIsTyping(false);
        setSelectedIndex(0);
      } else if (key.backspace || key.delete) {
        setQuery((q) => q.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) {
        setQuery((q) => q + input);
      }
    } else {
      if (key.upArrow) {
        setSelectedIndex((i) => Math.max(0, i - 1));
      } else if (key.downArrow) {
        setSelectedIndex((i) => Math.min(results.length - 1, i + 1));
      } else if (key.return && results[selectedIndex]) {
        onSelect(results[selectedIndex]);
      } else if (input === "/") {
        setIsTyping(true);
      }
    }
  });

  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Box marginBottom={1}>
        <Text dimColor>[esc] back  [enter] search/select  [/] new search</Text>
      </Box>

      <Box>
        <Text dimColor>Search: </Text>
        <Text color={isTyping ? "cyan" : undefined}>
          {query}
          {isTyping ? "▌" : ""}
        </Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {results.length === 0 && !isTyping && (
          <Text dimColor>No results found.</Text>
        )}
        {results.map((task, index) => {
          const isSelected = index === selectedIndex && !isTyping;
          return (
            <Box key={task.id}>
              <Text color={isSelected ? "cyan" : undefined} bold={isSelected}>
                {isSelected ? "❯ " : "  "}
              </Text>
              <Text color={statusColors[task.status] || "white"}>
                [{task.status}]{" "}
              </Text>
              <Text dimColor>{task.id.slice(0, 8)} </Text>
              <Text>{task.title}</Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
