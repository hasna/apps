import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { type Permissions, DEFAULT_PERMISSIONS } from "./history.js";

interface Props {
  onDone: (perms: Permissions) => void;
}

type Step =
  | { type: "welcome" }
  | { type: "permissions"; cursor: number }
  | { type: "done" };

const PERM_KEYS: Array<{ key: keyof Permissions; label: string; description: string }> = [
  { key: "destructive", label: "destructive", description: "rm, delete, drop table…" },
  { key: "network",     label: "network",     description: "curl, wget, ssh, ping…"  },
  { key: "sudo",        label: "sudo",        description: "commands requiring root"  },
  { key: "install",     label: "install",     description: "brew, npm -g, pip…"       },
  { key: "write_outside_cwd", label: "write outside cwd", description: "files outside current directory" },
];

export default function Onboarding({ onDone }: Props) {
  const [step, setStep] = useState<Step>({ type: "welcome" });
  const [perms, setPerms] = useState<Permissions>({ ...DEFAULT_PERMISSIONS });

  useInput((input, key) => {
    if (key.ctrl && input === "c") process.exit(0);

    if (step.type === "welcome") {
      setStep({ type: "permissions", cursor: 0 });
      return;
    }

    if (step.type === "permissions") {
      const { cursor } = step;
      if (key.upArrow) {
        setStep({ type: "permissions", cursor: Math.max(0, cursor - 1) });
        return;
      }
      if (key.downArrow) {
        setStep({ type: "permissions", cursor: Math.min(PERM_KEYS.length - 1, cursor + 1) });
        return;
      }
      if (input === " ") {
        const k = PERM_KEYS[cursor].key;
        setPerms((p) => ({ ...p, [k]: !p[k] }));
        return;
      }
      if (key.return) {
        onDone(perms);
        return;
      }
      return;
    }
  });

  if (step.type === "welcome") {
    return (
      <Box flexDirection="column" paddingTop={1} gap={1}>
        <Text bold>terminal</Text>
        <Text>Type anything in plain English.</Text>
        <Text>The AI translates it to a shell command and runs it.</Text>
        <Text>Use ↑ / ↓ to browse history. Enter to run, n to cancel, e to edit.</Text>
        <Text dimColor>press any key to set up permissions →</Text>
      </Box>
    );
  }

  if (step.type === "permissions") {
    return (
      <Box flexDirection="column" paddingTop={1} gap={1}>
        <Text bold>what can the AI do?</Text>
        <Text dimColor>space to toggle  ·  enter to confirm</Text>
        <Box flexDirection="column" marginTop={1}>
          {PERM_KEYS.map((p, i) => {
            const active = step.cursor === i;
            const on = perms[p.key];
            return (
              <Box key={p.key} gap={2}>
                <Text>{active ? "›" : " "}</Text>
                <Text color={on ? undefined : "red"}>{on ? "✓" : "✗"}</Text>
                <Text bold={active}>{p.label}</Text>
                <Text dimColor>{p.description}</Text>
              </Box>
            );
          })}
        </Box>
        <Text dimColor>you can change this later in ~/.terminal/config.json</Text>
      </Box>
    );
  }

  return null;
}
