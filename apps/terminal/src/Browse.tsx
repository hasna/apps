import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { readdirSync, statSync } from "fs";
import { join, dirname } from "path";

interface BrowseProps {
  cwd: string;
  onCd: (path: string) => void;
  onSelect: (path: string) => void;
  onExit: () => void;
}

interface Entry {
  name: string;
  isDir: boolean;
}

function readDir(dir: string): Entry[] {
  try {
    const names = readdirSync(dir);
    const entries: Entry[] = [];
    for (const name of names) {
      try {
        const stat = statSync(join(dir, name));
        entries.push({ name, isDir: stat.isDirectory() });
      } catch {
        entries.push({ name, isDir: false });
      }
    }
    entries.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return entries;
  } catch {
    return [];
  }
}

const PAGE = 20;

export default function Browse({ cwd, onCd, onSelect, onExit }: BrowseProps) {
  const [cursor, setCursor] = useState(0);

  const entries = readDir(cwd);
  const total = entries.length;

  const safeIndex = Math.min(cursor, Math.max(0, total - 1));

  const start = Math.max(0, Math.min(safeIndex - Math.floor(PAGE / 2), total - PAGE));
  const slice = entries.slice(Math.max(0, start), Math.max(0, start) + PAGE);

  useInput(useCallback((_input: string, key: any) => {
    if (key.upArrow) {
      setCursor(c => (c <= 0 ? Math.max(0, total - 1) : c - 1));
      return;
    }
    if (key.downArrow) {
      setCursor(c => (total === 0 ? 0 : (c >= total - 1 ? 0 : c + 1)));
      return;
    }
    if (key.return) {
      if (total === 0) return;
      const entry = entries[safeIndex];
      if (!entry) return;
      const full = join(cwd, entry.name);
      if (entry.isDir) {
        setCursor(0);
        onCd(full);
      } else {
        onSelect(full);
      }
      return;
    }
    if (key.backspace || key.delete || key.leftArrow) {
      setCursor(0);
      onCd(dirname(cwd));
      return;
    }
    if (key.escape) {
      onExit();
      return;
    }
  }, [cwd, entries, safeIndex, total, onCd, onSelect, onExit]));

  return (
    <Box flexDirection="column">
      <Text dimColor>{cwd}</Text>
      {total === 0 && <Text dimColor>  (empty)</Text>}
      {slice.map((entry, i) => {
        const absIdx = Math.max(0, start) + i;
        const selected = absIdx === safeIndex;
        const icon = entry.isDir ? "▸" : "·";
        return (
          <Box key={entry.name}>
            <Text inverse={selected}>{` ${icon} ${entry.name}${entry.isDir ? "/" : ""} `}</Text>
          </Box>
        );
      })}
      <Text dimColor>{"  enter  backspace  esc"}</Text>
    </Box>
  );
}
