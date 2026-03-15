import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";

interface FuzzyPickerProps {
  history: string[];
  onSelect: (nl: string) => void;
  onExit: () => void;
}

const MAX_MATCHES = 10;

export default function FuzzyPicker({ history, onSelect, onExit }: FuzzyPickerProps) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);

  const matches = query === ""
    ? history.slice().reverse().slice(0, MAX_MATCHES)
    : history.slice().reverse().filter(h => h.toLowerCase().includes(query.toLowerCase())).slice(0, MAX_MATCHES);

  const safeCursor = Math.min(cursor, Math.max(0, matches.length - 1));

  useInput(useCallback((_input: string, key: any) => {
    if (key.escape || key.ctrl && _input === "c") {
      onExit();
      return;
    }
    if (key.return) {
      if (matches.length > 0) {
        onSelect(matches[safeCursor]);
      }
      return;
    }
    if (key.upArrow) {
      setCursor(c => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow) {
      setCursor(c => Math.min(matches.length - 1, c + 1));
      return;
    }
    if (key.backspace || key.delete) {
      setQuery(q => q.slice(0, -1));
      setCursor(0);
      return;
    }
    if (!key.ctrl && !key.meta && _input && _input.length === 1) {
      setQuery(q => q + _input);
      setCursor(0);
    }
  }, [matches, safeCursor, onSelect, onExit]));

  return (
    <Box flexDirection="column">
      <Text>{`  / ${query}_`}</Text>
      {matches.length === 0
        ? <Text dimColor>{"  no matches"}</Text>
        : matches.map((m, i) => {
            const selected = i === safeCursor;
            return (
              <Box key={i}>
                <Text inverse={selected} dimColor={!selected}>{`  ${m} `}</Text>
              </Box>
            );
          })
      }
      <Text dimColor>{"  enter  esc"}</Text>
    </Box>
  );
}
