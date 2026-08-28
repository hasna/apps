import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { join } from "path";
import { type Permissions, DEFAULT_PERMISSIONS } from "./history.js";
import { getTerminalDir } from "./paths.js";

interface Props {
  onDone: (perms: Permissions) => void;
}

type Step = "welcome" | "permissions";

const PERM_KEYS: Array<{ key: keyof Permissions; label: string; hint: string }> = [
  { key: "destructive",       label: "destructive",    hint: "rm, delete, drop…"          },
  { key: "network",           label: "network",        hint: "curl, wget, ssh…"            },
  { key: "sudo",              label: "sudo",           hint: "root-level commands"         },
  { key: "install",           label: "install",        hint: "brew, npm -g, pip…"          },
  { key: "write_outside_cwd", label: "write outside",  hint: "files outside current dir"   },
];

export default function Onboarding({ onDone }: Props) {
  const [step, setStep] = useState<Step>("welcome");
  const [cursor, setCursor] = useState(0);
  const [perms, setPerms] = useState<Permissions>({ ...DEFAULT_PERMISSIONS });

  // Show the effective config path (resolved through @hasna/paths), tildified
  // under $HOME so the hint stays readable wherever the data home points.
  const configPath = (() => {
    const dir = getTerminalDir();
    const home = process.env.HOME;
    const display = home && dir.startsWith(home) ? `~${dir.slice(home.length)}` : dir;
    return join(display, "config.json");
  })();

  useInput((input, key) => {
    if (key.ctrl && input === "c") process.exit(0);

    if (step === "welcome") {
      setStep("permissions");
      return;
    }

    if (step === "permissions") {
      if (key.upArrow)   { setCursor((c) => Math.max(0, c - 1)); return; }
      if (key.downArrow) { setCursor((c) => Math.min(PERM_KEYS.length - 1, c + 1)); return; }
      if (input === " ") {
        const k = PERM_KEYS[cursor].key;
        setPerms((p) => ({ ...p, [k]: !p[k] }));
        return;
      }
      if (key.return) { onDone(perms); return; }
    }
  });

  if (step === "welcome") {
    return (
      <Box flexDirection="column" paddingLeft={2} gap={1} paddingTop={1}>
        <Text>terminal</Text>
        <Text dimColor>speak plain english, run commands</Text>
        <Box flexDirection="column" marginTop={1} gap={0}>
          <Text dimColor>›  type what you want</Text>
          <Text dimColor>$  see the command before it runs</Text>
          <Text dimColor>↑↓  browse history</Text>
          <Text dimColor>?  explain a command before running</Text>
          <Text dimColor>ctrl+r  toggle raw shell mode</Text>
        </Box>
        <Box marginTop={1}><Text dimColor>any key to set permissions →</Text></Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingLeft={2} gap={1} paddingTop={1}>
      <Text dimColor>what can the AI run?</Text>
      <Box flexDirection="column" marginTop={1}>
        {PERM_KEYS.map((p, i) => {
          const active = cursor === i;
          const on = perms[p.key];
          return (
            <Box key={p.key} gap={2}>
              <Text dimColor>{active ? "›" : " "}</Text>
              <Text color={on ? undefined : "red"}>{on ? "✓" : "✗"}</Text>
              <Text bold={active}>{p.label}</Text>
              <Text dimColor>{p.hint}</Text>
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}><Text dimColor>space toggle  ·  enter confirm</Text></Box>
      <Text dimColor>edit later: {configPath}</Text>
    </Box>
  );
}
